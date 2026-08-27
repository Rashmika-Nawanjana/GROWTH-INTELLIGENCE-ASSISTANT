"""Ensure execution variants stay grounded in Stage 1 research signals."""

from __future__ import annotations

from typing import Any


def _build_fallback_grounding_signals(research_outputs: list[dict[str, Any]]) -> list[str]:
    signals: list[str] = []
    for output in research_outputs:
        domain = output.get("domain", "research")
        for fact in (output.get("facts") or [])[:2]:
            if fact:
                signals.append(f"[{domain}] {fact}")
    return signals[:3]


def _build_safe_fallback_variant(product: str, fallback_signals: list[str]) -> dict[str, Any]:
    return {
        "id": "V1-SIGNAL-LED",
        "angle": "Signal-led baseline",
        "hypothesis": f"Grounding outreach in live market signals will increase reply quality for {product}.",
        "successMetric": "reply rate > 3% within 7 days",
        "variable": "opening hook angle",
        "channels": {
            "email": {
                "subject": f"{product}: one signal worth testing this week",
                "body": (
                    "We identified a live market signal relevant to your team and translated it "
                    "into a practical campaign angle. If useful, we can share the short breakdown "
                    "and test plan."
                ),
                "followUps": ["Happy to send the signal snapshot and variant test matrix."],
            },
            "linkedin": {
                "hook": "One live signal changed our outreach priority this week.",
                "post": (
                    f"We used fresh competitor and audience data to frame a tighter message for "
                    f"{product}. If you want, I can share the exact angle and why it should "
                    f"outperform generic outreach."
                ),
            },
        },
        "groundedSignals": fallback_signals
        if fallback_signals
        else ["No external signals available; fallback variant generated from prior context only."],
    }


def enforce_execution_grounding(
    variants: list[dict[str, Any]],
    research_outputs: list[dict[str, Any]],
    product: str,
) -> list[dict[str, Any]]:
    fallback_signals = _build_fallback_grounding_signals(research_outputs)
    safe_variants: list[dict[str, Any]] = []

    for index, variant in enumerate(variants):
        grounded_signals = [s for s in (variant.get("groundedSignals") or []) if s]
        safe_signals = grounded_signals if grounded_signals else fallback_signals
        fallback_hypothesis_signal = safe_signals[0] if safe_signals else f"recent signals for {product}"

        safe_variants.append(
            {
                **variant,
                "id": (variant.get("id") or "").strip() or f"V{index + 1}-SIGNAL",
                "angle": (variant.get("angle") or "").strip() or f"Signal-led angle {index + 1}",
                "hypothesis": (variant.get("hypothesis") or "").strip()
                or f"This angle should outperform generic outreach because of {fallback_hypothesis_signal}.",
                "successMetric": (variant.get("successMetric") or "").strip()
                or "reply rate > 3% within 7 days",
                "variable": (variant.get("variable") or "").strip() or "opening hook angle",
                "channels": variant.get("channels") or {},
                "groundedSignals": safe_signals[:4]
                if safe_signals
                else ["No external signals available; fallback variant generated from prior context only."],
            }
        )

    if safe_variants:
        return safe_variants
    return [_build_safe_fallback_variant(product, fallback_signals)]
