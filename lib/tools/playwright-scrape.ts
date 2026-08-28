/**
 * Local Chromium scrape for JS-heavy domains.
 * Gated off on Vercel — use Scrape.do render there instead.
 */

export type PlaywrightScrapePayload = {
  markdown: string;
  title: string;
};

const MAX_TEXT = 8000;
const NAV_TIMEOUT_MS = 20_000;

export function isPlaywrightScrapeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.PLAYWRIGHT_SCRAPE_ENABLED?.trim() !== 'true') return false;
  // Chromium in Vercel serverless is unreliable / oversized.
  if (env.VERCEL?.trim()) return false;
  return true;
}

/**
 * Scrape a single URL with Playwright Chromium.
 * Returns null when disabled, import fails, or navigation yields no content.
 */
export async function scrapeWithPlaywright(
  url: string,
): Promise<(PlaywrightScrapePayload & { source: 'Playwright' }) | null> {
  if (!isPlaywrightScrapeEnabled()) return null;

  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });

      const extracted = await page.evaluate(() => {
        const title = document.title || '';
        const main =
          document.querySelector('main') ||
          document.querySelector('article') ||
          document.body;
        const text = (main?.innerText || document.body?.innerText || '')
          .replace(/\s+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return { title, text };
      });

      const markdown = extracted.text.slice(0, MAX_TEXT);
      if (markdown.length < 50) return null;

      return {
        markdown,
        title: extracted.title.trim() || url,
        source: 'Playwright',
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}
