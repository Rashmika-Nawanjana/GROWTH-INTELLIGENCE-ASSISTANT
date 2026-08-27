"""POST /api/chat — SSE orchestration stream."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.auth import CurrentUser
from app.agents.orchestrator import orchestrate, run_mirofish_agent, run_mirofish_live_agent

router = APIRouter()

LIVE_COST_PER_AGENT = (2000 * (0.1 / 1_000_000)) + (1000 * (0.4 / 1_000_000))


def _encode(chunk: dict[str, Any]) -> str:
    return f"data: {json.dumps(chunk, default=str)}\n\n"


@router.post("/api/chat")
async def chat(request: Request, user: CurrentUser):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    query = (body.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    history = body.get("history") or []
    images = body.get("images") or []
    memory_context = body.get("memoryContext")
    include_mirofish = bool(body.get("includeMirofish", False))
    include_mirofish_live = bool(body.get("includeMirofishLive", False))
    follow_up_mode = body.get("followUpMode") or "full"
    selected_agents = body.get("selectedAgents") or []

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    orchestration_start = time.time()
    live_agent_state: dict[str, str] = {}
    loop = asyncio.get_running_loop()

    def compute_live_metrics() -> dict[str, Any]:
        completed = failed = running = 0
        for status in live_agent_state.values():
            if status == "completed":
                completed += 1
            elif status == "failed":
                failed += 1
            elif status == "running":
                running += 1
        billed = completed + failed + 1
        return {
            "elapsedMs": int((time.time() - orchestration_start) * 1000),
            "agentCount": len(live_agent_state),
            "completedAgentCount": completed,
            "failedAgentCount": failed,
            "runningAgentCount": running,
            "estimatedCostUsd": float(f"{billed * LIVE_COST_PER_AGENT:.5f}"),
            "geminiCallCount": billed,
            "toolCallCount": (completed + failed) * 3,
        }

    def enqueue(chunk: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, _encode(chunk))

    async def run_pipeline() -> None:
        try:
            await queue.put(_encode({"type": "orchestration_log", "line": "Starting orchestration…"}))

            def on_agent_update(run: dict[str, Any]) -> None:
                live_agent_state[run["agentId"]] = run["status"]
                enqueue(
                    {
                        "type": "agent_update",
                        "run": run,
                        "metrics": compute_live_metrics(),
                    }
                )

            def on_log(line: str) -> None:
                enqueue({"type": "orchestration_log", "line": line})

            result = await orchestrate(
                query,
                history,
                on_agent_update=on_agent_update,
                images=images,
                memory_context=memory_context,
                follow_up_mode=follow_up_mode,
                selected_agents=selected_agents,
                on_orchestration_log=on_log,
            )
            await queue.put(_encode({"type": "result", "output": result}))

            if include_mirofish:
                try:
                    mf = await run_mirofish_agent(
                        query,
                        history,
                        on_agent_update=on_agent_update,
                        images=images,
                        memory_context=memory_context,
                        on_orchestration_log=on_log,
                    )
                    if mf:
                        await queue.put(_encode({"type": "mirofish_result", "output": mf}))
                except Exception:
                    pass

            if include_mirofish_live:
                try:
                    mfl = await run_mirofish_live_agent(
                        query,
                        history,
                        on_agent_update=on_agent_update,
                        images=images,
                        memory_context=memory_context,
                        on_orchestration_log=on_log,
                    )
                    if mfl:
                        await queue.put(_encode({"type": "mirofish_live_result", "output": mfl}))
                except Exception:
                    pass
        except Exception as err:
            await queue.put(_encode({"type": "error", "message": str(err) or "Internal error"}))
        finally:
            await queue.put(None)

    async def event_generator():
        task = asyncio.create_task(run_pipeline())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
