"""Outreach Formatter — humanised sequences + deployment timeline (Stage 2 sub-agent)."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any

from app.gemini import generate_json
from app.models import score_to_level
from app.tools.fallback import compute_signal_quality_penalty, extract_tool_results
from app.tools.firecrawl import scrape_page
from app.tools.serpapi import search_web


async def run_outreach_formatter(
    ctx: dict[str, Any],
    input_variants: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if input_variants is None:
        input_variants = []

    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")

    best_practices_result, landing_result = await asyncio.gather(
        search_web("B2B SaaS cold email best practices subject lines 2025 reply rate"),
        scrape_page(ctx["product_url"]) if ctx.get("product_url") else asyncio.sleep(0, result=None),
        return_exceptions=True,
    )

    sources: list[dict[str, Any]] = []
    raw_content: list[str] = []

    if not isinstance(best_practices_result, BaseException) and best_practices_result:
        for result in (best_practices_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": result.get("url", ""),
                    "title": result.get("title", ""),
                    "timestamp": best_practices_result.get("timestamp", ""),
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[BEST PRACTICE] {result.get('title', '')}: {result.get('snippet', '')}")

    if not isinstance(landing_result, BaseException) and landing_result:
        page = landing_result.get("data") or {}
        sources.append(
            {
                "url": page.get("url", ctx.get("product_url", "")),
                "title": f"{product} Landing Page",
                "timestamp": landing_result.get("timestamp", datetime.now(timezone.utc).isoformat()),
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[PRODUCT VOICE] {page.get('excerpt', '')}")

    variants_summary = (
        json.dumps(
            [
                {
                    "id": v.get("id"),
                    "angle": v.get("angle"),
                    "hypothesis": v.get("hypothesis"),
                    "groundedSignals": v.get("groundedSignals"),
                }
                for v in input_variants
            ],
            indent=2,
        )
        if input_variants
        else "No variants provided — generate 3 default variants."
    )

    system_prompt = """You are an expert B2B SaaS cold outreach writer and humaniser.

Your job is to:
1. Take structured message variants and write fully-humanised, ready-to-send outreach sequences for each.
2. Generate a realistic deployment timeline.

Rules:
- No placeholders like [Name], [Company] — write as if sending to a specific ICP (VP Sales at Series B SaaS).
- Tone: confident, helpful, non-salesy — like a strategic operator who did deep research.
- Subject lines must be curiosity-driven, under 8 words, no exclamation marks.
- Email bodies: 3-5 sentences max. No features dump. One clear CTA.
- Follow-ups: shorter, add a new angle, never just "bumping this up".
- LinkedIn posts: punchy hook (first line stops the scroll), 3-4 sentences, conversational.
- Deployment timeline: realistic B2B cadence — Day 0 email, Day 3 follow-up, Day 5 LinkedIn, Day 8 final follow-up.
- Output valid JSON matching the schema exactly."""

    if prior_context:
        system_prompt += f"\n\nPrior context:\n{prior_context}"

    user_prompt = f"""Query: "{query}"
Product: {product}
{f"Competitor: {competitor}" if competitor else ""}

Outreach best practices:
{chr(10).join(raw_content)}

Input variants to enrich:
{variants_summary}

Produce a JSON object with this exact shape:
{{
  "enrichedVariants": [
    {{
      "id": string,
      "angle": string,
      "hypothesis": string,
      "successMetric": string,
      "variable": string,
      "channels": {{
        "email": {{
          "subject": string,
          "body": string,
          "followUps": string[]
        }},
        "linkedin": {{
          "hook": string,
          "post": string
        }}
      }},
      "groundedSignals": string[]
    }}
  ],
  "deployment": [
    {{
      "day": number,
      "action": string,
      "channel": "email" | "linkedin" | "ads",
      "audience": string
    }}
  ],
  "facts": string[],
  "interpretation": string[],
  "confidenceScore": number
}}"""

    try:
        parsed = await generate_json(system_prompt, user_prompt, max_new_tokens=1800, temperature=0.25)
    except Exception:
        parsed = {
            "enrichedVariants": input_variants,
            "deployment": [
                {"day": 0, "action": "Send Variant A cold email", "channel": "email", "audience": "VP Sales at Series B SaaS"},
                {"day": 0, "action": "Send Variant B cold email", "channel": "email", "audience": "Head of Growth at Series B SaaS"},
                {"day": 3, "action": "Send Variant A follow-up 1", "channel": "email", "audience": "Non-responders from Day 0"},
                {"day": 5, "action": "Publish Variant A LinkedIn post", "channel": "linkedin", "audience": "VP Sales network"},
                {"day": 5, "action": "Publish Variant B LinkedIn post", "channel": "linkedin", "audience": "Head of Growth network"},
                {"day": 8, "action": "Send final follow-up (insight angle)", "channel": "email", "audience": "All non-responders"},
            ],
            "facts": [
                re.sub(r"^\[[^\]]+\]\s*", "", s)
                for s in raw_content[:2]
                if len(re.sub(r"^\[[^\]]+\]\s*", "", s)) > 15
            ],
            "interpretation": ["Outreach formatting temporarily unavailable — input variants returned unchanged."],
            "confidenceScore": 0.4,
        }

    raw_score = parsed.get("confidenceScore", 0.65)
    if not isinstance(raw_score, (int, float)):
        raw_score = 0.65
    tool_results = extract_tool_results([best_practices_result, landing_result])
    conf_score = round(float(raw_score) * compute_signal_quality_penalty(tool_results, 2), 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": "outreach-formatter",
        "domain": "execution-engine",
        "artifactType": "execution-plan",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "enrichedVariants": parsed.get("enrichedVariants") or input_variants,
        "deployment": parsed.get("deployment") or [],
    }
