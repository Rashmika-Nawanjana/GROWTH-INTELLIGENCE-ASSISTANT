import { getCached, setCache } from '../supabase';
import type { ToolResult, HNPost } from './types';

// HN Algolia API — no key required
const BASE_URL = 'https://hn.algolia.com/api/v1';

export async function searchHN(query: string, type: 'story' | 'comment' = 'story'): Promise<ToolResult<HNPost[]>> {
  const cacheKey = `hn:${type}:${query}`;
  const cached = await getCached('hn', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<HNPost[]>), cached: true };
  }

  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set('query', query);
  url.searchParams.set('tags', type);
  url.searchParams.set('hitsPerPage', '15');
  // Last 12 months
  const since = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
  url.searchParams.set('numericFilters', `created_at_i>${since}`);

  const res = await fetch(url.toString());
  if (!res.ok) {
    return {
      data: [],
      source: 'Hacker News (failed)',
      sourceUrl: url.toString(),
      timestamp: new Date().toISOString(),
      confidence: 0,
      cached: false,
    };
  }

  const raw = await res.json() as any;
  const posts: HNPost[] = (raw.hits ?? [])
    .slice(0, 10)
    .map((h: any) => ({
      title: h.title ?? h.story_title ?? h.comment_text?.slice(0, 100) ?? '',
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      score: h.points ?? 0,
      author: h.author ?? 'unknown',
      created: h.created_at,
      commentCount: h.num_comments ?? 0,
    }));

  const result: ToolResult<HNPost[]> = {
    data: posts,
    source: 'Hacker News (Algolia)',
    sourceUrl: `https://hn.algolia.com/?query=${encodeURIComponent(query)}`,
    timestamp: new Date().toISOString(),
    confidence: 0.8,
    cached: false,
  };

  await setCache('hn', cacheKey, result);
  return result;
}

export async function searchHNComments(query: string): Promise<ToolResult<HNPost[]>> {
  return searchHN(query, 'comment');
}

export async function getTechSentiment(topic: string): Promise<{
  hnResult: ToolResult<HNPost[]>;
  topicScore: number;
  summary: string;
}> {
  const hnResult = await searchHN(topic);
  const posts = hnResult.data;

  if (posts.length === 0) {
    return { hnResult, topicScore: 0, summary: 'No HN mentions found.' };
  }

  const avgScore = posts.reduce((sum, p) => sum + p.score, 0) / posts.length;
  const totalComments = posts.reduce((sum, p) => sum + p.commentCount, 0);
  const topicScore = Math.min(100, Math.round((avgScore / 10 + totalComments / 50) * 10));

  const summary = `Found ${posts.length} HN posts about "${topic}" in the last 12 months. ` +
    `Average score: ${Math.round(avgScore)}, total comments: ${totalComments}. ` +
    `Tech community interest level: ${topicScore}/100.`;

  return { hnResult, topicScore, summary };
}
