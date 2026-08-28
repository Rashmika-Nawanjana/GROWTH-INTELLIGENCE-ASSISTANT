import type { GuardrailFinding, RiskLevel } from './types';

interface InjectionRule {
  re: RegExp;
  label: string;
  severity: RiskLevel;
}

const RULES: InjectionRule[] = [
  {
    re: /\bignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)\b/i,
    label: 'instruction_override',
    severity: 'high',
  },
  {
    re: /\bdisregard\s+(all\s+)?(previous|prior|system)\s+(instructions?|prompts?)\b/i,
    label: 'instruction_override',
    severity: 'high',
  },
  {
    re: /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as)\b.{0,40}\b(system|admin|root|developer|jailbreak)\b/i,
    label: 'role_hijack',
    severity: 'high',
  },
  {
    re: /\b(repeat|reveal|print|show|dump)\s+(your\s+)?(system\s+)?(prompt|instructions?|rules?)\b/i,
    label: 'prompt_exfiltration',
    severity: 'high',
  },
  {
    re: /\b(send|post|exfiltrate|upload)\s+.{0,60}\b(https?:\/\/|webhook)\b/i,
    label: 'data_exfiltration',
    severity: 'high',
  },
  {
    re: /!\[[^\]]*\]\(\s*https?:\/\/[^)]+\)/i,
    label: 'markdown_image_beacon',
    severity: 'medium',
  },
  {
    re: /```\s*(system|assistant)\b/i,
    label: 'delimiter_breakout',
    severity: 'medium',
  },
  {
    re: /<\/?(?:system|instructions?|prompt|untrusted_data)\b/i,
    label: 'delimiter_breakout',
    severity: 'medium',
  },
  {
    re: /\bDAN\b.{0,20}\b(mode|jailbreak)\b|\bjailbreak\b/i,
    label: 'jailbreak',
    severity: 'high',
  },
  {
    re: /\b(new\s+system\s+prompt|override\s+safety|disable\s+guardrails?)\b/i,
    label: 'safety_bypass',
    severity: 'high',
  },
];

/** Long base64-looking blobs that may hide encoded instructions. */
const BASE64_BLOB_RE = /(?:[A-Za-z0-9+/]{60,}={0,2})/g;

export function detectInjection(text: string): GuardrailFinding[] {
  if (!text) return [];
  const findings: GuardrailFinding[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    if (rule.re.test(text)) {
      if (seen.has(rule.label)) continue;
      seen.add(rule.label);
      findings.push({
        category: 'injection',
        label: rule.label,
        severity: rule.severity,
      });
    }
  }

  const blobs = text.match(BASE64_BLOB_RE);
  if (blobs && blobs.length >= 2) {
    findings.push({
      category: 'injection',
      label: 'encoded_blob',
      severity: 'medium',
      count: blobs.length,
    });
  }

  return findings;
}
