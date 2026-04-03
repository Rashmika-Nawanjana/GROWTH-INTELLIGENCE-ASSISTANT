---
name: ui-renderer
description: Converts structured agent outputs into interactive ephemeral UIs that render inline in the conversation thread. Use whenever research, content, or feedback agents produce structured JSON ready for display — including variant grids, channel selectors, performance maps, campaign brief cards, and prospect segment choosers.
---

# Ephemeral / Generative UI Renderer Skill

**Purpose**: Convert structured agent outputs (JSON from schemas) into beautiful, interactive, purpose-built UIs that materialize **inside the conversation thread** — exactly as required by the hackathon (no pasted text, no external links).

**When to use this skill**:
- Whenever Research, Content, or Feedback agents produce structured data ready for display.
- For variant comparisons, channel selectors, performance maps, one-pagers, etc.

**Core Instructions**:
- Take clean JSON (from research.schema.json, variants.schema.json, feedback.schema.json).
- Generate React + shadcn/ui + Tailwind code or descriptive UI specs that your Vercel frontend can render inline.
- Supported ephemeral UIs:
  - Side-by-side variant comparison grids (subject, hook, body snippet, CTA, hypothesis, "Select & Deploy" buttons)
  - Clickable channel selectors (LinkedIn / Email / Both)
  - Performance maps / mini-charts (reply rates, open rates, winner highlights)
  - Clean one-pager / campaign brief cards
  - Prospect segment choosers
- Make UIs responsive, accessible, and visually polished. Add clear labels and traceable signals where relevant.

**Output Format**:
- UI component name + description
- JSON payload ready for frontend renderer
- Optional: Ready-to-render React snippet (if your app supports it)

**Best Practices**:
- Keep UIs ephemeral and task-specific — they appear when needed and support direct interaction (click → "deploy" or "refine").
- Ensure every UI element traces back to live signals (e.g., "This angle grounded in 2026 competitor gap X").
- Prioritize clarity and speed — judges must feel the "magic" of everything happening in one thread.

**Integration Note**:
Works with your existing Vercel app (growth-intelligence-assistant-ai). The frontend should parse special UI JSON and render shadcn components inline in the chat.