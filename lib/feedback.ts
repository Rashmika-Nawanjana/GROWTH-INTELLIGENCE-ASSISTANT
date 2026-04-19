// Client-side helpers for the feedback loop.
// Used by page.tsx and ExecutionPlan.tsx — every call is fire-and-forget
// (failures never block the UI) and every body shape matches the server
// discriminated union in app/api/feedback/route.ts.

import type { ExecutionPlanOutput } from '@/lib/agents/types';

export type RecommendationRating = 'up' | 'down' | 'neutral';
export type RecommendationAction = 'accepted' | 'rejected' | 'refined' | 'copied';

// Stable key for a recommendation — lets us dedupe ratings across refines.
export function recommendationKey(title: string, rationale: string): string {
  const raw = `${title}::${rationale}`.toLowerCase();
  // cheap 32-bit hash — good enough for matching rows
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) | 0;
  }
  return `rec_${(h >>> 0).toString(16)}`;
}

async function postFeedback(body: unknown): Promise<boolean> {
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function rateRecommendation(params: {
  sessionId: string;
  messageId?: string | null;
  title: string;
  rationale: string;
  rating: RecommendationRating;
  note?: string;
}): Promise<boolean> {
  return postFeedback({
    kind: 'recommendation-feedback',
    sessionId: params.sessionId,
    messageId: params.messageId ?? null,
    recommendationKey: recommendationKey(params.title, params.rationale),
    title: params.title,
    rating: params.rating,
    note: params.note,
  });
}

export function logRecommendationAction(params: {
  sessionId: string;
  messageId?: string | null;
  title: string;
  rationale: string;
  action: RecommendationAction;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  return postFeedback({
    kind: 'recommendation-action',
    sessionId: params.sessionId,
    messageId: params.messageId ?? null,
    recommendationKey: recommendationKey(params.title, params.rationale),
    title: params.title,
    action: params.action,
    metadata: params.metadata,
  });
}

export function recordVariantResult(params: {
  sessionId: string;
  messageId?: string | null;
  variantId: string;
  variantAngle?: string;
  hypothesis?: string;
  successMetric?: string;
  sentCount?: number;
  openRate?: number;
  replyRate?: number;
  clickRate?: number;
  meetingsBooked?: number;
  hypothesisConfirmed?: 'yes' | 'no' | 'unclear';
  notes?: string;
}): Promise<boolean> {
  return postFeedback({
    kind: 'variant-result',
    ...params,
  });
}

// Refine a prior execution plan using session feedback.
// Returns the new ExecutionPlanOutput or null on failure.
export async function refineExecutionPlan(params: {
  sessionId: string;
  messageId: string;
  focus?: string;
}): Promise<{
  executionPlan: ExecutionPlanOutput;
  feedbackApplied: { recommendationFeedback: number; recommendationActions: number; variantResults: number };
} | null> {
  try {
    const res = await fetch('/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.ok) return null;
    return {
      executionPlan: json.executionPlan as ExecutionPlanOutput,
      feedbackApplied: json.feedbackApplied,
    };
  } catch {
    return null;
  }
}
