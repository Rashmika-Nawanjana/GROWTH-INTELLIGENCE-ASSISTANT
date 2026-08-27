"""Firecrawl + scrape fallbacks — mirrors lib/tools/firecrawl.ts (core paths)."""

from __future__ import annotations

import asyncio
import random
import re
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings
from app.supabase_client import get_cached, set_cache

from .fallback import build_tool_result

BASE_URL = "https://api.firecrawl.dev/v1"
SCRAPE_DO_BASE = "https://api.scrape.do"
TIMEOUT = 15.0
SCRAPE_DO_TIMEOUT = 25.0

EXTRACT_PROMPTS: dict[str, str] = {
    "pricing": (
        "Extract pricing tiers, features per tier, costs, and billing periods. "
        "Highlight any discounts or special offers."
    ),
    "features": (
        "Extract product features, capabilities, technical details, and key differentiators."
    ),
    "competitor": (
        "Extract positioning, USPs, target audience, and competitive claims."
    ),
    "review": "Extract review ratings, sentiment, pros/cons, and buyer feedback.",
    "generic": (
        "Extract key product information, pricing, features, and any competitive claims."
    ),
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]

SPA_PATTERNS = [
    re.compile(r"facebook\.com", re.I),
    re.compile(r"linkedin\.com", re.I),
    re.compile(r"twitter\.com", re.I),
    re.compile(r"x\.com", re.I),
    re.compile(r"app\.", re.I),
    re.compile(r"dashboard\.", re.I),
    re.compile(r"portal\.", re.I),
]


def _select_extract_prompt(url: str) -> str:
    lower = url.lower()
    if re.search(r"pricing|plan|billing|cost", lower):
        return EXTRACT_PROMPTS["pricing"]
    if re.search(r"feature|capability|docs|technical", lower):
        return EXTRACT_PROMPTS["features"]
    if re.search(r"review|g2|capterra|comparison", lower):
        return EXTRACT_PROMPTS["review"]
    if re.search(r"competitor|vs|alternative", lower):
        return EXTRACT_PROMPTS["competitor"]
    return EXTRACT_PROMPTS["generic"]


def _needs_js_render(url: str) -> bool:
    return any(p.search(url) for p in SPA_PATTERNS)


