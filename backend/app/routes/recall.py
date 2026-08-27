"""POST /api/recall — semantic recall via pgvector."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth import CurrentUser
from app.gemini import embed_text
from app.supabase_client import get_user_client

router = APIRouter()


@router.post("/api/recall")
async def recall(request: Request, user: CurrentUser):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    session_id = body.get("sessionId")
    query = (body.get("query") or "").strip()
    match_count = body.get("matchCount", 5)

    if not session_id or not query:
        return JSONResponse({"error": "sessionId and query are required"}, status_code=400)

    token = user.get("_access_token", "")
    supabase = get_user_client(token)
    if not supabase:
        return {"hits": [], "context": ""}

    session = (
        supabase.table("chat_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not session.data:
        return {"hits": [], "context": ""}

    try:
        embedding = await embed_text(query)
    except Exception:
        embedding = None
    if not embedding:
        return {"hits": [], "context": ""}

    try:
        res = supabase.rpc(
            "match_chat_embeddings",
            {
                "p_session_id": session_id,
                "p_query_embedding": embedding,
                "p_match_count": match_count,
            },
        ).execute()
        hits = res.data or []
    except Exception:
        return {"hits": [], "context": ""}

    context = ""
    if hits:
        lines = [f"- ({h.get('role')}) {(h.get('content') or '')[:300]}" for h in hits]
        context = "[Relevant context from earlier in this chat]\n" + "\n".join(lines)

    return {"hits": hits, "context": context}
