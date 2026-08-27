"""POST /api/refine — re-orchestrate with feedback injection."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth import CurrentUser
from app.agents.orchestrator import orchestrate
from app.agents.refine_utils import build_feedback_summary, build_refinement_deltas
from app.supabase_client import get_user_client

router = APIRouter()


@router.post("/api/refine")
async def refine(request: Request, user: CurrentUser):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid request body"}, status_code=400)

    session_id = body.get("sessionId")
    message_id = body.get("messageId")
    focus = body.get("focus")

    if not session_id or not message_id:
        return JSONResponse(
            {"ok": False, "error": "sessionId and messageId are required"},
            status_code=400,
        )

    token = user.get("_access_token", "")
    supabase = get_user_client(token)
    if not supabase:
        return JSONResponse({"ok": False, "error": "supabase unavailable"}, status_code=500)

    msg = (
        supabase.table("chat_messages")
        .select("id, content, metadata, created_at")
        .eq("id", message_id)
        .eq("session_id", session_id)
        .single()
        .execute()
    )
    if not msg.data:
        return JSONResponse(
            {
                "ok": False,
                "error": "Saved message not found for this session (it may not have been persisted yet). Wait for the run to save, or send a new query.",
            },
            status_code=404,
        )

    metadata = msg.data.get("metadata") or {}
    orchestrator_output = metadata.get("orchestratorOutput")
    if not orchestrator_output or not orchestrator_output.get("outputs"):
        return JSONResponse(
            {
                "ok": False,
                "error": "This message has no saved research outputs. Run a full intelligence query first, then use Refine.",
            },
            status_code=400,
        )

    feedback_res = (
        supabase.table("recommendation_feedback")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .limit(30)
        .execute()
    )
    actions_res = (
        supabase.table("recommendation_actions")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .limit(30)
        .execute()
    )
    results_res = (
        supabase.table("variant_results")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .limit(30)
        .execute()
    )

    feedback_data = feedback_res.data or []
    actions_data = actions_res.data or []
    results_data = results_res.data or []

    feedback_summary = build_feedback_summary(
        feedback_data, actions_data, results_data, focus
    )
    feedback_applied = {
        "recommendationFeedback": len(feedback_data),
        "recommendationActions": len(actions_data),
        "variantResults": len(results_data),
    }

    history_rows = (
        supabase.table("chat_messages")
        .select("role, content, created_at")
        .eq("session_id", session_id)
        .lte("created_at", msg.data["created_at"])
        .order("created_at")
        .limit(80)
        .execute()
    )
    history = [
        {
            "role": row["role"],
            "content": row["content"],
            "timestamp": row.get("created_at"),
        }
        for row in (history_rows.data or [])
    ]

    refined_query = focus or orchestrator_output.get("query") or ""

    try:
        refined_output = await orchestrate(
            refined_query,
            history,
            force_execution=True,
            injected_context=feedback_summary,
        )
    except Exception as err:
        return JSONResponse(
            {"ok": False, "error": f"Re-orchestration failed: {err}"},
            status_code=500,
        )

    deltas = build_refinement_deltas(
        orchestrator_output.get("outputs") or [],
        refined_output.get("outputs") or [],
    )

    delta_lines = [f"- {d.get('summary', '')}" for d in deltas[:3]]
    synthesized = refined_output.get("synthesizedAnswer", "")
    if delta_lines:
        synthesized = f"{synthesized}\n\nFeedback-driven updates:\n" + "\n".join(delta_lines)

    enriched = {
        **refined_output,
        "synthesizedAnswer": synthesized,
        "refinement": {
            "refinedFromMessageId": message_id,
            "focus": focus,
            "feedbackApplied": feedback_applied,
            "deltas": deltas,
            "feedbackSummary": feedback_summary,
        },
    }

    new_plan = next(
        (o for o in enriched.get("outputs") or [] if o.get("artifactType") == "execution-plan"),
        None,
    )
    if not new_plan:
        exec_run = next(
            (r for r in refined_output.get("agentRuns") or [] if r.get("agentId") == "execution-engine"),
            None,
        )
        why = (
            f"Execution step failed: {exec_run.get('error')}"
            if exec_run and exec_run.get("status") == "failed" and exec_run.get("error")
            else "The refined run completed without an execution-plan artifact (execution may have been skipped or errored)."
        )
        return JSONResponse({"ok": False, "error": why}, status_code=500)

    return {
        "ok": True,
        "executionPlan": new_plan,
        "orchestratorOutput": enriched,
        "feedbackApplied": feedback_applied,
        "changes": deltas,
    }
