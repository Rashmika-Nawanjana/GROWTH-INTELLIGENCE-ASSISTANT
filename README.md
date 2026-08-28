# Growth Intelligence Assistant

**Veracity AI × Hatch Hackathon** · TypeScript · Multi-agent systems · Gemini · Next.js 15

A conversational growth-intelligence platform. Ask a market question; specialist agents fan out in parallel, pull **live** web signals, and render findings as charts, matrices, and campaign plans **inside the chat** — not as a text dump.

[Architecture](ARCHITECTURE.md) · [Interview prep](INTERVIEW_PREP.md) · [LangGraph migration](docs/LANGGRAPH_MIGRATION.md) · [SearXNG / Playwright](docs/SEARXNG.md) · [GitHub](https://github.com/Rashmika-Nawanjana/GROWTH-INTELLIGENCE-ASSISTANT)

---

## Why this exists

Growth teams split research, copy, outreach, and feedback across tools. By the time insight becomes a campaign, the signal is stale.

This project closes that loop in one conversation:

**live research → structured artifacts → executable campaigns → recorded outcomes → refined next cycle**

---

## What it does

| Capability | How |
|---|---|
| **Multi-agent research** | 6 specialist agents run in parallel (`Promise.allSettled`): trends, competitive landscape, win/loss, pricing, positioning, adjacent threats |
| **Research → action** | Execution intent (e.g. “write a cold email”) triggers 3 more sub-agents: campaign brief, A/B variants with falsifiable hypotheses, outreach sequences — **9 agents** on a full run |
| **Live signals only** | SerpAPI, Firecrawl, Reddit, Hacker News, ad-library scrapes. Claims carry source URLs and confidence (`high` / `medium` / `low`) |
| **Agent memory** | Session history plus persistent user/org memory (company, products, competitors). Follow-ups never re-ask context |
| **Semantic recall** | PostgreSQL + pgvector embeddings over prior turns |
| **Generative UI** | SSE streams agent status live. Outputs render as TrendChart, CompetitiveMatrix, WinLossScorecard, PricingTable, PositioningGap, ThreatHeatmap, MindMap, ExecutionPlan |
| **Closed loop** | Rate recommendations, record variant results, refine — orchestration re-runs with outcomes injected |
| **Resilience** | One failed agent does not kill the run. Tool fallbacks (Reddit → HN, Firecrawl → scrape) plus confidence penalties when sources degrade |

---

## Architecture

```
User query
    │
    ▼
POST /api/chat  (SSE, auth-gated)
    │
    ▼
Classifier  →  product, domains, execution intent
    │
    ├─ Stage 1  6 research agents in parallel  →  tools → Gemini JSON
    │
    ├─ Stage 2  Execution Engine (if intent)   →  3 sub-agents grounded in Stage 1
    │
    └─ Synthesize + mind map in parallel
            │
            ▼
    Inline artifacts + recommendations + follow-ups
            │
            ▼
    (optional) Refine with feedback  →  full loop again
```

Deep dive: **[ARCHITECTURE.md](ARCHITECTURE.md)**

---

## Stack

| Layer | Tech |
|---|---|
| App | Next.js 15, React 19, TypeScript 5.9, Tailwind CSS 4 |
| LLM | Google Gemini (`gemini-2.5-flash`) via `@google/genai` |
| Data | Supabase (Auth, PostgreSQL, pgvector, RLS) |
| Signals | SerpAPI, Firecrawl, Reddit public JSON, HN Algolia |
| Tests | Vitest |

---

## Quick start

**Needs:** Node 18+, [Supabase](https://supabase.com), [Gemini](https://aistudio.google.com), [SerpAPI](https://serpapi.com). Firecrawl is optional (falls back to direct scrape).

```bash
git clone https://github.com/Rashmika-Nawanjana/GROWTH-INTELLIGENCE-ASSISTANT.git
cd GROWTH-INTELLIGENCE-ASSISTANT
npm install
cp .env.example .env.local
```

Fill `.env.local` (`GEMINI_API_KEY`, `SERPAPI_KEY`, Supabase URL/key, optional `FIRECRAWL_API_KEY`).

In the Supabase SQL editor, run in order:

```
supabase/schema.sql
supabase/migrations/001_chat_sessions.sql
supabase/migrations/002_chat_embeddings.sql
supabase/migrations/003_feedback_loop.sql
supabase/migrations/004_tighten_rls.sql
```

```bash
npm run dev    # http://localhost:3000
npm test
```

---

## Example queries

Research:

- Is Lilian competitive in the AI SDR market? Where does Vector stand?
- Is the digital workers category accelerating or consolidating?
- What should Vector Agents build over the next six months?

Execution (triggers Stage 2):

- Write a cold email campaign for Vector Agents targeting CTOs
- Draft 3 A/B message variants for SDR outreach
- Generate a campaign brief for Q3

The system is **not hardcoded to Vector Agents** — product identity is classified from the query and memory.

---

## Repo map

```
app/page.tsx              Chat UI
app/api/chat/             SSE orchestration
app/api/refine/           Feedback-grounded re-run
lib/agents/orchestrator.ts
lib/agents/*.ts           6 research agents
lib/agents/execution/     Content, A/B, outreach
lib/tools/                Live APIs + fallbacks
components/artifacts/     Inline UI for each domain
```

---

MIT
