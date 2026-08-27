"""Meta Ad Library browser scrape — mirrors lib/tools/meta-ads.ts."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode

from app.supabase_client import get_cached, set_cache

from .fallback import build_tool_result
from .firecrawl import scrape_page

AD_LIBRARY_BASE = "https://www.facebook.com/ads/library"


def _build_ad_library_url(advertiser_name: str) -> str:
    params = urlencode(
        {
            "active_status": "all",
            "ad_type": "all",
            "country": "US",
            "q": advertiser_name,
            "search_type": "keyword_unordered",
        }
    )
    return f"{AD_LIBRARY_BASE}/?{params}"


def _parse_ads_from_markdown(markdown: str, advertiser_name: str) -> list[dict[str, Any]]:
    ads: list[dict[str, Any]] = []
    blocks = [
        b.strip()
        for b in re.split(r"\n{2,}", markdown)
        if 30 < len(b.strip()) < 1000
    ]

    for i, block in enumerate(blocks[:15]):
        if re.search(r"cookie|privacy|terms|sign in|log in", block, re.I):
            continue
        ads.append(
            {
                "id": f"scraped-{i}",
                "page_name": advertiser_name,
                "ad_creative_body": block,
                "ad_snapshot_url": _build_ad_library_url(advertiser_name),
            }
        )

    return ads[:8]


async def search_meta_ads(
    advertiser_name: str,
    country: str = "US",
    limit: int = 15,
) -> dict[str, Any]:
    del country, limit  # API parity with TS; scrape uses US keyword search

    cache_key = f"meta:browser:{advertiser_name}"
    cached = await get_cached("meta_ads", cache_key)
    if cached:
        return {**cached, "cached": True}

    url = _build_ad_library_url(advertiser_name)

    try:
        scraped = await scrape_page(url)
        ads = _parse_ads_from_markdown(
            (scraped.get("data") or {}).get("markdown") or "",
            advertiser_name,
        )
        result = build_tool_result(
            data=ads,
            status="degraded" if ads else "failed",
            source="Meta Ad Library (browser scrape)",
            source_url=url,
        )
        await set_cache("meta_ads", cache_key, result)
        return result
    except Exception:
        return build_tool_result(
            data=[],
            status="failed",
            source="Meta Ad Library (browser scrape)",
            source_url=url,
        )


async def get_ad_messaging(advertiser_name: str) -> list[str]:
    result = await search_meta_ads(advertiser_name)
    messages: list[str] = []
    for ad in result.get("data") or []:
        body = ad.get("ad_creative_body") or ad.get("ad_creative_link_title") or ""
        if body:
            messages.append(body)
        if len(messages) >= 5:
            break
    return messages
