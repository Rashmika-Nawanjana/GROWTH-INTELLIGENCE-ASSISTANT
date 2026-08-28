import type { GuardrailFinding } from './types';

/**
 * Output-side ethical / legal / brand-safety heuristics.
 * Returns a safety score in [0, 1] (1 = safest).
 */
export function scorePolicies(text: string): {
  score: number;
  findings: GuardrailFinding[];
} {
  if (!text) return { score: 1, findings: [] };

  const findings: GuardrailFinding[] = [];
  let penalty = 0;

  const checks: Array<{ re: RegExp; label: string; weight: number }> = [
    {
      re: /\b(phishing|credential\s+harvest|malware|ransomware)\b/i,
      label: 'harmful_advice',
      weight: 0.4,
    },
    {
      re: /\b(guaranteed\s+returns?|get[\s-]?rich[\s-]?quick|ponzi)\b/i,
      label: 'financial_misconduct',
      weight: 0.25,
    },
    {
      re: /\b(discriminat(e|ion)|hate\s+speech)\b.{0,40}\b(race|religion|gender|ethnicity)\b/i,
      label: 'ethics_violation',
      weight: 0.35,
    },
    {
      re: /\b(ignore\s+privacy\s+laws?|bypass\s+gdpr|illegal\s+scraping)\b/i,
      label: 'legal_noncompliance',
      weight: 0.4,
    },
  ];

  for (const c of checks) {
    if (c.re.test(text)) {
      findings.push({
        category: 'policy',
        label: c.label,
        severity: c.weight >= 0.35 ? 'high' : 'medium',
      });
      penalty += c.weight;
    }
  }

  const score = Math.max(0, Math.min(1, 1 - penalty));
  return { score, findings };
}
