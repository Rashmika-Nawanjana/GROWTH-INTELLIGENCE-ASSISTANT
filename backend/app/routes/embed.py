"""POST /api/embed — index message embeddings."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth import CurrentUser
from app.gemini import embed_text
from app.supabase_client import get_user_client

router = APIRouter()


@router.post("/api/embed")
async def embed(request: Request, user: CurrentUser):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    session_id = body.get("sessionId")
    message_id = body.get("messageId")
    role = body.get("role")
    content = (body.get("content") or "").strip()

    if not session_id or not role or not content:
        return JSONResponse(
            {"error": "sessionId, role, content are required"}, status_code=400
        )

    token = user.get("_access_token", "")
    supabase = get_user_client(token)
    if not supabase:
        return JSONResponse({"error": "supabase unavailable"}, status_code=500)

    session = (
        supabase.table("chat_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not session.data:
        return JSONResponse({"error": "Session not found"}, status_code=404)

    try:
        embedding = await embed_text(content)
    except Exception:
        embedding = None
    if not embedding:
        return {"ok": True, "skipped": True}

    try:
        supabase.table("chat_embeddings").insert(
            {
                "session_id": session_id,
                "message_id": message_id,
                "role": role,
                "content": content[:8000],
                "embedding": embedding,
            }
        ).execute()
    except Exception as err:
        return JSONResponse({"error": str(err)}, status_code=500)

    return {"ok": True}
