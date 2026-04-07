---
name: campaign-memory-updater
description: Accumulates intelligence across campaign cycles by ingesting feedback, comparing against hypotheses, and updating shared memory files. Use after feedback is collected or when the user wants to close the learning loop, refine winning angles, or update campaign context for the next cycle.
---

# Campaign Memory Updater & Loop Learning Skill

**Purpose**: Accumulate intelligence across cycles and make learning visible so each new cycle is measurably sharper.

**When to use this skill**:
- After Feedback Agent runs.
- When updating shared campaign context.

**Core Instructions**:
- Ingest feedback (quantitative + qualitative).
- Compare against original hypotheses.
- Update shared memory (campaign-context.md, positioning.md):
  - Boost winning angles (e.g., "ROI now weighted 3× higher")
  - Demote weak signals
  - Refine audience segments or channel mix
- Produce a short "Learning Delta" summary for the user ("Next cycle will lead stronger with ROI because it delivered 3× replies").

**Best Practices**:
- Make improvement obvious in the UI (e.g., highlight refined variants).
- Preserve full history so the system demonstrates the closed growth loop.
- Tie every update back to real-world signals.

**Example Output**:
"Based on feedback, the ROI angle outperformed by 3×. Updated intelligence layer now prioritizes quantifiable impact in all future variants."