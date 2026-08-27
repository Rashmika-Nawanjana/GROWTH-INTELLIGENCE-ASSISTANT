"""Competitive Landscape agent (parity with lib/agents/competitive.ts)."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from app.agents.entity_url import (
    competitor_site_url,
    is_usable_scrape_page,
    skipped_scrape_promise,
)
from app.gemini import generate_json
from app.models import score_to_level
from app.tools.apify_twitter import scrape_twitter_x
from app.tools.fallback import compute_signal_quality_penalty, extract_tool_results
from app.tools.firecrawl import scrape_competitor_pricing, scrape_page
from app.tools.hn_algolia import search_hn
from app.tools.serpapi import search_news, search_web

AGENT_ID = "competitive"
AGENT_NAME = "Competitive Agent"
AGENT_DESCRIPTION = (
    "Scrapes competitor product pages, changelogs, and pricing to build a feature comparison matrix."
)


def _fulfilled(result: Any) -> bool:
    return not isinstance(result, BaseException)


async def run(ctx: dict[str, Any]) -> dict[str, Any]:
    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")

    competitor_name = competitor or "relevant competitors"
    comp_url = competitor_site_url(ctx)

    (
        web_result,
        news_result,
        hn_result,
        scrape_result,
        pricing_result,
        social_signals_result,
        apify_twitter_result,
    ) = await asyncio.gather(
        search_web(f"{competitor_name} features product update 2025 2026"),
        search_news(f"{competitor_name} funding launch product announcement 2025"),
        search_hn(f"{competitor_name} {product}"),
        scrape_page(comp_url) if comp_url else skipped_scrape_promise(),
        scrape_competitor_pricing(comp_url) if comp_url else skipped_scrape_promise(),
        search_web(
            f"{competitor_name} {product} "
            "site:x.com OR site:twitter.com OR site:instagram.com OR site:linkedin.com launch feature feedback"
        ),
        scrape_twitter_x(
            [f"{competitor_name} {product}", f"{competitor_name} launch feedback"],
            max_items=80,
            sort="Latest",
            language="en",
        ),
        return_exceptions=True,
    )

    (hiring_result,) = await asyncio.gather(
        search_web(
            f'{competitor_name} jobs hiring "AI" OR "machine learning" OR "sales" '
            "site:linkedin.com OR site:greenhouse.io"
        ),
        return_exceptions=True,
    )

    sources: list[dict[str, Any]] = []
    raw_content: list[str] = []

    if _fulfilled(web_result):
        for r in (web_result.get("data") or [])[:5]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": web_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[COMPETITOR WEB] {r['title']}: {r['snippet']}")

    if _fulfilled(news_result):
        for r in (news_result.get("data") or [])[:4]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": news_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[COMPETITOR NEWS] {r['title']}: {r['snippet']}")

    if _fulfilled(hn_result):
        for p in (hn_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "hn",
                }
            )
            raw_content.append(f"[HN] {p['title']}")

    if is_usable_scrape_page(scrape_result):
        page = scrape_result["data"]
        sources.append(
            {
                "url": page["url"],
                "title": page.get("title") or competitor_name,
                "timestamp": scrape_result["timestamp"],
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[COMPETITOR HOMEPAGE] {page['excerpt']}")

    if is_usable_scrape_page(pricing_result):
        page = pricing_result["data"]
        label = f"{competitor} pricing" if competitor else "Competitor pricing page"
        sources.append(
            {
                "url": page["url"],
                "title": label,
                "timestamp": pricing_result["timestamp"],
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[COMPETITOR PRICING] {page['excerpt']}")

    if _fulfilled(social_signals_result):
        for r in (social_signals_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": social_signals_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[SOCIAL SIGNAL] {r['title']}: {r['snippet']}")

    if _fulfilled(apify_twitter_result):
        for t in (apify_twitter_result.get("data") or [])[:8]:
            handle = t.get("authorHandle") or t.get("author_handle") or "unknown"
            sources.append(
                {
                    "url": t["url"],
                    "title": f"X @{handle}",
                    "timestamp": t.get("createdAt") or t.get("created_at") or apify_twitter_result["timestamp"],
                    "tool": "apify",
                }
            )
            likes = t.get("likeCount") if isinstance(t.get("likeCount"), (int, float)) else t.get("like_count")
            likes_suffix = f" (likes {likes})" if isinstance(likes, (int, float)) else ""
            raw_content.append(f"[APIFY X] @{handle}: {t['text']}{likes_suffix}")

    if _fulfilled(hiring_result):
        for r in (hiring_result.get("data") or [])[:3]:
            raw_content.append(f"[HIRING SIGNAL] {r['title']}: {r['snippet']}")

    prior_block = f"\nPrior conversation context:\n{prior_context}" if prior_context else ""
    system_prompt = f"""You are a competitive intelligence analyst specialising in B2B SaaS. You compare product capabilities with brutal honesty. You separate facts from interpretation. You never fabricate features.{prior_block}"""

    user_prompt = f"""Query: "{query}"
Our product: {product}
Competitor: {competitor_name}

Raw signals:
{chr(10).join(raw_content)}

Produce a JSON object:
{{
  "facts": string[],
  "interpretation": string[],
  "competitorSummary": string,
  "matrix": [
    {{
      "feature": string,
      "yourProduct": "strong" | "medium" | "weak" | "none",
      "competitor": "strong" | "medium" | "weak" | "none",
      "gapDirection": "advantage" | "parity" | "disadvantage"
    }}
  ],
  "hiringSignals": string[],
  "recentMoves": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}}

For the matrix, infer the most relevant feature dimensions from the signals above. Choose dimensions that are actually relevant to {product} and {competitor_name} based on what the data shows."""

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
            "competitorSummary": f"{competitor_name} competitive data collected.",
            "matrix": [],
            "hiringSignals": [],
            "recentMoves": [],
            "synthesizedAnswer": "Competitive data was gathered but synthesis failed.",
            "confidenceScore": 0.4,
        }

    raw_score = parsed["confidenceScore"] if isinstance(parsed.get("confidenceScore"), (int, float)) else 0.6
    tool_results = extract_tool_results(
        [
            web_result,
            news_result,
            hn_result,
            scrape_result,
            pricing_result,
            social_signals_result,
            apify_twitter_result,
            hiring_result,
        ]
    )
    conf_score = round(float(raw_score) * compute_signal_quality_penalty(tool_results, 8), 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": AGENT_ID,
        "domain": "competitive",
        "artifactType": "competitive-matrix",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "competitor": competitor_name,
        "matrix": parsed.get("matrix") or [],
        "competitorSummary": parsed.get("competitorSummary") or "",
        "hiringSignals": parsed.get("hiringSignals") or [],
        "recentMoves": parsed.get("recentMoves") or [],
    }
