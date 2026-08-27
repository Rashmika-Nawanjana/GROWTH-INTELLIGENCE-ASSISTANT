"""LinkedIn Ad Library scrape — mirrors lib/tools/linkedin-ads.ts."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from app.supabase_client import get_cached, set_cache

from .fallback import build_tool_result
from .firecrawl import scrape_page


async def scrape_linkedin_ads(company_name: str) -> dict[str, Any]:
    cache_key = f"linkedin-ads:{company_name}"
    cached = await get_cached("linkedin_ads", cache_key)
    if cached:
        return {**cached, "cached": True}

    search_url = (
        f"https://www.linkedin.com/ad-library/search?keywords={quote(company_name)}"
    )

    try:
        scraped = await scrape_page(search_url)
        markdown = (scraped.get("data") or {}).get("markdown") or ""

        ads = [
            {
                "advertiser": company_name,
                "adCopy": line,
                "url": search_url,
            }
            for line in (
                ln.strip()
                for ln in markdown.split("\n")
            )
            if len(line) > 40 and not line.startswith("#") and not line.startswith("http")
        ][:10]

        result = build_tool_result(
            data=ads,
            status="ok" if ads else "degraded",
            source="LinkedIn Ad Library",
            source_url=search_url,
            confidence_override=0.7 if ads else 0.3,
        )
        await set_cache("linkedin_ads", cache_key, result)
        return result
    except Exception:
        return build_tool_result(
            data=[],
            status="failed",
            source="LinkedIn Ad Library (failed)",
            source_url=search_url,
            confidence_override=0.0,
        )


async def scrape_competitor_linkedin_ads(
    competitors: list[str],
) -> list[dict[str, Any]]:
    import asyncio

    return list(await asyncio.gather(*(scrape_linkedin_ads(c) for c in competitors)))
