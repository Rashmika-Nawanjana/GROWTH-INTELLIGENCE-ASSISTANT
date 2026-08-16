# Growth Intelligence Assistant — Architecture Guide

> Read this before diving into code. It explains **what the product is**, **how requests flow**, **who each agent is**, **how tools and fallbacks work**, and **where to look** when you start changing things.

---

## Table of contents

1. [What this product is](#1-what-this-product-is)
2. [Hard product rules](#2-hard-product-rules)
3. [Tech stack](#3-tech-stack)
4. [Repository map](#4-repository-map)
5. [End-to-end request lifecycle](#5-end-to-end-request-lifecycle)
6. [Two-stage multi-agent architecture](#6-two-stage-multi-agent-architecture)
7. [Orchestrator deep dive](#7-orchestrator-deep-dive)
8. [Research agents (Stage 1)](#8-research-agents-stage-1)
9. [Execution Engine (Stage 2)](#9-execution-engine-stage-2)
10. [Optional MiroFish forecast agents](#10-optional-mirofish-forecast-agents)
11. [Tools & live signal layer](#11-tools--live-signal-layer)
12. [Fallback chains & confidence](#12-fallback-chains--confidence)
13. [Structured outputs & artifacts](#13-structured-outputs--artifacts)
14. [Streaming protocol (SSE)](#14-streaming-protocol-sse)
15. [Frontend & UI model](#15-frontend--ui-model)
16. [Memory, auth & persistence](#16-memory-auth--persistence)
17. [Feedback → refine closed loop](#17-feedback--refine-closed-loop)
18. [Data contracts (key TypeScript types)](#18-data-contracts-key-typescript-types)
19. [Environment variables](#19-environment-variables)
20. [Mental model for coding](#20-mental-model-for-coding)
21. [Suggested reading order](#21-suggested-reading-order)

---

## 1. What this product is

**Growth Intelligence Assistant** is a single-page conversational product that turns a growth / competitive question into **boardroom-quality intelligence**, rendered as **inline UI artifacts** (charts, matrices, scorecards)—not a plain chatbot dump.

It was built for the Veracity AI × Hatch hackathon. The reference demo product is **Vector Agents** (`vectoragents.ai`), but the system is designed to generalise to any product.

### What happens when a user asks a question

1. The user types a question (optionally attaches images, toggles MiroFish).
2. The backend **classifies** the query (product, competitor, domains, execution intent).
3. **Up to 6 research agents** fan out in parallel and call live tools (search, scrape, Reddit, HN, ads, patents).
4. Each agent synthesises tool results with **Gemini** into a typed JSON output (facts, interpretation, sources, confidence).
5. If the query is “do something” (write copy, outreach, A/B variants), a **Stage 2 Execution Engine** runs **3 sub-agents** grounded in Stage 1 findings.
6. A synthesizer merges findings into prose + recommendations; a mind-map is generated in parallel.
7. Results stream to the UI over **SSE**; artifacts render **inline** in the chat thread.
8. Conversation history + persistent user memory carry into the next turn.

**Not one model call.** A full research+execution run can involve ~9 agents plus classifier / synthesis / mind-map Gemini calls, all grounded in live-fetched signals.

---

## 2. Hard product rules

These are non-negotiable (from the brief / `CLAUDE.md`):

| Rule | Meaning in code |
|------|-----------------|
| Not a chatbot | Findings render as interfaces (`TrendChart`, `HeatMap`-style threat map, `ScoreCard`, etc.) inside the conversation |
| Not one model call | Orchestrator fans out ≥3 specialist agents; full path often 6 research + 3 execution |
| Live signal only | Insights come from SerpAPI / Firecrawl / Reddit / HN / ads scrapes—not training-data guesses. Every claim needs sources + confidence |
| Single page | `app/page.tsx` is the product—no separate dashboards/routes for intelligence |
| Conversational memory | History is sent on every `/api/chat` POST; product context persists across turns |
| Design system | Use Veracity tokens (`.veracity-card`, `.bg-gradient-signature`, `font-mono` labels)—see `CLAUDE.md` |

---

## 3. Tech stack

| Layer | Choice |
|-------|--------|
| App framework | **Next.js 15** (App Router), **React 19**, **TypeScript 5.9** |
| Styling | **Tailwind CSS 4** + Veracity design tokens in `app/globals.css` |
| LLM | **Google Gemini** via `@google/genai` (default `gemini-2.5-flash`; embeddings `gemini-embedding-001`) |
| Auth / DB | **Supabase** (auth, sessions, memory, feedback) |
| Charts / motion | **Recharts**, **Motion**, **Lucide** |
| Tests | **Vitest** (`__tests__/`) |
| Optional Python | **Flask MiroFish** swarm microservice (`mirofish-service/server.py`) — not the main product path |

> **Note:** Historical function names like `generateHuggingFaceText` in `lib/agents/gemini.ts` still say “HuggingFace” but call **Gemini**. The Hugging Face keys in `.env.example` are legacy / unused.

---

## 4. Repository map

```
app/
  page.tsx                 # Main chat UI (the product)
  layout.tsx               # Fonts + root shell
  globals.css              # Design tokens + utility classes
  auth/                    # Login + OAuth callback
  api/
    chat/route.ts          # Streaming orchestration (SSE) — primary entry
    refine/route.ts        # Re-run full loop with feedback injected
    feedback/route.ts      # Store recommendation / variant outcomes
    memory/route.ts        # Extract + update persistent user memory
    recall/route.ts        # Semantic recall helpers
    embed/route.ts         # Embedding endpoint

lib/
  agents/
    orchestrator.ts        # Classifier → fan-out → execution → synthesize
    types.ts               # Shared contracts (AgentOutput, domains, artifacts)
    gemini.ts              # Gemini client wrappers
    execution-intent.ts    # Regex safety net for “write/draft/…“ intents
    market-trends.ts       # Domain agent 1
    competitive.ts         # Domain agent 2
    win-loss.ts            # Domain agent 3
    pricing.ts             # Domain agent 4
    positioning.ts         # Domain agent 5
    adjacent.ts            # Domain agent 6
    mirofish.ts            # Opt-in synthetic swarm forecast
    mirofish-live.ts       # Opt-in live VPS swarm forecast
    execution/
      execution-engine.ts  # Stage-2 parent: merges 3 sub-agents
      content-agent.ts     # Campaign brief + angles
      ab-variant-agent.ts  # 3 A/B variants + hypotheses
      outreach-formatter.ts# Email / LinkedIn + deployment timeline
      grounding.ts         # Enforce research→execution grounding
  tools/
    serpapi.ts             # Web / news / trends / ads transparency
    firecrawl.ts           # URL → markdown
    reddit.ts              # Public .json search (no OAuth required)
    hn-algolia.ts          # HN search / sentiment
    meta-ads.ts            # Meta Ad Library via Firecrawl scrape
    linkedin-ads.ts        # LinkedIn ads scrape
    patents.ts             # USPTO-style patent signals
    query-planner.ts       # Multi-hop query variants (broad/targeted/hypothesis)
    fallback.ts            # Tool status + confidence penalty helpers
    source-validator.ts    # Filter / rank / trust sources
    retry-policy.ts        # Per-domain scrape retry behaviour
    scrape-quality.ts      # Quality gates on scraped markdown
    url-discovery.ts       # Discover / rank URLs to scrape
  memory.ts                # Client memory read + extract trigger
  conversations.ts         # Session / message persistence helpers
  feedback.ts              # Feedback client helpers
  embeddings.ts            # Embedding utilities
  supabase-*.ts            # Browser / server Supabase clients

components/artifacts/
  ArtifactRenderer.tsx     # Switch on artifactType → correct card
  TrendChart.tsx
  CompetitiveMatrix.tsx
  WinLossScorecard.tsx
  PricingTable.tsx
  PositioningGap.tsx
  ThreatHeatmap.tsx
  MindMap.tsx
  ExecutionPlan.tsx
  ForecastChart.tsx
  EmptyArtifact.tsx        # Safe empty state when an agent returned nothing useful

mirofish-service/          # Optional Python Flask swarm service
__tests__/                 # Intent, grounding, fallback, refine, memory tests
```

---

## 5. End-to-end request lifecycle

```
┌─────────────┐     POST /api/chat (JSON)      ┌──────────────────┐
│  app/page   │ ─────────────────────────────► │  chat/route.ts   │
│  (React)    │◄──── SSE: agent_update /       │  Auth gate first │
│             │      result / mirofish_*       └────────┬─────────┘
└─────────────┘                                         │
                                                        ▼
                                               ┌─────────────────┐
                                               │  orchestrate()  │
                                               └────────┬────────┘
                                                        │
          ┌─────────────────────────────────────────────┼──────────────────────────┐
          │                                             │                          │
          ▼                                             ▼                          ▼
   classifyQuery()                          Stage 1: Promise.allSettled     Stage 2 (if intent)
   (Gemini + regex)                         6 research agents               Execution Engine
                                            each: tools → Gemini JSON       3 sub-agents
          │                                             │                          │
          └─────────────────────┬───────────────────────┴──────────────────────────┘
                                ▼
                    synthesize() + generateMindMap()  (parallel)
                                │
                                ▼
                    OrchestratorOutput → SSE `result`
                                │
                    (optional) MiroFish / MiroFish Live → more SSE chunks
```

### Request body (`POST /api/chat`)

```ts
{
  query: string;
  history: ConversationMessage[];   // full session so far
  images?: ImageAttachment[];       // base64 + mimeType
  memoryContext?: string;           // persisted user memory blob
  includeMirofish?: boolean;
  includeMirofishLive?: boolean;
  followUpMode?: 'full' | 'targeted';
  selectedAgents?: string[];        // optional UI filter of domains
}
```

### Auth

- `middleware.ts` redirects unauthenticated users to `/auth`.
- `/api/chat` also checks Supabase user and returns **401** before opening the stream (orchestration costs real API money).

### Time budget

`export const maxDuration = 120` on chat/refine — parallel agents need headroom.

---

## 6. Two-stage multi-agent architecture

### Stage 1 — Research (always, parallel)

Six specialist agents run via `Promise.allSettled` so **one failure never kills the run**:

| ID | Agent | Question it answers | Primary artifact |
|----|-------|---------------------|------------------|
| `market-trends` | Market & Trend Sensing | Where is the category heading? | `trend-chart` |
| `competitive` | Competitive Landscape | Who’s doing what; feature bets | `competitive-matrix` |
| `win-loss` | Win / Loss Intelligence | Why deals won/lost (buyer view) | `win-loss-scorecard` |
| `pricing` | Pricing & Packaging | Is pricing right? WTP signals | `pricing-table` |
| `positioning` | Positioning & Messaging | How to talk about what exists | `positioning-gap` |
| `adjacent` | Adjacent Market Collision | External threats from outside | `threat-heatmap` |

### Stage 2 — Execution Engine (conditional)

Triggered when:

1. Classifier sets `runExecution: true`, **or**
2. Regex `detectExecutionIntent(query)` matches (safety net), **or**
3. Caller passes `forceExecution: true` (e.g. refine path),

**and** `execution-engine` is allowed in `selectedAgents` (default: allowed).

Parent: `lib/agents/execution/execution-engine.ts`  
Sub-agents:

1. **Content Agent** — campaign brief + messaging angles  
2. **A/B Variant Agent** — 3 variants, each with a **falsifiable hypothesis** tied to a Stage 1 signal  
3. **Outreach Formatter** — humanised email / LinkedIn + deployment timeline  

Content + A/B run in parallel; outreach runs after variants exist (needs variant input).  
All receive `researchOutputs` via `AgentContext` and must stay grounded (`enforceExecutionGrounding`).

**Demo talking point:** full execution query ≈ **9 agents** (6 research + 3 execution) + classifier/synthesis/mind-map.

### After Stage 1/2

- **Synthesizer** → `synthesizedAnswer`, `topRecommendations`, `suggestedFollowUps`
- **Mind map** → extra `mind-map` artifact appended to `outputs`
- Sources filtered/ranked per output
- Metrics (latency, estimated cost, call counts) attached

### Opt-in after result

- **Mirofish** / **Mirofish Live** run *after* the main `result` chunk so the UI is not blocked.

---

## 7. Orchestrator deep dive

File: `lib/agents/orchestrator.ts`

### Step-by-step inside `orchestrate()`

1. **Classify** (`classifyQuery`)
   - Uses last ~6 history messages + optional memory
   - Gemini returns JSON: `product`, `competitor`, URLs, `domains[]`, `intent`, `runExecution`
   - Regex execution check ORed in so obvious “Draft a cold email…” never misses Stage 2
   - Fallback on LLM failure: all 6 domains + regex execution flag

2. **Build `AgentContext`**
   - `query` is the classifier’s `intent` (cleaned), not always raw user text
   - Prior conversation snippet + injected refine context
   - Images + memory forwarded

3. **Select agents**
   - Default main queries: **full research sweep** (all allowed research agents)
   - Follow-ups with `followUpMode: 'targeted'`: only classifier-selected domains (min 3 domains enforced in classifier)

4. **Fan-out**
   - Each agent: `pending → running → completed | failed`
   - `onAgentUpdate` callback pushes live status to SSE

5. **Optional Execution Engine** with `researchOutputs: outputs`

6. **Parallel synthesize + mind map**

7. **Return `OrchestratorOutput`**

### Domain selection heuristics (classifier prompt)

- Compare / vs → competitive, win-loss, positioning  
- Market / trend / category → market-trends  
- Pricing / cost → pricing  
- Messaging / positioning → positioning  
- Disruption / adjacent → adjacent  
- Roadmap / build / strategy → market-trends, competitive, adjacent  
- Vague → all 6  
- Always ≥ 3 domains  

---

## 8. Research agents (Stage 1)

### Common agent pattern (every research agent)

```
1. Receive AgentContext
2. Plan queries (some agents use planQueries)
3. Promise.allSettled( tool calls )     ← multi-hop / multi-source
4. Collect raw snippets + AgentSource[]
5. Call Gemini with a strict JSON schema for this domain
6. Separate facts[] vs interpretation[]
7. Apply computeSignalQualityPenalty(toolResults)
8. Return typed AgentOutput + artifactType-specific fields
```

### Typical tools per domain

| Agent | Tools commonly used |
|-------|---------------------|
| Market trends | SerpAPI web/news/trends, HN sentiment, Reddit, query planner (broad/targeted/hypothesis + social pulse) |
| Competitive | SerpAPI web/news, Firecrawl product/pricing pages, HN |
| Win/loss | SerpAPI, Firecrawl, Reddit reviews, HN |
| Pricing | SerpAPI, Firecrawl pricing scrapes, Reddit |
| Positioning | SerpAPI, ads transparency, Firecrawl site copy, Reddit |
| Adjacent | SerpAPI web/news, HN, Reddit |

Each agent aims for **multiple tool calls** (brief: 2–4+), not a single search.

### Confidence

- Gemini may propose a score; agents multiply by **signal-quality penalty** from tool health (`ok` / `degraded` / `failed`).
- Exposed as both `confidenceScore` (0–1) and `confidence` (`high` | `medium` | `low`) via `scoreToLevel` (≥0.75 high, ≥0.5 medium).

---

## 9. Execution Engine (Stage 2)

```
researchOutputs (Stage 1)
        │
        ▼
execution-engine.ts
        │
        ├──► content-agent      ──► CampaignBrief
        ├──► ab-variant-agent   ──► CampaignVariant[] (hypotheses + groundedSignals)
        │         │
        └─────────┴──► outreach-formatter ──► email/LinkedIn + DeploymentStep[]
        │
        ▼
enforceExecutionGrounding()
        │
        ▼
ExecutionPlanOutput  (artifactType: 'execution-plan')
```

### Grounding contract

Variants must point back to Stage 1 signals (`groundedSignals[]`). Hypotheses should be **falsifiable** (e.g. “reply rate > 4% if we lead with ROI”). Tests in `__tests__/grounding-contract.test.ts` protect this.

---

## 10. Optional MiroFish forecast agents

| Mode | Purpose | Where |
|------|---------|--------|
| MiroFish (synthetic) | Swarm of simulated personas → probability / distribution forecast | `mirofish.ts` + tool `tools/mirofish.ts` (+ optional Flask `mirofish-service`) |
| MiroFish Live | Same idea against a live VPS simulation | `mirofish-live.ts` |

- Toggled from the UI (`includeMirofish` / `includeMirofishLive`).
- Run **after** main result so latency of the core answer stays low.
- Artifact: `forecast-chart` → `ForecastChart.tsx`.

---

## 11. Tools & live signal layer

All tools live under `lib/tools/` and ideally return a uniform `ToolResult<T>`:

```ts
{
  data: T;
  source: string;
  sourceUrl?: string;
  timestamp: string;
  confidence: number;   // 0–1
  status?: 'ok' | 'degraded' | 'failed';
  cached: boolean;
}
```

### Tool catalogue

| Tool file | Signal | Notes |
|-----------|--------|-------|
| `serpapi.ts` | Web, news, Google Trends, ads transparency | Needs `SERPAPI_KEY` |
| `firecrawl.ts` | Page → LLM-ready markdown | Needs `FIRECRAWL_API_KEY`; has fallbacks |
| `reddit.ts` | User voice / complaints | Public `reddit.com/search.json` — **no OAuth required** |
| `hn-algolia.ts` | Founder / developer sentiment | No key |
| `meta-ads.ts` | Competitor ad creatives | Firecrawl scrape of Meta Ad Library (no Meta token needed for general ads) |
| `linkedin-ads.ts` | LinkedIn ad messaging | Scrape-based |
| `patents.ts` | Pre-launch technical signal | USPTO-oriented |
| `query-planner.ts` | Multi-hop query bundles | broad / targeted / hypothesis |
| `mirofish*.ts` | Swarm forecast APIs | Optional |

### Supporting utilities

- **`source-validator.ts`** — drop junk URLs, prefer trusted sources, cap count  
- **`retry-policy.ts`** — domain-aware scrape retries (incl. Crunchbase-style hard pages)  
- **`scrape-quality.ts`** — reject empty / boilerplate scrapes  
- **`url-discovery.ts`** — find and rank pages worth scraping  
- **`entity-url.ts`** (agents) — skip placeholder competitors / unusable scrapes  

### Crunchbase note

There is **no dedicated Crunchbase API integration**. Funding / company data is approached via SerpAPI `site:crunchbase.com` queries + scrape retry policy after free Crunchbase access was deprecated—exactly the kind of adaptation the tool layer is designed for.

---

## 12. Fallback chains & confidence

Design goal: **never fail silently; degrade gracefully**.

| Primary | Fallback |
|---------|----------|
| Reddit public JSON | HN Algolia (auto when empty/blocked) |
| Meta Ad Library API | Firecrawl browser scrape of Ad Library URL |
| Firecrawl | Scrape.do (`SCRAPE_DO_TOKEN`) → raw `fetch` |
| Any single agent crash | Other agents continue (`Promise.allSettled`) |

`lib/tools/fallback.ts`:

- `buildToolResult({ status })` sets canonical confidence anchors: ok ≈ 0.85, degraded ≈ 0.55, failed ≈ 0.15  
- `computeSignalQualityPenalty()` returns a multiplier in **[0.5, 1.0]** applied to the agent’s Gemini score  

So an agent whose tools mostly failed cannot honestly claim “high confidence.”

---

## 13. Structured outputs & artifacts

### Base contract (`AgentOutput`)

Every agent must return:

- `agentId`, `domain`
- `confidence` + `confidenceScore`
- `facts[]` — verifiable, source-backed claims  
- `interpretation[]` — analyst synthesis (kept separate from facts)  
- `sources[]` — `{ url, title, timestamp, tool }`  
- `generatedAt`
- `artifactType` — drives UI component choice  

### Artifact → component map

| `artifactType` | Component |
|----------------|-----------|
| `trend-chart` | `TrendChart` |
| `competitive-matrix` | `CompetitiveMatrix` |
| `win-loss-scorecard` | `WinLossScorecard` |
| `pricing-table` | `PricingTable` |
| `positioning-gap` | `PositioningGap` |
| `threat-heatmap` | `ThreatHeatmap` |
| `mind-map` | `MindMap` |
| `execution-plan` | `ExecutionPlan` |
| `forecast-chart` | `ForecastChart` |

`ArtifactRenderer.tsx` switches on `artifactType` and falls back to `EmptyArtifact` when arrays are empty—so the UI never crashes on partial failures.

### Orchestrator-level response

`OrchestratorOutput` adds:

- `synthesizedAnswer` (chat prose)
- `topRecommendations[]` (title, rationale, evidence, confidence, priority)
- `suggestedFollowUps[]`
- `agentRuns[]` (lifecycle for status UI)
- `outputs[]` (all agent artifacts including mind map / execution)
- `metrics?` (latency, cost estimate, counts)
- `refinement?` (when produced by `/api/refine`)

---

## 14. Streaming protocol (SSE)

Implemented in `app/api/chat/route.ts` as `text/event-stream` style chunks:

```
data: { "type": "orchestration_log", "line": "…" }\n\n
data: { "type": "agent_update", "run": {…}, "metrics": {…} }\n\n
data: { "type": "result", "output": {…OrchestratorOutput} }\n\n
data: { "type": "mirofish_result", "output": {…} }\n\n
data: { "type": "mirofish_live_result", "output": {…} }\n\n
data: { "type": "error", "message": "…" }\n\n
```

**Live metrics** (while running): elapsed ms, agent counts, rough cost, estimated Gemini/tool calls.  
**Authoritative metrics** land on the final `result.output.metrics`.

Frontend listens to the stream, updates `AgentStatus`-style UI as agents complete, then paints artifacts from `result`.

---

## 15. Frontend & UI model

- **Single composition:** conversation is the product (`app/page.tsx`).
- Messages hold optional `agentOutput: OrchestratorOutput`.
- While running, show parallel agent pills (`pending` / `running` / `completed` / `failed`).
- After result: prose answer + recommendation cards + **inline artifacts** via `ArtifactRenderer`.
- Suggestion chips for `suggestedFollowUps`.
- Optional image attachments passed through to Gemini multimodal parts.
- Session sidebar persists conversations (Supabase).

Design tokens / patterns: see `CLAUDE.md` and `.claude/skills/theme` — prefer `.veracity-card`, gradient CTAs, `font-mono` for labels.

---

## 16. Memory, auth & persistence

### Auth

Supabase Auth + Next middleware. Chat and expensive APIs require a signed-in user.

### Conversational memory (in-session)

- React state holds full `history`.
- Every chat POST includes that history.
- Orchestrator injects recent turns into classifier + agent `priorContext` + synthesizer.
- Rule: **don’t reset context**; don’t ask again for product name if already established.

### Persistent memory (across sessions)

- Table / shape: `user_memory` (role, company, products, competitors, interests, facts, summary).
- After answers, client calls `extractAndUpdateMemory` → `POST /api/memory` (Gemini extraction server-side).
- `buildMemoryContext()` turns memory into a string injected as `memoryContext`.

### Embeddings / recall

- `lib/embeddings.ts`, `/api/embed`, `/api/recall` support semantic recall of prior knowledge when needed.

---

## 17. Feedback → refine closed loop

This is the **Research → Action → Learn** proof:

```
User rates recommendations / records variant results
        │
        ▼
POST /api/feedback  → stored against session + message
        │
        ▼
User clicks "Refine with feedback"
        │
        ▼
POST /api/refine
  - load prior OrchestratorOutput + outcomes
  - buildFeedbackSummary()
  - orchestrate() again with injectedContext + forceExecution
  - buildRefinementDeltas() (what changed per domain)
        │
        ▼
Updated OrchestratorOutput (+ refinement metadata) rendered in-thread
```

Important: refine re-runs **full orchestration** (research + execution), not only copy generation—so strategy can change when outcomes contradict prior bets.

---

## 18. Data contracts (key TypeScript types)

Canonical file: `lib/agents/types.ts`

| Type | Role |
|------|------|
| `AgentContext` | Input to every agent (`query`, `product`, `competitor`, URLs, `priorContext`, `images`, `memoryContext`, `researchOutputs?`) |
| `AgentConfig` | `{ id, name, description, run }` registered with orchestrator |
| `AgentRun` | Lifecycle row for UI |
| `AgentOutput` | Base structured result |
| `MarketTrendsOutput` … `AdjacentOutput` | Domain-specific extensions |
| `ExecutionPlanOutput` | Brief + variants + deployment |
| `ForecastOutput` | MiroFish forecast chart payload |
| `OrchestratorOutput` | Final envelope streamed to UI |
| `ConversationMessage` | Chat turn (+ optional nested orchestrator output) |

When you add a new agent:

1. Add domain + artifact type to `types.ts`
2. Implement `run(ctx)` returning the new output shape
3. Register in `ALL_AGENTS` (or Stage 2 / MiroFish path)
4. Add a React artifact component + `ArtifactRenderer` case
5. Extend classifier domain list if it’s a Stage 1 research domain

---

## 19. Environment variables

See `.env.example`:

| Variable | Required for |
|----------|----------------|
| `GEMINI_API_KEY` | All LLM calls |
| `GEMINI_MODEL` | Default `gemini-2.5-flash` |
| `SERPAPI_KEY` | Web / news / trends |
| `FIRECRAWL_API_KEY` | High-quality scrapes |
| `SCRAPE_DO_TOKEN` | Free-tier scrape fallback |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Auth + DB |
| `SUPABASE_DB_URL` | Server DB when needed |
| `MIROFISH_*` | Optional forecast services |

Reddit / Meta general ads work **without** their OAuth tokens (public JSON / Firecrawl scrape).

---

## 20. Mental model for coding

Think in **layers**, not files:

```
UI (page + artifacts)
   ↕ SSE JSON
API routes (auth, stream, refine, memory)
   ↕
Orchestrator (classify → parallel agents → optional execution → synthesize)
   ↕
Domain agents (tools → Gemini JSON → typed AgentOutput)
   ↕
Tools (live HTTP APIs + fallbacks → ToolResult)
   ↕
External world (Google, Reddit, HN, product sites, ad libraries)
```

### Where bugs usually live

| Symptom | Look here |
|---------|-----------|
| Wrong domains run | Classifier prompt / `normalizeDomains` / `followUpMode` |
| Execution didn’t run | `execution-intent.ts` + classifier `runExecution` + `selectedAgents` |
| Empty / wrong artifact | Agent Gemini schema + `ArtifactRenderer` empty guards |
| Hallucinated claims | Tools returning empty → weak grounding; check sources + penalty |
| One agent dies, UI blank | Shouldn’t happen—verify `Promise.allSettled` path still synthesizes |
| Cost/latency high | Tool fan-out size; MiroFish toggles; `maxDuration` |
| Follow-up forgets product | History not sent, or memory not injected |

### Parallelism rules

- Stage 1 agents: **always parallel**  
- Stage 2 content + A/B: **parallel**; outreach **after** variants  
- Synthesize + mind map: **parallel**  
- Only sequence when there is a true data dependency  

---

## 21. Suggested reading order

Before writing code, read in this order:

1. **This file** — mental model  
2. `lib/agents/types.ts` — contracts  
3. `lib/agents/orchestrator.ts` — control plane  
4. `app/api/chat/route.ts` — streaming boundary  
5. One research agent end-to-end, e.g. `market-trends.ts` + `serpapi.ts` / `reddit.ts`  
6. `execution/execution-engine.ts` + `grounding.ts`  
7. `components/artifacts/ArtifactRenderer.tsx` + one artifact component  
8. `lib/tools/fallback.ts` + `source-validator.ts`  
9. `app/api/refine/route.ts` + `__tests__/refine-loop.test.ts`  
10. `CLAUDE.md` — design system + hackathon constraints  

### Quick “hello pipeline” experiment

1. Start app (`npm run dev`), sign in.  
2. Ask a research question about Vector Agents vs a competitor.  
3. Watch SSE agent pills complete in parallel.  
4. Confirm each domain card has sources + confidence.  
5. Ask “Draft a cold email sequence based on this” → Stage 2 execution plan appears.  
6. Leave feedback and refine → deltas should reflect the loop.  

---

## Appendix A — Agent count cheat sheet

| Mode | Agents |
|------|--------|
| Research only | 6 Stage 1 |
| Research + execution | 6 + 3 = **9** |
| + MiroFish | +1 (after result) |
| + MiroFish Live | +1 (after result) |
| Plus always | Classifier, synthesizer, mind-map model calls |

## Appendix B — Demo queries (reference product)

1. *Is Lilian competitive in the AI SDR market right now? Where does Vector stand?*  
2. *Is the digital workers category accelerating or consolidating — and what does that mean for Vector’s roadmap?*  
3. *What should Vector Agents build or reposition over the next six months to capture emerging demand?*  

Then generalise to a second product to prove the system is not hard-coded to Vector.

---

*Generated as an onboarding / pre-coding architecture reference for this repository. For UI patterns and design tokens, prefer `CLAUDE.md`. For product narrative and setup, see `README.md`.*
