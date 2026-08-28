/**
 * Evidence sufficiency gate — decides when an agent should report
 * INSUFFICIENT EVIDENCE instead of filling with unrelated material.
 */

import type {
  EvidenceAssessment,
  EvidenceCandidate,
  EvidenceStatus,
  GeographyContext,
} from './types';

export type { EvidenceAssessment, EvidenceCandidate, EvidenceStatus };

export interface AssessEvidenceInput {
  relevantSourceCount: number;
  searchedFor: string[];
  domain: string;
  geography?: GeographyContext;
  category?: string;
  candidates?: EvidenceCandidate[];
  /** Extra gap notes from the agent (e.g. "no pricing pages scraped"). */
  extraGaps?: string[];
}

/**
 * Thresholds:
 * - insufficient: 0–1 relevant sources
 * - thin: 2–3
 * - sufficient: 4+
 */
export function assessEvidence(input: AssessEvidenceInput): EvidenceAssessment {
  const count = Math.max(0, input.relevantSourceCount);
  let status: EvidenceStatus;
  if (count <= 1) status = 'insufficient';
  else if (count <= 3) status = 'thin';
  else status = 'sufficient';

  const gaps: string[] = [...(input.extraGaps ?? [])];
  const geo = input.geography?.name;
  const cat = input.category;

  if (status === 'insufficient') {
    if (geo) {
      gaps.push(
        `No verified ${input.domain} evidence found for ${geo}${cat ? ` / ${cat}` : ''}.`,
      );
    } else {
      gaps.push(`Insufficient ${input.domain} evidence in retrieved sources.`);
    }
  } else if (status === 'thin') {
    gaps.push(
      `Only ${count} relevant source(s) for ${input.domain}${geo ? ` in ${geo}` : ''} — treat conclusions as provisional.`,
    );
  }

  return {
    status,
    relevantSourceCount: count,
    searchedFor: input.searchedFor.filter(Boolean),
    gaps,
    candidates: input.candidates?.length ? input.candidates : undefined,
  };
}

/**
 * When the LLM (or pipeline) flags insufficientEvidence, force low confidence
 * and empty structured arrays should already be empty from the prompt.
 */
export function applyInsufficientGate(
  parsed: Record<string, unknown>,
  assessment: EvidenceAssessment,
): { confidenceScore: number; insufficient: boolean } {
  const llmFlag = parsed.insufficientEvidence === true;
  const insufficient =
    llmFlag || assessment.status === 'insufficient';

  if (insufficient) {
    return {
      confidenceScore: Math.min(
        typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.35,
        0.35,
      ),
      insufficient: true,
    };
  }

  if (assessment.status === 'thin') {
    const raw =
      typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.55;
    return { confidenceScore: Math.min(raw, 0.55), insufficient: false };
  }

  return {
    confidenceScore:
      typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6,
    insufficient: false,
  };
}

/** Prompt fragment shared by all research agents. */
export function evidencePromptRules(geography?: GeographyContext, category?: string): string {
  const scope = [
    geography ? `geography: ${geography.name}` : null,
    category ? `category: ${category}` : null,
  ]
    .filter(Boolean)
    .join('; ');

  return `
Evidence rules (CRITICAL):
- Only use claims backed by the Raw signals below. Never invent local competitors or pricing.
- If signals do not contain evidence for your domain${scope ? ` (${scope})` : ''}, set "insufficientEvidence": true, empty facts/interpretation arrays (or minimal gap notes), and do NOT substitute generic industry stats, G2 category pages, or unrelated vendor pricing (Figma, Salesforce, etc.).
- Prefer naming specific local companies, government programs, or research projects when present.
`;
}
