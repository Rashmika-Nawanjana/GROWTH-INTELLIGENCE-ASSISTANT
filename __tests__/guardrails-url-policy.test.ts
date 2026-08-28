import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isClearlyUnsafeUrl, UnsafeUrlError } from '@/lib/guardrails/url-policy';

describe('guardrails-url-policy', () => {
  it('flags clearly unsafe hosts synchronously', () => {
    expect(isClearlyUnsafeUrl('http://127.0.0.1/admin')).toBe(true);
    expect(isClearlyUnsafeUrl('http://localhost:8080')).toBe(true);
    expect(isClearlyUnsafeUrl('http://169.254.169.254/latest/meta-data/')).toBe(true);
    expect(isClearlyUnsafeUrl('http://192.168.1.1/')).toBe(true);
    expect(isClearlyUnsafeUrl('ftp://example.com/file')).toBe(true);
    expect(isClearlyUnsafeUrl('https://example.com/pricing')).toBe(false);
  });

  it('rejects metadata IP asynchronously', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });

  it('rejects private IPv4', async () => {
    await expect(assertSafeUrl('http://10.0.0.5/internal')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('allows public https URLs', async () => {
    await expect(assertSafeUrl('https://example.com/pricing')).resolves.toBeUndefined();
  });
});
