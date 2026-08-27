"""Refinement helpers (parity with lib/agents/refine-utils.ts)."""

from __future__ import annotations

from typing import Any


def build_feedback_summary(
    feedback: list[dict[str, Any]],
    actions: list[dict[str, Any]],
    variant_results: list[dict[str, Any]],
    focus: str | None = None,
) -> str:
    lines: list[str] = [
        "[USER FEEDBACK & OUTCOMES — treat these as the highest-priority signal]"
    ]

    if focus:
        lines.append(f"Refinement focus: {focus}")

    likes = [f"+ liked: {f['title']}" for f in feedback if f.get("rating") == "up"]
    dislikes = [
        f"- rejected: {f['title']}" + (f" ({f['note']})" if f.get("note") else "")
        for f in feedback
        if f.get("rating") == "down"
    ]

    if likes:
        lines.append("Recommendations the user validated:")
        lines.extend(likes)
    if dislikes:
        lines.append("Recommendations the user rejected (do NOT repeat these angles):")
        lines.extend(dislikes)

    accepted = [
        f"~ {a['action']}: {a['title']}"
        for a in actions
        if a.get("action") in ("accepted", "refined")
    ]
    if accepted:
        lines.append("Actions the user took:")
        lines.extend(accepted)

    if variant_results:
        lines.append("Variant performance from prior runs:")
        for r in variant_results:
            parts: list[str] = [
                f"  {r.get('variant_id')}"
                + (f" ({r['variant_angle']})" if r.get("variant_angle") else "")
            ]
            if r.get("sent_count"):
                parts.append(f"sent={r['sent_count']}")
            if r.get("open_rate") is not None:
                parts.append(f"open={r['open_rate']}%")
            if r.get("reply_rate") is not None:
                parts.append(f"reply={r['reply_rate']}%")
            if r.get("click_rate") is not None:
                parts.append(f"click={r['click_rate']}%")
            if r.get("meetings_booked"):
                parts.append(f"meetings={r['meetings_booked']}")
            if r.get("hypothesis_confirmed"):
                parts.append(f"hypothesis={r['hypothesis_confirmed']}")
            if r.get("notes"):
                parts.append(f'what_resonated="{str(r["notes"])[:160]}"')
            lines.append(" | ".join(parts))

        lines.extend(
            [
                "",
                "REFINEMENT RULES:",
                "- Keep hypotheses that were confirmed; drop or rewrite hypotheses that were rejected.",
                "- If a variant performed well (reply_rate > 3% or hypothesis=yes), generate a NEW variant that extends its winning angle, not a copy.",
                "- If a variant underperformed (reply_rate < 1% or hypothesis=no), explicitly test the opposite angle.",
                "- Do not reuse identical subject lines or hooks from prior variants.",
            ]
        )

    return "\n".join(lines)


def normalize_fact(fact: str) -> str:
    return " ".join(fact.lower().split())


def build_refinement_deltas(
    previous: list[dict[str, Any]],
    next_outputs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    previous_by_domain = {o["domain"]: o for o in previous}

    deltas: list[dict[str, Any]] = []
    for current in next_outputs:
        if current.get("artifactType") == "mind-map":
            continue

        prior = previous_by_domain.get(current["domain"])
        if not prior:
            deltas.append(
                {
                    "domain": current["domain"],
                    "summary": f"New {current['domain']} output added in this refined cycle.",
                    "afterConfidence": current["confidence"],
                }
            )
            continue

        confidence_shift = current["confidenceScore"] - prior["confidenceScore"]
        prior_facts = {normalize_fact(f) for f in prior.get("facts", [])}
        new_facts = [f for f in current.get("facts", []) if normalize_fact(f) not in prior_facts]

        if abs(confidence_shift) >= 0.08:
            direction = "increased" if confidence_shift > 0 else "decreased"
            deltas.append(
                {
                    "domain": current["domain"],
                    "summary": (
                        f"{current['domain']} confidence {direction} from "
                        f"{prior['confidence']} to {current['confidence']}."
                    ),
                    "beforeConfidence": prior["confidence"],
                    "afterConfidence": current["confidence"],
                }
            )
        elif new_facts:
            deltas.append(
                {
                    "domain": current["domain"],
                    "summary": f"{current['domain']} added new evidence: {new_facts[0][:140]}.",
                    "beforeConfidence": prior["confidence"],
                    "afterConfidence": current["confidence"],
                }
            )
        else:
            deltas.append(
                {
                    "domain": current["domain"],
                    "summary": (
                        f"{current['domain']} direction retained with refreshed validation "
                        "from latest feedback context."
                    ),
                    "beforeConfidence": prior["confidence"],
                    "afterConfidence": current["confidence"],
                }
            )

    return deltas[:8]
