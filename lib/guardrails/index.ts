import { redactPii } from './pii';
import { detectInjection } from './injection';
import { detectMaliciousContent } from './content';
import { classifyFindings } from './classify';
import { llmJudgeSafety } from './llm-judge';
import { fenceUntrusted } from './untrusted';
import { guardOutput } from './output-guard';
import { assertSafeUrl, isClearlyUnsafeUrl, UnsafeUrlError } from './url-policy';
import {
  DEFAULT_CONSTRAINTS,
  MEDIUM_CONSTRAINTS,
  type GuardrailConstraints,
  type GuardrailFinding,
  type GuardrailVerdict,
  type OutputGuardResult,
  type RiskLevel,
} from './types';

export type {
  GuardrailConstraints,
  GuardrailFinding,
  GuardrailVerdict,
  OutputGuardResult,
  RiskLevel,
};

export {
  fenceUntrusted,
  guardOutput,
  assertSafeUrl,
  isClearlyUnsafeUrl,
  UnsafeUrlError,
  DEFAULT_CONSTRAINTS,
  MEDIUM_CONSTRAINTS,
};

export { CONSERVATIVE_PREAMBLE } from './types';
export { redactPii } from './pii';
export { detectInjection } from './injection';
export { detectMaliciousContent } from './content';
export { scorePolicies } from './policies';
export {
  enforceUserQuotas,
  logGuardrailEvent,
  checkRouteRateLimit,
  checkDailySpendCap,
} from './rate-limit';

export interface GuardInputOptions {
  /** Skip LLM judge even when ambiguous (tests / offline). */
  skipJudge?: boolean;
}

/**
 * Input gate: PII redact → injection/content detection → risk classify
 * → optional LLM judge → block or constrain.
 */
export async function guardInput(
  text: string,
  options: GuardInputOptions = {},
): Promise<GuardrailVerdict> {
  const pii = redactPii(text ?? '');
  const findings: GuardrailFinding[] = [
    ...pii.findings,
    ...detectInjection(pii.redactedText),
    ...detectMaliciousContent(pii.redactedText),
  ];

  let { risk, ambiguous } = classifyFindings(findings);
  let judged = false;
  let reason: string | undefined;

  if (ambiguous && !options.skipJudge && risk !== 'high') {
    const judge = await llmJudgeSafety(
      pii.redactedText,
      findings.map(f => f.label),
    );
    risk = judge.risk;
    reason = judge.reason;
    judged = true;
  }

  const blocked = risk === 'high';
  const constraints: GuardrailConstraints =
    risk === 'medium' || blocked ? { ...MEDIUM_CONSTRAINTS } : { ...DEFAULT_CONSTRAINTS };

  return {
    risk,
    findings,
    redactedText: pii.redactedText,
    blocked,
    constraints,
    judged,
    reason,
  };
}
