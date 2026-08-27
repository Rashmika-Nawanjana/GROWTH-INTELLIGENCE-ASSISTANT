"""Pricing & Packaging Intelligence agent (parity with lib/agents/pricing.ts)."""

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
from app.tools.firecrawl import scrape_competitor_pricing
from app.tools.reddit import search_reddit
from app.tools.serpapi import search_web

AGENT_ID = "pricing"
AGENT_NAME = "Pricing Agent"
AGENT_DESCRIPTION = (
    "Scrapes pricing pages and buyer discussions to map pricing models and willingness-to-pay signals."
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
        web_result,
        comp_pricing_result,
        prod_pricing_result,
        reddit_pricing_result,
        pricing_news_result,
    ) = await asyncio.gather(
        search_web(f"{competitor_name} pricing plans cost per seat 2025"),
        scrape_competitor_pricing(comp_url) if comp_url else skipped_scrape_promise(),
        scrape_competitor_pricing(prod_url) if prod_url else skipped_scrape_promise(),
        search_reddit(f"{competitor_name} pricing expensive cheap worth it"),
        search_web(f"{product} OR {competitor_name} pricing model SaaS willingness to pay"),
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
            raw_content.append(f"[PRICING WEB] {r['title']}: {r['snippet']}")

    if is_usable_scrape_page(comp_pricing_result):
        page = comp_pricing_result["data"]
        title = f"{competitor} — pricing page" if competitor else "Competitor pricing page"
        sources.append(
            {
                "url": page["url"],
                "title": title,
                "timestamp": comp_pricing_result["timestamp"],
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[COMPETITOR PRICING PAGE] {page['excerpt']}")

    if is_usable_scrape_page(prod_pricing_result):
        page = prod_pricing_result["data"]
        title = f"{product} — pricing page" if len(product) < 50 else "Product pricing page"
        sources.append(
            {
                "url": page["url"],
                "title": title,
                "timestamp": prod_pricing_result["timestamp"],
                "tool": "firecrawl",
            }
        )
        raw_content.append(f"[OUR PRICING PAGE] {page['excerpt']}")

    if _fulfilled(reddit_pricing_result):
        for p in (reddit_pricing_result.get("data") or [])[:4]:
            sources.append(
                {
                    "url": p["url"],
                    "title": p["title"],
                    "timestamp": p["created"],
                    "tool": "reddit",
                }
            )
            raw_content.append(
                f"[REDDIT PRICING] sentiment={p.get('sentiment')} | {p['title']}: {p['snippet']}"
            )

    if _fulfilled(pricing_news_result):
        for r in (pricing_news_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": r["url"],
                    "title": r["title"],
                    "timestamp": pricing_news_result["timestamp"],
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[PRICING NEWS] {r['title']}: {r['snippet']}")

    prior_block = f"\nPrior conversation context:\n{prior_context}" if prior_context else ""
    system_prompt = f"""You are a pricing strategist who analyses SaaS pricing models, buyer willingness-to-pay signals, and competitive pricing dynamics. You extract concrete pricing data and identify strategic opportunities.{prior_block}"""

    user_prompt = f"""Query: "{query}"
Our product: {product}
Competitor: {competitor_name}

Raw signals:
{chr(10).join(raw_content)}

Produce JSON:
{{
  "facts": string[],
  "interpretation": string[],
  "competitorPricing": [
    {{
      "tierName": string,
      "price": string,
      "features": string[],
      "targetSegment": string
    }}
  ],
  "yourPricing": [
    {{
      "tierName": string,
      "price": string,
      "features": string[],
      "targetSegment": string
    }}
  ],
  "willingnessToPay": "premium" | "mid-market" | "price-sensitive",
  "pricingSignals": string[],
  "recommendation": string,
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
            "competitorPricing": [],
            "yourPricing": [],
            "willingnessToPay": "mid-market",
            "pricingSignals": [],
            "recommendation": "Could not synthesize pricing recommendation.",
            "synthesizedAnswer": "Pricing data collected but synthesis failed.",
            "confidenceScore": 0.4,
        }

    raw_score = parsed["confidenceScore"] if isinstance(parsed.get("confidenceScore"), (int, float)) else 0.6
    tool_results = extract_tool_results(
        [web_result, comp_pricing_result, prod_pricing_result, reddit_pricing_result, pricing_news_result]
    )
    conf_score = round(float(raw_score) * compute_signal_quality_penalty(tool_results, 5), 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": AGENT_ID,
        "domain": "pricing",
        "artifactType": "pricing-table",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "competitorPricing": parsed.get("competitorPricing") or [],
        "yourPricing": parsed.get("yourPricing") or [],
        "willingnessToPay": parsed.get("willingnessToPay") or "mid-market",
        "pricingSignals": parsed.get("pricingSignals") or [],
        "recommendation": parsed.get("recommendation") or "",
    }
