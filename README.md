# 🚀 Growth Intelligence Assistant

> A multi-agent AI platform that delivers real-time, confidence-scored competitive intelligence across 6 specialist domains — all from a single query.

![Tech Stack](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![AI](https://img.shields.io/badge/Gemini_2.0_Flash-AI-blue?logo=google)
![Database](https://img.shields.io/badge/Supabase-Database-green?logo=supabase)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 📖 Overview

Growth Intelligence Assistant is a full-stack web application designed to give product teams, founders, and growth strategists instant access to structured market intelligence. Instead of manually trawling through competitor sites, Reddit threads, news articles, and pricing pages — you simply ask a question, and 6 specialist AI agents fan out to gather, analyse, and synthesise an answer in real time.

The system is built around a multi-agent architecture powered by **Google Gemini 2.0 Flash**. Each agent focuses on one intelligence domain and returns structured, confidence-scored output. A synthesis layer then combines all agent findings into a clear, readable response with strategic recommendations.

### Key Highlights

- 🧠 **6 parallel specialist agents** — each covering a distinct intelligence domain
- ⚡ **Real-time streaming** — watch agents complete live, see results appear as they stream in
- 🖼️ **Multimodal input** — attach images (screenshots, charts, pricing tables) alongside text
- 💾 **Persistent memory** — the system remembers your company context across sessions
- 📊 **Structured output** — confidence scores, source attribution, and strategic recommendations
- 💬 **Threaded follow-ups** — ask follow-up questions with full conversation context preserved
- 🗂️ **Session history** — all queries and follow-ups saved and recoverable from the sidebar

---

## 🤖 The 6 Specialist Agents

| Agent | Domain | Focus |
|---|---|---|
| **Market Trends** | `market-trends` | Industry signals, category growth, emerging technologies |
| **Competitive** | `competitive` | Competitor positioning, feature comparisons, SWOT data |
| **Win/Loss** | `win-loss` | Customer sentiment, switching triggers, Reddit/review signals |
| **Pricing** | `pricing` | Competitor pricing tiers, packaging strategies, value anchors |
| **Positioning** | `positioning` | Messaging analysis, brand differentiation, GTM strategy |
| **Adjacent** | `adjacent` | Disruption threats, adjacent markets, technology substitution |

All agents run **in parallel** and report back to a central **Orchestrator**, which:
1. Classifies the query and assigns relevant domains
2. Fans out to all 6 agents simultaneously
3. Synthesises agent findings into a single cohesive answer
4. Generates a live **Mind Map** from the intelligence gathered
5. Suggests focused follow-up questions

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js 15 (App Router) + React 19 | Full-stack web application |
| **Language** | TypeScript 5.9 | Type-safe development |
| **Styling** | Tailwind CSS v4 + Vanilla CSS | Responsive, dark/light themed UI |
| **AI** | Google Gemini 2.0 Flash (`@google/genai`) | All LLM calls, multimodal vision |
| **Database** | Supabase (PostgreSQL) | Auth, session storage, memory, signal cache |
| **Search** | SerpAPI | Web + news search for agent tools |
| **Web Scraping** | Firecrawl | Competitor website scraping |
| **Community** | Reddit API | Win/loss sentiment signals |
| **Icons** | Lucide React | UI icons |
| **Charts** | Recharts | Data visualisation |
| **Animation** | Motion (Framer) | Micro-animations |

---

## 🏗️ Project Architecture

```
GROWTH-INTELLIGENCE-ASSISTANT/
├── app/
│   ├── page.tsx              # Main chat interface & state management
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Global styles
│   ├── api/
│   │   ├── chat/route.ts     # Main streaming API endpoint
│   │   └── follow-up/        # Follow-up question API
│   └── auth/                 # Authentication pages (login/signup)
│
├── components/
│   ├── artifacts/
│   │   └── ArtifactRenderer  # Domain output renderer (mind map, tables, etc.)
│   └── ui/                   # Shared UI components
│
├── lib/
│   ├── agents/
│   │   ├── orchestrator.ts   # Central agent coordinator + query classifier
│   │   ├── types.ts          # Shared TypeScript types
│   │   ├── market-trends.ts  # Market Trends agent
│   │   ├── competitive.ts    # Competitive Intelligence agent
│   │   ├── win-loss.ts       # Win/Loss sentiment agent
│   │   ├── pricing.ts        # Pricing Intelligence agent
│   │   ├── positioning.ts    # Brand Positioning agent
│   │   └── adjacent.ts       # Adjacent Market agent
│   ├── conversations.ts      # Session CRUD (Supabase)
│   ├── memory.ts             # Persistent user memory (cross-session context)
│   ├── supabase-browser.ts   # Supabase browser client
│   └── theme.ts              # Dark/light theme logic
│
├── supabase/
│   ├── schema.sql            # Database schema
│   └── migrations/           # Supabase migration files
│
├── middleware.ts             # Auth middleware (route protection)
├── .env.example              # Required environment variables
└── package.json
```

---

## ⚙️ Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account
- A [Google AI Studio](https://aistudio.google.com) account (for Gemini API)
- A [SerpAPI](https://serpapi.com) account
- A [Firecrawl](https://firecrawl.dev) account

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
SUPABASE_DB_URL=your_postgres_connection_string

# AI
GEMINI_API_KEY=your_gemini_api_key

# Search & Scraping
SERPAPI_KEY=your_serpapi_key
FIRECRAWL_API_KEY=your_firecrawl_api_key

# Optional — for Win/Loss community signals
REDDIT_CLIENT_ID=your_reddit_client_id
REDDIT_CLIENT_SECRET=your_reddit_client_secret

# Optional — for Ad Intelligence
META_ADS_TOKEN=your_meta_ads_token
```

### 4. Set up the Supabase database

In your Supabase project, open the **SQL Editor** and run the contents of:

```bash
supabase/schema.sql
```

This creates:
- `signal_cache` — caches tool results to stay within API rate limits
- `conversations` — stores chat history per session  
- `chat_sessions` — tracks named sessions per user
- `chat_messages` — stores individual messages including follow-ups
- `user_memory` — persists cross-session context about each user

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🚀 Usage

### Making a Query

1. Sign in with your email (Supabase Auth)
2. Type any growth or competitive intelligence question into the chat input
3. Optionally attach an **image** (pricing screenshot, competitor UI, chart) for visual analysis
4. Hit **Enter** — all 6 agents fan out in real time
5. Watch the **Agent Grid** light up as each agent completes
6. Review the **Intelligence Summary**, **Recommendations**, and **Mind Map**
7. Click any agent card to drill into its detailed findings and sources

### Example Queries

```
What are the growth trends in the AI coding tools market?
How does Notion position itself against Linear for product teams?
What do customers say when they switch away from Intercom?
Compare pricing strategies of Slack vs Teams vs Discord
Is there a disruption threat to Figma from AI-native design tools?
```

### Follow-up Questions

After an initial intelligence run, use the **"Ask a follow-up"** input at the bottom. The system maintains full conversation context — including previous follow-ups — so each new question builds on what came before.

### History & Sessions

- All sessions are saved automatically and listed in the left sidebar under **Recent**
- Click any session to restore the full query, agent results, and follow-up threads
- Hover over a session and click the **trash icon** to delete it

### Persistent Memory

The system automatically extracts your company name, competitors, and strategic goals from your conversation, storing them in a **per-user memory layer**. This context is injected into future sessions so the AI always understands who you are without you needing to repeat yourself.

---

## 📡 API Reference

### `POST /api/chat`

Runs a full multi-agent intelligence query.

**Request body:**
```json
{
  "query": "string",
  "history": [{ "role": "user" | "assistant", "content": "string" }],
  "images": [{ "data": "base64string", "mimeType": "image/jpeg", "name": "file.jpg" }],
  "memoryContext": "string (optional)"
}
```

**Response:** `text/event-stream` (Server-Sent Events)

Each event is a JSON chunk:
```json
{ "type": "agent_update", "run": { "agentId": "...", "status": "running" | "completed" | "failed" } }
{ "type": "result", "output": { "synthesizedAnswer": "...", "outputs": [...], "agentRuns": [...] } }
{ "type": "error", "message": "..." }
```

---

## 🗄️ Database Schema

| Table | Purpose |
|---|---|
| `chat_sessions` | One row per named conversation session (per user) |
| `chat_messages` | All messages (user + AI), including follow-ups (flagged via `isFollowUp` in metadata) |
| `signal_cache` | Deduplication cache for tool API calls (avoids redundant scraping) |
| `user_memory` | JSON blob of extracted user context, updated after each query |

---

## 🔧 Configuration

### Adding a new Agent

Create a new file in `lib/agents/` following the pattern:

```typescript
// lib/agents/my-agent.ts
import type { AgentConfig, AgentContext, AgentOutput } from './types';

export const myAgent: AgentConfig = {
  id: 'my-domain',
  name: 'My Domain Agent',
  domain: 'my-domain' as any,
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

### Dark/Light Theme

The app supports system-level dark/light mode switching, persisted via the `useTheme()` hook in `lib/theme.ts`. Users can toggle via the header icon.

---

## 🚢 Deployment

### Deploy to Vercel

```bash
vercel deploy
```

Set all environment variables from `.env.local` in your Vercel project settings.

> **Note:** The API route uses `maxDuration = 120` (2-minute timeout) to accommodate parallel agent execution. Make sure your hosting plan supports this.

### Production Checklist

- [ ] Set all environment variables in production
- [ ] Run `supabase/schema.sql` in your production Supabase project
- [ ] Tighten Supabase Row-Level Security policies for production use
- [ ] Enable Supabase Auth email confirmations if needed
- [ ] Monitor Gemini API quota usage

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-new-agent`
3. Commit your changes: `git commit -m 'Add market sentiment agent'`
4. Push to the branch: `git push origin feature/my-new-agent`
5. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgements

Built with:
- [Google Gemini 2.0 Flash](https://deepmind.google/technologies/gemini/) — the core AI backbone
- [Supabase](https://supabase.com) — database, auth, and real-time infrastructure
- [Firecrawl](https://firecrawl.dev) — intelligent web scraping
- [SerpAPI](https://serpapi.com) — search engine results API
- [Next.js](https://nextjs.org) — the React framework
- [Lucide](https://lucide.dev) — beautiful open-source icons
