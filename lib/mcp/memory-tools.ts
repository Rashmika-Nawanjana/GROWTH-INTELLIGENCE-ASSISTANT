import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  getUserMemoryWithContext,
  recallSimilarTurns,
  getPastOutcomes,
  getPastOutcomesWithTimeout,
  recordOutcome,
  updateUserMemoryFromExchange,
} from '@/lib/memory-store';
import { retrieveEvidenceWithTimeout } from '@/lib/evidence/retrieve';
import { isEvidenceRagEnabled } from '@/lib/evidence/config';
import type { OutcomeRecordPayload } from '@/lib/memory-store';
import type { UserMemory } from '@/lib/memory';

// ── Zod schemas (shared by in-process tools and stdio MCP) ───────────────────

export const getUserMemoryInputSchema = z.object({
  userId: z.string().uuid().optional(),
});

export const recallSimilarTurnsInputSchema = z.object({
  sessionId: z.string().uuid(),
  query: z.string().min(1),
  matchCount: z.number().int().min(1).max(20).optional(),
});

export const getPastOutcomesInputSchema = z.object({
  sessionId: z.string().uuid().optional(),
  scope: z.enum(['session', 'user']),
  limit: z.number().int().min(1).max(50).optional(),
  focus: z.string().optional(),
});

export const recommendationFeedbackSchema = z.object({
  kind: z.literal('recommendation-feedback'),
  sessionId: z.string().uuid(),
  messageId: z.string().uuid().nullable().optional(),
  recommendationKey: z.string().min(1),
  title: z.string().min(1),
  rating: z.enum(['up', 'down', 'neutral']),
  note: z.string().optional(),
});

export const recommendationActionSchema = z.object({
  kind: z.literal('recommendation-action'),
  sessionId: z.string().uuid(),
  messageId: z.string().uuid().nullable().optional(),
  recommendationKey: z.string().min(1),
  title: z.string().min(1),
  action: z.enum(['accepted', 'rejected', 'refined', 'copied']),
  metadata: z.record(z.unknown()).optional(),
});

export const variantResultSchema = z.object({
  kind: z.literal('variant-result'),
  sessionId: z.string().uuid(),
  messageId: z.string().uuid().nullable().optional(),
  variantId: z.string().min(1),
  variantAngle: z.string().optional(),
  hypothesis: z.string().optional(),
  successMetric: z.string().optional(),
  sentCount: z.number().int().optional(),
  openRate: z.number().optional(),
  replyRate: z.number().optional(),
  clickRate: z.number().optional(),
  meetingsBooked: z.number().int().optional(),
  hypothesisConfirmed: z.enum(['yes', 'no', 'unclear']).optional(),
  notes: z.string().optional(),
});

export const recordOutcomeInputSchema = z.discriminatedUnion('kind', [
  recommendationFeedbackSchema,
  recommendationActionSchema,
  variantResultSchema,
]);

export const updateUserMemoryInputSchema = z.object({
  sessionId: z.string().uuid(),
  userQuery: z.string().min(1),
  assistantAnswer: z.string().min(1),
  existingMemory: z.object({
    role: z.string().nullable(),
    company: z.string().nullable(),
    products: z.array(z.string()),
    competitors: z.array(z.string()),
    interests: z.array(z.string()),
    facts: z.array(z.object({
      fact: z.string(),
      source_session: z.string(),
      created_at: z.string(),
    })),
    raw_summary: z.string().nullable(),
    updated_at: z.string(),
  }),
});

export const searchEvidenceInputSchema = z.object({
  query: z.string().min(1),
  product: z.string().optional(),
  domain: z.string().optional(),
  matchCount: z.number().int().min(1).max(20).optional(),
});

export type MemoryToolContext = {
  supabase: SupabaseClient;
  userId: string;
};

// ── In-process tool implementations ─────────────────────────────────────────

export async function toolGetUserMemory(
  ctx: MemoryToolContext,
  _input: z.infer<typeof getUserMemoryInputSchema> = {},
) {
  return getUserMemoryWithContext(ctx.supabase, ctx.userId);
}

