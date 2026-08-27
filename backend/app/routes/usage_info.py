"""GET /api/usage-info — non-secret provider config snapshot."""

from __future__ import annotations

from fastapi import APIRouter

from app.auth import CurrentUser
from app.config import get_settings

router = APIRouter()


def _bool_env(value: str) -> bool:
    return bool(value and value.strip())


@router.get("/api/usage-info")
async def usage_info(_user: CurrentUser):
    s = get_settings()
    text_model = s.gemini_model.strip() or "gemini-2.5-flash"
    embed_model = s.gemini_embedding_model.strip() or "gemini-embedding-001"

    providers = [
        {
            "id": "gemini",
            "label": "Google Gemini (LLM + JSON + classify)",
            "kind": "model",
            "configured": _bool_env(s.gemini_api_key),
            "usageNote": "In-app: estimated $ from orchestrator RunMetrics; exact usage: Google AI Studio / Cloud billing.",
        },
        {
            "id": "embed",
            "label": "Gemini embeddings (recall / pgvector)",
            "kind": "model",
            "configured": _bool_env(s.gemini_api_key),
            "usageNote": "Tied to same key as text model.",
        },
        {
            "id": "serpapi",
            "label": "SerpAPI (web, news, trends)",
            "kind": "tool",
            "configured": _bool_env(s.serpapi_key),
            "usageNote": "Dashboard: serpapi.com → Usage.",
        },
        {
            "id": "firecrawl",
            "label": "Firecrawl (scrape pages)",
            "kind": "tool",
            "configured": _bool_env(s.firecrawl_api_key),
            "usageNote": "Dashboard: firecrawl.dev account.",
        },
        {
            "id": "apify",
            "label": "Apify (Twitter/X via Tweet Scraper)",
            "kind": "tool",
            "configured": _bool_env(s.apify_api_token),
            "usageNote": "Apify console → Usage / per-actor runs.",
        },
        {
            "id": "reddit",
            "label": "Reddit (public JSON)",
            "kind": "tool",
            "configured": True,
            "usageNote": "No token required; optional OAuth for higher rate limits.",
        },
        {
            "id": "supabase",
            "label": "Supabase (DB + auth)",
            "kind": "platform",
            "configured": _bool_env(s.supabase_url) and _bool_env(s.supabase_anon_key),
            "usageNote": "Project dashboard for DB and API usage.",
        },
    ]

    return {
        "models": {
            "text": text_model,
            "embedding": embed_model,
            "embeddingDimensions": s.gemini_embedding_dimensions,
        },
        "providers": providers,
    }
