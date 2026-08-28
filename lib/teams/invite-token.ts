import { createHash, randomBytes } from 'crypto';

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function inviteUrl(token: string, origin?: string): string {
  const base = origin ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/invite/${encodeURIComponent(token)}`;
}
