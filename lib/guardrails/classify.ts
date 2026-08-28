import type { GuardrailFinding, RiskLevel } from './types';

export interface ClassifyResult {
  risk: RiskLevel;
  /** Weak but non-zero signals — escalate to LLM judge. */
  ambiguous: boolean;
}

const SEVERITY_RANK: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Combine findings into a risk level.
 * Ambiguous when there is exactly one medium finding and no high findings.
 */
export function classifyFindings(findings: GuardrailFinding[]): ClassifyResult {
  if (findings.length === 0) {
    return { risk: 'low', ambiguous: false };
  }

  let max: RiskLevel = 'low';
  let highCount = 0;
  let mediumCount = 0;

  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max]) {
      max = f.severity;
    }
    if (f.severity === 'high') highCount += 1;
    if (f.severity === 'medium') mediumCount += 1;
  }

  if (highCount >= 1) {
    return { risk: 'high', ambiguous: false };
  }

  if (mediumCount >= 2) {
    return { risk: 'medium', ambiguous: false };
  }

  if (mediumCount === 1) {
    return { risk: 'medium', ambiguous: true };
  }

  return { risk: max, ambiguous: false };
}
