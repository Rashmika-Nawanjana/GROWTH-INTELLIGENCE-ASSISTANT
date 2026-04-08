---
name: ab-test-orchestrator
description: Generates structured A/B test variant sets with falsifiable hypotheses for outreach campaigns. Use when the user requests message variants, outreach alternatives, or campaign angle testing — especially for email and LinkedIn sequences grounded in research signals.
---

# A/B Test Orchestrator Skill

**Purpose**: Produce structured, hypothesis-driven variant sets from research findings so the growth team can run meaningful outreach experiments across channels.

**When to use this skill**:
- During or right after Content Agent runs.
- When user requests outreach or campaign variants.

**Core Instructions**:
- Use structured research findings as grounding.
- For every variant set (2–4 variants):
  - Define a clear, falsifiable hypothesis (e.g., "ROI-focused hook will outperform competitor-gap hook for Series B VP Sales because audience signals show budget pressure").
  - Specify success metrics (reply rate, meetings booked, sentiment).
  - Highlight the single variable being tested.
- Generate variants for multiple channels (email + LinkedIn) where relevant.
- Prepare data structure for later Feedback Agent (easy comparison).

**Output Format** (extend variants.schema.json):
- Variant ID
- Content (subject, hook, body, CTA)
- Hypothesis + rationale (tied to specific signals)
- Expected performance indicators
- Traceable research sources

**Best Practices**:
- Test meaningful angles only (ROI, competitive differentiation, insight-first research, no-headcount savings, etc.).
- Make variants ready for inline UI grid rendering.
- Support the full loop: hypotheses must be easy to validate with engagement data.

**Example**:
User asks for outreach to VP Sales → Output 3 variants with distinct hypotheses grounded in Lilian's strengths vs 2026 competitors (11x.ai, Artisan, Salesloft).