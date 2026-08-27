"""Multi-agent orchestrator — classifies, fans out research agents, synthesizes (parity with lib/agents/orchestrator.ts)."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

from app.agents import RESEARCH_AGENTS
from app.agents.execution import execution_engine
from app.agents.execution_intent import detect_execution_intent
from app.agents.mirofish import run as run_mirofish
from app.agents.mirofish_live import run as run_mirofish_live
from app.gemini import generate_text
from app.models import score_to_level
from app.tools.source_validator import filter_and_rank_sources

# Cost estimation constants (heuristic UI metrics)
EST_INPUT_TOKENS_PER_CALL = 2000
EST_OUTPUT_TOKENS_PER_CALL = 1000
COST_PER_INPUT_TOKEN = 0.10 / 1_000_000
COST_PER_OUTPUT_TOKEN = 0.40 / 1_000_000
EST_COST_PER_MODEL_CALL = (
    EST_INPUT_TOKENS_PER_CALL * COST_PER_INPUT_TOKEN
    + EST_OUTPUT_TOKENS_PER_CALL * COST_PER_OUTPUT_TOKEN
)

VALID_DOMAINS = frozenset(
    {"market-trends", "competitive", "win-loss", "pricing", "positioning", "adjacent"}
)


def _strip_json_fences(raw: str) -> str:
    text = raw.strip()
    text = re.sub(r"^```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _safe_parse_json(raw: str) -> dict[str, Any]:
    try:
        return json.loads(_strip_json_fences(raw))
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return {}


def _normalize_domains(raw_domains: Any) -> list[str]:
    if not isinstance(raw_domains, list):
        return ["market-trends", "competitive", "win-loss"]
    filtered = [d for d in raw_domains if isinstance(d, str) and d in VALID_DOMAINS]
    if len(filtered) >= 3:
        return filtered
    merged = list(dict.fromkeys([*filtered, "market-trends", "competitive", "win-loss"]))
    return merged[:6]


async def _classify_query(
    query: str,
    history: list[dict[str, Any]],
    images: list[Any] | None = None,
    memory_context: str | None = None,
) -> dict[str, Any]:
    images = images or []
    prior_context = "\n".join(
        f"{'User' if m.get('role') == 'user' else 'AI'}: {m.get('content', '')}"
        for m in history[-6:]
    )

    prompt = f"""You are a query classifier for a growth intelligence system. Extract structured information using conversation history and persistent user memory.

{f"{memory_context}\n\n" if memory_context else ""}Conversation history:
{prior_context or "None"}

Current query: "{query}"

Respond with JSON:
{{
  "product": string,
  "competitor": string | null,
  "productUrl": string | null,
  "competitorUrl": string | null,
  "domains": string[],
  "intent": string,
  "runExecution": boolean
}}

Domain selection rules:
- "vs", "compare", "competitive" → include competitive, win-loss, positioning
- "market", "trend", "category", "growing" → include market-trends
- "pricing", "cost", "expensive" → include pricing
- "messaging", "positioning", "marketing" → include positioning
- "disruption", "threat", "outside", "adjacent" → include adjacent
- "build", "roadmap", "strategy" → include market-trends, competitive, adjacent
- Vague / broad queries → include all 6 domains
- Always include at least 3 domains

Execution intent detection (set runExecution: true if ANY of these apply):
- Generation verbs combined with marketing or outreach artifacts
- Standalone phrases: "campaign brief", "one-pager", "positioning guide", etc.
- A/B testing language: "variants", "A/B", "hypothesis", etc.
- Deployment verbs combined with campaign/outreach/copy
- Bare imperatives that start with a generation verb

