/**
 * Citation index — assign stable [n] numbers across all agent sources
 * and enforce citation-bound synthesis post-processing.
 */

import type { AgentOutput, AgentSource, CitationEntry } from './types';

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Drop trailing slash for dedupe
    const path = u.pathname.replace(/\/$/, '') || '/';
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Build a deduped citation index (stable order = first appearance across outputs).
 * Mutates each AgentSource with citationId.
 */
export function buildCitationIndex(outputs: AgentOutput[]): CitationEntry[] {
  const byNorm = new Map<string, CitationEntry>();
  const citations: CitationEntry[] = [];

  for (const output of outputs) {
    for (const source of output.sources ?? []) {
      if (!source.url?.trim()) continue;
      const norm = normalizeUrl(source.url);
      const existing = byNorm.get(norm);
      if (existing) {
        source.citationId = existing.id;
        if (!existing.domains.includes(output.domain)) {
          existing.domains.push(output.domain);
        }
        if (!existing.title && source.title) existing.title = source.title;
        continue;
      }
      const entry: CitationEntry = {
        id: citations.length + 1,
        url: source.url,
        title: source.title || source.url,
        domains: [output.domain],
      };
      byNorm.set(norm, entry);
      citations.push(entry);
      source.citationId = entry.id;
    }
  }

  return citations;
}

/**
 * Strip [n] references that are outside 1..maxId. Keeps valid citations.
 */
export function stripUnknownCitations(text: string, maxId: number): string {
  if (!text) return text;
  return text.replace(/\[(\d+)\]/g, (match, numStr: string) => {
    const n = Number.parseInt(numStr, 10);
    if (!Number.isFinite(n) || n < 1 || n > maxId) return '';
    return match;
  }).replace(/ {2,}/g, ' ').replace(/ \./g, '.').trim();
}

/**
 * Format citation list for the synthesis prompt.
 */
export function formatCitationsForPrompt(citations: CitationEntry[]): string {
  if (citations.length === 0) return '(no sources)';
  return citations
    .map(c => `[${c.id}] ${c.title}: ${c.url}`)
    .join('\n');
}

/**
 * Attach citationIds from an existing index without reordering (for UI).
 */
export function applyCitationIds(
  sources: AgentSource[],
  citations: CitationEntry[],
): AgentSource[] {
  const byNorm = new Map(citations.map(c => [normalizeUrl(c.url), c.id]));
  return sources.map(s => ({
    ...s,
    citationId: byNorm.get(normalizeUrl(s.url)) ?? s.citationId,
  }));
}
