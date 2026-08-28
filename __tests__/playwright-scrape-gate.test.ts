import { describe, expect, it } from 'vitest';
import { isPlaywrightScrapeEnabled } from '@/lib/tools/playwright-scrape';

describe('isPlaywrightScrapeEnabled', () => {
  it('is false by default', () => {
    expect(isPlaywrightScrapeEnabled({})).toBe(false);
  });

  it('is true when enabled and not on Vercel', () => {
    expect(
      isPlaywrightScrapeEnabled({ PLAYWRIGHT_SCRAPE_ENABLED: 'true' }),
    ).toBe(true);
  });

  it('is false on Vercel even when enabled', () => {
    expect(
      isPlaywrightScrapeEnabled({
        PLAYWRIGHT_SCRAPE_ENABLED: 'true',
        VERCEL: '1',
      }),
    ).toBe(false);
  });

  it('is false when flag is not exactly true', () => {
    expect(
      isPlaywrightScrapeEnabled({ PLAYWRIGHT_SCRAPE_ENABLED: '1' }),
    ).toBe(false);
  });
});