Set runExecution: false for pure research questions."""

    regex_execution = detect_execution_intent(query)

    try:
        image_note = ""
        if images:
            image_note = (
                f"\n\nAttached images: {len(images)}. Use them as contextual metadata only; "
                "the specialist agents inspect the actual image content."
            )
        raw = await generate_text(prompt + image_note, max_new_tokens=512, temperature=0.1)
        parsed = _safe_parse_json(raw)
        run_exec = bool(parsed.get("runExecution")) or regex_execution
        return {
            "product": parsed.get("product") or "the product",
            "competitor": parsed.get("competitor") or None,
            "productUrl": parsed.get("productUrl") or None,
            "competitorUrl": parsed.get("competitorUrl") or None,
            "domains": _normalize_domains(parsed.get("domains")),
            "intent": parsed.get("intent") or query,
            "runExecution": run_exec,
        }
    except Exception:
        return {
            "product": "the current product",
            "competitor": None,
            "productUrl": None,
            "competitorUrl": None,
            "domains": list(VALID_DOMAINS),
            "intent": query,
            "runExecution": regex_execution,
        }


def _build_fallback_answer(outputs: list[dict[str, Any]], query: str) -> str:
    if not outputs:
        return f'I couldn\'t retrieve signal data for "{query}". Please check your API keys and try again.'
    clean_facts = [
        f for o in outputs for f in (o.get("facts") or []) if not str(f).startswith("[")
    ][:4]
    domains = ", ".join((o.get("domain") or "").replace("-", " ") for o in outputs)
    if clean_facts:
        bullets = "\n".join(f"• {f}" for f in clean_facts)
        return f"Based on intelligence gathered across {domains}:\n\n{bullets}"
    return (
        f"Intelligence gathered from {len(outputs)} agents covering: {domains}. "
        "Expand the Agent Findings below for detailed insights."
    )


async def _synthesize(
    query: str,
    outputs: list[dict[str, Any]],
    history: list[dict[str, Any]],
    images: list[Any] | None = None,
    memory_context: str | None = None,
) -> dict[str, Any]:
    images = images or []
    prior_summary = "\n".join(
        str(m.get("content", ""))[:300]
        for m in history[-4:]
        if m.get("role") == "assistant"
    )

    output_summaries = [
        {
            "domain": o.get("domain"),
            "confidence": o.get("confidence"),
            "facts": (o.get("facts") or [])[:4],
            "interpretation": (o.get("interpretation") or [])[:3],
        }
        for o in outputs
    ]

    prompt = f"""You are the synthesis layer of a multi-agent growth intelligence system. Your job is to produce a clean, direct, well-written answer.

Original query: "{query}"
{f"{memory_context}\n" if memory_context else ""}{f"Prior conversation context:\n{prior_summary}\n" if prior_summary else ""}
Agent findings from {len(outputs)} specialist agents:
{json.dumps(output_summaries, indent=2)}

Rules:
1. If the query asks a FACTUAL question (revenue, funding amount, year founded, etc.), lead with the direct answer in the first sentence.
2. Write in clean prose — no raw tool labels like [WEB], [NEWS], [REDDIT]. Never output bracket prefixes.
3. Reference insights by domain only when relevant (e.g. "Competitive data shows...").
4. Be specific and concrete — cite actual company names, numbers, trends from the findings.
5. Keep the "answer" field under 180 words. Make it readable and insightful.
6. Only include recommendations if directly actionable from the findings. 2-3 max.

Return ONLY valid JSON (no markdown, no fences):
{{
  "answer": "string",
  "recommendations": [
    {{
      "title": "string",
      "rationale": "string",
      "evidence": ["string"],
      "confidence": "high" | "medium" | "low",
      "priority": "immediate" | "short-term" | "strategic"
    }}
  ],
  "followUps": ["string"]
}}"""

    try:
        image_note = ""
        if images:
            image_note = (
                f"\nThe user has also attached {len(images)} image(s). Reference their visual content "
                "(text, UI elements, charts, pricing tables, etc.) directly in your answer."
            )
        raw = await generate_text(prompt + image_note, max_new_tokens=768, temperature=0.2)
        parsed = _safe_parse_json(raw)
        return {
            "answer": parsed.get("answer") or _build_fallback_answer(outputs, query),
            "recommendations": parsed.get("recommendations") or [],
            "followUps": parsed.get("followUps") or [],
        }
    except Exception:
        return {
            "answer": _build_fallback_answer(outputs, query),
            "recommendations": [],
            "followUps": [],
        }


async def _generate_mind_map(
    query: str,
    product: str,
    outputs: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not outputs:
        return None

    output_summaries = [
        {
            "domain": o.get("domain"),
            "confidence": o.get("confidence"),
            "confidenceScore": o.get("confidenceScore"),
            "facts": (o.get("facts") or [])[:5],
            "interpretation": (o.get("interpretation") or [])[:3],
        }
        for o in outputs
    ]

    prompt = f"""You are building a strategic mind map from multi-agent intelligence findings.

Product: "{product}"
Query: "{query}"
Agent findings (use domain names exactly as given for sourceAgent):
{json.dumps(output_summaries, indent=2)}

Create a mind map with 4-6 top-level branches. Each branch maps to one of the intelligence domains above.
Each branch should have 2-4 child nodes. Key children with deep insights may have 1-3 grandchildren.
Every node must have a sentiment: "positive", "negative", "warning", or "neutral".

