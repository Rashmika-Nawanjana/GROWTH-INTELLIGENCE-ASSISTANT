"""Win / Loss Intelligence agent (parity with lib/agents/win-loss.ts)."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from app.agents.entity_url import is_placeholder_competitor, is_usable_scrape_page, skipped_scrape_promise
from app.gemini import generate_json
from app.models import score_to_level
from app.tools.fallback import compute_signal_quality_penalty, extract_tool_results
from app.tools.firecrawl import scrape_page
from app.tools.hn_algolia import search_hn
from app.tools.reddit import search_product_reviews, search_reddit
from app.tools.serpapi import search_web

AGENT_ID = "win-loss"
AGENT_NAME = "Win/Loss Agent"
AGENT_DESCRIPTION = (
    "Reads G2 reviews, Reddit, and HN to surface why buyers choose one product over another."
)


def _g2_reviews_url(competitor_brand: str) -> str:
    slug = competitor_brand.lower().replace(" ", "-")
    return f"https://www.g2.com/products/{slug}/reviews"


def _fulfilled(result: Any) -> bool:
    return not isinstance(result, BaseException)


async def run(ctx: dict[str, Any]) -> dict[str, Any]:
    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")

    competitor_name = competitor or "relevant competitors"
    g2_url = (
        _g2_reviews_url(competitor)
        if not is_placeholder_competitor(competitor) and (competitor or "").strip()
        else None
    )

    (
        web_result,
        reddit_product_result,
        reddit_competitor_result,
        hn_result,
        g2_scrape_result,
        social_review_result,
    ) = await asyncio.gather(
        search_web(f"{competitor_name} vs {product} review pros cons 2025"),
        search_product_reviews(product),
        search_product_reviews(competitor_name),
        search_hn(f"{competitor_name} {product} review comparison"),
        scrape_page(g2_url) if g2_url else skipped_scrape_promise(),
        search_web(
            f"{competitor_name} vs {product} "
            "site:x.com OR site:twitter.com OR site:instagram.com OR site:linkedin.com review comparison buyer feedback"
        ),
        return_exceptions=True,
    )

    (sales_reddit_result,) = await asyncio.gather(
        search_reddit(f"{product} review alternative experience"),
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
            raw_content.append(f"[REVIEW SEARCH] {r['title']}: {r['snippet']}")

    if _fulfilled(reddit_product_result):
        for p in (reddit_product_result.get("data") or [])[:4]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "reddit",
                }
            )
            raw_content.append(
                f"[REDDIT {product}] sentiment={p.get('sentiment')} | {p['title']}: {p['snippet']}"
            )

    if _fulfilled(reddit_competitor_result):
        for p in (reddit_competitor_result.get("data") or [])[:4]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "reddit",
                }
            )
            raw_content.append(
                f"[REDDIT {competitor_name}] sentiment={p.get('sentiment')} | {p['title']}: {p['snippet']}"
            )

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

    if is_usable_scrape_page(g2_scrape_result) and competitor:
        page = g2_scrape_result["data"]
        sources.append(
            {
                "url": page["url"],
                "title": f"{competitor} — G2 reviews",
                "timestamp": g2_scrape_result["timestamp"],
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[G2 REVIEWS] {page['excerpt']}")

    if _fulfilled(social_review_result):
        for r in (social_review_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": social_review_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[SOCIAL REVIEW] {r['title']}: {r['snippet']}")

    if _fulfilled(sales_reddit_result):
        for p in (sales_reddit_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "reddit",
                }
            )
            raw_content.append(f"[SALES REDDIT] {p['title']}: {p['snippet']}")

    prior_block = f"\nPrior conversation context:\n{prior_context}" if prior_context else ""
    system_prompt = f"""You are a win/loss analyst who reads buyer reviews, Reddit discussions, and comparison content to understand WHY deals are won or lost. You look for patterns in real buyer language.

Rules:
- Focus on the BUYER perspective, not vendor claims.
- Separate facts (quoted from reviews) from interpretation.
- Be specific about reasons — generic answers are useless.
- Frequency: "often" = mentioned 3+ times, "sometimes" = 1-2 times, "rarely" = once.{prior_block}"""

    user_prompt = f"""Query: "{query}"
Our product: {product}
Competitor: {competitor_name}

Raw signals (buyer reviews, Reddit posts, comparisons):
{chr(10).join(raw_content)}

Produce JSON:
{{
  "facts": string[],
  "interpretation": string[],
  "competitorWins": [
    {{ "reason": string, "frequency": "often" | "sometimes" | "rarely", "evidence": string }}
  ],
  "competitorLosses": [
    {{ "reason": string, "frequency": "often" | "sometimes" | "rarely", "evidence": string }}
  ],
  "buyerSentiment": "positive" | "mixed" | "negative",
  "topSwitchTriggers": string[],
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
            "competitorWins": [],
            "competitorLosses": [],
            "buyerSentiment": "mixed",
            "topSwitchTriggers": [],
            "synthesizedAnswer": "Buyer sentiment data collected but synthesis failed.",
            "confidenceScore": 0.4,
        }

    raw_score = parsed["confidenceScore"] if isinstance(parsed.get("confidenceScore"), (int, float)) else 0.6
    tool_results = extract_tool_results(
        [
            web_result,
            reddit_product_result,
            reddit_competitor_result,
            hn_result,
            g2_scrape_result,
            social_review_result,
            sales_reddit_result,
        ]
    )
    conf_score = round(float(raw_score) * compute_signal_quality_penalty(tool_results, 7), 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": AGENT_ID,
        "domain": "win-loss",
        "artifactType": "win-loss-scorecard",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "competitor": competitor_name,
        "competitorWins": parsed.get("competitorWins") or [],
        "competitorLosses": parsed.get("competitorLosses") or [],
        "buyerSentiment": parsed.get("buyerSentiment") or "mixed",
        "topSwitchTriggers": parsed.get("topSwitchTriggers") or [],
    }
