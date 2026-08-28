// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  getPastOutcomesInputSchema,
  recordOutcomeInputSchema,
  recallSimilarTurnsInputSchema,
  updateUserMemoryInputSchema,
} from '@/lib/mcp/memory-tools';

describe('memory-tools schemas', () => {
  it('accepts recommendation-feedback payload', () => {
    const parsed = recordOutcomeInputSchema.parse({
      kind: 'recommendation-feedback',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      recommendationKey: 'hash-1',
      title: 'Lead with workflow pain',
      rating: 'down',
      note: 'Not ROI',
    });
    expect(parsed.kind).toBe('recommendation-feedback');
  });

  it('accepts variant-result payload', () => {
    const parsed = recordOutcomeInputSchema.parse({
      kind: 'variant-result',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      variantId: 'V1',
      replyRate: 0.8,
      hypothesisConfirmed: 'no',
    });
    expect(parsed.variantId).toBe('V1');
  });

  it('rejects malformed feedback payload', () => {
    expect(() =>
      recordOutcomeInputSchema.parse({
        kind: 'recommendation-feedback',
        sessionId: 'not-a-uuid',
        recommendationKey: 'k',
        title: 't',
        rating: 'up',
      }),
    ).toThrow();
  });

  it('accepts get_past_outcomes session scope', () => {
    const parsed = getPastOutcomesInputSchema.parse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      scope: 'session',
      limit: 10,
    });
    expect(parsed.scope).toBe('session');
  });

  it('accepts recall_similar_turns input', () => {
    const parsed = recallSimilarTurnsInputSchema.parse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      query: 'pricing',
      matchCount: 3,
    });
    expect(parsed.matchCount).toBe(3);
  });

  it('accepts update_user_memory input shape', () => {
    const parsed = updateUserMemoryInputSchema.parse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      userQuery: 'We sell Vector Agents',
      assistantAnswer: 'Understood.',
      existingMemory: {
        role: null,
        company: null,
        products: [],
        competitors: [],
        interests: [],
        facts: [],
        raw_summary: null,
        updated_at: new Date().toISOString(),
      },
    });
    expect(parsed.userQuery).toContain('Vector Agents');
  });
});
