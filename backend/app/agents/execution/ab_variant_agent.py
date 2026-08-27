"""A/B Variant Agent — hypothesis-driven message variants (Stage 2 sub-agent)."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from app.gemini import generate_json
from app.models import score_to_level
from app.tools.fallback import compute_signal_quality_penalty, extract_tool_results
from app.tools.hn_algolia import search_hn
from app.tools.meta_ads import search_meta_ads
from app.tools.serpapi import search_web


async def run_ab_variant_agent(ctx: dict[str, Any]) -> dict[str, Any]:
    query = ctx["query"]
    product = ctx["product"]
    competitor = ctx.get("competitor")
    prior_context = ctx.get("prior_context")
    research_outputs = ctx.get("research_outputs") or []

    meta_ads_result, hn_result, web_result = await asyncio.gather(
        search_meta_ads(competitor) if competitor else search_meta_ads(product),
        search_hn(f"{product} {competitor or ''} outreach messaging"),
        search_web(f"{product} vs {competitor or 'competitors'} buyer decision 2025"),
        return_exceptions=True,
    )

    sources: list[dict[str, Any]] = []
    raw_content: list[str] = []

    if research_outputs:
        research_summary = "\n".join(
            f"[{o.get('domain', 'research')}] FACTS: {'; '.join((o.get('facts') or [])[:3])} | "
            f"INTERPRETATION: {'; '.join((o.get('interpretation') or [])[:2])}"
            for o in research_outputs
        )
        raw_content.append(f"[RESEARCH GROUNDING]\n{research_summary}")

    if not isinstance(meta_ads_result, BaseException) and meta_ads_result:
        for ad in (meta_ads_result.get("data") or [])[:5]:
            snapshot_url = ad.get("adSnapshotUrl") or ad.get("ad_snapshot_url")
            if snapshot_url:
                sources.append(
                    {
                        "url": snapshot_url,
                        "title": f"{ad.get('pageName') or ad.get('page_name', 'Competitor')} Ad",
                        "timestamp": meta_ads_result.get("timestamp", ""),
                        "tool": "firecrawl",
                    }
                )
            body = ad.get("adCreativeBody") or ad.get("ad_creative_body")
            if body:
                raw_content.append(
                    f"[COMPETITOR AD] {ad.get('pageName') or ad.get('page_name', '')}: \"{body}\""
                )

    if not isinstance(hn_result, BaseException) and hn_result:
        for post in (hn_result.get("data") or [])[:4]:
            sources.append(
                {
                    "url": post.get("url", ""),
                    "title": post.get("title", ""),
                    "timestamp": post.get("created", hn_result.get("timestamp", "")),
                    "tool": "hn",
                }
            )
            raw_content.append(f"[HN SENTIMENT] {post.get('title', '')}")

    if not isinstance(web_result, BaseException) and web_result:
        for result in (web_result.get("data") or [])[:3]:
            sources.append(
                {
                    "url": result.get("url", ""),
                    "title": result.get("title", ""),
                    "timestamp": web_result.get("timestamp", ""),
                    "tool": "serpapi",
                }
            )
            raw_content.append(f"[BUYER DECISION] {result.get('title', '')}: {result.get('snippet', '')}")

    system_prompt = """You are a specialist A/B test strategist for B2B SaaS outreach campaigns.

Your job is to produce 3 structured, hypothesis-driven message variants grounded in live signals.

Rules:
- Each variant tests ONE variable (angle/hook/frame) — not multiple things at once.
- Every hypothesis must be falsifiable: it predicts a specific outcome for a specific audience because of a specific signal.
- Variants must be meaningfully different: ROI, competitor gap, insight-led, no-headcount, pain-point-first are all distinct.
- Success metrics must be concrete and measurable (reply rate, meetings booked, etc.).
- Ground every hypothesis explicitly in a signal from the research or raw data.
- Output valid JSON matching the schema exactly."""

    if prior_context:
        system_prompt += f"\n\nPrior conversation context (build on this):\n{prior_context}"

    user_prompt = f"""Query: "{query}"
Product: {product}
{f"Competitor: {competitor}" if competitor else ""}

Raw signals:
{chr(10).join(raw_content)}

