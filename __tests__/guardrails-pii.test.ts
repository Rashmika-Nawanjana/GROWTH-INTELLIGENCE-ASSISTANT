import { describe, expect, it } from 'vitest';
import { redactPii } from '@/lib/guardrails/pii';

describe('guardrails-pii', () => {
  it('redacts emails', () => {
    const { redactedText, findings } = redactPii('Contact me at alice@acme.com please');
    expect(redactedText).toContain('[REDACTED_EMAIL]');
    expect(redactedText).not.toContain('alice@acme.com');
    expect(findings.some(f => f.label === 'email')).toBe(true);
  });

  it('redacts Luhn-valid card numbers only', () => {
    // 4111111111111111 is a well-known valid test Visa number
    const valid = redactPii('Card 4111 1111 1111 1111');
    expect(valid.redactedText).toContain('[REDACTED_CARD]');
    expect(valid.findings.some(f => f.label === 'credit_card')).toBe(true);

    const invalid = redactPii('Order id 1234 5678 9012 3456');
    // May or may not match depending on Luhn — 1234567890123456 fails Luhn
    expect(invalid.redactedText).not.toContain('[REDACTED_CARD]');
  });

  it('redacts API key shapes', () => {
    const { redactedText, findings } = redactPii('key sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(redactedText).toContain('[REDACTED_SECRET]');
    expect(findings.some(f => f.label === 'openai_key')).toBe(true);
  });

  it('does not flag ordinary product copy', () => {
    const { findings } = redactPii(
      'Is Vector Agents competitive vs Lilian in the AI SDR market for B2B SaaS?',
    );
    expect(findings.filter(f => f.label === 'email' || f.label === 'credit_card')).toHaveLength(0);
  });
});
