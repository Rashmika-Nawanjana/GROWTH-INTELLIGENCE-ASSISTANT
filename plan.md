1. Core Winning Thesis (What Makes Us Stand Out)
Judges will see 10+ research bots or chat wrappers. We win by:

Seamless intent detection & mode switching (no “switch to research mode” — conversation flows naturally, like the example in the brief).
Ephemeral UIs inside the thread — variant comparison grids, clickable channel selectors, performance maps, one-pagers rendered inline (inspired by Claude Artifacts + generative UI patterns).
True closed loop with learning — feedback updates the intelligence layer; next cycle is measurably sharper.
Live signals only — real web research on competitors (11x, Salesloft, Relevance AI, etc.), audience forums, LinkedIn trends.
Polish & demo magic — beautiful, responsive web demo that feels like the future of growth tools. Full video walkthrough + generalization toggle (Lilian ↔ Bradley ↔ any product).
Technical excellence — multi-agent orchestration via LangGraph + Claude API (exactly what Anthropic recommends in their 2024–2025 guides).

This directly hits every hard constraint: multi-agent, dynamic UIs, tools/live data, full loop, not a single prompt.
2. Recommended Tech Stack (Claude-Native & Hackathon-Proven)

LayerChoiceWhy it winsLLMClaude (latest Sonnet/Opus via API)Best reasoning + tool use; native structured outputsOrchestrationLangGraph (stateful graph)Explicit control over loop stages, memory, conditional routing, intent detectionAgents5 specialized agents (supervisor + sub-agents)Matches Anthropic multi-agent best practicesToolsCustom tools + web_search/browse_page (MCP-style)Live signals onlyFrontendNext.js 15 + shadcn/ui + TailwindBeautiful chat thread that renders dynamic JSON → UI components (grids, buttons, charts, cards) inlineUI PatternGenerative/ephemeral UI (JSON schema → React components) + Claude Artifacts inspirationPerfectly matches “ephemeral interfaces” requirementState & MemoryLangGraph persistent state + vector store (for campaign history)Accumulates learning across cyclesDeploymentVercel (free tier) + live demo linkJudges can play with it instantly
Alternative ultra-minimal path (if we want to ship faster): Build the entire experience as a Claude Artifact (interactive React app inside claude.ai conversation). This is extremely high-wow and perfectly matches the “inside the conversation” spec. We can fall back to this if time is tight.
3. Agent Architecture (Multi-Agent, Not One Big Prompt)

Orchestrator / Supervisor Agent (Claude + LangGraph node): Detects intent, manages loop state, routes, ensures structured outputs, handles mode switches.
Research Agent: Live multi-hop research (competitors, audience language, channel trends, PESTEL). Outputs typed JSON findings + confidence scores + sources.
Content Agent: Turns findings into outreach sequences, LinkedIn posts, A/B variants (with explicit hypotheses), social content, briefs, visual mocks.
Outreach / Deployment Simulator: Renders ephemeral UIs (side-by-side variant grids, channel choosers). “Deploys” via mock (shows what would happen).
Feedback / Learning Agent: Ingests engagement data (mock or real), interprets against hypotheses, updates shared intelligence layer.

All agents use structured outputs (Pydantic schemas) so content is always traceable to signals.