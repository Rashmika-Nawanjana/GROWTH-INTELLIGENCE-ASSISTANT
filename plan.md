Now I have the full picture. Here's the plan:

4-Hour Hackathon Battle Plan (4 Members)
Current State
Beautiful chat UI with mock data (Next.js 15 + Tailwind)
@google/genai installed but not wired up
No API routes, no backend, no real data fetching
All responses are hardcoded in INITIAL_CONVERSATION
Team Assignment
Member	Role	Focus
M1	Backend Lead	API route + Gemini orchestrator + agent coordination
M2	Data Engineer	Tool functions (SerpAPI, Firecrawl, Reddit, web scraping)
M3	Frontend Lead	Streaming UI, new artifact types (charts, heatmaps), agent status panel
M4	Agent Architect	6 domain agent prompts, structured output schemas, system prompts
Hour-by-Hour Breakdown
Hour 1 (Setup + Foundation) - All parallel
M1 - API Route + Orchestrator

Create app/api/chat/route.ts — streaming POST endpoint
Wire up @google/genai with Gemini 2.0 Flash
Build orchestrator function that takes user query → classifies domain → dispatches to agents
Define agent coordination pattern (parallel fan-out, sequential synthesis)
M2 - Tool Functions

Create lib/tools/ folder with individual tool modules:
lib/tools/serpapi.ts — Google search, trends, news
lib/tools/firecrawl.ts — page scraping to markdown
lib/tools/reddit.ts — subreddit search via API
lib/tools/hn-algolia.ts — HN search
Each tool returns standardized { data, source, timestamp } format
Set up .env.local with API keys
M3 - Frontend Enhancements

Add streaming response handling (SSE/ReadableStream from API)
Build new artifact components:
TrendChart — simple bar/line chart (use inline SVG or a lightweight chart lib)
HeatMap — competitive heat map grid
ScoreCard — confidence-scored insight card
Add real-time agent status tracker (show which agents are running/completed)
M4 - Agent Prompts + Schemas

Create lib/agents/ folder with 6 agent definitions:
market-trends.ts — Market & Trend Sensing
competitive.ts — Competitive Landscape & Feature Bets
win-loss.ts — Win/Loss Intelligence
pricing.ts — Pricing & Packaging
positioning.ts — Positioning & Messaging Gaps
adjacent.ts — Adjacent Market Collision
Define TypeScript types for structured outputs (confidence, sources, facts vs interpretation)
Write system prompts that enforce grounded, sourced responses
Hour 2 (Integration) - Pairs merge
M1 + M2 merge: Wire tools into the orchestrator

Orchestrator calls Gemini with function-calling/tool-use
Gemini decides which tools to invoke based on query
Tools run in parallel, results fed back for synthesis
Final response includes structured JSON with artifacts
M3 + M4 merge: Wire agent schemas into UI rendering

Map structured output types to artifact components
Agent status panel shows real agent names from M4's definitions
Test rendering with sample structured JSON
Hour 3 (End-to-End + Polish)
All together: Full integration

Connect frontend → API → agents → tools → response → render
Test with the 3 demo queries from the brief:
"Is Lilian competitive in the AI SDR market?"
"Is the digital workers category accelerating or consolidating?"
"What should Vector Agents build next?"
Fix streaming, error handling, loading states
Add conversational memory (store context in session/state)
Hour 4 (Demo Prep)
M1: Add cost estimation display, ensure graceful degradation if APIs fail
M2: Cache responses for demo reliability, add fallback mock data
M3: Final UI polish, animations, mobile responsiveness check
M4: Prepare demo script, test generalization with a second product (not Vector)

Key Files to Create

app/
  api/
    chat/
      route.ts          ← M1 (streaming API endpoint)
lib/
  agents/
    orchestrator.ts     ← M1 (coordinator)
    market-trends.ts    ← M4
    competitive.ts      ← M4
    win-loss.ts         ← M4
    pricing.ts          ← M4
    positioning.ts      ← M4
    adjacent.ts         ← M4
    types.ts            ← M4 (shared types)
  tools/
    serpapi.ts           ← M2
    firecrawl.ts         ← M2
    reddit.ts            ← M2
    hn-algolia.ts        ← M2
    types.ts             ← M2 (tool response types)
components/
  artifacts/
    TrendChart.tsx       ← M3
    HeatMap.tsx          ← M3
    ScoreCard.tsx        ← M3
    AgentStatus.tsx      ← M3
Critical Integration Points
M2 exports tool functions → M1 imports them into orchestrator
M4 exports agent configs + types → M1 uses them to dispatch, M3 uses types to render
M1's API returns streaming JSON → M3 parses and renders artifacts
Demo Script (10 min)
(1 min) Problem framing — growth intelligence gap
(2 min) Live query: "Vector vs Lilian in AI SDR" — show agents working in parallel
(2 min) Walk through artifacts: matrix, trends, recommendations with sources
(1 min) Follow-up query showing conversational memory
(2 min) Generalization: run same system on a different product
(2 min) Architecture walkthrough — show multi-agent coordination, not a wrapper
Want me to start building the foundation files now? I'd suggest starting with the shared types and the API route since those unblock everyone else.