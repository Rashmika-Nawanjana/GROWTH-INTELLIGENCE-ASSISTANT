"""Source URL validation and ranking — mirrors lib/tools/source-validator.ts."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse, urlunparse

from app.models import AgentSource

BLOCKED_DOMAINS = [
    "growth-intelligence-assistant-ai.vercel.app",
    "localhost",
    "127.0.0.1",
    "maincompetitor.com",
    "relevantcompetitors.com",
    "theproduct.com",
    "thecurrentproduct.com",
    "ourproduct.com",
    "yourproduct.com",
    "peerproducts.com",
    "google.com/search",
    "google.com/sorry",
    "www.google.com/search",
    "bing.com/search",
    "duckduckgo.com",
    "search.yahoo.com",
    "hn.algolia.com",
    "serpapi.com",
    "reddit.com/search",
    "www.reddit.com/search",
    "facebook.com/ads/library",
    "ads.google.com",
]

BLOCKED_URL_PATTERNS = [
    re.compile(r"^https?://(www\.)?google\.\w+/search", re.I),
    re.compile(r"^https?://hn\.algolia\.com/?\?", re.I),
    re.compile(r"^https?://(www\.)?reddit\.com/search", re.I),
    re.compile(r"^https?://(www\.)?bing\.com/search", re.I),
    re.compile(r"^https?://search\.yahoo\.com", re.I),
    re.compile(r"^https?://duckduckgo\.com/?\?", re.I),
    re.compile(r"^https?://trends\.google\.com/trends/explore", re.I),
    re.compile(r"^https?://growth-intelligence-assistant", re.I),
    re.compile(r"^https?://localhost", re.I),
    re.compile(r"^https?://127\.0\.0\.1", re.I),
]

TRUSTED_DOMAINS = [
    "techcrunch.com",
    "bloomberg.com",
    "reuters.com",
    "wsj.com",
    "ft.com",
    "forbes.com",
    "hbr.org",
    "mckinsey.com",
    "bain.com",
    "bcg.com",
    "gartner.com",
    "forrester.com",
    "statista.com",
    "crunchbase.com",
    "pitchbook.com",
    "g2.com",
    "capterra.com",
    "trustradius.com",
    "producthunt.com",
    "ycombinator.com",
    "news.ycombinator.com",
    "arxiv.org",
    "github.com",
    "medium.com",
    "substack.com",
    "nytimes.com",
    "theverge.com",
    "wired.com",
    "arstechnica.com",
    "cnbc.com",
    "businessinsider.com",
    "venturebeat.com",
    "semafor.com",
    "theinformation.com",
    "protocol.com",
    "zdnet.com",
    "infoworld.com",
    "ieee.org",
    "wikipedia.org",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "reddit.com",
    "sec.gov",
    "patents.google.com",
    "uspto.gov",
]


def is_valid_source_url(url: str | None) -> bool:
    if not url or not isinstance(url, str):
        return False

    trimmed = url.strip()
    if not trimmed:
        return False

    if not re.match(r"^https?://", trimmed, re.I):
        return False

    for pattern in BLOCKED_URL_PATTERNS:
        if pattern.search(trimmed):
            return False

    try:
        parsed = urlparse(trimmed)
        host_path = (parsed.hostname or "") + parsed.path
        for blocked in BLOCKED_DOMAINS:
            if blocked in host_path:
                return False
    except Exception:
        return False

    return True


def is_trusted_source(url: str) -> bool:
    try:
        hostname = (urlparse(url).hostname or "").removeprefix("www.")
        return any(hostname == d or hostname.endswith(f".{d}") for d in TRUSTED_DOMAINS)
    except Exception:
        return False


def _clean_source_title(title: str, url: str) -> str:
    if not title or len(title) < 3:
        try:
            return (urlparse(url).hostname or "Source").removeprefix("www.")
        except Exception:
            return "Source"

    cleaned = title
    junk_prefixes = [
        re.compile(r"^search results for:?\s*", re.I),
        re.compile(r"^results for:?\s*", re.I),
        re.compile(r"^google search:?\s*", re.I),
        re.compile(r"^about \d+ results", re.I),
    ]
    for prefix in junk_prefixes:
        cleaned = prefix.sub("", cleaned)
    cleaned = cleaned.strip()
    return cleaned or title


def _normalize_url(url: str) -> str | None:
    try:
        parsed = urlparse(url)
        parsed = parsed._replace(fragment="")
        normalised = urlunparse(parsed).rstrip("/")
        return normalised
    except Exception:
        return None


def filter_and_rank_sources(
    sources: list[AgentSource] | list[dict[str, Any]],
    limit: int = 12,
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    valid: list[dict[str, Any]] = []

    for s in sources:
        if isinstance(s, AgentSource):
            src = s.model_dump(by_alias=True)
        else:
            src = dict(s)

        url = src.get("url")
        if not is_valid_source_url(url):
            continue

        normalised = _normalize_url(str(url))
        if not normalised or normalised in seen:
            continue
        seen.add(normalised)

        valid.append(
            {
                **src,
                "title": _clean_source_title(str(src.get("title", "")), str(url)),
                "_trusted": is_trusted_source(str(url)),
            }
        )

    valid.sort(key=lambda x: (not x.get("_trusted", False),))
    return [{k: v for k, v in item.items() if k != "_trusted"} for item in valid[:limit]]


def filter_display_sources(
    sources: list[dict[str, str]],
    limit: int = 12,
) -> list[dict[str, str]]:
    seen: set[str] = set()
    valid: list[dict[str, Any]] = []

    for s in sources:
        url = s.get("url")
        if not is_valid_source_url(url):
            continue

        normalised = _normalize_url(str(url))
        if not normalised or normalised in seen:
            continue
        seen.add(normalised)

        valid.append(
            {
                "title": _clean_source_title(s.get("title", ""), str(url)),
                "url": url,
                "trusted": is_trusted_source(str(url)),
            }
        )

    valid.sort(key=lambda x: (not x.get("trusted", False),))
    return [{"title": item["title"], "url": item["url"]} for item in valid[:limit]]
