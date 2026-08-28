import type { SupabaseClient } from '@supabase/supabase-js';
import type { RunMetrics } from '@/lib/agents/types';

export type PersistRunUsageInput = {
  userId: string;
  sessionId: string;
  queryPreview: string;
  metrics: RunMetrics;
};

export async function persistRunUsage(
  supabase: SupabaseClient,
  input: PersistRunUsageInput,
): Promise<void> {
  const { metrics } = input;
  const { error } = await supabase.from('run_usage').insert({
    user_id: input.userId,
    session_id: input.sessionId,
    query_preview: input.queryPreview.slice(0, 200),
    latency_ms: metrics.totalLatencyMs,
    input_tokens: metrics.inputTokens ?? metrics.usage?.llm.inputTokens ?? 0,
    output_tokens: metrics.outputTokens ?? metrics.usage?.llm.outputTokens ?? 0,
    cost_usd: metrics.actualCostUsd ?? metrics.estimatedCostUsd,
    cost_basis: metrics.costBasis ?? 'estimated',
    tool_calls: metrics.usage?.tools.byProvider ?? {},
    llm_by_stage: metrics.usage?.llm.byStage ?? {},
    trace_id: metrics.traceId ?? null,
    trace_url: metrics.traceUrl ?? null,
    safety_score: metrics.safetyScore ?? null,
    guardrail_risk: metrics.guardrailRisk ?? null,
  });

  if (error) {
    // Table may not exist until migration 009 is applied — fail silently in dev.
    if (!/run_usage|relation.*does not exist/i.test(error.message)) {
      throw error;
    }
  }
}
