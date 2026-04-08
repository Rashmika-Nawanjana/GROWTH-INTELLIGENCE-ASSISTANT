# Veracity AI — Growth Intelligence Assistant

## Project Overview

Multi-agent conversational platform delivering boardroom-quality growth intelligence in minutes. Built for the Veracity AI × Hatch hackathon. Single chat interface, live-sourced data, dynamic inline artifacts.

**Live at**: Next.js 15 + React 19 + Tailwind CSS 4 + TypeScript

---

## Always Apply: Veracity Design System

### Color Tokens (CSS variables in `globals.css`)

| Token | Value | Tailwind class |
|-------|-------|----------------|
| Background | `#FAFAFA` | `bg-background` |
| Foreground | `#0F172A` | `text-foreground` |
| Muted bg | `#F1F5F9` | `bg-muted` |
| Muted text | `#64748B` | `text-muted-foreground` |
| Accent (primary) | `#0052FF` | `text-accent` / `bg-accent` |
| Accent secondary | `#4D7CFF` | `text-accent-secondary` |
| Border | `#E2E8F0` | `border-border` |
| Card | `#FFFFFF` | `bg-card` |

### Fonts

- **Display headers / logo**: `font-serif` → Calistoga
- **Body text / UI**: `font-sans` → Inter
- **Labels / pills / code / metadata**: `font-mono` → JetBrains Mono

### Global Utility Classes (never recreate, always reuse)

```css
.bg-gradient-signature    /* Primary gradient: #0052FF → #4D7CFF at 135deg */
.text-gradient-signature  /* Same gradient as text fill */
.veracity-card            /* White card: 16px radius, border-border, shadow */
.veracity-card-hover      /* Lift on hover */
.animate-pulse-dot        /* Pulsing dot for live indicators */
.animate-pulse-line       /* Skeleton loading shimmer */
```

### Semantic Color Coding

| Meaning | Classes |
|---------|---------|
| Positive / Win | `bg-emerald-50 text-emerald-600 border-emerald-200` |
| Warning / Partial | `bg-amber-50 text-amber-700 border-amber-200` |
| Negative / Loss | `bg-red-50 text-red-600 border-red-200` |
| Neutral | `bg-muted text-muted-foreground border-border` |
| Active / Accent | `bg-accent/5 text-accent border-accent/20` |

---

## Architecture

```
app/
  page.tsx              # Main chat interface (single page)
  globals.css           # Design tokens + utility classes
  layout.tsx            # Root layout + font loading
  api/
    chat/
      route.ts          # Streaming POST endpoint → agent orchestrator
lib/
  agents/
    orchestrator.ts     # Fan-out coordinator — classifies query, dispatches agents
    market-trends.ts    # Domain agent: Market & Trend Sensing
    competitive.ts      # Domain agent: Competitive Landscape & Feature Bets
    win-loss.ts         # Domain agent: Win / Loss Intelligence
    pricing.ts          # Domain agent: Pricing & Packaging Intelligence
    positioning.ts      # Domain agent: Positioning & Messaging Gaps
    adjacent.ts         # Domain agent: Adjacent Market Collision
    types.ts            # Shared agent output types
  tools/
    serpapi.ts          # Google Search / Trends / News (SerpAPI)
    firecrawl.ts        # Page → LLM-ready markdown (Firecrawl)
    reddit.ts           # Reddit OAuth2 search
    hn-algolia.ts       # Hacker News Algolia API
    types.ts            # Tool response types { data, source, timestamp }
components/
  artifacts/
    TrendChart.tsx      # Inline trend visualization
    HeatMap.tsx         # Competitive heat map grid
    ScoreCard.tsx       # Confidence-scored insight card
    AgentStatus.tsx     # Real-time agent run status panel
.claude/
  skills/
    theme.md            # Full design system reference (component patterns)
```

---

## Design Rules — Non-Negotiable

1. **Single page only** — no routing, no dashboards. The conversation IS the product.
2. **Always use `.veracity-card`** for any card surface — never custom bg + border + shadow.
3. **Always use `.bg-gradient-signature`** for primary buttons and highlights.
4. **Always use `font-mono`** for labels, pills, metadata, source tags.
5. **Never use bare hex colors** — always Tailwind token classes.
6. **Artifacts render inline** inside the chat — never as links or popups.
7. **Every AI claim needs a source** — `sources[]` array always present in responses.
8. **Confidence scores are required** on all structured outputs (`high` | `medium` | `low`).

---

## Data Flow

```
User query
  → POST /api/chat (streaming)
    → Orchestrator classifies domain(s)
      → Fan-out: 3-6 agents run in parallel
        → Each agent calls tools (SerpAPI, Firecrawl, Reddit, HN)
          → Tools return { data, source, timestamp }
        → Agent synthesizes with Gemini → structured JSON output
      → Orchestrator merges outputs → final response
    → Stream structured JSON chunks to frontend
  → Frontend renders artifact components inline
```

---

## Environment Variables

