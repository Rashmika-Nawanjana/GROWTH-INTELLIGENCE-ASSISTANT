"""Gemini generateContent / embedContent client (parity with lib/agents/gemini.ts)."""

from __future__ import annotations

import json
import math
import re
from typing import Any, TypeVar

import httpx

from .config import get_settings

DEFAULT_TEXT_MAX_OUTPUT = 2048
DEFAULT_JSON_MAX_OUTPUT = 4096

T = TypeVar("T")


def _safe_preview(value: str, max_length: int = 300) -> str:
    return value[:max_length] + "..." if len(value) > max_length else value


def _api_key() -> str:
    key = get_settings().gemini_api_key.strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is required")
    return key


def _generation_url(model: str, api_key: str) -> str:
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )


def _build_generation_config(
    *,
    default_max: int,
    max_new_tokens: int | None = None,
    temperature: float | None = None,
    thinking_budget: int | None = None,
    response_mime_type: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    budget = thinking_budget if thinking_budget is not None else settings.gemini_thinking_budget
    config: dict[str, Any] = {
        "temperature": 0.2 if temperature is None else temperature,
        "maxOutputTokens": default_max if max_new_tokens is None else max_new_tokens,
        "thinkingConfig": {"thinkingBudget": budget},
    }
    if response_mime_type:
        config["responseMimeType"] = response_mime_type
    return config


async def generate_text(
    prompt: str,
    *,
    model: str | None = None,
    max_new_tokens: int | None = None,
    temperature: float | None = None,
    thinking_budget: int | None = None,
) -> str:
    settings = get_settings()
    api_key = _api_key()
    use_model = (model or settings.gemini_model or "gemini-2.5-flash").strip()

    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": _build_generation_config(
            default_max=DEFAULT_TEXT_MAX_OUTPUT,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            thinking_budget=thinking_budget,
        ),
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        res = await client.post(
            _generation_url(use_model, api_key),
            headers={"Content-Type": "application/json"},
            json=body,
        )
    raw = res.text
    if not res.is_success:
        raise RuntimeError(f"Gemini generateContent failed ({res.status_code}): {_safe_preview(raw)}")

    try:
        parsed = res.json()
    except Exception:
        return raw.strip()

    try:
        return (
            parsed["candidates"][0]["content"]["parts"][0]["text"].strip()
        )
    except (KeyError, IndexError, TypeError):
        return ""


async def generate_json(
    system_prompt: str,
    user_prompt: str,
    *,
    model: str | None = None,
    max_new_tokens: int | None = None,
    temperature: float | None = None,
    thinking_budget: int | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    api_key = _api_key()
    use_model = (model or settings.gemini_model or "gemini-2.5-flash").strip()
    combined = f"{system_prompt.strip()}\n\n{user_prompt.strip()}"

    body = {
        "contents": [{"parts": [{"text": combined}]}],
        "generationConfig": _build_generation_config(
            default_max=DEFAULT_JSON_MAX_OUTPUT,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            thinking_budget=thinking_budget,
            response_mime_type="application/json",
        ),
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(
            _generation_url(use_model, api_key),
            headers={"Content-Type": "application/json"},
            json=body,
        )
    raw = res.text
    if not res.is_success:
        raise RuntimeError(
            f"Gemini JSON generateContent failed ({res.status_code}): {_safe_preview(raw)}"
        )

    try:
        parsed = res.json()
    except Exception as exc:
        raise RuntimeError(f"Gemini response is not valid JSON: {_safe_preview(raw)}") from exc

    candidate = (parsed.get("candidates") or [{}])[0]
    try:
        text = candidate["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError):
        text = ""
    if not text:
        reason = candidate.get("finishReason", "unknown")
        raise RuntimeError(f"Gemini returned empty JSON response (finishReason: {reason})")

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        raise RuntimeError(f"Gemini JSON parse failed: {_safe_preview(text)}")


async def embed_text(text: str) -> list[float] | None:
    settings = get_settings()
    api_key = _api_key()
    trimmed = text.strip()
    if not trimmed:
        return None

    model = (settings.gemini_embedding_model or "gemini-embedding-001").strip()
    dims = settings.gemini_embedding_dimensions

    body = {
        "content": {"parts": [{"text": trimmed[:8000]}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": dims,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json=body,
        )
    raw = res.text
    if not res.is_success:
        raise RuntimeError(f"Gemini embedContent failed ({res.status_code}): {_safe_preview(raw)}")

    try:
        parsed = res.json()
    except Exception:
        return None

    values = (parsed.get("embedding") or {}).get("values")
    if not isinstance(values, list):
        return None

    if dims < 3072:
        norm = math.sqrt(sum(v * v for v in values))
        if norm > 0:
            return [v / norm for v in values]
    return values


# Aliases matching TS naming for easier mental mapping
generate_hugging_face_text = generate_text
generate_hugging_face_json = generate_json
embed_text_with_hugging_face = embed_text
