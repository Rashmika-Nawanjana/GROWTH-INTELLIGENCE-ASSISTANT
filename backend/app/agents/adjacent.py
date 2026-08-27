"""Adjacent Market Collision agent (parity with lib/agents/adjacent.ts)."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from app.gemini import generate_json
from app.models import score_to_level
from app.tools.fallback import compute_signal_quality_penalty, extract_tool_results
from app.tools.hn_algolia import get_tech_sentiment
from app.tools.reddit import search_reddit
from app.tools.serpapi import search_news, search_web

AGENT_ID = "adjacent"
AGENT_NAME = "Adjacent Threat Agent"
AGENT_DESCRIPTION = (
    "Identifies companies from outside the category that could disrupt it — "
    "platform expansion, infrastructure players, category convergence."
)


def _fulfilled(result: Any) -> bool:
    return not isinstance(result, BaseException)


def _add_web_results(
    result: Any,
    label: str,
    sources: list[dict[str, Any]],
    raw_content: list[str],
) -> None:
    if not _fulfilled(result):
        return
    for r in (result.get("data") or [])[:4]:
        sources.append(
            {
                "url": r["url"],
                "title": r["title"],
                "timestamp": result["timestamp"],
                "tool": "serpapi",
            }
        )
        raw_content.append(f"[{label}] {r['title']}: {r['snippet']}")


async def run(ctx: dict[str, Any]) -> dict[str, Any]:
    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")

    category = f"{product} vs {competitor}" if competitor else product

    (
        platform_threat_result,
        ai_funding_result,
        disruptor_result,
        funding_result,
        hn_adjacent_result,
        reddit_adjacent_result,
    ) = await asyncio.gather(
        search_web(f"{product} competitors alternatives disruption market 2025 2026"),
        search_web(f"{product} category adjacent market expansion threat 2025"),
        search_web(f"companies replacing {product} OR disrupting {category} 2025 2026"),
        search_news(f"{product}{f' {competitor}' if competitor else ''} market disruption funding threat"),
        get_tech_sentiment(f"{product} disruption threat"),
        search_reddit(f"{product} alternatives what are people using instead"),
        return_exceptions=True,
    )

    (patent_result,) = await asyncio.gather(
        search_web(
            f"{product} patent filing technology site:patents.google.com OR site:patents.justia.com"
        ),
        return_exceptions=True,
    )

    sources: list[dict[str, Any]] = []
    raw_content: list[str] = []

    _add_web_results(platform_threat_result, "PLATFORM THREAT", sources, raw_content)
    _add_web_results(ai_funding_result, "ADJACENT MARKET", sources, raw_content)
    _add_web_results(disruptor_result, "DISRUPTOR", sources, raw_content)
    _add_web_results(funding_result, "FUNDING", sources, raw_content)

    if _fulfilled(hn_adjacent_result):
        hn_data = hn_adjacent_result.get("hnResult") or hn_adjacent_result.get("hn_result") or {}
        summary = hn_adjacent_result.get("summary", "")
        for p in (hn_data.get("data") or [])[:3]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "hn",
                }
            )
        raw_content.append(f"[HN TECH SENTIMENT] {summary}")

    if _fulfilled(reddit_adjacent_result):
        for p in (reddit_adjacent_result.get("data") or [])[:4]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "reddit",
                }
            )
            raw_content.append(f"[REDDIT ADJACENT] {p['title']}: {p['snippet']}")

    _add_web_results(patent_result, "PATENT SIGNAL", sources, raw_content)

    prior_block = f"\nPrior conversation context:\n{prior_context}" if prior_context else ""
    system_prompt = f"""You are a strategic threat analyst who identifies companies from OUTSIDE the primary category that could disrupt it. You think in terms of market adjacency, platform expansion, and category convergence.

Key question: What companies or trends are NOT currently in the {category} space but have the distribution, data, or technology to enter it or displace it credibly within 12-18 months?

Types of adjacent threats to watch:
1. Platform expansion — large platforms adding the same capability as a feature
2. Infrastructure players — lower-level tech companies moving up-stack
3. Horizontal AI — general-purpose AI agents expanding into this vertical
4. Category convergence — adjacent tools expanding into this space{prior_block}"""

    user_prompt = f"""Query: "{query}"
Product category: {category}

Raw signals:
{chr(10).join(raw_content)}

Produce JSON:
{{
  "facts": string[],
  "interpretation": string[],
  "threats": [
    {{
      "company": string,
      "category": string,
      "threatVector": string,
      "riskLevel": "high" | "medium" | "low",
      "evidence": string
    }}
  ],
  "overallRisk": "high" | "medium" | "low",
  "timeToImpact": string,
  "defensiveActions": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}}"""

    try:
        parsed = await generate_json(system_prompt, user_prompt, max_new_tokens=1400, temperature=0.2)
    except Exception:
        parsed = {
            "facts": [
                re.sub(r"^\[[^\]]+\]\s*", "", s)
                for s in raw_content[:3]
                if len(re.sub(r"^\[[^\]]+\]\s*", "", s)) > 15
            ],
            "interpretation": [
                "Analysis synthesis is temporarily unavailable. Raw data signals are shown below."
            ],
            "threats": [],
            "overallRisk": "medium",
            "timeToImpact": "12-18 months",
            "defensiveActions": [],
            "synthesizedAnswer": "Adjacent threat data collected but synthesis failed.",
            "confidenceScore": 0.4,
        }

    raw_score = parsed["confidenceScore"] if isinstance(parsed.get("confidenceScore"), (int, float)) else 0.6
    tool_results = extract_tool_results(
        [
            platform_threat_result,
            ai_funding_result,
            disruptor_result,
            funding_result,
            hn_adjacent_result,
            reddit_adjacent_result,
            patent_result,
        ]
    )
    conf_score = round(float(raw_score) * compute_signal_quality_penalty(tool_results, 7), 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": AGENT_ID,
        "domain": "adjacent",
        "artifactType": "threat-heatmap",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "threats": parsed.get("threats") or [],
        "overallRisk": parsed.get("overallRisk") or "medium",
        "timeToImpact": parsed.get("timeToImpact") or "12-18 months",
        "defensiveActions": parsed.get("defensiveActions") or [],
    }
