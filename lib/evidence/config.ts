import type { IntelligenceDomain } from '@/lib/agents/types';

export function isEvidenceRagEnabled(): boolean {
  return process.env.EVIDENCE_RAG_ENABLED === 'true';
}

export function evidenceRagTopK(): number {
  const raw = parseInt(process.env.EVIDENCE_RAG_TOP_K ?? '8', 10);
  if (!Number.isFinite(raw)) return 8;
  return Math.max(1, Math.min(raw, 20));
}

export function evidenceRagDefaultMaxAgeDays(): number {
  const raw = parseInt(process.env.EVIDENCE_RAG_MAX_AGE_DAYS ?? '30', 10);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(1, Math.min(raw, 365));
}

/** Per-domain staleness ceilings (days). */
export const DOMAIN_MAX_AGE_DAYS: Partial<Record<IntelligenceDomain, number>> = {
  pricing: 3,
  competitive: 7,
  'market-trends': 7,
  positioning: 14,
  adjacent: 14,
  'win-loss': 30,
};

export function maxAgeDaysForDomain(domain?: string): number {
  if (!domain) return evidenceRagDefaultMaxAgeDays();
  const mapped = DOMAIN_MAX_AGE_DAYS[domain as IntelligenceDomain];
  return mapped ?? evidenceRagDefaultMaxAgeDays();
}

export const EVIDENCE_RETRIEVE_TIMEOUT_MS = 1_500;
export const EVIDENCE_INDEX_CONCURRENCY = 3;
export const CHUNK_TARGET_CHARS = 1_200;
export const CHUNK_OVERLAP_CHARS = 150;
export const CHUNK_MIN_CHARS = 200;
export const CHUNKS_PER_DOCUMENT_CAP = 12;
