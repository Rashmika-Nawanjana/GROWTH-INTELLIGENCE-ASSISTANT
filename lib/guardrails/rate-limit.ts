import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuardrailFinding, RiskLevel } from './types';

/** Per-route request limits (sliding window). */
export const ROUTE_LIMITS: Record<
  string,
  { limit: number; windowSeconds: number }
> = {
  chat: { limit: 8, windowSeconds: 60 },
  refine: { limit: 4, windowSeconds: 60 },
  'steal-strategy': { limit: 6, windowSeconds: 60 },
  'workspace-explain': { limit: 12, windowSeconds: 60 },
  memory: { limit: 20, windowSeconds: 60 },
  recall: { limit: 30, windowSeconds: 60 },
  embed: { limit: 40, windowSeconds: 60 },
};

/** Daily estimated spend cap in USD per user. */
export const DAILY_SPEND_CAP_USD = Number(process.env.DAILY_SPEND_CAP_USD ?? '5');

export interface RateLimitResult {
  allowed: boolean;
  reason?: 'rate' | 'spend';
  retryAfterSeconds?: number;
  currentCount?: number;
}

/**
 * Postgres-backed sliding-window rate limit via check_rate_limit RPC.
 * Fails open (allow) if the table/RPC is missing so local dev without
 * migration 010 still works — but logs a warning.
 */
export async function checkRouteRateLimit(
  supabase: SupabaseClient,
  userId: string,
  route: string,
): Promise<RateLimitResult> {
  const cfg = ROUTE_LIMITS[route] ?? { limit: 20, windowSeconds: 60 };

  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_user_id: userId,
      p_route: route,
      p_limit: cfg.limit,
      p_window_seconds: cfg.windowSeconds,
    });

    if (error) {
      console.warn('[rate-limit] RPC unavailable:', error.message);
      return { allowed: true };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { allowed: true };

    if (row.allowed === false) {
      return {
        allowed: false,
        reason: 'rate',
        retryAfterSeconds: Number(row.retry_after_seconds ?? cfg.windowSeconds),
        currentCount: Number(row.current_count ?? 0),
      };
    }

    return {
      allowed: true,
      currentCount: Number(row.current_count ?? 0),
    };
  } catch (err) {
    console.warn(
      '[rate-limit] check failed:',
      err instanceof Error ? err.message : err,
    );
    return { allowed: true };
  }
}

/**
 * Reject when today's run_usage cost already exceeds the daily spend cap.
 */
export async function checkDailySpendCap(
  supabase: SupabaseClient,
  userId: string,
): Promise<RateLimitResult> {
  if (!Number.isFinite(DAILY_SPEND_CAP_USD) || DAILY_SPEND_CAP_USD <= 0) {
    return { allowed: true };
  }

  try {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('run_usage')
      .select('cost_usd')
      .eq('user_id', userId)
      .gte('created_at', since.toISOString());

    if (error) {
      console.warn('[rate-limit] spend check unavailable:', error.message);
      return { allowed: true };
    }

    const total = (data ?? []).reduce(
      (sum, row) => sum + Number(row.cost_usd ?? 0),
      0,
    );

    if (total >= DAILY_SPEND_CAP_USD) {
      return { allowed: false, reason: 'spend' };
    }

    return { allowed: true };
  } catch (err) {
    console.warn(
      '[rate-limit] spend check failed:',
      err instanceof Error ? err.message : err,
    );
    return { allowed: true };
  }
}

export async function enforceUserQuotas(
  supabase: SupabaseClient,
  userId: string,
  route: string,
): Promise<RateLimitResult> {
  const rate = await checkRouteRateLimit(supabase, userId, route);
  if (!rate.allowed) return rate;

  // Spend cap only on expensive routes
  if (['chat', 'refine', 'steal-strategy', 'workspace-explain'].includes(route)) {
    const spend = await checkDailySpendCap(supabase, userId);
    if (!spend.allowed) return spend;
  }

  return { allowed: true };
}

/**
 * Persist a guardrail event (categories only — never raw text).
 */
export async function logGuardrailEvent(
  supabase: SupabaseClient,
  input: {
    userId: string;
    route: string;
    risk: RiskLevel;
    blocked: boolean;
    findings: GuardrailFinding[];
    judged?: boolean;
    reason?: string;
  },
): Promise<void> {
  try {
    const categories = [...new Set(input.findings.map(f => f.category))];
    const labels = [...new Set(input.findings.map(f => f.label))];
    await supabase.from('guardrail_events').insert({
      user_id: input.userId,
      route: input.route,
      risk: input.risk,
      blocked: input.blocked,
      finding_categories: categories,
      finding_labels: labels,
      judged: input.judged ?? false,
      reason: input.reason?.slice(0, 200) ?? null,
    });
  } catch (err) {
    console.warn(
      '[guardrails] event log failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
