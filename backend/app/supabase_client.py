"""Supabase helpers — signal cache + authenticated client factory."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client, create_client

from .config import get_settings

CACHE_TTL_MINUTES: dict[str, int] = {
    "serpapi_search": 30,
    "serpapi_news": 15,
    "serpapi_trends": 60,
    "reddit": 20,
    "hn": 30,
    "firecrawl": 120,
}


def get_anon_client() -> Client | None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        return None
    return create_client(settings.supabase_url, settings.supabase_anon_key)


def get_user_client(access_token: str) -> Client | None:
    """Client that acts as the authenticated user (RLS applies)."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        return None
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    # supabase-py: set session for PostgREST
    client.postgrest.auth(access_token)
    return client


async def get_cached(tool: str, cache_key: str) -> Any | None:
    client = get_anon_client()
    if not client:
        return None
    try:
        ttl = CACHE_TTL_MINUTES.get(tool, 30)
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=ttl)).isoformat()
        res = (
            client.table("signal_cache")
            .select("result")
            .eq("cache_key", cache_key)
            .eq("tool", tool)
            .gte("created_at", cutoff)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return rows[0].get("result")
    except Exception:
        return None


async def set_cache(tool: str, cache_key: str, result: Any) -> None:
    client = get_anon_client()
    if not client:
        return
    try:
        client.table("signal_cache").upsert(
            {
                "cache_key": cache_key,
                "tool": tool,
                "result": result,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="cache_key,tool",
        ).execute()
    except Exception:
        pass