export async function toolRecallSimilarTurns(
  ctx: MemoryToolContext,
  input: z.infer<typeof recallSimilarTurnsInputSchema>,
) {
  const parsed = recallSimilarTurnsInputSchema.parse(input);
  return recallSimilarTurns(ctx.supabase, {
    ...parsed,
    userId: ctx.userId,
  });
}

export async function toolGetPastOutcomes(
  ctx: MemoryToolContext,
  input: z.infer<typeof getPastOutcomesInputSchema>,
) {
  const parsed = getPastOutcomesInputSchema.parse(input);
  return getPastOutcomes(ctx.supabase, {
    ...parsed,
    userId: ctx.userId,
  });
}

export async function toolGetPastOutcomesForChat(
  ctx: MemoryToolContext,
  sessionId: string,
) {
  return getPastOutcomesWithTimeout(ctx.supabase, {
    sessionId,
    scope: 'session',
    limit: 30,
    userId: ctx.userId,
  });
}

export async function toolRecordRecommendationOutcome(
  ctx: MemoryToolContext,
  input: OutcomeRecordPayload,
) {
  const parsed = recordOutcomeInputSchema.parse(input) as OutcomeRecordPayload;
  await recordOutcome(ctx.supabase, ctx.userId, parsed);
  return { ok: true as const };
}

export async function toolUpdateUserMemory(
  ctx: MemoryToolContext,
  input: z.infer<typeof updateUserMemoryInputSchema>,
) {
  const parsed = updateUserMemoryInputSchema.parse(input);
  await updateUserMemoryFromExchange(ctx.supabase, ctx.userId, {
    sessionId: parsed.sessionId,
    userQuery: parsed.userQuery,
    assistantAnswer: parsed.assistantAnswer,
    existingMemory: parsed.existingMemory as UserMemory,
  });
  return { ok: true as const };
}

export async function toolSearchEvidence(
  ctx: MemoryToolContext,
  input: z.infer<typeof searchEvidenceInputSchema>,
) {
  if (!isEvidenceRagEnabled()) {
    return { hits: [], contextBlock: '', enabled: false };
  }
  const parsed = searchEvidenceInputSchema.parse(input);
  return retrieveEvidenceWithTimeout(ctx.supabase, {
    userId: ctx.userId,
    query: parsed.query,
    product: parsed.product,
    domain: parsed.domain,
    matchCount: parsed.matchCount,
  });
}

export const MEMORY_TOOL_DEFINITIONS = [
  {
    name: 'get_user_memory',
    description: 'Read persistent user memory (role, company, products, competitors) across all sessions.',
    inputSchema: getUserMemoryInputSchema,
    handler: toolGetUserMemory,
  },
  {
    name: 'recall_similar_turns',
    description: 'Semantic recall of similar prior turns within the current chat session (pgvector).',
    inputSchema: recallSimilarTurnsInputSchema,
    handler: toolRecallSimilarTurns,
  },
  {
    name: 'get_past_outcomes',
    description: 'Load recommendation ratings, actions, and variant campaign results for session or user scope.',
    inputSchema: getPastOutcomesInputSchema,
    handler: toolGetPastOutcomes,
  },
  {
    name: 'record_recommendation_outcome',
    description: 'Record recommendation feedback, action, or variant performance outcome.',
    inputSchema: recordOutcomeInputSchema,
    handler: toolRecordRecommendationOutcome,
  },
  {
    name: 'update_user_memory',
    description: 'Extract and merge durable user facts from a query/answer exchange into persistent memory.',
    inputSchema: updateUserMemoryInputSchema,
    handler: toolUpdateUserMemory,
  },
  {
    name: 'search_evidence',
    description: 'Semantic search over indexed research evidence (scraped pages and agent facts). Context only — not live verification.',
    inputSchema: searchEvidenceInputSchema,
    handler: toolSearchEvidence,
  },
] as const;
