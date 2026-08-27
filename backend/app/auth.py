"""Supabase JWT verification for FastAPI routes."""

from __future__ import annotations

from typing import Annotated, Any

import httpx
from fastapi import Depends, Header, HTTPException, Request

from .config import get_settings


async def _get_user_from_token(access_token: str) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        return None
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "apikey": settings.supabase_anon_key,
            },
        )
    if res.status_code != 200:
        return None
    data = res.json()
    if not data.get("id"):
        return None
    return data


def _token_from_cookie(request: Request) -> str | None:
    """Best-effort extract of Supabase access token from chunked cookies."""
    cookies = request.cookies
    # Common patterns: sb-<ref>-auth-token, or chunked sb-*-auth-token.0/.1
    candidates: list[str] = []
    for name, value in cookies.items():
        if "auth-token" in name and not name.endswith("-code-verifier"):
            candidates.append((name, value))
    if not candidates:
        return None
    # Prefer non-chunked, then stitch chunks in order
    non_chunked = [v for n, v in candidates if "." not in n.split("auth-token")[-1]]
    if non_chunked:
        raw = non_chunked[0]
    else:
        chunks = sorted(
            [(n, v) for n, v in candidates if n.rsplit(".", 1)[-1].isdigit()],
            key=lambda x: int(x[0].rsplit(".", 1)[-1]),
        )
        raw = "".join(v for _, v in chunks) if chunks else candidates[0][1]

    # Cookie value may be URL-encoded JSON: {"access_token":"...","refresh_token":"..."}
    import json
    import urllib.parse

    decoded = urllib.parse.unquote(raw)
    if decoded.startswith("base64-"):
        import base64

        try:
            payload = base64.b64decode(decoded[len("base64-") :] + "==")
            decoded = payload.decode("utf-8", errors="ignore")
        except Exception:
            pass
    try:
        obj = json.loads(decoded)
        if isinstance(obj, list) and obj:
            # Sometimes stored as [access_token, refresh_token, ...]
            if isinstance(obj[0], str) and obj[0].count(".") == 2:
                return obj[0]
        if isinstance(obj, dict):
            token = obj.get("access_token") or obj.get("accessToken")
            if isinstance(token, str):
                return token
    except Exception:
        pass
    # Bare JWT
    if decoded.count(".") == 2:
        return decoded
    return None


async def require_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        token = _token_from_cookie(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = await _get_user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Attach token for downstream Supabase calls as the user
    user["_access_token"] = token
    return user


CurrentUser = Annotated[dict[str, Any], Depends(require_user)]
