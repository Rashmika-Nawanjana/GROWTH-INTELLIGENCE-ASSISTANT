# LangChain.js / LangGraph.js migration

Safe, flag-gated migration of LLM providers and orchestration. **Default behavior is unchanged** (`ORCHESTRATOR_BACKEND=legacy`, `LLM_PROVIDER=gemini`).

## Quick reference

| Env | Values | Default | Purpose |
|-----|--------|---------|---------|
| `LLM_PROVIDER` | `gemini` \| `vertex` | `gemini` | Chat/JSON backend |
| `ORCHESTRATOR_BACKEND` | `legacy` \| `langgraph` | `legacy` | Orchestrator implementation |
| `GEMINI_API_KEY` | string | — | Developer API (gemini + **always** embeddings) |
| `GOOGLE_CLOUD_PROJECT` | string | — | Vertex project (or taken from service-account JSON) |
| `GOOGLE_CLOUD_LOCATION` | string | `us-central1` | Vertex region |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON object (one line) | — | Service-account key for Vertex (preferred on Vercel/local) |
| `LANGCHAIN_TRACING_V2` | `true` | off | LangSmith for LangGraph runs |
| `LANGCHAIN_API_KEY` | string | — | LangSmith |

## Rollback (instant)

```bash
ORCHESTRATOR_BACKEND=legacy
LLM_PROVIDER=gemini
```

No code redeploy required if env is set on the host (Vercel project settings).

## Architecture

```
POST /api/chat|refine
  → runOrchestration()          # lib/agents/orchestrate-entry.ts
      → legacy orchestrate()    # default
      → orchestrateLangGraph()  # when ORCHESTRATOR_BACKEND=langgraph
            → same agent.run() + tools
  → agents call gemini.ts
      → lib/llm (LangChain ChatGoogle)
          → Gemini Developer API  OR  Vertex AI
```

Embeddings **always** use the Gemini Developer API (`GEMINI_API_KEY`) so pgvector `vector(768)` stays consistent.

## Manual QA checklist

Before flipping `ORCHESTRATOR_BACKEND=langgraph` in production:

- [ ] Research-only query (e.g. market trends for a product) — SSE `agent_update` + `result`
- [ ] Execution query (“Write a cold email…”) — ExecutionPlan artifact
- [ ] Refine with feedback — `/api/refine` returns new plan + deltas
- [ ] Force one tool failure (invalid SerpAPI key temporarily) — other agents still complete
- [ ] `LLM_PROVIDER=gemini` smoke with existing key
- [ ] `LLM_PROVIDER=vertex` smoke with GCP project + ADC (staging only)
- [ ] Compare `result.outputs[].artifactType` set vs legacy on the same query

## Key files

| Path | Role |
|------|------|
| `lib/llm/*` | Provider factory + generateText/Json |
| `lib/agents/gemini.ts` | Stable exports; delegates to `lib/llm` |
| `lib/agents/orchestrate-entry.ts` | Backend switch + dynamic LangGraph import |
| `lib/agents/langgraph/*` | StateGraph wrapping existing agents |
| `lib/tools/langchain-tools.ts` | Optional LangChain `tool()` wrappers |
| `__tests__/llm-provider.test.ts` | Provider config (no network) |
| `__tests__/orchestrator-backend-switch.test.ts` | Flag routing |

## Soak policy

1. Keep `ORCHESTRATOR_BACKEND=legacy` in production until staging soak passes.
2. Enable `langgraph` in staging for at least several successful demos.
3. Flip production only after checklist above is green.
4. Keep legacy code for at least one release cycle after cutover.

**Do not** set production default to `langgraph` until this soak completes.

## Phase 4 hardening (optional, post-parity)

Already available without flipping the default:

- **LangSmith:** set `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY` (+ optional `LANGCHAIN_PROJECT`). Graph invokes are tagged `orchestrator` / `langgraph`.
- **Tool wrappers:** `lib/tools/langchain-tools.ts` exposes LangChain `tool()` adapters around SerpAPI / Firecrawl / Reddit / HN. Agents still call `lib/tools` directly today.
- **Structured output helpers** for classify/synthesize remain a follow-up once the graph path is trusted.
