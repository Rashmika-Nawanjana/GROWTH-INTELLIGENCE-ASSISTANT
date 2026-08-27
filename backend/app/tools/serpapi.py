"""SerpAPI tools — mirrors lib/tools/serpapi.ts."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from app.config import get_settings
from app.supabase_client import get_cached, set_cache

from .fallback import build_tool_result

BASE_URL = "https://serpapi.com/search"
TIMEOUT = 15.0


async def _serp_fetch(params: dict[str, str]) -> dict[str, Any]:
    settings = get_settings()
    if not settings.serpapi_key:
        raise RuntimeError("SERPAPI_KEY not set")

    query_params = {"api_key": settings.serpapi_key, **params}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        res = await client.get(BASE_URL, params=query_params)
        if not res.is_success:
            raise RuntimeError(f"SerpAPI {res.status_code}: {res.text}")
        return res.json()


def _empty_search_result(source: str, query: str) -> dict[str, Any]:
    return build_tool_result(
        data=[],
        status="failed",
        source=f"{source} (failed)",
        source_url=f"https://google.com/search?q={quote(query)}",
    )


async def search_web(query: str) -> dict[str, Any]:
    cache_key = f"web:{query}"
    cached = await get_cached("serpapi_search", cache_key)
    if cached:
        return {**cached, "cached": True}

    try:
        raw = await _serp_fetch({"engine": "google", "q": query, "num": "10"})
        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("link", ""),
                "snippet": r.get("snippet") or "",
                "date": r.get("date"),
            }
            for r in (raw.get("organic_results") or [])[:8]
        ]
        result = build_tool_result(
            data=results,
            status="ok" if results else "failed",
            source="SerpAPI / Google",
            source_url=f"https://google.com/search?q={quote(query)}",
        )
        await set_cache("serpapi_search", cache_key, result)
        return result
    except Exception:
        return _empty_search_result("SerpAPI / Google", query)


async def search_news(query: str) -> dict[str, Any]:
    cache_key = f"news:{query}"
    cached = await get_cached("serpapi_news", cache_key)
    if cached:
        return {**cached, "cached": True}

    try:
        raw = await _serp_fetch({"engine": "google", "q": query, "tbm": "nws", "num": "10"})
        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("link", ""),
                "snippet": r.get("snippet") or "",
                "date": r.get("date"),
            }
            for r in (raw.get("news_results") or [])[:8]
        ]
        result = build_tool_result(
            data=results,
            status="ok" if results else "failed",
            source="SerpAPI / Google News",
            source_url=f"https://news.google.com/search?q={quote(query)}",
        )
        await set_cache("serpapi_news", cache_key, result)
        return result
    except Exception:
        return _empty_search_result("SerpAPI / Google News", query)


async def search_trends(keywords: list[str]) -> dict[str, Any]:
    joined = ",".join(keywords)
    cache_key = f"trends:{joined}"
    cached = await get_cached("serpapi_trends", cache_key)
    if cached:
        return {**cached, "cached": True}

    explore_url = f"https://trends.google.com/trends/explore?q={quote(joined)}"
    try:
        raw = await _serp_fetch(
            {
                "engine": "google_trends",
                "q": joined,
                "data_type": "TIMESERIES",
                "date": "today 12-m",
            }
        )
        points: list[dict[str, Any]] = []
        for point in raw.get("interest_over_time", {}).get("timeline_data") or []:
            for kw in point.get("values") or []:
                points.append(
                    {
                        "date": point.get("date", ""),
                        "value": int(kw.get("value") or 0),
                        "keyword": kw.get("query", ""),
                    }
                )
        result = build_tool_result(
            data=points,
            status="ok" if points else "failed",
            source="SerpAPI / Google Trends",
            source_url=explore_url,
        )
        await set_cache("serpapi_trends", cache_key, result)
        return result
    except Exception:
        return build_tool_result(
            data=[],
            status="failed",
            source="SerpAPI / Google Trends (failed)",
            source_url=explore_url,
        )


async def search_ads_transparency(advertiser: str) -> dict[str, Any]:
    cache_key = f"ads:{advertiser}"
    cached = await get_cached("serpapi_search", cache_key)
    if cached:
        return {**cached, "cached": True}

    try:
        raw = await _serp_fetch(
            {
                "engine": "google",
                "q": f'"{advertiser}" site:adstransparency.google.com OR "{advertiser}" ads',
                "num": "5",
            }
        )
        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("link", ""),
                "snippet": r.get("snippet") or "",
            }
            for r in (raw.get("organic_results") or [])[:5]
        ]
        result = build_tool_result(
            data=results,
            status="ok" if results else "failed",
            source="SerpAPI / Google Ads Transparency",
        )
        await set_cache("serpapi_search", cache_key, result)
        return result
    except Exception:
        return _empty_search_result("SerpAPI / Google Ads Transparency", advertiser)
