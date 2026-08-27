"""Hacker News Algolia API — mirrors lib/tools/hn-algolia.ts."""

from __future__ import annotations

import time
from typing import Any, Literal
from urllib.parse import quote

import httpx

from app.supabase_client import get_cached, set_cache

from .fallback import build_tool_result

BASE_URL = "https://hn.algolia.com/api/v1"
TIMEOUT = 15.0


async def search_hn(
    query: str,
    type: Literal["story", "comment"] = "story",
) -> dict[str, Any]:
    cache_key = f"hn:{type}:{query}"
    cached = await get_cached("hn", cache_key)
    if cached:
        return {**cached, "cached": True}

    url = f"{BASE_URL}/search"
    params: dict[str, str] = {
        "query": query,
        "tags": type,
        "hitsPerPage": "15",
    }
    since = int(time.time()) - 365 * 24 * 60 * 60
    params["numericFilters"] = f"created_at_i>{since}"

    posts: list[dict[str, Any]] = []
    source_url = f"https://hn.algolia.com/?query={quote(query)}"

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.get(url, params=params)
            if not res.is_success:
                return build_tool_result(
                    data=[],
                    status="failed",
                    source="Hacker News (failed)",
                    source_url=str(res.url),
                )
            raw = res.json()
            for h in (raw.get("hits") or [])[:10]:
                posts.append(
                    {
                        "title": h.get("title")
                        or h.get("story_title")
                        or (h.get("comment_text") or "")[:100],
                        "url": h.get("url")
                        or f"https://news.ycombinator.com/item?id={h.get('objectID', '')}",
                        "score": h.get("points") or 0,
                        "author": h.get("author") or "unknown",
                        "created": h.get("created_at", ""),
                        "commentCount": h.get("num_comments") or 0,
                    }
                )
    except Exception:
        return build_tool_result(
            data=[],
            status="failed",
            source="Hacker News (failed)",
            source_url=source_url,
        )

    result = build_tool_result(
        data=posts,
        status="ok" if posts else "failed",
        source="Hacker News (Algolia)",
        source_url=source_url,
    )
    await set_cache("hn", cache_key, result)
    return result


async def search_hn_comments(query: str) -> dict[str, Any]:
    return await search_hn(query, "comment")


async def get_tech_sentiment(topic: str) -> dict[str, Any]:
    hn_result = await search_hn(topic)
    posts: list[dict[str, Any]] = hn_result.get("data") or []

    if not posts:
        return {
            "hnResult": hn_result,
            "topicScore": 0,
            "summary": "No HN mentions found.",
        }

    avg_score = sum(p.get("score", 0) for p in posts) / len(posts)
    total_comments = sum(p.get("commentCount", 0) for p in posts)
    topic_score = min(100, round((avg_score / 10 + total_comments / 50) * 10))

    summary = (
        f'Found {len(posts)} HN posts about "{topic}" in the last 12 months. '
        f"Average score: {round(avg_score)}, total comments: {total_comments}. "
        f"Tech community interest level: {topic_score}/100."
    )

    return {
        "hnResult": hn_result,
        "topicScore": topic_score,
        "summary": summary,
    }
