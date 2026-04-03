# Intent Detection & Mode Switching Skill

**Purpose**: Automatically detect the user's current stage in the growth loop and route to the correct agent/skill without the user having to declare modes. This enables seamless, natural conversation flow (research → content generation → A/B variants → outreach → feedback → refinement).

**When to use this skill**:
- At the start of every user message or after a major output.
- When the conversation shifts naturally (e.g., from "What's the positioning gap?" to "Now write outreach variants").

**Core Instructions**:
- Analyze the user's utterance against the full growth loop stages:
  1. Research / Market Intelligence (signals, competitors, audience, channels)
  2. Content Generation (outreach, social, briefs from signals)
  3. A/B Variants & Hypotheses (testing angles)
  4. Outreach / Deployment Simulation (channel selection, "deploy")
  5. Feedback & Learning (engagement results, what resonated)
  6. Refinement / Next Cycle (sharper intelligence)
- Detect intent with high confidence. Provide a short reasoning trace (internal only).
- Suggest or auto-trigger the appropriate agent (Research Agent, Content Agent, Feedback Agent, etc.).
- Maintain full campaign context — never lose previous findings or memory.

**Output Format**:
- Internal reasoning (not shown to user)
- Detected intent + confidence (0–100)
- Recommended next action or agent
- If switch is clear, seamlessly hand off while preserving context

**Best Practices**:
- Use examples from the hackathon problem statement (e.g., “What’s the positioning gap?” = research; “The ROI angle got 3× replies” = feedback).
- Be proactive but not disruptive — ask for clarification only when confidence < 70.
- Always tie back to Lilian’s positioning as an insight-first, full-cycle AI SDR.

**Example Triggers**:
- “What’s changed in competitor messaging this week?” → Research mode
- “Write three outreach variants for VP Sales” → Content + A/B mode
- “The ROI angle performed better” → Feedback + Learning mode