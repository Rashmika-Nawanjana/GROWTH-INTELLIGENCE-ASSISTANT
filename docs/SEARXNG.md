# SearXNG + Playwright scraping

Self-hosted discovery search and local browser scrape fallback. SerpAPI trends/ads stay as-is.

## SearXNG (Docker)

```bash
docker compose -f docker-compose.searxng.yml up -d
curl "http://127.0.0.1:8080/search?q=vector+agents&format=json"
```

Add to `.env.local`:

```bash
SEARXNG_BASE_URL=http://127.0.0.1:8080
# SEARXNG_CATEGORIES=general
```

`searchWeb` / `searchNews` try SearXNG first when `SEARXNG_BASE_URL` is set, then fall back to SerpAPI if configured.

Settings live in [`searxng/settings.yml`](../searxng/settings.yml) — `json` is required under `search.formats`.

## Playwright scrape (local only)

```bash
npm i
npx playwright install chromium
```

```bash
PLAYWRIGHT_SCRAPE_ENABLED=true
```

Used only when Firecrawl fails **and** the domain policy sets `useBrowserFallback` (LinkedIn, G2, Capterra). Disabled automatically on Vercel (`VERCEL` set); use Scrape.do `render=true` there instead.

## Playwright MCP (Cursor QA)

[`.cursor/mcp.json`](../.cursor/mcp.json) registers `@playwright/mcp@latest`. Reload Cursor MCP, then use headed browser tools to QA scrape targets or the SearXNG UI. This is **not** imported by the Next.js app.

## Discover → scrape helper

`discoverAndScrape(query, { product, domain, topN })` runs `searchWeb` → `discoverUrls` → parallel `scrapePage`. Used by competitive and win-loss agents for extra page depth.
