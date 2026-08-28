import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentOutput } from '@/lib/agents/types';
import { embedText } from '@/lib/embeddings';
import { getCached } from '@/lib/supabase';
import type { ScrapedPage, ToolResult } from '@/lib/tools/types';
import { chunkAgentFacts, chunkPageMarkdown } from './chunker';
import { EVIDENCE_INDEX_CONCURRENCY, isEvidenceRagEnabled } from './config';
import type { EvidenceDocumentDraft, IndexRunEvidenceInput } from './types';

function normalizeProduct(product?: string): string | undefined {
  const p = product?.trim();
  if (!p || p === 'the product') return undefined;
  return p.toLowerCase();
}

function contentHash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function recoverScrapedMarkdown(url: string): Promise<ScrapedPage | null> {
  const cached = await getCached('firecrawl', `scrape:${url}`);
  if (!cached) return null;
  const result = cached as ToolResult<ScrapedPage>;
  if (!result?.data?.markdown?.trim()) return null;
  return result.data;
}

function collectFirecrawlSources(outputs: AgentOutput[]): Array<{
  url: string;
  title: string;
  timestamp: string;
  domain: string;
}> {
  const seen = new Set<string>();
  const out: Array<{ url: string; title: string; timestamp: string; domain: string }> = [];

  for (const output of outputs) {
    for (const source of output.sources) {
      if (source.tool !== 'firecrawl' || !source.url) continue;
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      out.push({
        url: source.url,
        title: source.title,
        timestamp: source.timestamp,
        domain: output.domain,
      });
    }
  }
  return out;
}

async function upsertDocumentWithChunks(
  supabase: SupabaseClient,
  userId: string,
  draft: EvidenceDocumentDraft,
): Promise<void> {
  const { data: existing } = await supabase
    .from('evidence_documents')
    .select('id')
    .eq('user_id', userId)
    .eq('content_hash', draft.contentHash)
    .maybeSingle();

  let documentId = existing?.id as string | undefined;

  if (!documentId) {
    const { data: inserted, error } = await supabase
      .from('evidence_documents')
      .insert({
        user_id: userId,
        url: draft.url,
        title: draft.title ?? null,
        source_tool: draft.sourceTool,
        domain: draft.domain ?? null,
        product: draft.product ?? null,
        category: draft.category ?? null,
        geography: draft.geography ?? null,
        content_hash: draft.contentHash,
        fetched_at: draft.fetchedAt,
      })
      .select('id')
      .single();

    if (error || !inserted) {
      console.error('[evidence index] document insert', error?.message);
      return;
    }
    documentId = inserted.id as string;
  } else {
    await supabase
      .from('evidence_documents')
      .update({ fetched_at: draft.fetchedAt, title: draft.title ?? null })
      .eq('id', documentId);
    await supabase.from('evidence_chunks').delete().eq('document_id', documentId);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const chunk of draft.chunks) {
    const embedding = await embedText(chunk.content);
    if (!embedding) continue;
    rows.push({
      document_id: documentId,
      user_id: userId,
      kind: chunk.kind,
      chunk_index: chunk.chunkIndex,
      content: chunk.content.slice(0, 8000),
      embedding: embedding as unknown as string,
    });
  }

  if (rows.length === 0) return;

  const { error: chunkError } = await supabase.from('evidence_chunks').insert(rows);
  if (chunkError) {
    console.error('[evidence index] chunk insert', chunkError.message);
  }
}

export async function indexRunEvidence(
  supabase: SupabaseClient,
  input: IndexRunEvidenceInput,
): Promise<{ indexedDocuments: number }> {
  if (!isEvidenceRagEnabled()) {
    return { indexedDocuments: 0 };
  }

  const { userId, outputs, classification } = input;
  const product = normalizeProduct(classification.product);
  const category = classification.category?.trim() || undefined;
  const geography = classification.geography?.name?.trim() || undefined;

  const drafts: EvidenceDocumentDraft[] = [];
  const firecrawlSources = collectFirecrawlSources(outputs);

  for (const source of firecrawlSources) {
    const page = await recoverScrapedMarkdown(source.url);
    if (page?.markdown) {
      const hash = contentHash(page.markdown);
      const chunks = chunkPageMarkdown(page.markdown);
      if (chunks.length > 0) {
        drafts.push({
          url: source.url,
          title: page.title || source.title,
          sourceTool: 'firecrawl',
          domain: source.domain,
          product,
          category,
          geography,
          contentHash: hash,
          fetchedAt: source.timestamp || new Date().toISOString(),
          chunks,
        });
        continue;
      }
    }

    const output = outputs.find(o => o.domain === source.domain);
    if (output?.facts?.length) {
      const factText = output.facts.join('\n');
      const hash = contentHash(`facts:${source.url}:${factText}`);
      const chunks = chunkAgentFacts(output.facts);
      if (chunks.length > 0) {
        drafts.push({
          url: source.url,
          title: source.title,
          sourceTool: 'firecrawl',
          domain: source.domain,
          product,
          category,
          geography,
          contentHash: hash,
          fetchedAt: source.timestamp || new Date().toISOString(),
          chunks,
        });
      }
    }
  }

  for (const output of outputs) {
    const orphanFacts = output.facts.filter(f => f.trim().length >= 200);
    if (orphanFacts.length === 0) continue;
    const hasDocForDomain = drafts.some(d => d.domain === output.domain);
    if (hasDocForDomain) continue;
    const factText = orphanFacts.join('\n');
    const hash = contentHash(`orphan-facts:${output.domain}:${factText}`);
    const chunks = chunkAgentFacts(orphanFacts);
    if (chunks.length === 0) continue;
    drafts.push({
      url: `agent://${output.domain}/${hash.slice(0, 12)}`,
      title: `${output.domain} facts`,
      sourceTool: 'fact-fallback',
      domain: output.domain,
      product,
      category,
      geography,
      contentHash: hash,
      fetchedAt: output.generatedAt || new Date().toISOString(),
      chunks,
    });
  }

  if (drafts.length === 0) return { indexedDocuments: 0 };

  await mapWithConcurrency(drafts, EVIDENCE_INDEX_CONCURRENCY, draft =>
    upsertDocumentWithChunks(supabase, userId, draft),
  );

  return { indexedDocuments: drafts.length };
}