```bash
GEMINI_API_KEY=        # Google Gemini API (via @google/genai)
SERPAPI_KEY=           # SerpAPI for Google search/trends
FIRECRAWL_API_KEY=     # Firecrawl page scraping
REDDIT_CLIENT_ID=      # Reddit OAuth2
REDDIT_CLIENT_SECRET=  # Reddit OAuth2
```

---

## Component Patterns — Quick Reference

### Primary Button
```tsx
<button className="bg-gradient-signature text-white rounded-xl py-3 px-4 font-medium transition-transform hover:-translate-y-[1px] hover:shadow-md">
```

### Status Pill (running agent)
```tsx
<span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
  Agent Name <RefreshCw size={10} className="animate-spin" />
</span>
```

### Status Pill (completed agent)
```tsx
<span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1">
  Agent Name <Check size={10} className="text-emerald-500" />
</span>
```

### Suggestion Chip
```tsx
<button className="text-xs text-accent border border-accent/20 bg-accent/5 hover:bg-accent/10 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5">
  {suggestion} <ChevronRight size={12} />
</button>
```

### Section Label
```tsx
<div className="text-xs font-mono text-muted-foreground mb-3 uppercase tracking-wider">Label</div>
```

### Loading Skeleton
```tsx
<div className="veracity-card p-6 flex flex-col gap-4 w-full max-w-2xl">
  <div className="h-4 bg-muted rounded w-3/4 animate-pulse-line" />
  <div className="h-4 bg-muted rounded w-full animate-pulse-line" />
  <div className="h-4 bg-muted rounded w-5/6 animate-pulse-line" />
</div>
```

---

## Intelligence Domains

| # | Domain | Purpose |
|---|--------|---------|
| 1 | Market & Trend Sensing | Where is the category heading? Leading indicators? |
| 2 | Competitive Landscape | Who's doing what, feature bets, genuine demand? |
| 3 | Win / Loss Intelligence | Why deals lost? Buyer-side view? |
| 4 | Pricing & Packaging | Is pricing right, WTP shifts? |
| 5 | Positioning & Messaging | How to talk about what exists? |
| 6 | Adjacent Market Collision | External threats from outside the category? |

---

## Evaluation Criteria (Hackathon)

| Criterion | Weight | Target |
|-----------|--------|--------|
| Multi-Agent System | 25% | 6+ coordinated agents, parallelism, MCP usage |
| Product Design | 25% | Dynamic inline artifacts, seamless UX |
| Intelligence Quality | 20% | Multi-source, confidence-scored, grounded |
| Scalability / Cost | 15% | Cost-per-query <$0.05, cloud-deployable |
| Demo Strength | 15% | Live on Vector Agents + generalise to another product |

---

## Three Hard Rules (Non-Negotiable from Brief)

1. **Not a chatbot** — Findings render as interfaces (TrendChart, HeatMap, ScoreCard) inside the conversation. Never links, never separate windows, never plain text dumps.
2. **Not one model call** — Genuine multi-agent coordination: multiple steps, tool calls, parallel threads. The orchestrator must fan out to ≥3 specialist agents per query.
3. **Live signal only** — Every insight must be grounded in real-time fetched data (SerpAPI, Firecrawl, Reddit, HN). No training-data responses. Every claim carries a source URL and confidence level.

---

## Conversational Memory — Critical Requirement

This is **not a popup chatbot**. The system must maintain deep conversational memory:

### Rules
- **Never reset context between messages** — each follow-up query builds on all prior context in the session.
- **Memory is stateful, not stateless** — prior findings, agent outputs, and established facts persist across the entire conversation.
- **New signals update conclusions** — if a follow-up query contradicts or extends a prior finding, the system explicitly notes the update and revises its position.
- **No "As I mentioned earlier..." anti-patterns** — silently carry context forward; don't narrate the memory.
- **Domain context carries forward** — if the user establishes the product is "Vector Agents" in message 1, agents must never ask again in messages 2–10.

### Implementation
- Store full conversation history in React state and send it with every POST to `/api/chat`
- API route passes prior messages to the orchestrator
- Orchestrator includes prior agent findings in the system prompt for follow-up classification
- The synthesis step must reference prior conclusions when constructing the new response

---

## Multi-Agent Architecture Requirements

### Two-Stage Architecture (Member 3)

The orchestrator now runs in **two sequential stages**:

**Stage 1 — Research (parallel, always runs):**
Six specialist agents fan out simultaneously via `Promise.allSettled`:
1. `market-trends` — Market & Trend Sensing
2. `competitive` — Competitive Landscape & Feature Bets
3. `win-loss` — Win / Loss Intelligence
4. `pricing` — Pricing & Packaging Intelligence
5. `positioning` — Positioning & Messaging Gaps
6. `adjacent` — Adjacent Market Collision

**Stage 2 — Execution Engine (triggered by execution intent, runs after Stage 1):**
When the query contains execution intent (write copy, draft outreach, campaign brief, cold email, LinkedIn post, message variants, A/B test angles), the classifier sets `runExecution: true` and the orchestrator dispatches the Execution Engine after Stage 1 completes. This proves "Research → Action" sequencing.

