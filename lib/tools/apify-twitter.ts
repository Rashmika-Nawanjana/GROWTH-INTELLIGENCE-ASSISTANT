import { ApifyClient } from 'apify-client';
import type { ToolResult } from './types';
import { buildToolResult } from './fallback';

export interface ApifyTweet {
  id: string;
  url: string;
  text: string;
  authorHandle?: string;
  createdAt?: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
}

const APIFY_TWITTER_ACTOR_ID = process.env.APIFY_TWITTER_ACTOR_ID ?? '61RPP7dywgiy0JPD0';

function makeClient(): ApifyClient | null {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return null;
  return new ApifyClient({ token });
}

export async function scrapeTwitterX(
  terms: string[],
  options: {
    handles?: string[];
    maxItems?: number;
    sort?: 'Latest' | 'Top';
    language?: string;
  } = {},
): Promise<ToolResult<ApifyTweet[]>> {
  const client = makeClient();
  if (!client) {
    return buildToolResult<ApifyTweet[]>({
      data: [],
      status: 'failed',
      source: 'Apify Twitter/X (missing APIFY_API_TOKEN)',
      sourceUrl: 'https://console.apify.com',
    });
  }

  const searchTerms = terms.map(t => t.trim()).filter(Boolean).slice(0, 6);
  if (!searchTerms.length) {
    return buildToolResult<ApifyTweet[]>({
      data: [],
      status: 'failed',
      source: 'Apify Twitter/X (no search terms)',
      sourceUrl: 'https://console.apify.com',
    });
  }

  try {
    const run = await client.actor(APIFY_TWITTER_ACTOR_ID).call({
      searchTerms,
      twitterHandles: options.handles ?? [],
      maxItems: Math.min(Math.max(options.maxItems ?? 60, 10), 500),
      sort: options.sort ?? 'Latest',
      tweetLanguage: options.language ?? 'en',
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 120 });
    const tweets: ApifyTweet[] = (items ?? [])
      .map((it: any) => {
        const text = (it.fullText ?? it.text ?? '').toString().trim();
        const id = (it.id ?? it.tweetId ?? '').toString();
        const url = (it.url ?? '').toString();
        if (!text || !id || !url) return null;
        return {
          id,
          url,
          text,
          authorHandle: it.author?.userName ?? it.author?.username ?? it.author?.name,
          createdAt: it.createdAt ?? it.created_at,
          likeCount: typeof it.likeCount === 'number' ? it.likeCount : undefined,
          retweetCount: typeof it.retweetCount === 'number' ? it.retweetCount : undefined,
          replyCount: typeof it.replyCount === 'number' ? it.replyCount : undefined,
        } as ApifyTweet;
      })
      .filter((x): x is ApifyTweet => Boolean(x))
      .slice(0, 40);

    return buildToolResult<ApifyTweet[]>({
      data: tweets,
      status: tweets.length > 0 ? 'ok' : 'failed',
      source: 'Apify Twitter/X Scraper',
      sourceUrl: `https://console.apify.com/actors/${APIFY_TWITTER_ACTOR_ID}`,
    });
  } catch {
    return buildToolResult<ApifyTweet[]>({
      data: [],
      status: 'failed',
      source: 'Apify Twitter/X Scraper (failed)',
      sourceUrl: `https://console.apify.com/actors/${APIFY_TWITTER_ACTOR_ID}`,
    });
  }
}

