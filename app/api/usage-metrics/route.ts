import { createClient } from '@/lib/supabase-server';
import { getPricingTableForUi } from '@/lib/observability/pricing';

function parseWindow(window: string | null): number {
  if (!window) return 7;
  const match = window.match(/^(\d+)d$/);
  if (!match) return 7;
  return Math.min(30, Math.max(1, Number.parseInt(match[1], 10)));
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const url = new URL(req.url);
  const days = parseWindow(url.searchParams.get('window'));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('run_usage')
    .select('id, query_preview, latency_ms, input_tokens, output_tokens, cost_usd, cost_basis, trace_url, created_at')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    if (/run_usage|relation.*does not exist/i.test(error.message)) {
      return new Response(
        JSON.stringify({ runs: [], rollup: null, migrationRequired: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const runs = rows ?? [];
  const rollup = runs.length > 0
    ? {
        queryCount: runs.length,
        totalCostUsd: runs.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
        totalLatencyMs: runs.reduce((s, r) => s + (r.latency_ms ?? 0), 0),
        totalInputTokens: runs.reduce((s, r) => s + (r.input_tokens ?? 0), 0),
        totalOutputTokens: runs.reduce((s, r) => s + (r.output_tokens ?? 0), 0),
        windowDays: days,
      }
    : null;

  return new Response(
    JSON.stringify({ runs, rollup, pricing: getPricingTableForUi() }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
