"""MiroFish Forecast Agent — swarm simulation with synthetic Gemini fallback."""

from __future__ import annotations

import asyncio
import json
import random
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import get_settings
from app.gemini import generate_json, generate_text
from app.models import score_to_level
from app.tools.serpapi import search_trends

AGENT_ID = "mirofish"
AGENT_NAME = "MiroFish (Forecast)"
AGENT_DESCRIPTION = (
    "Swarm-simulation forecasting — interviews simulated personas to predict what happens next"
)

SYNTHETIC_PERSONAS = [
    "enterprise CTO evaluating AI vendors",
    "Series B SaaS founder",
    "growth-stage product manager",
    "B2B sales leader in tech",
    "VC analyst tracking AI infrastructure",
    "startup operator with sales automation background",
    "mid-market RevOps director",
    "digital-native SMB founder",
    "technical co-founder building with agents",
    "analyst at a research firm covering AI tooling",
    "CMO at a scale-up",
    "procurement lead at a Fortune-500 firm",
    "developer advocate in the LLM ecosystem",
    "early adopter SaaS power user",
    "CFO evaluating AI ROI",
]


def _simulations_map() -> dict[str, str]:
    raw = get_settings().mirofish_simulations or "{}"
    try:
        parsed = json.loads(raw)
        return {str(k).lower(): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _base_url() -> str:
    return (get_settings().mirofish_base_url or "http://localhost:5001").rstrip("/")


def get_simulation_id_for_product(product: str) -> str | None:
    sim_map = _simulations_map()
    if not product or not sim_map:
        return None
    needle = product.lower().strip()
    if needle in sim_map:
        return sim_map[needle]
    for key, value in sim_map.items():
        if needle in key or key in needle:
            return value
    if len(sim_map) == 1:
        return next(iter(sim_map.values()))
    return None


async def is_simulation_ready(simulation_id: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(
                f"{_base_url()}/api/simulation/{simulation_id}/run-status"
            )
        if not res.is_success:
            return False
        data = res.json()
        status = (data.get("data") or {}).get("status") or data.get("status") or ""
        return status in ("completed", "waiting_command", "finished", "running")
    except Exception:
        return False


async def _fetch_agent_ids(simulation_id: str, max_agents: int = 5) -> list[int]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        res = await client.get(f"{_base_url()}/api/simulation/{simulation_id}/config")
    if not res.is_success:
        raise RuntimeError(f"Could not fetch sim config: {res.status_code}")
    data = res.json()
    configs = (data.get("data") or {}).get("agent_configs") or []
    agent_ids = [int(c["agent_id"]) for c in configs if "agent_id" in c]
    random.shuffle(agent_ids)
    return agent_ids[:max_agents]


async def _interview_single_agent(
    simulation_id: str,
    agent_id: int,
    prompt: str,
    platform: str,
    timeout_sec: int,
) -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=float(timeout_sec + 5)) as client:
            res = await client.post(
                f"{_base_url()}/api/simulation/interview",
                json={
                    "simulation_id": simulation_id,
                    "agent_id": agent_id,
                    "prompt": prompt,
                    "platform": platform,
                    "timeout": timeout_sec,
                },
            )
        if not res.is_success:
            return None
        data = res.json()
        if not data.get("success"):
            return None
        payload = data.get("data") or {}
        response = payload.get("result") or payload.get("response") or ""
        if not response:
            return None
        return {"agent_id": agent_id, "response": response, "platform": platform}
    except Exception:
        return None


async def interview_swarm(
    simulation_id: str,
    prompt: str,
    *,
    platform: str = "reddit",
    timeout_sec: int = 45,
) -> dict[str, Any]:
    agent_ids = await _fetch_agent_ids(simulation_id, 5)
    if not agent_ids:
        raise RuntimeError("No agents found in simulation config")

    responses: list[dict[str, Any]] = []
    for index, agent_id in enumerate(agent_ids):
        resp = await _interview_single_agent(simulation_id, agent_id, prompt, platform, timeout_sec)
        if resp:
            responses.append(resp)
        if index < len(agent_ids) - 1:
            await asyncio.sleep(4.5)

    if not responses:
        raise RuntimeError("All agent interviews failed")

    confidence = min(0.9, 0.72 if len(responses) >= 4 else 0.55 if len(responses) >= 2 else 0.35)
    return {
        "data": {
            "simulationId": simulation_id,
            "prompt": prompt,
            "responses": responses,
            "totalCount": len(responses),
        },
        "source": "MiroFish Swarm",
        "sourceUrl": f"{_base_url()}/api/simulation/interview",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "confidence": confidence,
    }


def _make_empty_forecast(query: str, reason: str) -> dict[str, Any]:
    return {
        "agentId": AGENT_ID,
        "domain": "mirofish",
        "artifactType": "forecast-chart",
        "confidence": "low",
        "confidenceScore": 0.1,
        "facts": [],
        "interpretation": [f"MiroFish unavailable: {reason}"],
        "sources": [],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "question": query,
        "pointEstimate": 0,
        "unit": "probability",
        "confidenceLow": 0,
        "confidenceHigh": 0,
        "direction": "flat",
        "swarmSize": 0,
        "timeHorizon": "unknown",
        "distribution": [],
        "contributingSignals": [],
        "rationale": f"Swarm prediction unavailable: {reason}",
    }


async def _formulate_forecast_question(
    query: str,
    product: str,
    competitor: str | None,
    prior_context: str | None,
) -> str:
    prompt = f"""You are a prediction-market question writer.

Product: {product}{f"\nCompetitor: {competitor}" if competitor else ""}
{f"Prior context:\n{prior_context}\n" if prior_context else ""}
User query: "{query}"

Rephrase the user's query into ONE question suitable for polling a simulated swarm of market personas.
Critical rules:
- PRESERVE the original intent exactly — do NOT change the topic or introduce new subjects the user did not mention
- If the user asked about threats, competitors, or market landscape, ask the swarm about threats/competitors/landscape
- If the user asked about a specific company, region, or product, keep that exact focus
- Only use "Will X happen by [horizon]?" form if the user explicitly asked about a future event
- For descriptive questions, use open-ended form: "From your perspective, what are the main [topic] for [subject]?"
- Include geographic or domain context from the original query
- Keep it specific and measurable

Reply with ONLY the rephrased question string, no JSON, no preamble."""

    try:
        result = await generate_text(prompt, max_new_tokens=160, temperature=0.2)
        return result.strip() or query
    except Exception:
        return query


async def _run_synthetic_swarm(forecast_question: str, product: str) -> dict[str, Any]:
    persona_list = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(SYNTHETIC_PERSONAS))
    prompt = f"""You are simulating a panel of {len(SYNTHETIC_PERSONAS)} independent market personas answering a question about {product}.

Panel members:
{persona_list}

Question: "{forecast_question}"

For EACH persona, write a 1-2 sentence response in their voice that:
- Directly answers the question as asked (do NOT reframe or change the topic)
- Gives their specific view based on their background
- Is grounded in realistic market signals for 2025/2026

Reply with ONLY a JSON object with a "responses" field containing an array of {len(SYNTHETIC_PERSONAS)} strings (one per persona, in order):
{{ "responses": ["response1", "response2", ...] }}"""

    try:
        parsed = await generate_json(
            "You are a simulation engine producing structured persona responses.",
            prompt,
            max_new_tokens=1600,
            temperature=0.5,
        )
        responses = [r for r in (parsed.get("responses") or []) if r]
        return {"responses": responses, "totalCount": len(responses)}
    except Exception:
        return {"responses": [], "totalCount": 0}


