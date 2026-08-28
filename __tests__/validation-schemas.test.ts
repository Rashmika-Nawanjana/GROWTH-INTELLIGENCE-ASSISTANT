import { describe, expect, it } from 'vitest';
import {
  chatBodySchema,
  recallBodySchema,
  stealStrategyBodySchema,
  formatZodError,
} from '@/lib/validation/schemas';
import { safeRedirectPath } from '@/lib/api/errors';

describe('validation-schemas', () => {
  it('accepts a normal chat payload', () => {
    const parsed = chatBodySchema.safeParse({
      query: 'Is Lilian competitive vs Vector?',
      history: [{ role: 'user', content: 'hi' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects oversized queries', () => {
    const parsed = chatBodySchema.safeParse({
      query: 'x'.repeat(5000),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatZodError(parsed.error)).toMatch(/query/i);
    }
  });

  it('caps recall matchCount', () => {
    const parsed = recallBodySchema.safeParse({
      sessionId: '00000000-0000-4000-8000-000000000001',
      query: 'prior pricing',
      matchCount: 999,
    });
    expect(parsed.success).toBe(false);
  });

  it('requires company length for steal-strategy', () => {
    const parsed = stealStrategyBodySchema.safeParse({ company: 'a' });
    expect(parsed.success).toBe(false);
  });
});

describe('safeRedirectPath', () => {
  it('blocks open redirects', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/');
    expect(safeRedirectPath('https://evil.com')).toBe('/');
    expect(safeRedirectPath('/workspace')).toBe('/workspace');
    expect(safeRedirectPath(null)).toBe('/');
  });
});
