"""Market & Trend Sensing agent (parity with lib/agents/market-trends.ts)."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from app.gemini import generate_json
from app.models import score_to_level
from app.tools.apify_twitter import scrape_twitter_x
from app.tools.fallback import compute_signal_quality_penalty, extract_tool_results
from app.tools.hn_algolia import get_tech_sentiment
from app.tools.query_planner import plan_queries
from app.tools.reddit import search_reddit
from app.tools.serpapi import search_news, search_trends, search_web

AGENT_ID = "market-trends"
AGENT_NAME = "Trend Sensor"
AGENT_DESCRIPTION = (
    "Detects market direction via job postings, funding signals, search trends, and news."
)


def _is_social_url(url: str) -> bool:
    return bool(
        re.search(
            r"(?:^|\/\/)(?:www\.)?(x\.com|twitter\.com|linkedin\.com|instagram\.com)\/",
            url,
            re.IGNORECASE,
        )
    )


def _fulfilled(result: Any) -> bool:
    return not isinstance(result, BaseException)


async def run(ctx: dict[str, Any]) -> dict[str, Any]:
    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")

    query_bundle = plan_queries(
        {
            "product": product,
            "competitor": competitor,
            "domain": "market-trends",
            "query": query,
            "category": "AI/ML" if "ai" in query.lower() else "SaaS",
        }
    )

    trend_keywords = [k for k in [product, competitor] if k]

    (
        web_result,
        news_result,
        trends_result,
        hn_result,
        reddit_result,
        web_targeted_result,
        web_hypothesis_result,
        social_pulse_result,
        apify_twitter_result,
    ) = await asyncio.gather(
        search_web(query_bundle["broad"]),
        search_news(f"{product}{f' {competitor}' if competitor else ''} market growth revenue funding"),
        search_trends(trend_keywords),
        get_tech_sentiment(product),
        search_reddit(query_bundle["hypothesis"]),
        search_web(query_bundle["targeted"]),
        search_web(query_bundle["hypothesis"]),
        search_web(
            f"{product}{f' {competitor}' if competitor else ''} "
            "site:x.com OR site:twitter.com OR site:instagram.com OR site:linkedin.com trend launch feedback"
        ),
        scrape_twitter_x(
            [query_bundle["targeted"], query_bundle["hypothesis"]],
            max_items=80,
            sort="Latest",
            language="en",
        ),
        return_exceptions=True,
    )

    sources: list[dict[str, Any]] = []
    raw_content: list[str] = []

    if _fulfilled(web_result):
        for r in (web_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": web_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[WEB BROAD] {r['title']}: {r['snippet']}")

    if _fulfilled(web_targeted_result):
        for r in (web_targeted_result.get("data") or [])[:2]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": web_targeted_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[WEB TARGETED] {r['title']}: {r['snippet']}")

    if _fulfilled(web_hypothesis_result):
        for r in (web_hypothesis_result.get("data") or [])[:2]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": web_hypothesis_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[WEB HYPOTHESIS] {r['title']}: {r['snippet']}")

    if _fulfilled(social_pulse_result):
        for r in (social_pulse_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": social_pulse_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[SOCIAL PULSE] {r['title']}: {r['snippet']}")

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
            raw_content.append(f"[NEWS] {r['title']}: {r['snippet']}")

    if _fulfilled(trends_result):
        pts = trends_result.get("data") or []
        sources.append(
            {
                "url": trends_result.get("sourceUrl") or trends_result.get("source_url") or "",
                "title": "Google Trends",
                "timestamp": trends_result["timestamp"],
                "tool": "serpapi",
            }
        )
        summary = ", ".join(f"{p['keyword']}@{p['date']}={p['value']}" for p in pts[:10])
        raw_content.append(f"[TRENDS] {summary}")

    if _fulfilled(hn_result):
        hn_data = hn_result.get("hnResult") or hn_result.get("hn_result") or {}
        summary = hn_result.get("summary", "")
        for p in (hn_data.get("data") or [])[:3]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "hn",
                }
            )
        raw_content.append(f"[HN SENTIMENT] {summary}")

    if _fulfilled(reddit_result):
        for p in (reddit_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "reddit",
                }
            )
            raw_content.append(f"[REDDIT] {p['title']}: {p['snippet']}")

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

    has_social_sources = any(_is_social_url(s["url"]) for s in sources)
    social_backfill_results: list[Any] = []
    if not has_social_sources:
        comp_or = f' OR "{competitor}"' if competitor else ""
        social_backfill_results = list(
            await asyncio.gather(
                search_web(f'site:x.com "{product}"{comp_or} launch OR feedback OR pricing'),
                search_web(f'site:twitter.com "{product}"{comp_or} launch OR feedback OR pricing'),
                search_web(
                    f'site:linkedin.com "{product}"{comp_or} announcement OR hiring OR product update'
                ),
                search_web(f'site:instagram.com "{product}"{comp_or} product OR campaign'),
                return_exceptions=True,
            )
        )

        for result in social_backfill_results:
            if _fulfilled(result):
                for r in [x for x in (result.get("data") or []) if _is_social_url(x["url"])][:2]:
                    sources.append(
                        {
                            "url": r["url"],
                            "title": r["title"],
                            "timestamp": result["timestamp"],
                            "tool": "serpapi",
                        }
                    )
                    raw_content.append(f"[SOCIAL BACKFILL] {r['title']}: {r['snippet']}")

    prior_block = f"\nPrior conversation context:\n{prior_context}" if prior_context else ""
    system_prompt = f"""You are a senior market intelligence analyst. Your job is to analyse raw signals and produce structured, grounded market trend insights.