def _strip_html_to_text(html: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<svg[\s\S]*?</svg>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_main_content(html: str) -> str:
    for pattern in (
        r"<main[^>]*>([\s\S]*?)</main>",
        r"<article[^>]*>([\s\S]*?)</article>",
        r'<div[^>]*role=["\']main["\'][^>]*>([\s\S]*?)</div>',
        r'<div[^>]*class=["\'][^"\']*content[^"\']*["\'][^>]*>([\s\S]*?)</div>',
    ):
        match = re.search(pattern, html, flags=re.I)
        if match and match.group(1) and len(match.group(1)) > 200:
            return _strip_html_to_text(match.group(1))

    cleaned = html
    for tag in ("nav", "header", "footer", "aside", "noscript"):
        cleaned = re.sub(rf"<{tag}[\s\S]*?</{tag}>", " ", cleaned, flags=re.I)
    return _strip_html_to_text(cleaned)


def _assess_scrape_quality(markdown: str, url: str) -> dict[str, Any]:
    text = (markdown or "").strip()
    lower = text.lower()
    block_signals = (
        "access denied",
        "captcha",
        "please enable javascript",
        "sign in to continue",
        "403 forbidden",
    )
    is_block = any(sig in lower for sig in block_signals)
    is_valid = len(text) >= 100 and not is_block
    quality_score = min(1.0, len(text) / 2000) if is_valid else 0.2
    return {
        "isBlockPage": is_block,
        "isValid": is_valid,
        "qualityScore": quality_score,
    }


async def _firecrawl_fetch(
    url: str,
    extract_prompt: str,
    api_key: str,
    *,
    is_strict: bool = False,
) -> dict[str, str] | None:
    payload: dict[str, Any] = {
        "url": url,
        "formats": ["markdown", "extract"],
        "extract": {"prompt": extract_prompt},
    }
    if is_strict:
        payload.update(
            {
                "waitForSelector": "body",
                "onlyMainContent": True,
                "removeTags": ["script", "style"],
            }
        )

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post(
                f"{BASE_URL}/scrape",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                json=payload,
            )
        if not res.is_success:
            return None
        raw = res.json()
        markdown = (raw.get("data") or {}).get("markdown") or ""
        title = (raw.get("data") or {}).get("metadata", {}).get("title") or url
        if len(markdown.strip()) <= 50:
            return None
        return {"markdown": markdown, "title": title}
    except Exception:
        return None


async def _scrape_do_fetch(url: str) -> dict[str, str] | None:
    settings = get_settings()
    if not settings.scrape_do_token:
        return None

    params: dict[str, str] = {
        "token": settings.scrape_do_token,
        "url": url,
        "output": "markdown",
    }
    if _needs_js_render(url):
        params["render"] = "true"
        params["waitUntil"] = "domcontentloaded"

    try:
        async with httpx.AsyncClient(timeout=SCRAPE_DO_TIMEOUT) as client:
            res = await client.get(f"{SCRAPE_DO_BASE}/?{urlencode(params)}")
        if not res.is_success:
            return None
        markdown = res.text.strip()
        if len(markdown) < 50:
            return None
        title_match = re.search(r"^#\s+(.+)$", markdown, re.M)
        title = title_match.group(1).strip() if title_match else url
        return {"markdown": markdown[:8000], "title": title}
    except Exception:
        return None


async def _smart_direct_fetch(url: str) -> dict[str, str] | None:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            res = await client.get(
                url,
                headers={
                    "User-Agent": random.choice(USER_AGENTS),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Cache-Control": "no-cache",
                },
            )
        if not res.is_success:
            return None
        html = res.text
        text = _extract_main_content(html)[:6000]
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
        meta_match = re.search(
            r'<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)["\']',
            html,
            re.I,
        )
        page_title = title_match.group(1).strip() if title_match else url
        if len(text) < 50:
            return None
        markdown = f"{meta_match.group(1).strip()}\n\n{text}" if meta_match else text
        return {"markdown": markdown, "title": page_title}
    except Exception:
        return None


async def _scrape_basic(url: str) -> dict[str, Any]:
    scrape_do = await _scrape_do_fetch(url)
    if scrape_do:
        page = {
            "url": url,
            "title": scrape_do["title"],
            "markdown": scrape_do["markdown"],
            "excerpt": scrape_do["markdown"][:500],
        }
        return build_tool_result(
            data=page,
            status="degraded",
            source="Scrape.do (no Firecrawl key)",
            source_url=url,
        )

    direct = await _smart_direct_fetch(url)
    if direct:
        page = {
            "url": url,
            "title": direct["title"],
            "markdown": direct["markdown"],
            "excerpt": direct["markdown"][:500],
        }
        return build_tool_result(
            data=page,
            status="degraded",
            source="Direct Scrape (fallback)",
            source_url=url,
        )

    page = {
        "url": url,
        "title": url,
        "markdown": "",
        "excerpt": "Could not scrape this page.",
    }
    return build_tool_result(
        data=page,
        status="failed",
        source="Direct Scrape (failed)",
        source_url=url,
    )


async def scrape_page(url: str) -> dict[str, Any]:
    cache_key = f"scrape:{url}"
    cached = await get_cached("firecrawl", cache_key)
    if cached:
        return {**cached, "cached": True}

    settings = get_settings()
    if not settings.firecrawl_api_key:
        return await _scrape_basic(url)

    extract_prompt = _select_extract_prompt(url)
    attempts_made = 0
    result_data: dict[str, str] | None = None

    result_data = await _firecrawl_fetch(url, extract_prompt, settings.firecrawl_api_key)
    attempts_made += 1

    if not result_data:
        await asyncio.sleep(1.0)
        result_data = await _firecrawl_fetch(
            url, extract_prompt, settings.firecrawl_api_key, is_strict=True
        )
        attempts_made += 1

    if not result_data:
        await asyncio.sleep(1.5)
        result_data = await _scrape_do_fetch(url)
        attempts_made += 1

    if not result_data:
        await asyncio.sleep(2.0)
        result_data = await _smart_direct_fetch(url)
        attempts_made += 1

    markdown = result_data["markdown"] if result_data else ""
    title = result_data["title"] if result_data else url

    quality = _assess_scrape_quality(markdown, url)
    page = {
        "url": url,
        "title": title,
        "markdown": markdown,
        "excerpt": markdown[:500],
    }

    status: str = "ok"
    confidence = 0.85

    if not markdown.strip():
        status = "failed"
        confidence = 0.15
    elif quality["isBlockPage"]:
        status = "degraded"
        confidence = 0.35
    elif not quality["isValid"]:
        status = "degraded"
        confidence = quality["qualityScore"] * 0.7
    elif attempts_made > 1:
        status = "degraded"
        confidence = 0.7

    result = build_tool_result(
        data=page,
        status=status,  # type: ignore[arg-type]
        source="Firecrawl",
        source_url=url,
        confidence_override=confidence,
    )
    await set_cache("firecrawl", cache_key, result)
    return result


async def scrape_competitor_pricing(product_url: str) -> dict[str, Any]:
    pricing_url = product_url.rstrip("/") + "/pricing"
    return await scrape_page(pricing_url)
