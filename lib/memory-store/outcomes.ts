import type { SupabaseClient } from '@supabase/supabase-js';
import { buildFeedbackSummary } from '@/lib/agents/refine-utils';
import type { OutcomeRecordPayload, OutcomeScope, PastOutcomesResult } from './types';

export const DEFAULT_OUTCOMES_LIMIT = 30;
export const MAX_SUMMARY_BLOCK_CHARS = 4_000;

export interface GetPastOutcomesInput {
  sessionId?: string;
  scope: OutcomeScope;
  limit?: number;
  focus?: string;
  userId?: string;
}

function truncateSummaryBlock(summary: string, maxChars = MAX_SUMMARY_BLOCK_CHARS): string {
  if (summary.length <= maxChars) return summary;
  return `${summary.slice(0, maxChars)}\n…[truncated]`;
}

export async function getPastOutcomes(
  supabase: SupabaseClient,
  input: GetPastOutcomesInput,
): Promise<PastOutcomesResult> {
  const limit = input.limit ?? DEFAULT_OUTCOMES_LIMIT;

  let feedbackQuery = supabase
    .from('recommendation_feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  let actionsQuery = supabase
    .from('recommendation_actions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  let resultsQuery = supabase
    .from('variant_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (input.scope === 'session' && input.sessionId) {
    feedbackQuery = feedbackQuery.eq('session_id', input.sessionId);
    actionsQuery = actionsQuery.eq('session_id', input.sessionId);
    resultsQuery = resultsQuery.eq('session_id', input.sessionId);
  } else if (input.scope === 'user' && input.userId) {
    feedbackQuery = feedbackQuery.eq('user_id', input.userId);
    actionsQuery = actionsQuery.eq('user_id', input.userId);
    resultsQuery = resultsQuery.eq('user_id', input.userId);
  } else {
    return {
      feedback: [],
      actions: [],
      variantResults: [],
      summaryBlock: '',
    };
  }

  if (input.userId) {
    feedbackQuery = feedbackQuery.eq('user_id', input.userId);
    actionsQuery = actionsQuery.eq('user_id', input.userId);
    resultsQuery = resultsQuery.eq('user_id', input.userId);
  }

  const [feedbackRes, actionsRes, resultsRes] = await Promise.all([
    feedbackQuery,
    actionsQuery,
    resultsQuery,
  ]);

  const feedback = (feedbackRes.data ?? []) as Array<Record<string, unknown>>;
  const actions = (actionsRes.data ?? []) as Array<Record<string, unknown>>;
  const variantResults = (resultsRes.data ?? []) as Array<Record<string, unknown>>;

  const summaryBlock = truncateSummaryBlock(
    buildFeedbackSummary(feedback, actions, variantResults, input.focus),
  );

  return { feedback, actions, variantResults, summaryBlock };
}

export async function recordOutcome(
  supabase: SupabaseClient,
  userId: string,
  payload: OutcomeRecordPayload,
): Promise<{ ok: true }> {
  if (payload.kind === 'recommendation-feedback') {
    if (!payload.recommendationKey || !payload.title || !payload.rating) {
      throw new Error('missing required fields');
    }
    const { error } = await supabase.from('recommendation_feedback').insert({
      user_id: userId,
      session_id: payload.sessionId,
      message_id: payload.messageId ?? null,
      recommendation_key: payload.recommendationKey,
      title: payload.title,
      rating: payload.rating,
      note: payload.note ?? null,
    });
    if (error) throw error;
    return { ok: true };
  }

  if (payload.kind === 'recommendation-action') {
    if (!payload.recommendationKey || !payload.title || !payload.action) {
      throw new Error('missing required fields');
    }
    const { error } = await supabase.from('recommendation_actions').insert({
      user_id: userId,
      session_id: payload.sessionId,
      message_id: payload.messageId ?? null,
      recommendation_key: payload.recommendationKey,
      title: payload.title,
      action: payload.action,
      metadata: payload.metadata ?? {},
    });
    if (error) throw error;
    return { ok: true };
  }

  if (payload.kind === 'variant-result') {
    if (!payload.variantId) {
      throw new Error('missing variantId');
    }
    const { error } = await supabase.from('variant_results').insert({
      user_id: userId,
      session_id: payload.sessionId,
      message_id: payload.messageId ?? null,
      variant_id: payload.variantId,
      variant_angle: payload.variantAngle ?? null,
      hypothesis: payload.hypothesis ?? null,
      success_metric: payload.successMetric ?? null,
      sent_count: payload.sentCount ?? null,
      open_rate: payload.openRate ?? null,
      reply_rate: payload.replyRate ?? null,
      click_rate: payload.clickRate ?? null,
      meetings_booked: payload.meetingsBooked ?? null,
      hypothesis_confirmed: payload.hypothesisConfirmed ?? null,
      notes: payload.notes ?? null,
    });
    if (error) throw error;
    return { ok: true };
  }

  throw new Error('unknown kind');
}

const OUTCOMES_FETCH_TIMEOUT_MS = 2_500;

export async function getPastOutcomesWithTimeout(
  supabase: SupabaseClient,
  input: GetPastOutcomesInput,
  timeoutMs = OUTCOMES_FETCH_TIMEOUT_MS,
): Promise<PastOutcomesResult> {
  const empty: PastOutcomesResult = {
    feedback: [],
    actions: [],
    variantResults: [],
    summaryBlock: '',
  };

  try {
    const result = await Promise.race([
      getPastOutcomes(supabase, input),
      new Promise<PastOutcomesResult>((_, reject) => {
        setTimeout(() => reject(new Error('outcomes timeout')), timeoutMs);
      }),
    ]);
    return result;
  } catch {
    return empty;
  }
}
