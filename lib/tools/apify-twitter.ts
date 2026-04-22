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

let loggedMissingApifyToken = false;

/** Product/competitor names are not X handles; only pass valid bare handles to Apify. */
function sanitizeHandleCandidates(candidates: string[] | undefined): string[] {
  if (!candidates?.length) return [];
  const out: string[] = [];
  for (const raw of candidates) {
    const t = (raw ?? '').trim();
    if (!t) continue;
    if (/[:\s/]/.test(t)) continue;
    const bare = t.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(bare)) continue;
    out.push(bare);
  }
  return [...new Set(out)].slice(0, 4);
}

function getRunWaitSecs(): number {
  const raw = parseInt(process.env.APIFY_MAX_WAIT_SECS ?? '95', 10);
  if (!Number.isFinite(raw)) return 95;
  return Math.max(15, Math.min(300, raw));
}

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
    if (!loggedMissingApifyToken) {
      loggedMissingApifyToken = true;
      // High-signal line for Vercel logs — without APIFY_API_TOKEN the client never calls Apify (zero usage in console).
      console.warn('[apify] APIFY_API_TOKEN is not set; Twitter/X Apify runs are skipped.');
    }
    return buildToolResult<ApifyTweet[]>({
      data: [],
      status: 'failed',
      source: 'Apify Twitter/X (missing APIFY_API_TOKEN — set in Vercel / .env to record usage)',
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

  const twitterHandles = sanitizeHandleCandidates(options.handles);
  const maxItems = Math.min(Math.max(options.maxItems ?? 60, 10), 500);
  const waitSecs = getRunWaitSecs();
  const input = {
    searchTerms,
    twitterHandles,
    maxItems,
    sort: options.sort ?? 'Latest',
    tweetLanguage: options.language ?? 'en',
  };

  try {
    const run = await client.actor(APIFY_TWITTER_ACTOR_ID).call(input, { waitSecs });

    if (!run?.id) {
      throw new Error('Apify run returned no run id');
    }
    if (!run.defaultDatasetId) {
      const st = run.status != null ? String(run.status) : 'unknown';
      throw new Error(`Apify run ${run.id} has no defaultDatasetId (status: ${st})`);
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 120 });
    const tweets: ApifyTweet[] = (items ?? [])
      .map((it: any) => {
        const text = (
          it.fullText
          ?? it.text
          ?? it.full_text
          ?? (typeof it.legacy === 'object' && it.legacy ? it.legacy.full_text : undefined)
          ?? it.content
          ?? ''
        ).toString().trim();
        const id = (it.id ?? it.tweetId ?? it.id_str ?? it.rest_id ?? '').toString();
        const url = (it.url ?? it.tweetUrl ?? (id ? `https://x.com/i/web/status/${id}` : '')).toString();
        if (!text || !id) return null;
        return {
          id,
          url: url || `https://x.com/i/web/status/${id}`,
          text,
          authorHandle: it.author?.userName ?? it.author?.username ?? it.user?.screen_name ?? it.author?.name,
          createdAt: it.createdAt ?? it.created_at,
          likeCount: typeof it.likeCount === 'number' ? it.likeCount : undefined,
          retweetCount: typeof it.retweetCount === 'number' ? it.retweetCount : undefined,
          replyCount: typeof it.replyCount === 'number' ? it.replyCount : undefined,
        } as ApifyTweet;
      })
      .filter((x): x is ApifyTweet => Boolean(x))
      .slice(0, 40);

    const runLabel = `run ${run.id}`;
    return buildToolResult<ApifyTweet[]>({
      data: tweets,
      status: tweets.length > 0 ? 'ok' : 'failed',
      source: tweets.length > 0
        ? `Apify Twitter/X Scraper (${runLabel}, ${tweets.length} items)`
        : `Apify Twitter/X Scraper (${runLabel}, 0 items — check run log in Apify console)`,
      sourceUrl: `https://console.apify.com/actors/${APIFY_TWITTER_ACTOR_ID}/runs/${run.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[apify] actor call or dataset read failed:', message);
    return buildToolResult<ApifyTweet[]>({
      data: [],
      status: 'failed',
      source: `Apify Twitter/X error: ${message.slice(0, 200)}`,
      sourceUrl: `https://console.apify.com/actors/${APIFY_TWITTER_ACTOR_ID}`,
    });
  }
}

