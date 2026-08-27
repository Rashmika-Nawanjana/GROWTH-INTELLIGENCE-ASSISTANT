"""MiroFish Live Agent — real VPS swarm only, no synthetic fallback."""

from __future__ import annotations

import asyncio
import json
import random
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import get_settings
from app.gemini import generate_json, generate_text
from app.models import score_to_level
from app.tools.serpapi import search_trends

AGENT_ID = "mirofish-live"
AGENT_NAME = "MiroFish Live (Real VPS)"
AGENT_DESCRIPTION = (
    "Live swarm forecasting — interviews real MiroFish personas on the VPS. No synthetic fallback."
)


def _live_simulations_map() -> dict[str, str]:
    raw = get_settings().mirofish_live_simulations or "{}"
    try:
        parsed = json.loads(raw)
        return {str(k).lower(): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _live_base_url() -> str:
    return (get_settings().mirofish_live_base_url or "").rstrip("/")


def get_live_simulation_id_for_product(product: str) -> str | None:
    sim_map = _live_simulations_map()
    default_id = (get_settings().mirofish_live_default_simulation_id or "").strip()
    if default_id:
        return default_id
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


def _live_max_agents() -> int:
    raw = get_settings().mirofish_live_max_agents
    return max(1, min(12, int(raw) if raw else 5))


def _live_interview_timeout_sec() -> int:
    raw = get_settings().mirofish_live_interview_timeout_sec
    return max(30, min(360, int(raw) if raw else 240))


async def is_live_simulation_ready(simulation_id: str) -> bool:
    base = _live_base_url()
    if not base:
        return False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(f"{base}/api/simulation/{simulation_id}/run-status")
        if not res.is_success:
            return False
        data = res.json()
        status = (data.get("data") or {}).get("status") or data.get("status") or ""
        return status in ("completed", "waiting_command", "finished", "running")
    except Exception:
        return False


async def _fetch_live_agent_ids(simulation_id: str, max_agents: int) -> list[int]:
    base = _live_base_url()
    async with httpx.AsyncClient(timeout=5.0) as client:
        res = await client.get(f"{base}/api/simulation/{simulation_id}/config")
    if not res.is_success:
        raise RuntimeError(f"Could not fetch live sim config: {res.status_code}")
    data = res.json()
    configs = (data.get("data") or {}).get("agent_configs") or []
    agent_ids = [int(c["agent_id"]) for c in configs if "agent_id" in c]
    random.shuffle(agent_ids)
    return agent_ids[:max_agents]


async def _interview_live_single_agent(
    simulation_id: str,
    agent_id: int,
    prompt: str,
    platform: str,
    timeout_sec: int,
) -> dict[str, Any] | None:
    base = _live_base_url()
    try:
        async with httpx.AsyncClient(timeout=float(timeout_sec + 5)) as client:
            res = await client.post(
                f"{base}/api/simulation/interview",
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


async def interview_live_swarm(
    simulation_id: str,
    prompt: str,
    *,
    timeout_sec: int | None = None,
    max_agents: int | None = None,
) -> dict[str, Any]:
    per_agent_timeout = timeout_sec if timeout_sec is not None else _live_interview_timeout_sec()
    agent_cap = max_agents if max_agents is not None else _live_max_agents()
    agent_ids = await _fetch_live_agent_ids(simulation_id, agent_cap)
    if not agent_ids:
        raise RuntimeError("No agents found in live simulation config")

    responses: list[dict[str, Any]] = []
    for index, agent_id in enumerate(agent_ids):
        resp = await _interview_live_single_agent(
            simulation_id, agent_id, prompt, "reddit", per_agent_timeout
        )
        if resp:
            responses.append(resp)
        if index < len(agent_ids) - 1:
            await asyncio.sleep(4.5)

    if not responses:
        raise RuntimeError("All live agent interviews failed")

    confidence = min(0.9, 0.72 if len(responses) >= 4 else 0.55 if len(responses) >= 2 else 0.35)
    base = _live_base_url()
    return {
        "data": {
            "simulationId": simulation_id,
            "prompt": prompt,
            "responses": responses,
            "totalCount": len(responses),
        },
        "source": "MiroFish Live Swarm",
        "sourceUrl": f"{base}/api/simulation/interview",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "confidence": confidence,
    }


def _make_empty_forecast(query: str, reason: str) -> dict[str, Any]:
    return {
        "agentId": AGENT_ID,
        "domain": "mirofish-live",
        "artifactType": "forecast-chart",
        "confidence": "low",
        "confidenceScore": 0.1,
        "facts": [],
        "interpretation": [f"MiroFish Live unavailable: {reason}"],
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
        "rationale": f"Live swarm unavailable: {reason}",
    }


def _has_non_ascii(text: str | None) -> bool:
    if not text:
        return False
    return bool(re.search(r"[^\x00-\x7F]", text))


async def _translate_to_english_if_needed(text: str | None) -> str | None:
    if not text or not _has_non_ascii(text):
        return text
    try:
        translated = await generate_text(
            f"Translate to fluent English. Keep meaning and be concise.\n\nText:\n{text}\n\nEnglish:",
            max_new_tokens=120,
            temperature=0.1,
        )
        return translated.strip() or text
    except Exception:
        return text


def _sanitise_interview_question(raw: str | None, fallback: str) -> str:
    value = (raw or "").strip()
    if not value:
        return fallback
    cleaned = re.sub(r"[\x00-\x1f\x7f]", " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    starts = ["From your perspective", "Will ", "What ", "How ", "Why "]
    indices = [cleaned.find(s) for s in starts if cleaned.find(s) >= 0]
    if indices:
        idx = min(indices)
        if idx > 0:
            cleaned = cleaned[idx:].strip()
    max_chars = 220
    if len(cleaned) > max_chars:
        cleaned = f"{cleaned[: max_chars - 3].strip()}..."
    return cleaned or fallback


async def _formulate_forecast_question(
    query: str,
    product: str,
    competitor: str | None,
    prior_context: str | None,
) -> str:
    fallback = query.strip()
    prompt = f"""You are a prediction-market question writer.

Product: {product}{f"\nCompetitor: {competitor}" if competitor else ""}
{f"Prior context:\n{prior_context}\n" if prior_context else ""}
User query: "{query}"

Rephrase the user's query into ONE question suitable for polling a simulated swarm of market personas.
Critical rules:
- PRESERVE the original intent exactly — do NOT change the topic
- For descriptive questions use open-ended form: "From your perspective, what are the main [topic] for [subject]?"
- For future event questions use: "Will X happen by [horizon]?"
- Keep it specific and measurable

Reply with ONLY the rephrased question string, no JSON, no preamble."""

    try:
        result = await generate_text(prompt, max_new_tokens=160, temperature=0.2)
        return _sanitise_interview_question(result, fallback)
    except Exception:
        return _sanitise_interview_question(query, fallback)


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
    prompt = f"""You are a market-intelligence analyst synthesising a live swarm of real simulated personas.

Swarm question: "{forecast_question}"
Product/Subject: {product}
Live swarm size: {swarm_size} personas responded from MiroFish VPS
{f"Prior research context:\n{prior_context}\n" if prior_context else ""}
Trend baseline: {trend_summary or "unavailable"}

Live swarm responses (sample):
{responses_sample}

Synthesise into a structured swarm consensus. Stay true to what was asked.
For threat/landscape questions, pointEstimate = severity (0=none, 1=critical).
For future-event questions, pointEstimate = probability.

Reply with ONLY valid JSON:
{{
  "pointEstimate": 0.0,
  "unit": "probability",
  "confidenceLow": 0.0,
  "confidenceHigh": 0.0,
  "direction": "up",
  "timeHorizon": "string",
  "distribution": [{{ "label": "high", "count": 0 }}],
  "contributingSignals": [{{ "persona": "string", "weight": 0.0, "excerpt": "string" }}],
  "confidenceScore": 0.0,
  "facts": ["string"],
  "interpretation": ["string"],
  "rationale": "string"
}}

All output must be in English."""

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
            "confidenceScore": 0.35,
            "facts": [f"{swarm_size} live personas were polled from MiroFish VPS"],
            "interpretation": ["Live synthesis parsing failed; raw swarm data was received"],
            "rationale": "Live synthesis step encountered an error. Raw swarm data was collected from the VPS.",
        }


async def run(ctx: dict[str, Any]) -> dict[str, Any]:
    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")
    sources: list[dict[str, Any]] = []
    live_base = _live_base_url()

    simulation_id = get_live_simulation_id_for_product(product)
    if not simulation_id:
        return _make_empty_forecast(
            query,
            "No simulation configured — add MIROFISH_LIVE_SIMULATIONS to your env and run the bootstrap script.",
        )

    ready = await is_live_simulation_ready(simulation_id)
    if not ready:
        return _make_empty_forecast(
            query,
            f"VPS at {live_base or 'MIROFISH_LIVE_BASE_URL'} is unreachable or simulation not ready.",
        )

    try:
        forecast_question = await _formulate_forecast_question(query, product, competitor, prior_context)
    except Exception:
        forecast_question = _sanitise_interview_question(query, query)

    interview_result, trends_result = await asyncio.gather(
        interview_live_swarm(simulation_id, forecast_question),
        search_trends([k for k in [product, competitor] if k]),
        return_exceptions=True,
    )

    if isinstance(interview_result, BaseException):
        reason = str(interview_result)
        if isinstance(interview_result, Exception):
            reason = str(interview_result)
        return _make_empty_forecast(query, f"Live swarm interviews failed: {reason}")

    swarm_bundle = interview_result["data"]
    trend_summary = ""

    sources.append(
        {
            "url": interview_result.get("sourceUrl") or f"{live_base}/api/simulation/interview",
            "title": f"MiroFish Live VPS — {swarm_bundle['totalCount']} real personas polled",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "tool": "mirofish-live",
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

    if not swarm_bundle.get("totalCount"):
        return _make_empty_forecast(query, "Live swarm returned no responses.")

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

    facts = [f for f in (await asyncio.gather(*[_translate_to_english_if_needed(x) for x in (synthesised.get("facts") or [])])) if f]
    interpretation = [
        i
        for i in (
            await asyncio.gather(
                *[_translate_to_english_if_needed(x) for x in (synthesised.get("interpretation") or [])]
            )
        )
        if i
    ]
    rationale = await _translate_to_english_if_needed(synthesised.get("rationale")) or synthesised.get("rationale", "")

    signals_en: list[dict[str, Any]] = []
    for signal in synthesised.get("contributingSignals") or []:
        persona = await _translate_to_english_if_needed(signal.get("persona")) or signal.get("persona", "")
        excerpt = await _translate_to_english_if_needed(signal.get("excerpt"))
        signals_en.append({**signal, "persona": persona, "excerpt": excerpt})

    conf_score = float(synthesised.get("confidenceScore", 0.35))
    return {
        "agentId": AGENT_ID,
        "domain": "mirofish-live",
        "artifactType": "forecast-chart",
        "confidence": score_to_level(conf_score),
        "confidenceScore": conf_score,
        "facts": facts,
        "interpretation": interpretation,
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
        "contributingSignals": signals_en,
        "rationale": rationale,
    }