CRITICAL RULES:
- Every "id" must be globally unique
- Every "label" MUST be a complete, meaningful phrase (3-8 words). NEVER use one-word labels
- Every node MUST have a non-empty label and a non-empty "detail" string
- Each branch MUST set "sourceAgent" to the exact domain string
- Each branch MUST set "confidence" to the confidence level of its source domain

Return ONLY valid JSON (no markdown, no fences):
{{
  "centralTopic": "string",
  "summary": "string",
  "branches": [
    {{
      "id": "branch-1",
      "label": "string",
      "detail": "string",
      "sentiment": "positive" | "neutral" | "negative" | "warning",
      "confidence": "high" | "medium" | "low",
      "sourceAgent": "market-trends" | "competitive" | "win-loss" | "pricing" | "positioning" | "adjacent",
      "children": []
    }}
  ]
}}"""

    try:
        raw = await generate_text(prompt, max_new_tokens=2048, temperature=0.15)
        parsed = _safe_parse_json(raw)
        branches = parsed.get("branches") or []
        if not branches:
            return None
        avg_score = sum(float(o.get("confidenceScore", 0)) for o in outputs) / len(outputs)
        return {
            "agentId": "mind-map-synthesis",
            "domain": "market-trends",
            "confidence": score_to_level(avg_score),
            "confidenceScore": avg_score,
            "facts": [],
            "interpretation": [],
            "sources": filter_and_rank_sources(
                [s for o in outputs for s in (o.get("sources") or [])],
                10,
            ),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "artifactType": "mind-map",
            "centralTopic": parsed.get("centralTopic") or product,
            "branches": branches,
            "summary": parsed.get("summary") or "",
        }
    except Exception:
        return None


def _build_agent_context(
    *,
    intent: str,
    product: str,
    competitor: str | None,
    product_url: str | None,
    competitor_url: str | None,
    prior_context: str | None,
    images: list[Any] | None,
    memory_context: str | None,
    research_outputs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    ctx: dict[str, Any] = {
        "query": intent,
        "product": product,
        "competitor": competitor,
        "product_url": product_url,
        "competitor_url": competitor_url,
        "prior_context": prior_context,
        "memory_context": memory_context,
    }
    if images:
        ctx["images"] = images
    if research_outputs is not None:
        ctx["research_outputs"] = research_outputs
    return ctx


async def orchestrate(
    query: str,
    history: list[dict[str, Any]],
    on_agent_update: Callable[[dict[str, Any]], None] | None = None,
    images: list[Any] | None = None,
    memory_context: str | None = None,
    *,
    injected_context: str | None = None,
    force_execution: bool = False,
    follow_up_mode: str = "full",
    selected_agents: list[str] | None = None,
    on_orchestration_log: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    orchestration_start = datetime.now(timezone.utc)
    start_ms = orchestration_start.timestamp() * 1000
    log = on_orchestration_log

    log and log("Reasoning about your query and selecting intelligence domains…")
    classification = await _classify_query(query, history, images, memory_context)
    model_call_count = 1

    product = classification["product"]
    competitor = classification.get("competitor")
    product_url = classification.get("productUrl")
    competitor_url = classification.get("competitorUrl")
    intent = classification["intent"]
    run_execution = classification["runExecution"]

    allowed = set(selected_agents) if selected_agents else {a["id"] for a in RESEARCH_AGENTS}
    execution_enabled = "execution-engine" in allowed
    should_run_execution = execution_enabled and (run_execution or force_execution)

    prior_context = "\n".join(
        f"{'User' if m.get('role') == 'user' else 'AI'}: {str(m.get('content', ''))[:400]}"
        for m in history[-4:]
    )
    combined_prior = "\n\n".join(p for p in [prior_context, injected_context] if p) or None
    synthesis_memory = "\n\n".join(p for p in [memory_context, injected_context] if p) or None

    agent_context = _build_agent_context(
        intent=intent,
        product=product,
        competitor=competitor,
        product_url=product_url,
        competitor_url=competitor_url,
        prior_context=combined_prior,
        images=images,
        memory_context=memory_context,
    )

    classified_domains = set(classification.get("domains") or [])
    available_research = [a for a in RESEARCH_AGENTS if a["id"] in allowed]
    targeted = [a for a in available_research if a["id"] in classified_domains]
    if follow_up_mode == "targeted":
        agents_to_run = targeted if targeted else available_research
    else:
        agents_to_run = available_research

    sweep_label = "targeted follow-up" if follow_up_mode == "targeted" else "full research sweep"
    log and log(f"Dividing work across {len(agents_to_run)} specialist agents ({sweep_label})…")
    log and log("Orchestrating parallel research — search, fetch, and extract…")

    agent_runs: list[dict[str, Any]] = [
        {"agentId": a["id"], "name": a["name"], "status": "pending"} for a in agents_to_run
    ]
    agent_latencies: dict[str, float] = {}

    async def _run_agent(index: int, agent: dict[str, Any]) -> dict[str, Any] | None:
        agent_start = datetime.now(timezone.utc).timestamp() * 1000
        agent_runs[index] = {
            **agent_runs[index],
            "status": "running",
            "startedAt": datetime.now(timezone.utc).isoformat(),
        }
        if on_agent_update:
            on_agent_update(agent_runs[index])
        try:
            output = await agent["run"](agent_context)
            agent_latencies[agent["id"]] = datetime.now(timezone.utc).timestamp() * 1000 - agent_start
            agent_runs[index] = {
                **agent_runs[index],
                "status": "completed",
                "completedAt": datetime.now(timezone.utc).isoformat(),
            }
            if on_agent_update:
                on_agent_update(agent_runs[index])
            return output
        except Exception as err:
            agent_latencies[agent["id"]] = datetime.now(timezone.utc).timestamp() * 1000 - agent_start
            agent_runs[index] = {
                **agent_runs[index],
                "status": "failed",
                "completedAt": datetime.now(timezone.utc).isoformat(),
                "error": str(err),
            }
            if on_agent_update:
                on_agent_update(agent_runs[index])
            return None

    settled = await asyncio.gather(
        *[_run_agent(i, a) for i, a in enumerate(agents_to_run)],
        return_exceptions=True,
    )
    outputs: list[dict[str, Any]] = [
        r for r in settled if isinstance(r, dict)
    ]
    model_call_count += len(agents_to_run)

    if should_run_execution:
        log and log("Execution intent detected — running execution engine for deliverables…")
        exec_start = datetime.now(timezone.utc).timestamp() * 1000
        exec_run: dict[str, Any] = {
            "agentId": "execution-engine",
            "name": "Execution Engine",
            "status": "running",
            "startedAt": datetime.now(timezone.utc).isoformat(),
        }
        agent_runs.append(exec_run)
        if on_agent_update:
            on_agent_update(exec_run)
        try:
            execution_output = await execution_engine.run(
                {**agent_context, "research_outputs": outputs}
            )
            agent_latencies["execution-engine"] = (
                datetime.now(timezone.utc).timestamp() * 1000 - exec_start
            )
            exec_run["status"] = "completed"
            exec_run["completedAt"] = datetime.now(timezone.utc).isoformat()
            outputs.append(execution_output)
            model_call_count += 3
        except Exception as err:
            agent_latencies["execution-engine"] = (
                datetime.now(timezone.utc).timestamp() * 1000 - exec_start
            )
            exec_run["status"] = "failed"
            exec_run["error"] = str(err)
        if on_agent_update:
            on_agent_update(exec_run)

    log and log("Reasoning over findings — synthesizing answer and strategic mind map…")
    synthesis_result, mind_map_result = await asyncio.gather(
        _synthesize(query, outputs, history, images, synthesis_memory),
        _generate_mind_map(query, product, outputs),
    )
    model_call_count += 2

    answer = synthesis_result["answer"]
    recommendations = synthesis_result["recommendations"]
    follow_ups = synthesis_result["followUps"]

    if mind_map_result:
        outputs.append(mind_map_result)

    for output in outputs:
        output["sources"] = filter_and_rank_sources(output.get("sources") or [], 8)

    avg_confidence = (
        sum(float(o.get("confidenceScore", 0)) for o in outputs) / len(outputs)
        if outputs
        else 0.5
    )
    total_confidence = score_to_level(avg_confidence)

    completed_agents = sum(1 for r in agent_runs if r.get("status") == "completed")
    failed_agents = sum(1 for r in agent_runs if r.get("status") == "failed")
    tool_call_count = completed_agents * 3

    total_latency_ms = int(datetime.now(timezone.utc).timestamp() * 1000 - start_ms)
    metrics = {
        "totalLatencyMs": total_latency_ms,
        "agentLatencies": agent_latencies,
        "estimatedCostUsd": round(model_call_count * EST_COST_PER_MODEL_CALL, 5),
        "toolCallCount": tool_call_count,
        "geminiCallCount": model_call_count,
        "agentCount": len(agent_runs),
        "completedAgentCount": completed_agents,
        "failedAgentCount": failed_agents,
    }

    return {
        "query": query,
        "product": product,
        "competitor": competitor,
        "agentRuns": agent_runs,
        "outputs": outputs,
        "synthesizedAnswer": answer,
        "topRecommendations": recommendations,
        "suggestedFollowUps": follow_ups,
        "totalConfidence": total_confidence,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
    }


def _is_unavailable_live_output(output: dict[str, Any]) -> bool:
    interpretation = output.get("interpretation") or []
    rationale = str(output.get("rationale") or "")
    swarm_size = output.get("swarmSize")
    unavailable_re = re.compile(
        r"mirofish live unavailable|live swarm unavailable|live swarm interviews failed",
        re.I,
    )
    return (
        any(unavailable_re.search(str(line)) for line in interpretation)
        or bool(re.search(r"unavailable|interviews failed|no responses", rationale, re.I))
        or swarm_size == 0
    )


async def run_mirofish_agent(
    query: str,
    history: list[dict[str, Any]],
    on_agent_update: Callable[[dict[str, Any]], None] | None = None,
    images: list[Any] | None = None,
    memory_context: str | None = None,
    on_orchestration_log: Callable[[str], None] | None = None,
) -> dict[str, Any] | None:
    log = on_orchestration_log
    log and log("MiroFish: refreshing product context…")
    classification = await _classify_query(query, history, images, memory_context)
    product = classification["product"]
    competitor = classification.get("competitor")
    product_url = classification.get("productUrl")
    competitor_url = classification.get("competitorUrl")
    intent = classification["intent"]

    prior_context = "\n".join(
        f"{'User' if m.get('role') == 'user' else 'AI'}: {str(m.get('content', ''))[:400]}"
        for m in history[-4:]
    ) or None

    agent_context = _build_agent_context(
        intent=intent,
        product=product,
        competitor=competitor,
        product_url=product_url,
        competitor_url=competitor_url,
        prior_context=prior_context,
        images=images,
        memory_context=memory_context,
    )

    from app.agents.mirofish import AGENT_ID, AGENT_NAME

    run: dict[str, Any] = {
        "agentId": AGENT_ID,
        "name": AGENT_NAME,
        "status": "running",
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }
    if on_agent_update:
        on_agent_update(run)

    try:
        log and log("MiroFish: running forecast agent…")
        output = await run_mirofish(agent_context)
        completed = {
            **run,
            "status": "completed",
            "completedAt": datetime.now(timezone.utc).isoformat(),
        }
        if on_agent_update:
            on_agent_update(completed)
        return output
    except Exception as err:
        failed = {
            **run,
            "status": "failed",
            "completedAt": datetime.now(timezone.utc).isoformat(),
            "error": str(err),
        }
        if on_agent_update:
            on_agent_update(failed)
        return None


async def run_mirofish_live_agent(
    query: str,
    history: list[dict[str, Any]],
    on_agent_update: Callable[[dict[str, Any]], None] | None = None,
    images: list[Any] | None = None,
    memory_context: str | None = None,
    on_orchestration_log: Callable[[str], None] | None = None,
) -> dict[str, Any] | None:
    log = on_orchestration_log
    log and log("MiroFish Live: connecting to real VPS…")
    classification = await _classify_query(query, history, images, memory_context)
    product = classification["product"]
    competitor = classification.get("competitor")
    product_url = classification.get("productUrl")
    competitor_url = classification.get("competitorUrl")
    intent = classification["intent"]

    prior_context = "\n".join(
        f"{'User' if m.get('role') == 'user' else 'AI'}: {str(m.get('content', ''))[:400]}"
        for m in history[-4:]
    ) or None

    agent_context = _build_agent_context(
        intent=intent,
        product=product,
        competitor=competitor,
        product_url=product_url,
        competitor_url=competitor_url,
        prior_context=prior_context,
        images=images,
        memory_context=memory_context,
    )

    from app.agents.mirofish_live import AGENT_ID, AGENT_NAME

    live_run: dict[str, Any] = {
        "agentId": AGENT_ID,
        "name": AGENT_NAME,
        "status": "running",
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }
    if on_agent_update:
        on_agent_update(live_run)

    try:
        log and log("MiroFish Live: interviewing live swarm…")
        output = await run_mirofish_live(agent_context)
        failed = _is_unavailable_live_output(output)
        status_run = {
            **live_run,
            "status": "failed" if failed else "completed",
            "completedAt": datetime.now(timezone.utc).isoformat(),
        }
        if failed:
            status_run["error"] = output.get("rationale") or "Live swarm unavailable"
        if on_agent_update:
            on_agent_update(status_run)
        return output
    except Exception as err:
        failed_run = {
            **live_run,
            "status": "failed",
            "completedAt": datetime.now(timezone.utc).isoformat(),
            "error": str(err),
        }
        if on_agent_update:
            on_agent_update(failed_run)
        return None
