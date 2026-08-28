import type { SupabaseClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/embeddings';
import type { IntelligenceDomain } from '@/lib/agents/types';
import {
  EVIDENCE_RETRIEVE_TIMEOUT_MS,
  evidenceRagDefaultMaxAgeDays,
  evidenceRagTopK,
  isEvidenceRagEnabled,
  maxAgeDaysForDomain,
} from './config';
import type { EvidenceRetrieveResult, RetrievedEvidenceHit } from './types';

export interface RetrieveEvidenceInput {
  userId: string;
  query: string;
  product?: string;
  domain?: IntelligenceDomain | string;
  maxAgeDays?: number;
  matchCount?: number;
}

function normalizeProduct(product?: string): string | null {
  const p = product?.trim();
  if (!p || p === 'the product') return null;
  return p;
}

function buildEvidenceContextBlock(hits: RetrievedEvidenceHit[]): string {
  if (!hits.length) return '';
  const lines = hits.map(h => {
    const ageLabel =
      h.ageDays === 0
        ? 'today'
        : h.ageDays === 1
          ? '1 day ago'
          : `${h.ageDays} days ago`;
    const title = h.title || h.url;
    return `- [${title}](${h.url}) (${h.sourceTool}, fetched ${ageLabel}): ${h.content.slice(0, 400)}`;
  });
  return [
    '[PRIOR VERIFIED EVIDENCE — context only, not fresh verification]',
    'Use these snippets to avoid redundant research. Still run live tools for time-sensitive claims.',
    ...lines,
  ].join('\n');
}

function mapRpcRow(row: Record<string, unknown>): RetrievedEvidenceHit {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    kind: row.kind === 'fact' ? 'fact' : 'page',
    content: String(row.content ?? ''),
    similarity: Number(row.similarity ?? 0),
    url: String(row.url ?? ''),
    title: row.title ? String(row.title) : undefined,
    sourceTool: String(row.source_tool ?? ''),
    domain: row.domain ? String(row.domain) : undefined,
    product: row.product ? String(row.product) : undefined,
    fetchedAt: String(row.fetched_at ?? new Date().toISOString()),
    ageDays: Number(row.age_days ?? 0),
  };
}

export async function retrieveEvidence(
  supabase: SupabaseClient,
  input: RetrieveEvidenceInput,
): Promise<EvidenceRetrieveResult> {
  const empty: EvidenceRetrieveResult = { hits: [], contextBlock: '' };
  if (!isEvidenceRagEnabled()) return empty;
  if (!input.userId || !input.query?.trim()) return empty;

  const embedding = await embedText(input.query);
  if (!embedding) return empty;

  const maxAge =
    input.maxAgeDays ??
    (input.domain ? maxAgeDaysForDomain(input.domain) : evidenceRagDefaultMaxAgeDays());

  const { data, error } = await supabase.rpc('match_evidence_chunks', {
    p_user_id: input.userId,
    p_query_embedding: embedding as unknown as string,
    p_match_count: input.matchCount ?? evidenceRagTopK(),
    p_product: normalizeProduct(input.product),
    p_domain: input.domain ?? null,
    p_max_age_days: maxAge,
  });

  if (error) {
    console.error('[evidence retrieve]', error.message);
    return empty;
  }

  const hits = (data ?? []).map((row: Record<string, unknown>) => mapRpcRow(row));
  return {
    hits,
    contextBlock: buildEvidenceContextBlock(hits),
  };
}

export async function retrieveEvidenceWithTimeout(
  supabase: SupabaseClient,
  input: RetrieveEvidenceInput,
  timeoutMs = EVIDENCE_RETRIEVE_TIMEOUT_MS,
): Promise<EvidenceRetrieveResult> {
  const empty: EvidenceRetrieveResult = { hits: [], contextBlock: '' };
  if (!isEvidenceRagEnabled()) return empty;

  try {
    return await Promise.race([
      retrieveEvidence(supabase, input),
      new Promise<EvidenceRetrieveResult>((_, reject) => {
        setTimeout(() => reject(new Error('evidence retrieve timeout')), timeoutMs);
      }),
    ]);
  } catch {
    return empty;
  }
}

export function filterHitsForDomain(
  hits: RetrievedEvidenceHit[],
  domain: IntelligenceDomain,
): RetrievedEvidenceHit[] {
  const filtered = hits.filter(h => !h.domain || h.domain === domain);
  return filtered.length > 0 ? filtered : hits.slice(0, 3);
}

export function buildDomainEvidenceBlock(
  hits: RetrievedEvidenceHit[],
  domain: IntelligenceDomain,
): string {
  return buildEvidenceContextBlock(filterHitsForDomain(hits, domain));
}
