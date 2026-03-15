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
