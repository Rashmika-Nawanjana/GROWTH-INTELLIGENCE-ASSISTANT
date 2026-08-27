"""Reddit public JSON API — mirrors lib/tools/reddit.ts."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from app.supabase_client import get_cached, set_cache

from .fallback import build_tool_result
from .hn_algolia import search_hn

BASE_URL = "https://www.reddit.com"
USER_AGENT = "GrowthIntelBot/1.0 (hackathon demo)"
TIMEOUT = 15.0

_NEGATIVE = [
    "terrible", "awful", "broken", "scam", "hate", "disappointed",
    "worst", "bad", "overpriced", "useless", "unreliable",
]
_POSITIVE = [
    "love", "great", "amazing", "excellent", "best", "fantastic",
    "perfect", "awesome", "recommend", "worth",
]


def _detect_sentiment(text: str) -> str:
    lower = text.lower()
    neg_score = sum(1 for w in _NEGATIVE if w in lower)
    pos_score = sum(1 for w in _POSITIVE if w in lower)
    if neg_score > pos_score:
        return "negative"
    if pos_score > neg_score:
        return "positive"
    return "neutral"


async def _hn_fallback(query: str) -> dict[str, Any]:
    hn = await search_hn(query)
    posts = [
        {
            "title": p.get("title", ""),
            "subreddit": "r/hackernews",
            "score": p.get("score", 0),
            "url": p.get("url", ""),
            "snippet": p.get("title", ""),
            "created": p.get("created", ""),
            "sentiment": "neutral",
        }
        for p in (hn.get("data") or [])
    ]
    return build_tool_result(
        data=posts,
        status="degraded" if posts else "failed",
        source="Hacker News (Reddit fallback)",
        source_url="https://hn.algolia.com",
    )


async def search_reddit(query: str, subreddit: str | None = None) -> dict[str, Any]:
    cache_key = f"reddit:{subreddit or 'all'}:{query}"
    cached = await get_cached("reddit", cache_key)
    if cached:
        return {**cached, "cached": True}

    search_path = f"/r/{subreddit}/search.json" if subreddit else "/search.json"
    params: dict[str, str] = {
        "q": query,
        "sort": "relevance",
        "t": "year",
        "limit": "15",
    }
    if subreddit:
        params["restrict_sr"] = "1"

    url = f"{BASE_URL}{search_path}?{urlencode(params)}"

    try:
        import httpx

        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.get(url, headers={"User-Agent": USER_AGENT})

        if not res.is_success:
            return await _hn_fallback(query)

        raw = res.json()
        posts: list[dict[str, Any]] = []
        for c in (raw.get("data", {}).get("children") or []):
            if c.get("kind") != "t3":
                continue
            p = c.get("data") or {}
            text = f"{p.get('title', '')} {p.get('selftext') or ''}"
            posts.append(
                {
                    "title": p.get("title", ""),
                    "subreddit": p.get("subreddit_name_prefixed", ""),
                    "score": p.get("score", 0),
                    "url": f"https://reddit.com{p.get('permalink', '')}",
                    "snippet": (p.get("selftext") or p.get("title", ""))[:300],
                    "created": datetime.fromtimestamp(
                        p.get("created_utc", 0), tz=timezone.utc
                    ).isoformat(),
                    "sentiment": _detect_sentiment(text),
                }
            )
            if len(posts) >= 10:
                break

        if not posts:
            return await _hn_fallback(query)

        result = build_tool_result(
            data=posts,
            status="ok",
            source="Reddit",
            source_url=url,
        )
        await set_cache("reddit", cache_key, result)
        return result
    except Exception:
        return await _hn_fallback(query)


async def search_product_reviews(product_name: str) -> dict[str, Any]:
    return await search_reddit(
        f"{product_name} review OR experience OR pricing OR alternative"
    )


async def search_subreddits(query: str, subreddits: list[str]) -> dict[str, Any]:
    results = await asyncio.gather(
        *[search_reddit(query, sr) for sr in subreddits],
        return_exceptions=True,
    )

    rejected_count = sum(1 for r in results if isinstance(r, BaseException))
    all_posts: list[dict[str, Any]] = []
    for r in results:
        if isinstance(r, dict):
            all_posts.extend(r.get("data") or [])

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for p in sorted(all_posts, key=lambda x: x.get("score", 0), reverse=True):
        post_url = p.get("url", "")
        if post_url in seen:
            continue
        seen.add(post_url)
        unique.append(p)
        if len(unique) >= 12:
            break

    if not unique:
        status = "failed"
    elif rejected_count > 0:
        status = "degraded"
    else:
        status = "ok"

    return build_tool_result(
        data=unique,
        status=status,
        source="Reddit (multi-subreddit)",
        source_url="https://www.reddit.com",
    )
