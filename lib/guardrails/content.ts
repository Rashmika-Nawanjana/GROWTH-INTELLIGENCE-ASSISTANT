import type { GuardrailFinding, RiskLevel } from './types';

interface ContentRule {
  re: RegExp;
  label: string;
  severity: RiskLevel;
}

const RULES: ContentRule[] = [
  {
    re: /\b(steal|harvest|phish|scrape)\s+.{0,40}\b(credentials?|passwords?|api\s*keys?|tokens?|ssn|social\s*security)\b/i,
    label: 'credential_theft',
    severity: 'high',
  },
  {
    re: /\b(credential\s+stuffing|password\s+spraying|brute[\s-]?force\s+login)\b/i,
    label: 'credential_theft',
    severity: 'high',
  },
  {
    re: /\b(doxx?|swat|harass|stalk)\s+.{0,40}\b(person|employee|founder|ceo|customer)\b/i,
    label: 'targeted_harassment',
    severity: 'high',
  },
  {
    re: /\b(scrape|collect|buy)\s+.{0,40}\b(personal\s+data|pii|emails?\s+list|phone\s+numbers?\s+list|leads?\s+database)\b.{0,30}\b(without\s+consent|illegally|dark\s*web)\b/i,
    label: 'illegal_data_acquisition',
    severity: 'high',
  },
  {
    re: /\b(mass[\s-]?scrape|bulk[\s-]?harvest)\s+.{0,30}\b(linkedin|gmail|outlook|personal\s+emails?)\b/i,
    label: 'personal_data_scraping',
    severity: 'medium',
  },
  {
    re: /\b(write|craft|generate)\s+.{0,40}\b(phishing|spear[\s-]?phish|malware|ransomware)\b/i,
    label: 'malicious_content_request',
    severity: 'high',
  },
];

export function detectMaliciousContent(text: string): GuardrailFinding[] {
  if (!text) return [];
  const findings: GuardrailFinding[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    if (rule.re.test(text)) {
      if (seen.has(rule.label)) continue;
      seen.add(rule.label);
      findings.push({
        category: 'malicious_content',
        label: rule.label,
        severity: rule.severity,
      });
    }
  }

  return findings;
}
