import type { GuardrailFinding } from './types';

const EMAIL_RE =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g;

const IBAN_RE =
  /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;

const IP_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;

const JWT_RE =
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

const API_KEY_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, label: 'openai_key' },
  { re: /\bpk-lf-[A-Za-z0-9-]{10,}\b/gi, label: 'langfuse_key' },
  { re: /\bsk-lf-[A-Za-z0-9-]{10,}\b/gi, label: 'langfuse_secret' },
  { re: /\bAIza[0-9A-Za-z_-]{20,}\b/g, label: 'google_api_key' },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/g, label: 'github_token' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: 'slack_token' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi, label: 'bearer_token' },
];

/** Digits that look like a card number (13–19 digits with optional separators). */
const CARD_CANDIDATE_RE =
  /\b(?:\d[ -]*?){13,19}\b/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (Number.isNaN(n)) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export interface PiiResult {
  redactedText: string;
  findings: GuardrailFinding[];
}

function pushFinding(
  findings: GuardrailFinding[],
  label: string,
  count = 1,
): void {
  const existing = findings.find(f => f.label === label);
  if (existing) {
    existing.count = (existing.count ?? 1) + count;
    return;
  }
  findings.push({
    category: 'pii',
    label,
    severity: 'medium',
    count,
  });
}

/**
 * Detect and mask PII / secrets. Returns redacted text; never logs originals.
 */
export function redactPii(text: string): PiiResult {
  if (!text) return { redactedText: text, findings: [] };

  let out = text;
  const findings: GuardrailFinding[] = [];

  out = out.replace(EMAIL_RE, () => {
    pushFinding(findings, 'email');
    return '[REDACTED_EMAIL]';
  });

  out = out.replace(JWT_RE, () => {
    pushFinding(findings, 'jwt');
    return '[REDACTED_JWT]';
  });

  for (const { re, label } of API_KEY_PATTERNS) {
    out = out.replace(re, () => {
      pushFinding(findings, label);
      return '[REDACTED_SECRET]';
    });
  }

  out = out.replace(CARD_CANDIDATE_RE, match => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnValid(digits)) return match;
    pushFinding(findings, 'credit_card');
    return '[REDACTED_CARD]';
  });

  out = out.replace(IBAN_RE, match => {
    // Skip short false positives that look like product codes
    if (match.length < 15) return match;
    pushFinding(findings, 'iban');
    return '[REDACTED_IBAN]';
  });

  out = out.replace(IP_RE, match => {
    // Skip common version-like numbers that aren't IPs in practice is hard;
    // only redact private/link-local and clearly public dotted quads with 4 octets.
    pushFinding(findings, 'ip_address');
    return '[REDACTED_IP]';
  });

  // Phone: only redact when 10+ digits to cut product-ID false positives
  out = out.replace(PHONE_RE, match => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return match;
    // Avoid re-matching already-redacted card digits
    if (match.includes('REDACTED')) return match;
    pushFinding(findings, 'phone');
    return '[REDACTED_PHONE]';
  });

  return { redactedText: out, findings };
}
