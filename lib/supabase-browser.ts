import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Singleton browser client.
 *
 * auth.lock no-op: @supabase/auth-js uses navigator.locks; in Next.js Strict Mode
 * (mount→unmount→remount) + many parallel getUser() calls (workspace CRUD), that
 * lock can be orphaned/stolen and surfaces as:
 *   AbortError: Lock broken by another request with the 'steal' option.
 * A process-local lock is enough for a single-tab SPA.
 */
let client: SupabaseClient | undefined;

export function createClient() {
  if (client) return client;

  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        lock: async (_name, _acquireTimeout, fn) => fn(),
      },
    },
  );

  return client;
}
