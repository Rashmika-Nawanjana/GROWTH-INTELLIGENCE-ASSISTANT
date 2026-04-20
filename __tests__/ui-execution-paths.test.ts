// @ts-nocheck
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordVariantResult, refineExecutionPlan } from '@/lib/feedback';

describe('UI-triggered execution paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recordVariantResult posts variant payload to /api/feedback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await recordVariantResult({
      sessionId: 'session-1',
      messageId: 'msg-1',
      variantId: 'V1-ROI',
      replyRate: 4.2,
      hypothesisConfirmed: 'yes',
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/feedback',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.kind).toBe('variant-result');
    expect(body.variantId).toBe('V1-ROI');
  });

  it('refineExecutionPlan posts to /api/refine and parses response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        executionPlan: { artifactType: 'execution-plan', variants: [], brief: {}, deployment: [] },
        orchestratorOutput: { query: 'q', outputs: [] },
        feedbackApplied: { recommendationFeedback: 1, recommendationActions: 1, variantResults: 1 },
        changes: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await refineExecutionPlan({ sessionId: 'session-1', messageId: 'msg-1', focus: 'ROI' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/refine',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ sessionId: 'session-1', messageId: 'msg-1', focus: 'ROI' });
    expect(result?.feedbackApplied.variantResults).toBe(1);
  });
});
