# Growth Intelligence — Python FastAPI backend

Replaces the Next.js TypeScript API routes (`app/api/*`) with a FastAPI service.
The React UI stays on Next.js and proxies `/api/*` to this service.

## Setup

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

Copy env vars from the repo root `.env` / `.env.example` (same keys: `GEMINI_API_KEY`, `SERPAPI_KEY`, `FIRECRAWL_API_KEY`, `NEXT_PUBLIC_SUPABASE_*`, etc.).

Create a root `.env` (or `.env.local`) before running — the FastAPI process loads those files automatically.

## Run

From repo root (recommended via npm):

```bash
npm run dev:backend
```

Or:

```bash
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Full stack (Next + Python):

```bash
npm run dev:full
```

Set `PYTHON_BACKEND_URL=http://127.0.0.1:8000` (default) so Next.js rewrites `/api/*` here.

## Auth

Send `Authorization: Bearer <supabase_access_token>` on API calls. Cookie forwarding is also attempted as a fallback.

## Endpoints

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/chat` | SSE stream (same chunk types as TS) |
| POST | `/api/refine` | Feedback-driven re-orchestration |
| POST | `/api/memory` | User memory extraction |
| POST/GET | `/api/feedback` | Recommendation / variant feedback |
| POST | `/api/recall` | Semantic recall |
| POST | `/api/embed` | Index embeddings |
| POST | `/api/steal-strategy` | Strategy helper |
| GET | `/api/usage-info` | Configured providers (no secrets) |
| GET | `/health` | Liveness |

LangChain / LangGraph / MCP are intentionally not included yet — add them under `backend/app/` later without changing the SSE contract.
