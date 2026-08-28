import dns from 'node:dns/promises';
import net from 'node:net';
import type { GuardrailFinding } from './types';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
]);

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.lan'];

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (normalized.startsWith('fe80')) return true; // link-local
  return false;
}

export class UnsafeUrlError extends Error {
  readonly findings: GuardrailFinding[];

  constructor(message: string, findings: GuardrailFinding[]) {
    super(message);
    this.name = 'UnsafeUrlError';
    this.findings = findings;
  }
}

/**
 * Reject non-http(s), localhost, private ranges, metadata endpoints,
 * and DNS-rebinding to private IPs. Call before any outbound scrape/fetch.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  const findings: GuardrailFinding[] = [];

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    findings.push({ category: 'ssrf', label: 'invalid_url', severity: 'high' });
    throw new UnsafeUrlError('Invalid URL', findings);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    findings.push({ category: 'ssrf', label: 'bad_scheme', severity: 'high' });
    throw new UnsafeUrlError('Only http(s) URLs are allowed', findings);
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(host)) {
    findings.push({ category: 'ssrf', label: 'blocked_host', severity: 'high' });
    throw new UnsafeUrlError('Host is not allowed', findings);
  }

  if (BLOCKED_SUFFIXES.some(s => host.endsWith(s))) {
    findings.push({ category: 'ssrf', label: 'blocked_suffix', severity: 'high' });
    throw new UnsafeUrlError('Host is not allowed', findings);
  }

  // Literal IP in hostname
  if (net.isIP(host)) {
    if (
      (net.isIPv4(host) && isPrivateIpv4(host)) ||
      (net.isIPv6(host) && isPrivateIpv6(host))
    ) {
      findings.push({ category: 'ssrf', label: 'private_ip', severity: 'high' });
      throw new UnsafeUrlError('Private or link-local addresses are not allowed', findings);
    }
    if (host === '169.254.169.254') {
      findings.push({ category: 'ssrf', label: 'metadata_ip', severity: 'high' });
      throw new UnsafeUrlError('Metadata endpoint is not allowed', findings);
    }
    return;
  }

  // Resolve DNS and reject private answers (DNS rebinding)
  try {
    const records = await dns.lookup(host, { all: true });
    for (const rec of records) {
      const addr = rec.address;
      if (
        (net.isIPv4(addr) && isPrivateIpv4(addr)) ||
        (net.isIPv6(addr) && isPrivateIpv6(addr))
      ) {
        findings.push({ category: 'ssrf', label: 'dns_private', severity: 'high' });
        throw new UnsafeUrlError('Host resolves to a private address', findings);
      }
    }
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    // DNS failure — fail closed for scrape safety
    findings.push({ category: 'ssrf', label: 'dns_failure', severity: 'medium' });
    throw new UnsafeUrlError('Unable to resolve host', findings);
  }
}

/** Sync-ish hostname check without DNS (for tests / pre-filters). */
export function isClearlyUnsafeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.has(host)) return true;
    if (BLOCKED_SUFFIXES.some(s => host.endsWith(s))) return true;
    if (net.isIP(host)) {
      if (net.isIPv4(host) && isPrivateIpv4(host)) return true;
      if (net.isIPv6(host) && isPrivateIpv6(host)) return true;
    }
    return false;
  } catch {
    return true;
  }
}
