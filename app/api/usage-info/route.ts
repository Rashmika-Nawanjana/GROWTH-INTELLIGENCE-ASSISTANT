import { createClient } from '@/lib/supabase-server';

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

  const providers = [
    { id: 'gemini', label: 'Google Gemini (LLM + JSON + classify)', kind: 'model' as const, configured: boolEnv('GEMINI_API_KEY'), usageNote: 'In-app: estimated $ from orchestrator RunMetrics; exact usage: Google AI Studio / Cloud billing.' },
    { id: 'embed', label: 'Gemini embeddings (recall / pgvector)', kind: 'model' as const, configured: boolEnv('GEMINI_API_KEY'), usageNote: 'Tied to same key as text model.' },
    { id: 'serpapi', label: 'SerpAPI (web, news, trends)', kind: 'tool' as const, configured: boolEnv('SERPAPI_KEY'), usageNote: 'Dashboard: serpapi.com → Usage.' },
    { id: 'firecrawl', label: 'Firecrawl (scrape pages)', kind: 'tool' as const, configured: boolEnv('FIRECRAWL_API_KEY'), usageNote: 'Dashboard: firecrawl.dev account.' },
    { id: 'apify', label: 'Apify (Twitter/X via Tweet Scraper)', kind: 'tool' as const, configured: boolEnv('APIFY_API_TOKEN'), usageNote: 'Apify console → Usage / per-actor runs.' },
    { id: 'reddit', label: 'Reddit (public JSON)', kind: 'tool' as const, configured: true, usageNote: 'No token required; optional OAuth for higher rate limits.' },
    { id: 'supabase', label: 'Supabase (DB + auth)', kind: 'platform' as const, configured: boolEnv('NEXT_PUBLIC_SUPABASE_URL') && boolEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), usageNote: 'Project dashboard for DB and API usage.' },
  ];

  return new Response(
    JSON.stringify({
      models: { text: textModel, embedding: embedModel, embeddingDimensions: Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768) },
      providers,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
