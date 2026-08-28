import { createClient } from '@/lib/supabase-server';
import { getLlmProviderId } from '@/lib/llm/providers/google';
import { getOrchestratorBackend } from '@/lib/agents/orchestrator-backend';
import { isLangfuseEnabled, getLangfuseBaseUrl } from '@/lib/observability/langfuse';
import { getPricingTableForUi } from '@/lib/observability/pricing';

function boolEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Public, non-secret usage/config snapshot for the API Usage tab.
 * Do not return API key values; only which integrations are configured.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const textModel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  const embedModel = process.env.GEMINI_EMBEDDING_MODEL?.trim() || 'gemini-embedding-001';
  const llmProvider = getLlmProviderId();
  const orchestratorBackend = getOrchestratorBackend();
  const langsmithConfigured =
    process.env.LANGCHAIN_TRACING_V2 === 'true' && boolEnv('LANGCHAIN_API_KEY');

  const vertexConfigured =
    boolEnv('GOOGLE_CLOUD_PROJECT') ||
    boolEnv('GOOGLE_SERVICE_ACCOUNT_JSON') ||
    boolEnv('GOOGLE_SERVICE_ACCOUNT_JASON');
  const geminiConfigured = boolEnv('GEMINI_API_KEY') || boolEnv('GOOGLE_API_KEY');

  const providers = [
    {
      id: 'llm-provider',
      label: `Active LLM provider (${llmProvider})`,
      kind: 'model' as const,
      configured: llmProvider === 'vertex' ? vertexConfigured : geminiConfigured,
      usageNote:
        llmProvider === 'vertex'
          ? 'Vertex AI — GCP billing for the project. Embeddings still use GEMINI_API_KEY (Developer API).'
          : 'Google AI Studio / Generative Language API. Exact usage: AI Studio / Cloud billing.',
    },
    {
      id: 'gemini',
      label: 'Gemini Developer API key',
      kind: 'model' as const,
      configured: geminiConfigured,
      usageNote: 'Required for embeddings and when LLM_PROVIDER=gemini.',
    },
    {
      id: 'vertex',
      label: 'Vertex AI (GCP project)',
      kind: 'model' as const,
      configured: vertexConfigured,
      usageNote: 'Set LLM_PROVIDER=vertex + GOOGLE_SERVICE_ACCOUNT_JSON (or ADC) + optional GOOGLE_CLOUD_PROJECT.',
    },
    {
      id: 'embed',
      label: 'Gemini embeddings (recall / pgvector)',
      kind: 'model' as const,
      configured: boolEnv('GEMINI_API_KEY'),
      usageNote: 'Always Developer API; not switched by LLM_PROVIDER.',
    },
    {
      id: 'orchestrator',
      label: `Orchestrator backend (${orchestratorBackend})`,
      kind: 'platform' as const,
      configured: true,
      usageNote: 'ORCHESTRATOR_BACKEND=legacy|langgraph. Default legacy for safe rollback.',
    },
    {
      id: 'langsmith',
      label: 'LangSmith tracing',
      kind: 'platform' as const,
      configured: langsmithConfigured,
      usageNote:
        'LANGCHAIN_TRACING_V2=true + LANGCHAIN_API_KEY. Optional — LangGraph runs only. Langfuse covers the whole app.',
    },
    {
      id: 'langfuse',
      label: 'Langfuse observability',
      kind: 'platform' as const,
      configured: isLangfuseEnabled(),
      usageNote:
        'LANGFUSE_ENABLED=true + LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY. Full-app traces, tokens, and cost.',
    },
    { id: 'searxng', label: 'SearXNG (self-hosted discovery)', kind: 'tool' as const, configured: boolEnv('SEARXNG_BASE_URL'), usageNote: 'SEARXNG_BASE_URL — docker compose -f docker-compose.searxng.yml up -d. Preferred for searchWeb/searchNews.' },
    { id: 'serpapi', label: 'SerpAPI (web, news, trends)', kind: 'tool' as const, configured: boolEnv('SERPAPI_KEY'), usageNote: 'Fallback for searchWeb/news; required for Trends + Ads Transparency.' },
    { id: 'firecrawl', label: 'Firecrawl (scrape pages)', kind: 'tool' as const, configured: boolEnv('FIRECRAWL_API_KEY'), usageNote: 'Dashboard: firecrawl.dev account.' },
    {
      id: 'playwright-scrape',
      label: 'Playwright scrape fallback',
      kind: 'tool' as const,
      configured: process.env.PLAYWRIGHT_SCRAPE_ENABLED === 'true' && !boolEnv('VERCEL'),
      usageNote: 'PLAYWRIGHT_SCRAPE_ENABLED=true locally for JS-heavy domains. Disabled on Vercel.',
    },
    { id: 'apify', label: 'Apify (Twitter/X via Tweet Scraper)', kind: 'tool' as const, configured: boolEnv('APIFY_API_TOKEN'), usageNote: 'Apify console → Usage / per-actor runs.' },
    { id: 'reddit', label: 'Reddit (public JSON)', kind: 'tool' as const, configured: true, usageNote: 'No token required; optional OAuth for higher rate limits.' },
    { id: 'supabase', label: 'Supabase (DB + auth)', kind: 'platform' as const, configured: boolEnv('NEXT_PUBLIC_SUPABASE_URL') && boolEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), usageNote: 'Project dashboard for DB and API usage.' },
    {
      id: 'evidence-rag',
      label: 'Evidence RAG (pgvector research library)',
      kind: 'platform' as const,
      configured: process.env.EVIDENCE_RAG_ENABLED === 'true' && boolEnv('GEMINI_API_KEY'),
      usageNote: 'EVIDENCE_RAG_ENABLED=true + migration 007. Indexes scraped pages and agent facts for follow-up recall.',
    },
    {
      id: 'workspace-rag',
      label: 'Workspace Artifact RAG (pgvector)',
      kind: 'platform' as const,
      configured: process.env.WORKSPACE_RAG_ENABLED === 'true' && boolEnv('GEMINI_API_KEY'),
      usageNote: 'WORKSPACE_RAG_ENABLED=true + migration 008. Semantic search over pinned artifacts for Ask AI.',
    },
  ];

  return new Response(
    JSON.stringify({
      models: {
        text: textModel,
        embedding: embedModel,
        embeddingDimensions: Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768),
        llmProvider,
        orchestratorBackend,
      },
      pricing: getPricingTableForUi(),
      langfuse: {
        enabled: isLangfuseEnabled(),
        baseUrl: getLangfuseBaseUrl(),
      },
      providers,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