Rules:
- Separate FACTS (verifiable from sources) from INTERPRETATION (analyst view).
- Never hallucinate. Only state what the signals support.
- Be specific: name trends, estimate directions and magnitudes.
- Output valid JSON matching the schema exactly.{prior_block}"""

    user_prompt = f"""Query: "{query}"
Product: {product}
{f"Competitor: {competitor}" if competitor else ""}

Raw signals collected:
{chr(10).join(raw_content)}

Produce a JSON object with this exact shape:
{{
  "facts": string[],          // 4-6 verifiable claims directly from the signals
  "interpretation": string[], // 3-4 analyst insights derived from the facts
  "trends": [
    {{
      "keyword": string,
      "direction": "up" | "down" | "flat",
      "changePercent": number,
      "signal": string,
      "source": string
    }}
  ],
  "categoryOutlook": "accelerating" | "consolidating" | "maturing" | "emerging",
  "keySignals": string[],     // top 3 leading indicators
  "timeHorizon": string,
  "synthesizedAnswer": string, // 2-3 sentence plain-English summary
  "confidenceScore": number    // 0.0 - 1.0
}}"""

    try:
        parsed = await generate_json(system_prompt, user_prompt, max_new_tokens=1400, temperature=0.2)
    except Exception:
        parsed = {
            "facts": [
                re.sub(r"^\[[^\]]+\]\s*", "", s)
                for s in raw_content[:4]
                if len(re.sub(r"^\[[^\]]+\]\s*", "", s)) > 15
            ],
            "interpretation": [
                "Analysis synthesis is temporarily unavailable. Raw data signals are shown below."
            ],
            "trends": [],
            "categoryOutlook": "emerging",
            "keySignals": [],
            "timeHorizon": "6-12 months",
            "synthesizedAnswer": "Market trend data was collected but synthesis encountered an error.",
            "confidenceScore": 0.4,
        }

    raw_score = parsed["confidenceScore"] if isinstance(parsed.get("confidenceScore"), (int, float)) else 0.6
    tool_results = extract_tool_results(
        [
            web_result,
            news_result,
            trends_result,
            hn_result,
            reddit_result,
            web_targeted_result,
            web_hypothesis_result,
            social_pulse_result,
            apify_twitter_result,
            *social_backfill_results,
        ]
    )
    signal_penalty = compute_signal_quality_penalty(tool_results, 8 + len(social_backfill_results))
    conf_score = round(float(raw_score) * signal_penalty, 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": AGENT_ID,
        "domain": "market-trends",
        "artifactType": "trend-chart",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trends": parsed.get("trends") or [],
        "categoryOutlook": parsed.get("categoryOutlook") or "emerging",
        "keySignals": parsed.get("keySignals") or [],
        "timeHorizon": parsed.get("timeHorizon") or "6-12 months",
    }
