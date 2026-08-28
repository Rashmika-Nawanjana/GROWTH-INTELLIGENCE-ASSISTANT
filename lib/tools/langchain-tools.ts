/**
 * Optional LangChain tool() wrappers around existing lib/tools implementations.
 * Does not change Firecrawl/SerpAPI/Reddit behavior — thin adapters for future
 * LangGraph ToolNode usage. Agents today still call lib/tools directly.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchWeb, searchNews } from './serpapi';
import { scrapePage } from './firecrawl';
import { searchReddit } from './reddit';
import { searchHN } from './hn-algolia';

export const searchWebTool = tool(
  async ({ query }) => {
    const result = await searchWeb(query);
    return JSON.stringify({
      status: result.status ?? 'ok',
      items: result.data.slice(0, 5).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
    });
  },
  {
    name: 'search_web',
    description: 'Search the live web via SearXNG (if configured) or SerpAPI for market and competitive signals.',
    schema: z.object({ query: z.string().describe('Search query') }),
  },
);

export const searchNewsTool = tool(
  async ({ query }) => {
    const result = await searchNews(query);
    return JSON.stringify({
      status: result.status ?? 'ok',
      items: result.data.slice(0, 5).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
    });
  },
  {
    name: 'search_news',
    description: 'Search recent news via SearXNG (news category) or SerpAPI.',
    schema: z.object({ query: z.string() }),
  },
);

export const scrapePageTool = tool(
  async ({ url }) => {
    const result = await scrapePage(url);
    return JSON.stringify({
      status: result.status ?? 'ok',
      title: result.data?.title,
      excerpt: result.data?.excerpt?.slice(0, 2000),
      url: result.data?.url ?? url,
    });
  },
  {
    name: 'scrape_page',
    description: 'Scrape a URL to LLM-ready markdown via Firecrawl (with fallbacks).',
    schema: z.object({ url: z.string().url() }),
  },
);

export const searchRedditTool = tool(
  async ({ query }) => {
    const result = await searchReddit(query);
    return JSON.stringify({
      status: result.status ?? 'ok',
      items: result.data.slice(0, 5).map(p => ({
        title: p.title,
        url: p.url,
        subreddit: p.subreddit,
        score: p.score,
      })),
    });
  },
  {
    name: 'search_reddit',
    description: 'Search Reddit public JSON (auto-falls back to HN when empty/blocked).',
    schema: z.object({ query: z.string() }),
  },
);

export const searchHnTool = tool(
  async ({ query }) => {
    const result = await searchHN(query);
    return JSON.stringify({
      status: result.status ?? 'ok',
      items: result.data.slice(0, 5).map(p => ({
        title: p.title,
        url: p.url,
        score: p.score,
      })),
    });
  },
  {
    name: 'search_hn',
    description: 'Search Hacker News via Algolia.',
    schema: z.object({ query: z.string() }),
  },
);

/** Bundle for future ToolNode / agent binding experiments. */
export const liveSignalTools = [
  searchWebTool,
  searchNewsTool,
  scrapePageTool,
  searchRedditTool,
  searchHnTool,
];