The Execution Engine (`lib/agents/execution/execution-engine.ts`) fans out **3 sub-agents in parallel**:
- `content-agent` — Campaign brief + copy angles (grounded in Stage 1 findings)
- `ab-variant-agent` — 3 A/B variants, each with a falsifiable hypothesis tied to a Stage 1 signal
- `outreach-formatter` — Humanised email/LinkedIn sequences + deployment timeline

All 3 sub-agents receive `researchOutputs` (Stage 1 findings) via `AgentContext`, satisfying the live-signal rule.

**Demo talking point:** A full execution query runs 9 agents total (6 research + 3 execution sub-agents), all grounded in live-fetched signals.

### Minimum Agent Count: 6 (research) + 3 (execution sub-agents) = 9 total

### Parallelism (7.2 from brief)
- The orchestrator **must** dispatch multiple agents simultaneously using `Promise.all` or equivalent.
- Never run agents sequentially unless one explicitly depends on the output of another.
- Show real-time agent status in `AgentStatus.tsx` — users must see parallel execution happening.

### Deep Research — Multi-hop (7.3 from brief)
- Agents must follow threads: Find → Deepen → Cross-reference → Surface with confidence.
- A single SerpAPI call is not sufficient. Each agent should perform 2–4 tool calls minimum.

### Lifecycle & Failure Handling (7.4 from brief)
- Agent status must be visible: `pending` → `running` → `completed` | `failed`
- If one agent fails, others continue — graceful degradation, never full crash.
- Audit trail: each finding records which agent produced it and which tool calls backed it.

### Structured Outputs (7.5 from brief)
All agent outputs must conform to the typed schema in `lib/agents/types.ts`:
- `confidence: 'high' | 'medium' | 'low'`
- `sources: { url: string; title: string; timestamp: string }[]`
- `facts: string[]` — verifiable claims from sources
- `interpretation: string[]` — analyst synthesis (clearly separated from facts)

---

## Signal Source Requirements (7.1 from brief)

Each query should draw from **multiple** of these signal types:

| Signal | Tool | Notes |
|--------|------|-------|
| Web search / news | `lib/tools/serpapi.ts` | Google Trends, News, Ads Transparency |
| Product pages / reviews | `lib/tools/firecrawl.ts` | Any URL → LLM-ready markdown |
| Developer / founder sentiment | `lib/tools/hn-algolia.ts` | HN Algolia, no key needed |
| User voice / complaints | `lib/tools/reddit.ts` | Public JSON API — **no OAuth key needed** |
| Meta ad intelligence | `lib/tools/meta-ads.ts` | Firecrawl browser scrape of facebook.com/ads/library |
| Job postings | SerpAPI jobs or Firecrawl | Hiring signals = intent signal |
| Funding / patents | Firecrawl → Crunchbase / USPTO | Pre-launch technical signal |

## Tool Strategy — Key Decisions (M2)

### Reddit — No API Key Required
Use Reddit's **public JSON API** (append `.json` to any Reddit URL). No OAuth, no key, works immediately.
- Primary: `reddit.ts` calls `reddit.com/search.json` with a `User-Agent` header
- Fallback: If Reddit blocks or returns 0 results, **automatically falls back to HN Algolia**
- Never fail silently — always return some signal

### Meta Ad Library — Browser Scrape, No Token
The official Meta Ad Library API only covers political/EU ads. For competitor ad intelligence (all advertisers), use **Firecrawl to scrape `facebook.com/ads/library`** directly.
- `meta-ads.ts` builds the public Ad Library search URL and passes it to `scrapePage()`
- Firecrawl renders the JS-heavy page and returns markdown ad content
- Graceful degradation: if scrape fails, returns empty array and agents continue

### Fallback Chain
```
Reddit public JSON → HN Algolia (auto-fallback on empty/block)
Meta Ad Library API → Firecrawl browser scrape (no token needed)
Firecrawl → scrapeBasic() raw fetch (if no API key)
```

---

## Demo Scenario (Reference Product)

The reference product is **Vector Agents** (vectoragents.ai — AI-powered digital workers).

The system must answer these three live demo queries convincingly:
1. *"Is Lilian competitive in the AI SDR market right now? Where does Vector stand?"*
2. *"Is the digital workers category accelerating or consolidating — and what does that mean for Vector's roadmap?"*
3. *"What should Vector Agents build or reposition over the next six months to capture emerging demand?"*

**The solution must generalise to any product.** Vector Agents is the example, not the constraint. During demo, generalize to a second product to prove this.

---

## Demo Tips (from brief)

- **Show agents working, not just output** — judges assess process depth.
- The `AgentStatus.tsx` panel must be visible during execution showing parallel agent runs.
- Architecture walkthrough required: explicitly show multi-agent coordination, not a wrapper.
- Demo script is 10 minutes: 1 min problem framing, 2 min live query, 2 min artifact walkthrough, 1 min memory follow-up, 2 min generalization, 2 min architecture.
