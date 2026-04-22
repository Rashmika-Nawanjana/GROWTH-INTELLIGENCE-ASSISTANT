# Growth Intelligence Assistant

> A multi-agent AI platform that delivers real-time, confidence-scored competitive intelligence across 6 specialist domains — then converts findings into shipped campaigns with a closed feedback loop.

![Tech Stack](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![AI](https://img.shields.io/badge/Gemini_2.0_Flash-AI-blue?logo=google)
![Database](https://img.shields.io/badge/Supabase-Database-green?logo=supabase)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)
![Tests](https://img.shields.io/badge/Tests-91_passing-brightgreen?logo=vitest)
![License](https://img.shields.io/badge/License-MIT-yellow)
 
---
   


  
## Overview

Growth Intelligence Assistant is a full-stack web application designed to give product teams, founders, and growth strategists instant access to structured market intelligence. Instead of manually trawling through competitor sites, Reddit threads, news articles, and pricing pages — you simply ask a question, and up to 9 specialist AI agents fan out to gather, analyse, synthesise, and **execute** in real time.

The system is built around a **two-stage multi-agent architecture** powered by **Google Gemini 2.0 Flash**:

- **Stage 1 (Research):** 6 specialist agents run in parallel, each covering a distinct intelligence domain.
- **Stage 2 (Execution):** When the query asks for copy, outreach, or campaign assets, 3 execution sub-agents convert research findings into A/B variants, email/LinkedIn sequences, and deployment timelines.
- **Feedback Loop:** Users rate recommendations, record variant performance, and click "Refine with feedback" to re-run the execution engine grounded in real outcomes.

### Key Highlights

- **9 coordinated agents** — 6 research + 3 execution sub-agents, all grounded in live-fetched signals
- **Real-time streaming** — watch agents complete live via Server-Sent Events
- **Research to Action loop** — research, execute, feedback, refine — measurable learning across cycles
- **Multimodal input** — attach images (screenshots, charts, pricing tables) that are passed to every agent's Gemini call via `buildContentParts()`
- **Persistent memory** — the system remembers your company context across sessions
- **Structured output** — confidence scores, source attribution, and strategic recommendations
- **Cost & latency tracking** — every query shows wall-clock time, estimated cost, and API call count
- **Threaded follow-ups** — ask follow-up questions with full conversation context preserved
- **Session history** — all queries and follow-ups saved and recoverable from the sidebar
- **91 automated tests** — execution intent detection, empty artifact safety, memory contract, tool fallback penalties

---

## 4-Member Team Split (Execution Plan)

Use this ownership model to maximize judging score in the final sprint.

### Member 1 — Orchestration + Closed Loop (Backend Lead)

**Primary goal:** Guarantee true end-to-end loop behavior (research -> execution -> feedback -> refined research).

- Owns: `app/api/refine/route.ts`, `lib/agents/orchestrator.ts`, `lib/agents/types.ts`
- Delivers:
  - Refine flow re-runs full orchestration, not only execution generation
  - Feedback context is injected into research stage before synthesis
  - Updated outputs show what changed after feedback
- Demo proof:
  - "ROI angle got 3x replies" leads to a visibly updated next-cycle strategy

### Member 2 — Agent Quality + Grounding (AI/Prompt Lead)

**Primary goal:** Make every generated variant traceable to live research signals.

- Owns: `lib/agents/execution/content-agent.ts`, `lib/agents/execution/ab-variant-agent.ts`, `lib/agents/execution/execution-engine.ts`
- Delivers:
  - Every execution variant includes explicit grounded signals from Stage 1
  - A/B hypotheses are falsifiable and tied to specific findings
  - Confidence and source quality are preserved through execution outputs
- Demo proof:
  - Judges can map each copy angle back to concrete research evidence

### Member 3 — Ephemeral UI + Demo Experience (Frontend Lead)

**Primary goal:** Make process visibility and in-thread interfaces unmistakable.

- Owns: `app/page.tsx`, `components/artifacts/ExecutionPlan.tsx`, `components/artifacts/ArtifactRenderer.tsx`
- Delivers:
  - Inline clarification UI (channel selector: Email / LinkedIn / Both)
  - Strong live agent status visuals (pending/running/completed/failed)
  - Clear recommended variant highlighting in execution artifacts
- Demo proof:
  - User clicks in-thread controls instead of typing, and output adapts immediately

### Member 4 — Signals, Metrics, and Stability (Tools + QA Lead)

**Primary goal:** Prove live-signal reliability, cost efficiency, and demo safety.

- Owns: `lib/tools/*`, `app/api/chat/route.ts`, `__tests__/*`
- Delivers:
  - Tool fallback quality remains robust under partial failures
  - Visible cost/latency/API-call indicators for each run
  - Test coverage for refine loop, grounding contract, and UI-triggered execution paths
- Demo proof:
  - Real-time run shows low cost, stable fallback behavior, and no empty/unsafe artifacts

### 72-Hour Hand-off Checklist

- Day 1:
  - Member 1 ships full-loop refine behavior
  - Member 2 enforces grounded variant contract
- Day 2:
  - Member 3 ships clarification UI + status upgrades
  - Member 4 adds cost visibility + fallback validation tests
- Day 3:
  - Full-team integration + scripted demo rehearsal (Vector Agents + one non-Vector product)

---  

## The Two-Stage Architecture

### Stage 1: Research (always runs, parallel)   

| Agent | Domain | Focus |
|---|---|---|
| **Market Trends** | `market-trends` | Industry signals, category growth, emerging technologies |
| **Competitive** | `competitive` | Competitor positioning, feature comparisons, SWOT data |
| **Win/Loss** | `win-loss` | Customer sentiment, switching triggers, Reddit/review signals |
| **Pricing** | `pricing` | Competitor pricing tiers, packaging strategies, value anchors |
| **Positioning** | `positioning` | Messaging analysis, brand differentiation, GTM strategy |
| **Adjacent** | `adjacent` | Disruption threats, adjacent markets, technology substitution |

### Stage 2: Execution Engine (triggered by execution intent)

When the query contains generation verbs + marketing artifacts (e.g. "write a cold email", "generate A/B variants", "campaign brief"), the orchestrator dispatches 3 execution sub-agents **after** Stage 1 completes:

| Sub-Agent | Responsibility |
|---|---|
| **Content Agent** | Campaign brief, copy angles, pain point mapping |
| **A/B Variant Agent** | 3 variants, each with a falsifiable hypothesis tied to a research signal |
| **Outreach Formatter** | Humanised email/LinkedIn sequences + deployment timeline |

### Orchestrator Flow

1. **Classify** query (LLM + deterministic regex, OR'd together)
2. **Fan out** 6 research agents in parallel via `Promise.allSettled`
3. If execution intent detected, **fan out** 3 execution sub-agents with research outputs as grounding
4. **Synthesise** all findings into prose + recommendations
5. **Generate** a strategic mind map
6. **Stream** structured JSON chunks to the frontend
7. **Report** cost/latency metrics

---

## Feedback Loop

The system closes the loop between research and real-world outcomes:

```
Research (6 agents) → Execute (3 sub-agents) → Feedback (user rates + records) → Refine (re-run with outcomes)
```

- **Rate recommendations** — thumbs up/down on each strategic recommendation
- **Record variant results** — paste actual campaign numbers (sent, open rate, reply rate, meetings booked, hypothesis confirmed)
- **Refine with feedback** — one-click re-run of the Execution Engine grounded in your recorded outcomes
- **Outcome tables** — `recommendation_feedback`, `recommendation_actions`, `variant_results` persist across sessions

The refiner applies explicit rules: keep confirmed hypotheses, invert rejected ones, never reuse identical subject lines.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js 15 (App Router) + React 19 | Full-stack web application |
| **Language** | TypeScript 5.9 | Type-safe development |
| **Styling** | Tailwind CSS v4 + Vanilla CSS | Responsive, dark/light themed UI |
| **AI** | Google Gemini 2.0 Flash (`@google/genai`) | All LLM calls, multimodal vision |
| **Database** | Supabase (PostgreSQL + pgvector) | Auth, sessions, memory, embeddings, feedback |
| **Search** | SerpAPI | Web + news + trends search |
| **Web Scraping** | Firecrawl | Competitor website scraping |
| **Community** | Reddit public JSON API + HN Algolia | Win/loss sentiment signals |
| **Testing** | Vitest | Unit + integration tests |
| **Icons** | Lucide React | UI icons |
| **Charts** | Recharts | Data visualisation |
| **Animation** | Motion (Framer) | Micro-animations |

---

## Project Architecture

```
GROWTH-INTELLIGENCE-ASSISTANT/
├── app/
│   ├── page.tsx                 # Main chat interface & state management
│   ├── layout.tsx               # Root layout + font loading
│   ├── globals.css              # Design tokens + utility classes
│   ├── api/
│   │   ├── chat/route.ts        # Streaming POST → orchestrator (SSE)
│   │   ├── feedback/route.ts    # Feedback loop: rate, act, record results
│   │   ├── refine/route.ts      # Re-run execution engine with feedback
│   │   ├── memory/route.ts      # Durable user memory extraction
│   │   ├── embed/               # pgvector embedding indexer
│   │   └── recall/              # Semantic recall for session context
│   └── auth/                    # Authentication pages (login/signup)
│
├── components/
│   └── artifacts/
│       ├── ArtifactRenderer.tsx  # Routes outputs to domain components
│       ├── ExecutionPlan.tsx     # Variant tabs, record results, refine button
│       ├── TrendChart.tsx        # Recharts trend visualisation
│       ├── CompetitiveMatrix.tsx # Feature comparison grid
│       ├── WinLossScorecard.tsx  # Buyer sentiment scorecard
│       ├── PricingTable.tsx      # Pricing tier comparison
│       ├── PositioningGap.tsx    # Messaging gap analysis
│       ├── ThreatHeatmap.tsx     # Adjacent threat grid
│       ├── MindMap.tsx           # SVG strategic mind map
│       └── EmptyArtifact.tsx     # Graceful fallback for sparse data
│
├── lib/
│   ├── agents/
│   │   ├── orchestrator.ts      # Two-stage coordinator + cost/latency metrics
│   │   ├── types.ts             # All TypeScript types + RunMetrics
│   │   ├── market-trends.ts     # Market Trends agent
│   │   ├── competitive.ts       # Competitive Intelligence agent
│   │   ├── win-loss.ts          # Win/Loss sentiment agent
│   │   ├── pricing.ts           # Pricing Intelligence agent
│   │   ├── positioning.ts       # Brand Positioning agent
│   │   ├── adjacent.ts          # Adjacent Market agent
│   │   ├── execution-intent.ts  # Deterministic regex execution intent detector
│   │   ├── gemini-utils.ts     # Shared multimodal Gemini parts builder
│   │   └── execution/
│   │       ├── execution-engine.ts   # Stage 2 parent (fans out 3 sub-agents)
│   │       ├── content-agent.ts      # Campaign brief + copy angles
│   │       ├── ab-variant-agent.ts   # 3 A/B variants with hypotheses
│   │       └── outreach-formatter.ts # Email/LinkedIn sequences + timeline
│   ├── tools/
│   │   ├── serpapi.ts           # Google Search / Trends / News / Ads
│   │   ├── firecrawl.ts         # Page → LLM-ready markdown
│   │   ├── reddit.ts            # Reddit public JSON (auto-fallback to HN)
│   │   ├── hn-algolia.ts        # Hacker News Algolia API
│   │   ├── meta-ads.ts          # Meta Ad Library browser scrape
│   │   ├── linkedin-ads.ts      # LinkedIn Ad Library scrape
│   │   ├── patents.ts           # USPTO PatentsView API
│   │   ├── fallback.ts          # Uniform tool status + signal quality penalties
│   │   ├── index.ts             # Re-exports
│   │   └── types.ts             # ToolResult<T> + ToolStatus + domain types
│   ├── feedback.ts              # Client-side feedback helpers
│   ├── memory.ts                # User memory read/write/build context
│   ├── conversations.ts         # Session CRUD (Supabase)
│   ├── embeddings.ts            # pgvector embedding utilities
│   ├── supabase.ts              # Server-side Supabase client (cache)
│   ├── supabase-browser.ts      # Browser Supabase client
│   ├── supabase-server.ts       # SSR Supabase client (cookies)
│   └── theme.tsx                # Dark/light theme context
│
├── __tests__/
│   ├── execution-intent.test.ts # Regex detector: 57 cases (41 positive, 16 negative)
│   ├── empty-artifacts.test.ts  # withArrayDefaults: all 8 artifact types
│   ├── memory-context.test.ts   # buildMemoryContext + POST body contract
│   └── tool-fallback.test.ts    # Signal quality penalties + tool result extraction
│
├── supabase/
│   ├── schema.sql               # Base schema (signal_cache, conversations)
│   └── migrations/
│       ├── 001_chat_sessions.sql     # Sessions, messages, user_memory + RLS
│       ├── 002_chat_embeddings.sql   # pgvector embeddings + recall function
│       ├── 003_feedback_loop.sql     # Outcome tables + RLS
│       └── 004_tighten_rls.sql       # Drop open policies, enforce scoped RLS
│
├── middleware.ts                 # Auth middleware (route protection)
├── vitest.config.ts             # Test configuration
├── .env.example                 # Required environment variables
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account
- A [Google AI Studio](https://aistudio.google.com) account (for Gemini API)
- A [SerpAPI](https://serpapi.com) account
- A [Firecrawl](https://firecrawl.dev) account (optional — falls back to direct scrape)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/GROWTH-INTELLIGENCE-ASSISTANT.git
cd GROWTH-INTELLIGENCE-ASSISTANT
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# AI
GEMINI_API_KEY=your_gemini_api_key

# Search & Scraping
SERPAPI_KEY=your_serpapi_key
FIRECRAWL_API_KEY=your_firecrawl_api_key
```

### 4. Set up the Supabase database

In your Supabase project, open the **SQL Editor** and run these files in order:

```bash
supabase/schema.sql                    # Base tables + signal cache
supabase/migrations/001_chat_sessions.sql   # Sessions, messages, user_memory
supabase/migrations/002_chat_embeddings.sql # pgvector embeddings + recall
supabase/migrations/003_feedback_loop.sql   # Outcome tables (feedback, actions, variant results)
supabase/migrations/004_tighten_rls.sql     # Production RLS hardening
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Run tests

```bash
npm test
```

---

## Usage

### Making a Query

1. Sign in with your email (Supabase Auth)
2. Type any growth or competitive intelligence question into the chat input
3. Optionally attach an **image** (pricing screenshot, competitor UI, chart) for visual analysis
4. Hit **Enter** — all 6 agents fan out in real time
5. Watch the **Agent Grid** light up as each agent completes
6. Review the **Intelligence Summary**, **Recommendations**, and **Mind Map**
7. Click any agent card to drill into its detailed findings and sources

### Execution Queries

To trigger the Execution Engine (Stage 2), use generation verbs:

```
Write a cold email campaign for Vector Agents targeting CTOs
Draft 3 A/B message variants for our SDR outreach
Generate a campaign brief for Q3 product launch
Create LinkedIn posts about our new AI agent feature
```

The system will run all 9 agents (6 research + 3 execution), then render an **Execution Plan** artifact with:
- Variant tabs with hypothesis, success metric, and variable tested
- Copyable email/LinkedIn sequences
- Deployment timeline
- "Record result" form per variant
- "Refine with feedback" button

### Closing the Feedback Loop

1. **Rate recommendations** — click thumbs up/down on strategic recommendations
2. **Record variant results** — expand "Record campaign result" under any variant, paste your numbers
3. **Refine** — click "Refine with feedback" in the Execution Plan header to re-run the engine with your outcomes

### Example Queries

```
What are the growth trends in the AI coding tools market?
How does Notion position itself against Linear for product teams?
What do customers say when they switch away from Intercom?
Compare pricing strategies of Slack vs Teams vs Discord
Is there a disruption threat to Figma from AI-native design tools?
Write a cold email for an AI SDR tool targeting VP Sales
Generate A/B test variants for our outreach campaign
```

### Follow-up Questions

After an initial intelligence run, use the **"Ask a follow-up"** input at the bottom. The system maintains full conversation context — including previous follow-ups — so each new question builds on what came before.

### Persistent Memory

The system automatically extracts your company name, competitors, and strategic goals from your conversation, storing them in a **per-user memory layer**. This context is injected into future sessions so the AI always understands who you are without you needing to repeat yourself.

---

## API Reference

### `POST /api/chat`

Runs a full multi-agent intelligence query. Returns Server-Sent Events.

**Request body:**
```json
{
  "query": "string",
  "history": [{ "role": "user" | "assistant", "content": "string" }],
  "images": [{ "data": "base64", "mimeType": "image/jpeg" }],
  "memoryContext": "string (optional)"
}
```

**Response:** `text/event-stream`

```json
{ "type": "agent_update", "run": { "agentId": "...", "status": "running" | "completed" | "failed" } }
{ "type": "result", "output": { "synthesizedAnswer": "...", "outputs": [...], "metrics": { "totalLatencyMs": 12400, "estimatedCostUsd": 0.0054, "geminiCallCount": 9 } } }
{ "type": "error", "message": "..." }
```

### `POST /api/feedback`

Records user feedback. Discriminated union by `kind`:

```json
{ "kind": "recommendation-feedback", "sessionId": "...", "recommendationKey": "...", "title": "...", "rating": "up" | "down" | "neutral" }
{ "kind": "recommendation-action", "sessionId": "...", "recommendationKey": "...", "title": "...", "action": "accepted" | "rejected" | "refined" | "copied" }
{ "kind": "variant-result", "sessionId": "...", "variantId": "...", "replyRate": 4.2, "hypothesisConfirmed": "yes" }
```

### `GET /api/feedback?sessionId=...`

Returns all accumulated feedback, actions, and variant results for a session.

### `POST /api/refine`

Re-runs the Execution Engine using accumulated feedback.

```json
{ "sessionId": "...", "messageId": "...", "focus": "optional refinement steer" }
```

Returns a new `ExecutionPlanOutput` grounded in the user's recorded outcomes.

---

## Database Schema

| Table | Purpose | RLS |
|---|---|---|
| `chat_sessions` | Named conversation sessions per user | `auth.uid() = user_id` |
| `chat_messages` | All messages (user + AI) with metadata | Session-scoped via user ownership |
| `chat_embeddings` | pgvector embeddings for semantic recall | Session-scoped |
| `user_memory` | Extracted user context (role, company, competitors) | `auth.uid() = user_id` |
| `signal_cache` | Shared tool result cache (non-PII) | Authenticated read/write, no delete |
| `recommendation_feedback` | Thumbs up/down per recommendation | `auth.uid() = user_id` |
| `recommendation_actions` | Accepted/rejected/refined/copied actions | `auth.uid() = user_id` |
| `variant_results` | Campaign performance numbers per variant | `auth.uid() = user_id` |

---

## Cost & Latency

Every query displays live metrics in the Intelligence Summary header:

- **Latency** — wall-clock time from query to final response
- **Estimated cost** — based on Gemini 2.0 Flash pricing (~$0.005 per research query, ~$0.008 with execution)
- **API calls** — total Gemini calls (typically 9 for research, 12 with execution)

Per-agent latencies are tracked in `RunMetrics.agentLatencies` for profiling.

---

## Testing

```bash
npm test
```

**91 tests across 4 suites:**

| Suite | Tests | What it validates |
|---|---|---|
| `execution-intent.test.ts` | 57 | Regex detector fires for execution queries (41 positive), stays silent for research (16 negative) |
| `empty-artifacts.test.ts` | 16 | `withArrayDefaults` patches undefined/null arrays for all 8 artifact types |
| `memory-context.test.ts` | 8 | `buildMemoryContext` output shape + POST body uses `memoryContext` (not `recalledContext`) |
| `tool-fallback.test.ts` | 10 | `buildToolResult` status/confidence mapping, `computeSignalQualityPenalty` scaling, `extractToolResults` from settled promises |

---

## Configuration

### Adding a New Agent

Create a new file in `lib/agents/` following the pattern:

```typescript
// lib/agents/my-agent.ts
import type { AgentConfig, AgentContext, AgentOutput } from './types';

export const myAgent: AgentConfig = {
  id: 'my-domain',
  name: 'My Domain Agent',
  description: 'What this agent does.',
  async run(ctx: AgentContext): Promise<AgentOutput> {
    // fetch signals, process, return structured output
  },
};
```

Then register it in `lib/agents/orchestrator.ts`:

```typescript
import { myAgent } from './my-agent';
const ALL_AGENTS: AgentConfig[] = [...existingAgents, myAgent];
```

### Tool Fallback Contract

All tools in `lib/tools/` follow a normalized contract via `buildToolResult()` from `lib/tools/fallback.ts`:

- Always return `ToolResult<T>` — never throw
- Every result carries a `status: 'ok' | 'degraded' | 'failed'` with canonical confidence anchors (0.85 / 0.55 / 0.15)
- Fallback chains: Reddit → HN Algolia, Firecrawl → direct scrape, Meta Ad API → browser scrape
- Agents apply `computeSignalQualityPenalty()` to their Gemini-reported confidence — a synthesis with 3 failed tools scores lower than one where all tools succeeded
- Include `sourceUrl` in all paths (success and failure)

### Dark/Light Theme

The app supports system-level dark/light mode switching, persisted via the `useTheme()` hook in `lib/theme.tsx`. Users can toggle via the header icon.

---

## Deployment

### Deploy to Vercel

```bash
vercel deploy
```

Set all environment variables from `.env.local` in your Vercel project settings.

> **Note:** The API route uses `maxDuration = 120` (2-minute timeout) to accommodate parallel agent execution. Make sure your hosting plan supports this.

### Production Checklist

- [ ] Set all environment variables in production
- [ ] Run all 4 migration files in your production Supabase project
- [ ] Run `004_tighten_rls.sql` to drop open policies
- [ ] Enable Supabase Auth email confirmations
- [ ] Monitor Gemini API quota usage
- [ ] Run `npm test` in CI

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-new-agent`
3. Run tests: `npm test`
4. Commit your changes: `git commit -m 'Add market sentiment agent'`
5. Push to the branch: `git push origin feature/my-new-agent`
6. Open a Pull Request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgements

Built with:
- [Google Gemini 2.0 Flash](https://deepmind.google/technologies/gemini/) — the core AI backbone
- [Supabase](https://supabase.com) — database, auth, and real-time infrastructure
- [Firecrawl](https://firecrawl.dev) — intelligent web scraping
- [SerpAPI](https://serpapi.com) — search engine results API
- [Next.js](https://nextjs.org) — the React framework
- [Vitest](https://vitest.dev) — fast test runner
- [Lucide](https://lucide.dev) — beautiful open-source icons
