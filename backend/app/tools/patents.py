"""USPTO Patents via PatentsView — mirrors lib/tools/patents.ts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import httpx

from app.supabase_client import get_cached, set_cache

from .fallback import build_tool_result

BASE_URL = "https://api.patentsview.org/patents/query"
TIMEOUT = 20.0


async def search_patents(
    query: str,
    assignee: str | None = None,
    limit: int = 8,
) -> dict[str, Any]:
    cache_key = f"patents:{assignee or ''}:{query}"
    cached = await get_cached("patents", cache_key)
    if cached:
        return {**cached, "cached": True}

    since_date = (datetime.now(timezone.utc) - timedelta(days=365 * 3)).date().isoformat()
    query_obj: dict[str, Any] = {
        "_and": [
            {"_text_any": {"patent_abstract": query}},
            {"_gte": {"patent_date": since_date}},
        ]
    }
    if assignee:
        query_obj["_and"].append({"_contains": {"assignee_organization": assignee}})

    source_url = f"https://patentsview.org/search?q={quote(query)}"

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post(
                BASE_URL,
                headers={"Content-Type": "application/json"},
                json={
                    "q": query_obj,
                    "f": [
                        "patent_number",
                        "patent_title",
                        "patent_abstract",
                        "patent_date",
                        "assignee_organization",
                    ],
                    "o": {"per_page": limit, "sort": [{"patent_date": "desc"}]},
                },
            )
        if not res.is_success:
            raise RuntimeError(f"PatentsView {res.status_code}")

        raw = res.json()
        patents: list[dict[str, Any]] = []
        for p in raw.get("patents") or []:
            assignees = p.get("assignees") or []
            assignee_org = assignees[0].get("assignee_organization") if assignees else None
            patent_number = p.get("patent_number") or ""
            patents.append(
                {
                    "patent_number": patent_number,
                    "patent_title": p.get("patent_title") or "",
                    "patent_abstract": (p.get("patent_abstract") or "")[:400],
                    "patent_date": p.get("patent_date") or "",
                    "assignee_organization": assignee_org,
                    "patent_url": f"https://patents.google.com/patent/US{patent_number}",
                }
            )

        result = build_tool_result(
            data=patents,
            status="ok" if patents else "degraded",
            source="USPTO Patents (PatentsView)",
            source_url=source_url,
        )
        await set_cache("patents", cache_key, result)
        return result
    except Exception:
        return build_tool_result(
            data=[],
            status="failed",
            source="USPTO Patents (failed)",
            source_url=source_url,
        )


async def company_patents(company_name: str, limit: int = 5) -> dict[str, Any]:
    return await search_patents(company_name, company_name, limit)
