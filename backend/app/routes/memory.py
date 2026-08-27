"""POST /api/memory — extract durable user facts via Gemini."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth import CurrentUser
from app.gemini import generate_json
from app.supabase_client import get_user_client

router = APIRouter()


def _dedupe(arr: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for s in arr:
        t = (s or "").strip()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


@router.post("/api/memory")
async def memory(request: Request, user: CurrentUser):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False}, status_code=400)

    session_id = body.get("sessionId") or ""
    user_query = (body.get("userQuery") or "").strip()
    assistant_answer = (body.get("assistantAnswer") or "").strip()
    existing = body.get("existingMemory") or {}

    if not user_query or not assistant_answer:
        return {"ok": True}

    token = user.get("_access_token", "")
    supabase = get_user_client(token)
    if not supabase:
        return JSONResponse({"ok": False, "error": "supabase unavailable"}, status_code=500)

    products = existing.get("products") or []
    competitors = existing.get("competitors") or []
    interests = existing.get("interests") or []
    facts = existing.get("facts") or []
    raw_summary = existing.get("raw_summary") or ""

    existing_summary = (
        f"Existing memory about this user:\n{raw_summary}\n"
        f"Known products: {', '.join(products) or 'none'}\n"
        f"Known competitors: {', '.join(competitors) or 'none'}"
        if raw_summary
        else "No prior memory about this user."
    )

    system_prompt = """You are a memory extraction system for a growth intelligence assistant.
Your job is to extract durable facts about the USER from their query — not about the companies they're researching.

Extract ONLY facts that reveal something about WHO THE USER IS:
- Their role or job title
- Their company or product they work on
- Companies/products they regularly research or compete with
- Their strategic focus areas

Do NOT extract facts about external companies — only about the user themselves."""

    user_prompt = f"""{existing_summary}

Latest exchange:
User asked: "{user_query}"
System answered: "{assistant_answer[:400]}"

Return JSON with this exact shape:
{{
  "role": string | null,
  "company": string | null,
  "new_products": string[],
  "new_competitors": string[],
  "new_interests": string[],
  "new_facts": string[],
  "summary_update": string
}}"""

    try:
        parsed = await generate_json(system_prompt, user_prompt, max_new_tokens=512, temperature=0.1)
    except Exception as err:
        msg = str(err).lower()
        if any(x in msg for x in ("429", "resource_exhausted", "rate", "gemini")):
            return {"ok": True, "skipped": "rate_limited"}
        return JSONResponse({"ok": False}, status_code=500)

    merged_products = _dedupe([*products, *(parsed.get("new_products") or [])])
    merged_competitors = _dedupe([*competitors, *(parsed.get("new_competitors") or [])])
    merged_interests = _dedupe([*interests, *(parsed.get("new_interests") or [])])

    new_facts = [
        {
            "fact": f,
            "source_session": session_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        for f in (parsed.get("new_facts") or [])
        if f
    ]
    merged_facts = [*facts, *new_facts][-30:]

    update: dict = {
        "user_id": user["id"],
        "products": merged_products,
        "competitors": merged_competitors,
        "interests": merged_interests,
        "facts": merged_facts,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if parsed.get("role"):
        update["role"] = parsed["role"]
    if parsed.get("company"):
        update["company"] = parsed["company"]
    if parsed.get("summary_update"):
        update["raw_summary"] = parsed["summary_update"]

    try:
        supabase.table("user_memory").upsert(update, on_conflict="user_id").execute()
    except Exception:
        return JSONResponse({"ok": False}, status_code=500)

    return {"ok": True}