async def _synthesise_forecast(
    *,
    forecast_question: str,
    product: str,
    swarm_responses: list[str],
    swarm_size: int,
    trend_summary: str,
    prior_context: str | None,
) -> dict[str, Any]:
    responses_sample = "\n---\n".join(swarm_responses[:30])
    prompt = f"""You are a market-intelligence analyst synthesising a swarm of simulated market personas.

Swarm question: "{forecast_question}"
Product/Subject: {product}
Swarm size: {swarm_size} personas responded
{f"Prior research context:\n{prior_context}\n" if prior_context else ""}
Trend baseline: {trend_summary or "unavailable"}

Swarm responses (sample):
{responses_sample}

Synthesise these into a structured swarm consensus. Stay true to what was asked — do NOT reframe the question.
For questions about threats, competitors, or landscape, "pointEstimate" represents the overall severity/concern level (0=no threat, 1=critical threat).
For questions about future events, "pointEstimate" represents probability.

Reply with ONLY valid JSON matching this exact shape:
{{
  "pointEstimate": 0.0,
  "unit": "probability",
  "confidenceLow": 0.0,
  "confidenceHigh": 0.0,
  "direction": "up",
  "timeHorizon": "string",
  "distribution": [{{ "label": "high threat", "count": 0 }}],
  "contributingSignals": [{{ "persona": "string", "weight": 0.0, "excerpt": "string" }}],
  "confidenceScore": 0.0,
  "facts": ["string"],
  "interpretation": ["string"],
  "rationale": "string"
}}"""

    try:
        return await generate_json(
            "You are a prediction-market analyst.",
            prompt,
            max_new_tokens=1400,
            temperature=0.2,
        )
    except Exception:
        return {
            "pointEstimate": 0.5,
            "unit": "probability",
            "confidenceLow": 0.3,
            "confidenceHigh": 0.7,
            "direction": "flat",
            "timeHorizon": "6 months",
            "distribution": [],
            "contributingSignals": [],
            "confidenceScore": 0.3,
            "facts": [f"{swarm_size} simulated personas were polled"],
            "interpretation": ["Synthesis parsing failed; raw swarm data was received"],
            "rationale": "Synthesis step encountered an error. Raw swarm data was collected but could not be fully structured.",
        }


