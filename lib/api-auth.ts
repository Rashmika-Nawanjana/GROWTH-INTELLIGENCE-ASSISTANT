/** Attach Supabase access token for Python FastAPI auth. */
import { createClient } from '@/lib/supabase-browser';

export async function apiAuthHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // unauthenticated — backend will 401
  }
  return headers;
}
