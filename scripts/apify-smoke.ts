/**
 * One-off: `npx tsx --env-file .env.local scripts/apify-smoke.ts`
 * Verifies Apify actor + dataset read. Requires APIFY_API_TOKEN in env.
 */
import { scrapeTwitterX } from '../lib/tools/apify-twitter';

void (async () => {
  const r = await scrapeTwitterX(['openai product launch'], { maxItems: 5 });
  console.log('status', r.status);
  console.log('tweetCount', r.data?.length ?? 0);
  console.log('source', r.source);
  if (r.data?.[0]) {
    console.log('sample', (r.data[0].text || '').slice(0, 120));
  }
  process.exit(r.status === 'ok' && (r.data?.length ?? 0) > 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