async def run(ctx: dict[str, Any]) -> dict[str, Any]:
    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")
    sources: list[dict[str, Any]] = []
    trend_summary = ""

    simulation_id = get_simulation_id_for_product(product)
    use_real_swarm = False
    if simulation_id:
        use_real_swarm = await is_simulation_ready(simulation_id)

    try:
        forecast_question = await _formulate_forecast_question(query, product, competitor, prior_context)
    except Exception:
        forecast_question = query

    swarm_bundle: dict[str, Any]
    base = _base_url()

    if use_real_swarm and simulation_id:
        interview_result, trends_result = await asyncio.gather(
            interview_swarm(simulation_id, forecast_question, timeout_sec=90),
            search_trends([k for k in [product, competitor] if k]),
            return_exceptions=True,
        )

        if isinstance(interview_result, BaseException):
            synth = await _run_synthetic_swarm(forecast_question, product)
            swarm_bundle = {
                "responses": [{"response": r} for r in synth["responses"]],
                "totalCount": synth["totalCount"],
            }
            swarm_source_label = f"Synthetic swarm — {synth['totalCount']} AI personas (real swarm failed)"
            sources.append(
                {
                    "url": "synthetic",
                    "title": swarm_source_label,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "tool": "mirofish",
                }
            )
        else:
            bundle_data = interview_result["data"]
            swarm_bundle = bundle_data
            swarm_source_label = f"MiroFish swarm — {bundle_data['totalCount']} simulated personas polled"
            sources.append(
                {
                    "url": interview_result.get("sourceUrl") or f"{base}/api/simulation/interview/all",
                    "title": swarm_source_label,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "tool": "mirofish",
                }
            )

        if not isinstance(trends_result, BaseException) and trends_result:
            td = trends_result
            trend_data = td.get("data") or []
            if isinstance(trend_data, list):
                trend_summary = ", ".join(
                    f"{p.get('keyword', '')}: {p.get('value', '')}" for p in trend_data[:3]
                )
            sources.append(
                {
                    "url": td.get("sourceUrl") or td.get("source_url") or "",
                    "title": "Google Trends baseline",
                    "timestamp": td.get("timestamp", ""),
                    "tool": "serpapi",
                }
            )
    else:
        synth_result, trends_result = await asyncio.gather(
            _run_synthetic_swarm(forecast_question, product),
            search_trends([k for k in [product, competitor] if k]),
            return_exceptions=True,
        )
        synth = synth_result if not isinstance(synth_result, BaseException) else {"responses": [], "totalCount": 0}
        swarm_bundle = {
            "responses": [{"response": r} for r in synth.get("responses", [])],
            "totalCount": synth.get("totalCount", 0),
        }
        sources.append(
            {
                "url": "synthetic",
                "title": f"Synthetic swarm — {swarm_bundle['totalCount']} AI personas (no live simulation)",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "tool": "mirofish",
            }
        )
        if not isinstance(trends_result, BaseException) and trends_result:
            sources.append(
                {
                    "url": trends_result.get("sourceUrl") or trends_result.get("source_url") or "",
                    "title": "Google Trends baseline",
                    "timestamp": trends_result.get("timestamp", ""),
                    "tool": "serpapi",
                }
            )

    if not swarm_bundle.get("totalCount"):
        return _make_empty_forecast(
            query,
            "Both real and synthetic swarm returned no responses. Check GEMINI_API_KEY / model quota.",
        )

    swarm_response_texts = [
        r.get("response", "") for r in (swarm_bundle.get("responses") or []) if r.get("response")
    ]
    synthesised = await _synthesise_forecast(
        forecast_question=forecast_question,
        product=product,
        swarm_responses=swarm_response_texts,
        swarm_size=int(swarm_bundle["totalCount"]),
        trend_summary=trend_summary,
        prior_context=prior_context,
    )

    conf_score = float(synthesised.get("confidenceScore", 0.3))
    return {
        "agentId": AGENT_ID,
        "domain": "mirofish",
        "artifactType": "forecast-chart",
        "confidence": score_to_level(conf_score),
        "confidenceScore": conf_score,
        "facts": synthesised.get("facts") or [],
        "interpretation": synthesised.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "question": forecast_question,
        "pointEstimate": synthesised.get("pointEstimate", 0),
        "unit": synthesised.get("unit", "probability"),
        "confidenceLow": synthesised.get("confidenceLow", 0),
        "confidenceHigh": synthesised.get("confidenceHigh", 0),
        "direction": synthesised.get("direction", "flat"),
        "swarmSize": swarm_bundle["totalCount"],
        "timeHorizon": synthesised.get("timeHorizon", "6 months"),
        "distribution": synthesised.get("distribution") or [],
        "contributingSignals": synthesised.get("contributingSignals") or [],
        "rationale": synthesised.get("rationale", ""),
    }
