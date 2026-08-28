import { redactPii } from './pii';
import { detectInjection } from './injection';
import { scorePolicies } from './policies';
import type { GuardrailFinding, OutputGuardResult } from './types';

/**
 * Scan generated output for leaked PII/secrets, echoed injection payloads,
 * and policy violations. Returns redacted text + safety score.
 */
export function guardOutput(text: string): OutputGuardResult {
  if (!text) {
    return { safeText: text, findings: [], safetyScore: 1, redacted: false };
  }

  const findings: GuardrailFinding[] = [];

  const pii = redactPii(text);
  findings.push(...pii.findings);

  const injection = detectInjection(text);
  // Injection phrases in *output* are suspicious echoes — treat as leaks
  for (const f of injection) {
    findings.push({
      category: 'output_leak',
      label: `echoed_${f.label}`,
      severity: f.severity,
    });
  }

  const policy = scorePolicies(pii.redactedText);
  findings.push(...policy.findings);

  // Start from policy score, then penalize for PII / echoed injection
  let score = policy.score;
  if (pii.findings.length > 0) score = Math.min(score, 0.7);
  if (injection.some(f => f.severity === 'high')) score = Math.min(score, 0.4);

  return {
    safeText: pii.redactedText,
    findings,
    safetyScore: Math.max(0, Math.min(1, score)),
    redacted: pii.redactedText !== text,
  };
}
