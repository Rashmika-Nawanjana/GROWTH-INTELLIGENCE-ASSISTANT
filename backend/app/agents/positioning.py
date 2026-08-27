"""Positioning & Messaging Gaps agent (parity with lib/agents/positioning.ts)."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from app.agents.entity_url import (
    competitor_site_url,
    is_usable_scrape_page,
    product_site_url,
    skipped_scrape_promise,
)
from app.gemini import generate_json
from app.models import score_to_level
from app.tools.fallback import compute_signal_quality_penalty, extract_tool_results
from app.tools.firecrawl import scrape_page
from app.tools.reddit import search_reddit
from app.tools.serpapi import search_ads_transparency, search_web

AGENT_ID = "positioning"
AGENT_NAME = "Positioning Agent"
AGENT_DESCRIPTION = (
    "Analyses homepages, ads, and marketing copy to surface messaging gaps and positioning opportunities."
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
    prod_url = product_site_url(ctx)

    (
        comp_home_result,
        prod_home_result,
        comp_ads_result,
        prod_ads_result,
        messaging_search_result,
        reddit_perception_result,
        social_voice_result,
    ) = await asyncio.gather(
        scrape_page(comp_url) if comp_url else skipped_scrape_promise(),
        scrape_page(prod_url) if prod_url else skipped_scrape_promise(),
        search_ads_transparency(competitor_name),
        search_ads_transparency(product),
        search_web(f"{competitor_name} vs {product} messaging positioning marketing"),
        search_reddit(f"how does {competitor_name} market itself brand positioning"),
        search_web(
            f"{competitor_name} OR {product} "
            "site:x.com OR site:twitter.com OR site:instagram.com OR site:linkedin.com positioning messaging"
        ),
        return_exceptions=True,
    )

    comp_about_url = f"{comp_url.rstrip('/')}/about" if comp_url else ""
    prod_about_url = f"{prod_url.rstrip('/')}/about" if prod_url else ""

    comp_about_result, prod_about_result = await asyncio.gather(
        scrape_page(comp_about_url) if comp_about_url else skipped_scrape_promise(),
        scrape_page(prod_about_url) if prod_about_url else skipped_scrape_promise(),
        return_exceptions=True,
    )

    sources: list[dict[str, Any]] = []
    raw_content: list[str] = []

    if is_usable_scrape_page(comp_home_result):
        page = comp_home_result["data"]
        title = f"{competitor} — homepage" if competitor else "Competitor homepage"
        sources.append(
            {
                "url": page["url"],
                "title": title,
                "timestamp": comp_home_result["timestamp"],
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[COMPETITOR HOMEPAGE] {page['excerpt']}")

    if is_usable_scrape_page(prod_home_result):
        page = prod_home_result["data"]
        title = f"{product} — homepage" if len(product) < 50 else "Product homepage"
        sources.append(
            {
                "url": page["url"],
                "title": title,
                "timestamp": prod_home_result["timestamp"],
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[OUR HOMEPAGE] {page['excerpt']}")

    if is_usable_scrape_page(comp_about_result):
        raw_content.append(f"[COMPETITOR ABOUT] {comp_about_result['data']['excerpt']}")

    if is_usable_scrape_page(prod_about_result):
        raw_content.append(f"[OUR ABOUT] {prod_about_result['data']['excerpt']}")

    if _fulfilled(comp_ads_result):
        for r in (comp_ads_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": comp_ads_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[COMPETITOR AD] {r['title']}: {r['snippet']}")

    if _fulfilled(prod_ads_result):
        for r in (prod_ads_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": prod_ads_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[OUR AD] {r['title']}: {r['snippet']}")

    if _fulfilled(messaging_search_result):
        for r in (messaging_search_result.get("data") or [])[:4]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": messaging_search_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[MESSAGING SEARCH] {r['title']}: {r['snippet']}")

    if _fulfilled(reddit_perception_result):
        for p in (reddit_perception_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "reddit",
                }
            )
            raw_content.append(f"[REDDIT PERCEPTION] {p['title']}: {p['snippet']}")

    if _fulfilled(social_voice_result):
        for r in (social_voice_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": social_voice_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[SOCIAL VOICE] {r['title']}: {r['snippet']}")

    prior_block = f"\nPrior conversation context:\n{prior_context}" if prior_context else ""
    system_prompt = f"""You are a brand positioning strategist. You analyse how companies talk about themselves — their hero message, value frame, audience language — and find gaps and opportunities.

Key insight: Positioning is not what you build, it's how you talk about what already exists. A company can have the same product but win or lose based on messaging.

Look for:
- Value framing differences (technology-first vs outcome-first)
- Audience language differences
- Emotional vs functional emphasis
- Category claim differences (e.g. "AI SDR" vs "Revenue automation"){prior_block}"""

    user_prompt = f"""Query: "{query}"
Our product: {product}
Competitor: {competitor_name}

Raw signals:
{chr(10).join(raw_content)}

Produce JSON:
{{
  "facts": string[],
  "interpretation": string[],
  "yourPositioning": string,
  "competitorPositioning": string,
  "gaps": [
    {{
      "dimension": string,
      "yourMessage": string,
      "competitorMessage": string,
      "gap": string,
      "opportunity": string
    }}
  ],
  "adThemes": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}}

Dimensions to analyse: Value Framing, Audience Language, Category Claim, Emotional Appeal, Social Proof Style, Feature Focus vs Outcome Focus, Brand Personality."""

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
            "yourPositioning": "",
            "competitorPositioning": "",
            "gaps": [],
            "adThemes": [],
            "synthesizedAnswer": "Positioning data collected but synthesis failed.",
            "confidenceScore": 0.4,
        }

    raw_score = parsed["confidenceScore"] if isinstance(parsed.get("confidenceScore"), (int, float)) else 0.6
    tool_results = extract_tool_results(
        [
            comp_home_result,
            prod_home_result,
            comp_ads_result,
            prod_ads_result,
            messaging_search_result,
            reddit_perception_result,
            social_voice_result,
            comp_about_result,
            prod_about_result,
        ]
    )
    conf_score = round(float(raw_score) * compute_signal_quality_penalty(tool_results, 9), 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": AGENT_ID,
        "domain": "positioning",
        "artifactType": "positioning-gap",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "competitor": competitor_name,
        "yourPositioning": parsed.get("yourPositioning") or "",
        "competitorPositioning": parsed.get("competitorPositioning") or "",
        "gaps": parsed.get("gaps") or [],
        "adThemes": parsed.get("adThemes") or [],
    }