Produce a JSON object with this exact shape:
{{
  "variants": [
    {{
      "id": string,
      "angle": string,
      "hypothesis": string,
      "successMetric": string,
      "variable": string,
      "channels": {{
        "email": {{
          "subject": string,
          "body": string,
          "followUps": string[]
        }},
        "linkedin": {{
          "hook": string,
          "post": string
        }}
      }},
      "groundedSignals": string[]
    }}
  ],
  "facts": string[],
  "interpretation": string[],
  "confidenceScore": number
}}"""

    comp_label = competitor or "your current tool"
    try:
        parsed = await generate_json(system_prompt, user_prompt, max_new_tokens=1800, temperature=0.25)
    except Exception:
        parsed = {
            "variants": [
                {
                    "id": "V1-ROI",
                    "angle": "ROI-focused",
                    "hypothesis": (
                        f"ROI messaging outperforms competitor-gap for VP Sales at Series B because "
                        f"budget pressure is the primary buying signal for {product}"
                    ),
                    "successMetric": "reply rate > 4% within 72h",
                    "variable": "opening hook angle",
                    "channels": {
                        "email": {
                            "subject": f"What if {product} paid for itself in 30 days?",
                            "body": (
                                f"Most teams spend 60% of selling time on manual research. {product} flips "
                                f"that ratio — your reps get live-sourced intelligence in minutes, not days.\n\n"
                                f"Worth a 20-minute call to show you the math?"
                            ),
                            "followUps": ["Following up — did the ROI angle land?"],
                        },
                        "linkedin": {
                            "hook": "Your top reps are losing deals to intel lag.",
                            "post": (
                                f"{product} surfaces live competitor, pricing, and buyer signals before "
                                f"the call even starts. Happy to share what that looks like for a team your size."
                            ),
                        },
                    },
                    "groundedSignals": [
                        "Budget pressure identified in research signals",
                        "Competitor ad messaging focuses on speed",
                    ],
                },
                {
                    "id": "V2-COMPETITOR-GAP",
                    "angle": "Competitor gap",
                    "hypothesis": (
                        "Highlighting a specific competitor weakness increases curiosity opens for buyers "
                        "already evaluating alternatives"
                    ),
                    "successMetric": "click-through on demo link > 8%",
                    "variable": "competitive framing vs ROI framing",
                    "channels": {
                        "email": {
                            "subject": f"What {comp_label} doesn't show you",
                            "body": (
                                f"{comp_label} gives you static reports. {product} pulls live signals — "
                                f"funding moves, job postings, ad shifts — in real time.\n\n"
                                f"Curious what that difference looks like for your team?"
                            ),
                            "followUps": ["Still thinking it over? Happy to share a side-by-side."],
                        },
                        "linkedin": {
                            "hook": "Static research is a competitive liability in 2025.",
                            "post": (
                                f"{product} vs {comp_label}: one surfaces live signals before the call, "
                                f"one summarises what happened last quarter. Reach out if you want to see "
                                f"the gap in action."
                            ),
                        },
                    },
                    "groundedSignals": [
                        "Competitor ads emphasise static reports",
                        "HN sentiment shows frustration with lagging intel",
                    ],
                },
                {
                    "id": "V3-INSIGHT-LED",
                    "angle": "Insight-led",
                    "hypothesis": (
                        "Opening with a specific, non-obvious insight about the prospect's market "
                        "increases reply rates among analytical buyers"
                    ),
                    "successMetric": "reply rate > 5% for VP-level prospects",
                    "variable": "personalised insight hook vs generic value prop",
                    "channels": {
                        "email": {
                            "subject": "One signal your team is probably missing",
                            "body": (
                                f"I ran {product} against your category this morning — three competitors "
                                f"increased ad spend in the last 30 days while pulling back on pricing pages. "
                                f"That's usually a pivot signal.\n\n"
                                f"Want me to walk you through what it means for your Q3 positioning?"
                            ),
                            "followUps": ["Wanted to check — did the market signal angle resonate?"],
                        },
                        "linkedin": {
                            "hook": "I found something interesting about your market this morning.",
                            "post": (
                                f"Using {product} I spotted a pattern: three of your top competitors shifted "
                                f"ad messaging this week. Curious what that might mean for your positioning? "
                                f"Happy to share the breakdown."
                            ),
                        },
                    },
                    "groundedSignals": [
                        "Market trend agent detected competitor ad spend shifts",
                        "Positioning agent identified untapped messaging angles",
                    ],
                },
            ],
            "facts": [
                re.sub(r"^\[[^\]]+\]\s*", "", s)
                for s in raw_content[:3]
                if len(re.sub(r"^\[[^\]]+\]\s*", "", s)) > 15
            ],
            "interpretation": ["A/B variant synthesis temporarily unavailable — default variants generated."],
            "confidenceScore": 0.4,
        }

    raw_score = parsed.get("confidenceScore", 0.65)
    if not isinstance(raw_score, (int, float)):
        raw_score = 0.65
    tool_results = extract_tool_results([meta_ads_result, hn_result, web_result])
    conf_score = round(float(raw_score) * compute_signal_quality_penalty(tool_results, 3), 2)
    confidence = score_to_level(conf_score)

    return {
        "agentId": "ab-variant-agent",
        "domain": "execution-engine",
        "artifactType": "execution-plan",
        "confidence": confidence,
        "confidenceScore": conf_score,
        "facts": parsed.get("facts") or [],
        "interpretation": parsed.get("interpretation") or [],
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "variants": parsed.get("variants") or [],
    }
