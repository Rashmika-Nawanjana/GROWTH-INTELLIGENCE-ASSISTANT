# Veracity Memory MCP

Stdio MCP server exposing user memory, session recall, and feedback/outcome tools for Cursor local development.

## Tools

| Tool | Purpose |
|------|---------|
| `get_user_memory` | Persistent profile (role, company, products, competitors) |
| `recall_similar_turns` | pgvector semantic recall within a session |
| `get_past_outcomes` | Ratings, actions, variant results + summary block |
| `record_recommendation_outcome` | Write feedback (same shapes as `/api/feedback`) |
| `update_user_memory` | Gemini extraction merge into `user_memory` |

Runtime orchestration uses the same logic **in-process** via `lib/mcp/memory-tools.ts` (no subprocess on Vercel).

## Local setup

1. Add to `.env.local` (or Cursor MCP env):

```bash
SUPABASE_SERVICE_ROLE_KEY=...   # Supabase → Settings → API
MEMORY_MCP_USER_ID=...          # auth.users id for your test account
```

2. Reload Cursor MCP (`.cursor/mcp.json` registers `veracity-memory`).

3. Optional manual run:

```bash
npm run mcp:memory
```

**Security:** Service role is for local Cursor QA only. The Next.js app uses cookie auth + RLS, never the service role key.

## Product behavior

When `sessionId` is sent with `/api/chat`, the server loads prior feedback and variant outcomes and injects them as `injectedContext` on every turn (not only `/api/refine`).
