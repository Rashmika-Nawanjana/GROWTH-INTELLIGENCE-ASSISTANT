import { getCached, setCache } from '../supabase';
import type { ToolResult, RedditPost } from './types';

// Reddit public JSON API — no key required
const BASE_URL = 'https://www.reddit.com';

function detectSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase();
  const negative = ['terrible', 'awful', 'broken', 'scam', 'hate', 'disappointed', 'worst', 'bad', 'overpriced', 'useless', 'unreliable'];
  const positive = ['love', 'great', 'amazing', 'excellent', 'best', 'fantastic', 'perfect', 'awesome', 'recommend', 'worth'];
  const negScore = negative.filter(w => lower.includes(w)).length;
  const posScore = positive.filter(w => lower.includes(w)).length;
  if (negScore > posScore) return 'negative';
  if (posScore > negScore) return 'positive';
  return 'neutral';
}

export async function searchReddit(
  query: string,
  subreddit?: string
): Promise<ToolResult<RedditPost[]>> {
  const cacheKey = `reddit:${subreddit ?? 'all'}:${query}`;
  const cached = await getCached('reddit', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<RedditPost[]>), cached: true };
  }

  const searchPath = subreddit
    ? `/r/${subreddit}/search.json`
    : '/search.json';

  const url = new URL(`${BASE_URL}${searchPath}`);
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'relevance');
  url.searchParams.set('t', 'year');
  url.searchParams.set('limit', '15');
  if (subreddit) url.searchParams.set('restrict_sr', '1');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'GrowthIntelBot/1.0 (hackathon demo)' },
  });

  if (!res.ok) {
    return {
      data: [],
      source: 'Reddit',
      timestamp: new Date().toISOString(),
      confidence: 0,
      cached: false,
    };
  }

  const raw = await res.json() as any;
  const posts: RedditPost[] = (raw.data?.children ?? [])
    .filter((c: any) => c.kind === 't3')
    .slice(0, 10)
    .map((c: any) => {
      const p = c.data;
      const text = `${p.title} ${p.selftext ?? ''}`;
      return {
        title: p.title,
        subreddit: p.subreddit_name_prefixed,
        score: p.score,
        url: `https://reddit.com${p.permalink}`,
        snippet: p.selftext ? p.selftext.slice(0, 300) : p.title,
        created: new Date(p.created_utc * 1000).toISOString(),
        sentiment: detectSentiment(text),
      };
    });

  const result: ToolResult<RedditPost[]> = {
    data: posts,
    source: 'Reddit',
    sourceUrl: url.toString(),
    timestamp: new Date().toISOString(),
    confidence: 0.75,
    cached: false,
  };

  await setCache('reddit', cacheKey, result);
  return result;
}

export async function searchProductReviews(productName: string): Promise<ToolResult<RedditPost[]>> {
  return searchReddit(`${productName} review OR experience OR pricing OR alternative`);
}

export async function searchSubreddits(
  query: string,
  subreddits: string[]
): Promise<ToolResult<RedditPost[]>> {
  const results = await Promise.allSettled(
    subreddits.map(sr => searchReddit(query, sr))
  );

  const allPosts: RedditPost[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allPosts.push(...r.value.data);
    }
  }

  // Deduplicate and sort by score
  const seen = new Set<string>();
  const unique = allPosts
    .filter(p => {
      if (seen.has(p.url)) return false;
      seen.add(p.url);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  return {
    data: unique,
    source: 'Reddit (multi-subreddit)',
    timestamp: new Date().toISOString(),
    confidence: 0.75,
    cached: false,
  };
}
