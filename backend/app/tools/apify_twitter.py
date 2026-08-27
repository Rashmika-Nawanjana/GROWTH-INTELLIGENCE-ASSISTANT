"""Apify Twitter/X scraper — mirrors lib/tools/apify-twitter.ts via REST API."""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import quote

import httpx

from app.config import get_settings

from .fallback import build_tool_result

logger = logging.getLogger(__name__)

_logged_missing_token = False
APIFY_BASE = "https://api.apify.com/v2"


def _sanitize_handle_candidates(candidates: list[str] | None) -> list[str]:
    if not candidates:
        return []
    out: list[str] = []
    for raw in candidates:
        t = (raw or "").strip()
        if not t:
            continue
        if re.search(r"[:\s/]", t):
            continue
        bare = t.lstrip("@")
        if not re.fullmatch(r"[a-z0-9_]{1,15}", bare):
            continue
        out.append(bare)
    return list(dict.fromkeys(out))[:4]


def _get_run_wait_secs() -> int:
    settings = get_settings()
    raw = settings.apify_max_wait_secs
    return max(10, min(300, raw))


def _map_tweet(item: dict[str, Any]) -> dict[str, Any] | None:
    legacy = item.get("legacy") if isinstance(item.get("legacy"), dict) else {}
    text = (
        item.get("fullText")
        or item.get("text")
        or item.get("full_text")
        or legacy.get("full_text")
        or item.get("content")
        or ""
    )
    text = str(text).strip()
    tweet_id = str(item.get("id") or item.get("tweetId") or item.get("id_str") or item.get("rest_id") or "")
    url = str(
        item.get("url")
        or item.get("tweetUrl")
        or (f"https://x.com/i/web/status/{tweet_id}" if tweet_id else "")
    )
    if not text or not tweet_id:
        return None

    author = item.get("author") or item.get("user") or {}
    return {
        "id": tweet_id,
        "url": url or f"https://x.com/i/web/status/{tweet_id}",
        "text": text,
        "authorHandle": (
            author.get("userName")
            or author.get("username")
            or author.get("screen_name")
            or author.get("name")
        ),
        "createdAt": item.get("createdAt") or item.get("created_at"),
        "likeCount": item.get("likeCount") if isinstance(item.get("likeCount"), int) else None,
        "retweetCount": item.get("retweetCount") if isinstance(item.get("retweetCount"), int) else None,
        "replyCount": item.get("replyCount") if isinstance(item.get("replyCount"), int) else None,
    }


async def scrape_twitter_x(
    terms: list[str],
    *,
    handles: list[str] | None = None,
    max_items: int | None = None,
    sort: str = "Latest",
    language: str = "en",
) -> dict[str, Any]:
    global _logged_missing_token

    settings = get_settings()
    actor_id = settings.apify_twitter_actor_id
    actor_path = quote(actor_id, safe="")

    if not settings.apify_api_token:
        if not _logged_missing_token:
            _logged_missing_token = True
            logger.warning(
                "[apify] APIFY_API_TOKEN is not set; Twitter/X Apify runs are skipped."
            )
        return build_tool_result(
            data=[],
            status="failed",
            source=(
                "Apify Twitter/X (missing APIFY_API_TOKEN — set in Vercel / .env to record usage)"
            ),
            source_url="https://console.apify.com",
        )

    search_terms = [t.strip() for t in terms if t.strip()][:6]
    if not search_terms:
        return build_tool_result(
            data=[],
            status="failed",
            source="Apify Twitter/X (no search terms)",
            source_url="https://console.apify.com",
        )

    twitter_handles = _sanitize_handle_candidates(handles)
    max_items_val = min(max(max_items or 60, 10), 500)
    wait_secs = _get_run_wait_secs()
    actor_input = {
        "searchTerms": search_terms,
        "twitterHandles": twitter_handles,
        "maxItems": max_items_val,
        "sort": sort or "Latest",
        "tweetLanguage": language or "en",
    }

    debug_apify = settings.apify_debug == "1"
    if debug_apify:
        logger.info(
            "[apify] starting run actor=%s searchTerms=%s twitterHandles=%s maxItems=%s waitSecs=%s",
            actor_id,
            search_terms,
            twitter_handles,
            max_items_val,
            wait_secs,
        )

    try:
        async with httpx.AsyncClient(timeout=wait_secs + 30) as client:
            run_res = await client.post(
                f"{APIFY_BASE}/acts/{actor_path}/runs",
                params={
                    "token": settings.apify_api_token,
                    "waitForFinish": str(wait_secs),
                },
                json=actor_input,
            )
            if not run_res.is_success:
                raise RuntimeError(f"Apify run start failed: {run_res.status_code} {run_res.text}")
            run = run_res.json().get("data") or {}

            if debug_apify:
                logger.info(
                    "[apify] run finished id=%s status=%s defaultDatasetId=%s",
                    run.get("id"),
                    run.get("status"),
                    run.get("defaultDatasetId"),
                )

            run_id = run.get("id")
            dataset_id = run.get("defaultDatasetId")
            if not run_id:
                raise RuntimeError("Apify run returned no run id")
            if not dataset_id:
                status = run.get("status", "unknown")
                raise RuntimeError(f"Apify run {run_id} has no defaultDatasetId (status: {status})")

            items_res = await client.get(
                f"{APIFY_BASE}/datasets/{dataset_id}/items",
                params={"token": settings.apify_api_token, "limit": 120},
            )
            if not items_res.is_success:
                raise RuntimeError(f"Apify dataset read failed: {items_res.status_code}")
            items = items_res.json()

        if debug_apify:
            logger.info("[apify] dataset items count: %s", len(items) if isinstance(items, list) else 0)

        tweets: list[dict[str, Any]] = []
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict):
                continue
            mapped = _map_tweet(it)
            if mapped:
                tweets.append(mapped)
            if len(tweets) >= 40:
                break

        run_label = f"run {run_id}"
        return build_tool_result(
            data=tweets,
            status="ok" if tweets else "failed",
            source=(
                f"Apify Twitter/X Scraper ({run_label}, {len(tweets)} items)"
                if tweets
                else f"Apify Twitter/X Scraper ({run_label}, 0 items — check run log in Apify console)"
            ),
            source_url=f"https://console.apify.com/actors/{actor_path}/runs/{run_id}",
        )
    except Exception as err:
        message = str(err)
        logger.error("[apify] actor call or dataset read failed: %s", message)
        return build_tool_result(
            data=[],
            status="failed",
            source=f"Apify Twitter/X error: {message[:200]}",
            source_url=f"https://console.apify.com/actors/{actor_path}",
        )
