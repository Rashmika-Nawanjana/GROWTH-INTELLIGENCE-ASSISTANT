"""Shared tool-fallback utilities (parity with lib/tools/fallback.ts)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

ToolStatus = Literal["ok", "degraded", "failed"]

STATUS_CONFIDENCE: dict[ToolStatus, float] = {
    "ok": 0.85,
    "degraded": 0.55,
    "failed": 0.15,
}


def build_tool_result(
    *,
    data: Any,
    status: ToolStatus,
    source: str,
    source_url: str | None = None,
    cached: bool = False,
    confidence_override: float | None = None,
) -> dict[str, Any]:
    confidence = (
        max(0.0, min(1.0, confidence_override))
        if isinstance(confidence_override, (int, float))
        else STATUS_CONFIDENCE[status]
    )
    return {
        "data": data,
        "source": source,
        "sourceUrl": source_url,
        "source_url": source_url,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "confidence": confidence,
        "status": status,
        "cached": cached,
    }


def _derive_status(result: dict[str, Any]) -> ToolStatus:
    status = result.get("status")
    if status in ("ok", "degraded", "failed"):
        return status  # type: ignore[return-value]
    confidence = result.get("confidence", 0)
    if confidence >= 0.7:
        return "ok"
    if confidence >= 0.3:
        return "degraded"
    return "failed"


def compute_signal_quality_penalty(
    results: list[dict[str, Any]],
    expected_count: int | None = None,
) -> float:
    total_expected = max(expected_count if expected_count is not None else len(results), 1)
    failure_shortfall = max(0, total_expected - len(results))

    weight = 0.0
    count = 0

    for r in results:
        status = _derive_status(r)
        weight += STATUS_CONFIDENCE[status]
        count += 1

    weight += failure_shortfall * STATUS_CONFIDENCE["failed"]
    count += failure_shortfall

    avg = STATUS_CONFIDENCE["failed"] if count == 0 else weight / count
    normalised = (avg - STATUS_CONFIDENCE["failed"]) / (
        STATUS_CONFIDENCE["ok"] - STATUS_CONFIDENCE["failed"]
    )
    penalty = 0.5 + max(0.0, min(1.0, normalised)) * 0.5
    return round(penalty, 3)


def extract_tool_results(results: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in results:
        if isinstance(r, BaseException):
            continue
        if r is not None and isinstance(r, dict) and "confidence" in r:
            out.append(r)
    return out


def summarise_tool_health(results: list[dict[str, Any]]) -> str:
    counts: dict[ToolStatus, int] = {"ok": 0, "degraded": 0, "failed": 0}
    for r in results:
        counts[_derive_status(r)] += 1
    return f"ok:{counts['ok']} degraded:{counts['degraded']} failed:{counts['failed']}"
