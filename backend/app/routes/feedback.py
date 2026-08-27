"""POST/GET /api/feedback — recommendation & variant feedback."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth import CurrentUser
from app.supabase_client import get_user_client

router = APIRouter()


@router.post("/api/feedback")
async def feedback_post(request: Request, user: CurrentUser):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid JSON"}, status_code=400)

    kind = body.get("kind")
    session_id = body.get("sessionId")
    if not kind or not session_id:
        return JSONResponse({"ok": False, "error": "missing kind or sessionId"}, status_code=400)

    token = user.get("_access_token", "")
    supabase = get_user_client(token)
    if not supabase:
        return JSONResponse({"ok": False, "error": "supabase unavailable"}, status_code=500)

    try:
        if kind == "recommendation-feedback":
            if not body.get("recommendationKey") or not body.get("title") or not body.get("rating"):
                return JSONResponse({"ok": False, "error": "missing required fields"}, status_code=400)
            supabase.table("recommendation_feedback").insert(
                {
                    "user_id": user["id"],
                    "session_id": session_id,
                    "message_id": body.get("messageId"),
                    "recommendation_key": body["recommendationKey"],
                    "title": body["title"],
                    "rating": body["rating"],
                    "note": body.get("note"),
                }
            ).execute()
            return {"ok": True}

        if kind == "recommendation-action":
            if not body.get("recommendationKey") or not body.get("title") or not body.get("action"):
                return JSONResponse({"ok": False, "error": "missing required fields"}, status_code=400)
            supabase.table("recommendation_actions").insert(
                {
                    "user_id": user["id"],
                    "session_id": session_id,
                    "message_id": body.get("messageId"),
                    "recommendation_key": body["recommendationKey"],
                    "title": body["title"],
                    "action": body["action"],
                    "metadata": body.get("metadata") or {},
                }
            ).execute()
            return {"ok": True}

        if kind == "variant-result":
            if not body.get("variantId"):
                return JSONResponse({"ok": False, "error": "missing required fields"}, status_code=400)
            supabase.table("variant_results").insert(
                {
                    "user_id": user["id"],
                    "session_id": session_id,
                    "message_id": body.get("messageId"),
                    "variant_id": body["variantId"],
                    "variant_angle": body.get("variantAngle"),
                    "hypothesis": body.get("hypothesis"),
                    "success_metric": body.get("successMetric"),
                    "sent_count": body.get("sentCount"),
                    "open_rate": body.get("openRate"),
                    "reply_rate": body.get("replyRate"),
                    "click_rate": body.get("clickRate"),
                    "meetings_booked": body.get("meetingsBooked"),
                    "hypothesis_confirmed": body.get("hypothesisConfirmed"),
                    "notes": body.get("notes"),
                }
            ).execute()
            return {"ok": True}

        return JSONResponse({"ok": False, "error": "unknown kind"}, status_code=400)
    except Exception as err:
        return JSONResponse({"ok": False, "error": str(err)}, status_code=500)


@router.get("/api/feedback")
async def feedback_get(request: Request, user: CurrentUser):
    session_id = request.query_params.get("sessionId")
    if not session_id:
        return JSONResponse({"ok": False, "error": "sessionId required"}, status_code=400)

    token = user.get("_access_token", "")
    supabase = get_user_client(token)
    if not supabase:
        return {"ok": True, "feedback": [], "actions": [], "variantResults": []}

    try:
        fb = (
            supabase.table("recommendation_feedback")
            .select("*")
            .eq("session_id", session_id)
            .eq("user_id", user["id"])
            .execute()
        )
        actions = (
            supabase.table("recommendation_actions")
            .select("*")
            .eq("session_id", session_id)
            .eq("user_id", user["id"])
            .execute()
        )
        variants = (
            supabase.table("variant_results")
            .select("*")
            .eq("session_id", session_id)
            .eq("user_id", user["id"])
            .execute()
        )
        return {
            "ok": True,
            "feedback": fb.data or [],
            "actions": actions.data or [],
            "variantResults": variants.data or [],
        }
    except Exception:
        return {"ok": True, "feedback": [], "actions": [], "variantResults": []}
