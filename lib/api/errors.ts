import { randomUUID } from 'node:crypto';

/**
 * Sanitize errors before returning them to clients.
 * Logs full detail server-side; client gets a generic message + correlation id.
 */
export function toPublicError(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): { message: string; correlationId: string; status: number } {
  const correlationId = randomUUID();
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[api-error ${correlationId}]`, detail);

  // Preserve intentional auth / validation statuses via Error name or cause
  let status = 500;
  if (err && typeof err === 'object' && 'status' in err) {
    const s = Number((err as { status?: number }).status);
    if (Number.isFinite(s) && s >= 400 && s < 600) status = s;
  }

  return {
    message: status === 500 ? `${fallback} (ref: ${correlationId.slice(0, 8)})` : detail,
    correlationId,
    status,
  };
}

export function publicJsonError(
  err: unknown,
  fallback?: string,
): Response {
  const { message, status } = toPublicError(err, fallback);
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Safe relative path for post-auth redirects — blocks open redirects. */
export function safeRedirectPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  // Must be a single-slash relative path (not //evil.com, not https://...)
  if (!/^\/(?!\/)/.test(next)) return fallback;
  if (next.includes('\\') || next.includes('\0')) return fallback;
  return next;
}
