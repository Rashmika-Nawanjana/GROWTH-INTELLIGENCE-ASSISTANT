"""Entity URL helpers (parity with lib/agents/entity-url.ts)."""

from __future__ import annotations

import re
from typing import Any

from app.tools.fallback import build_tool_result

# Sentinel: homepage/pricing scrape skipped because competitor/product URL is unknown.
SKIPPED_INFERRED_URL = "skip-inferred-url"

_PLACEHOLDER_COMPETITOR = frozenset(
    {
        "main competitor",
        "competitor",
        "unknown",
        "n/a",
        "na",
        "none",
        "your competitor",
        "the competitor",
    }
)

_PLACEHOLDER_PRODUCT = frozenset(
    {
        "the product",
        "the current product",
        "our product",
        "your product",
        "product",
        "unknown",
        "n/a",
        "na",
    }
)


async def skipped_scrape_promise() -> dict[str, Any]:
    return build_tool_result(
        data={"url": "", "title": "", "markdown": "", "excerpt": ""},
        status="failed",
        source=SKIPPED_INFERRED_URL,
    )


def is_usable_scrape_page(result: Any) -> bool:
    if isinstance(result, BaseException):
        return False
    v = result
    if not isinstance(v, dict):
        return False
    if v.get("source") == SKIPPED_INFERRED_URL:
        return False
    data = v.get("data") or {}
    md = len((data.get("markdown") or "").strip())
    return bool(data.get("url")) and md > 40


def is_placeholder_competitor(name: str | None) -> bool:
    if not name or not name.strip():
        return True
    return name.lower().strip() in _PLACEHOLDER_COMPETITOR


def is_placeholder_product(name: str | None) -> bool:
    if not name or not name.strip():
        return True
    return name.lower().strip() in _PLACEHOLDER_PRODUCT


def competitor_site_url(ctx: dict[str, Any]) -> str | None:
    explicit = (ctx.get("competitor_url") or "").strip()
    if explicit and re.match(r"^https?://", explicit, re.IGNORECASE):
        return explicit
    if is_placeholder_competitor(ctx.get("competitor")):
        return None
    name = ctx["competitor"].strip()
    slug = name.lower().replace(" ", "")
    if len(slug) < 2 or len(slug) > 40:
        return None
    if not re.fullmatch(r"[a-z0-9]+", slug):
        return None
    return f"https://{slug}.com"


def product_site_url(ctx: dict[str, Any]) -> str | None:
    explicit = (ctx.get("product_url") or "").strip()
    if explicit and re.match(r"^https?://", explicit, re.IGNORECASE):
        return explicit
    if is_placeholder_product(ctx.get("product")):
        return None
    name = ctx["product"].strip()
    words = len(name.split())
    if len(name) > 35 or words > 4:
        return None
    slug = name.lower().replace(" ", "")
    if len(slug) < 2 or len(slug) > 40:
        return None
    if not re.fullmatch(r"[a-z0-9]+", slug):
        return None
    return f"https://{slug}.com"
