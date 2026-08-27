"""Content Agent — campaign brief + copy angles (Stage 2 sub-agent)."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from app.gemini import generate_json
from app.models import score_to_level
from app.tools.fallback import compute_signal_quality_penalty, extract_tool_results
from app.tools.firecrawl import scrape_page
from app.tools.reddit import search_reddit
from app.tools.serpapi import search_news


async def run_content_agent(ctx: dict[str, Any]) -> dict[str, Any]:
    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")
    research_outputs = ctx.get("research_outputs") or []
    product_url = ctx.get("product_url") or ""

    page_result, reddit_result, news_result = await asyncio.gather(
        scrape_page(product_url) if product_url else asyncio.sleep(0, result=None),
        search_reddit(f"{product} pain points complaints buyers"),
        search_news(f"{product} {competitor or ''} GTM messaging 2025 2026"),
        return_exceptions=True,
    )

    sources: list[dict[str, Any]] = []
    raw_content: list[str] = []

    if research_outputs:
        research_summary = "\n".join(
            f"[{o.get('domain', 'research')}] FACTS: {'; '.join((o.get('facts') or [])[:3])} | "
            f"INTERPRETATION: {'; '.join((o.get('interpretation') or [])[:2])}"
            for o in research_outputs
        )
        raw_content.append(f"[RESEARCH GROUNDING]\n{research_summary}")

    if not isinstance(page_result, BaseException) and page_result:
        page = page_result.get("data") or {}
        sources.append(
            {
                "url": page.get("url", product_url),
                "title": f"{product} Website",
                "timestamp": page_result.get("timestamp", datetime.now(timezone.utc).isoformat()),
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[PRODUCT PAGE] {page.get('excerpt', '')}")

    if not isinstance(reddit_result, BaseException) and reddit_result:
        for post in (reddit_result.get("data") or [])[:4]:
            sources.append(
                {
                    "url": post.get("url", ""),
                    "title": post.get("title", ""),
                    "timestamp": post.get("created", reddit_result.get("timestamp", "")),
                    "tool": "reddit",
                }
            )
            raw_content.append(f"[BUYER VOICE] {post.get('title', '')}: {post.get('snippet', '')}")

    if not isinstance(news_result, BaseException) and news_result:
        for article in (news_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": article.get("url", ""),
                    "title": article.get("title", ""),
                    "timestamp": news_result.get("timestamp", ""),
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[NEWS] {article.get('title', '')}: {article.get('snippet', '')}")

    system_prompt = """You are a senior growth strategist and campaign brief writer for B2B SaaS companies.

Your job is to synthesise live market signals into a structured campaign brief and a list of distinct copy angles that a growth team can execute immediately.

Rules:
- Base every angle on a signal from the raw data — no unsourced claims.
- Angles must be meaningfully different (ROI, competitor gap, pain point, insight-led, no-headcount, etc.).
- Brief sections must be concise, bullet-friendly, and ready for a growth team to act on.
- Output valid JSON matching the schema exactly."""

    if prior_context:
        system_prompt += f"\n\nPrior conversation context (build on this, do not repeat it):\n{prior_context}"

    user_prompt = f"""Query: "{query}"
Product: {product}
{f"Competitor: {competitor}" if competitor else ""}

Raw signals:
{chr(10).join(raw_content)}

Produce a JSON object with this exact shape:
{{
  "brief": {{
    "objective": string,
    "targetAudience": string,
    "painPoints": string[],
    "keyMessagingAngles": [
      {{ "angle": string, "hypothesis": string }}
    ],
    "variantsSummary": string,
    "channelStrategy": string,
    "successMetrics": string[],
    "nextSteps": string[]
  }},
  "angles": string[],
  "facts": string[],
  "interpretation": string[],
  "confidenceScore": number
}}"""

    try:
        parsed = await generate_json(system_prompt, user_prompt, max_new_tokens=1400, temperature=0.2)
    except Exception:
        parsed = {
            "brief": {
                "objective": f"Drive pipeline for {product}",
                "targetAudience": "VP Sales / Head of Growth at Series B+ SaaS",
                "painPoints": [
                    "Manual outreach at scale",
                    "Poor signal-to-noise in prospecting",
                    "Headcount constraints",
                ],
                "keyMessagingAngles": [
                    {
                        "angle": "ROI-focused",
                        "hypothesis": "Buyers prioritise cost-per-meeting over features",
                    },
                    {
                        "angle": "Competitor gap",
                        "hypothesis": "Highlighting competitor weakness increases curiosity",
                    },
                ],
                "variantsSummary": "Two initial variants: ROI and competitor-gap angles",
                "channelStrategy": "Cold email + LinkedIn",
                "successMetrics": ["reply rate > 4%", "meetings booked per 100 outreach"],
                "nextSteps": ["Run A/B test on Variant A vs B", "Analyse reply sentiment after 72h"],
            },
            "angles": ["ROI-focused", "Competitor gap", "Insight-led"],
            "facts": [
                re.sub(r"^\[[^\]]+\]\s*", "", s)
                for s in raw_content[:3]
                if len(re.sub(r"^\[[^\]]+\]\s*", "", s)) > 15
            ],
            "interpretation": ["Content synthesis temporarily unavailable — raw data used as fallback."],
            "confidenceScore": 0.4,
        }

    raw_score = parsed.get("confidenceScore", 0.6)
    if not isinstance(raw_score, (int, float)):
        raw_score = 0.6
    tool_results = extract_tool_results([page_result, reddit_result, news_result])
    conf_score = round(float(raw_score) * compute_signal_quality_penalty(tool_results, 3), 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": "content-agent",
        "domain": "execution-engine",
        "artifactType": "execution-plan",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "brief": parsed.get("brief") or {},
        "angles": parsed.get("angles") or [],
    }
