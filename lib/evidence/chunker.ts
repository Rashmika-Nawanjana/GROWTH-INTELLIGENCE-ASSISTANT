import {
  CHUNK_MIN_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNKS_PER_DOCUMENT_CAP,
  CHUNK_TARGET_CHARS,
} from './config';
import type { EvidenceChunkDraft } from './types';

const BOILERPLATE_PATTERNS = [
  /^cookie/i,
  /^privacy policy/i,
  /^terms of (use|service)/i,
  /^sign up/i,
  /^subscribe to newsletter/i,
  /^all rights reserved/i,
];

function stripBoilerplate(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return true;
      return !BOILERPLATE_PATTERNS.some(p => p.test(t));
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hardWrap(text: string, target: number, overlap: number): string[] {
  if (text.length <= target) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + target);
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }
  return out.filter(c => c.length >= CHUNK_MIN_CHARS);
}

function splitByHeadings(markdown: string): string[] {
  const sections: string[] = [];
  const lines = markdown.split('\n');
  let current = '';

  for (const line of lines) {
    if (/^#{2,3}\s+/.test(line)) {
      if (current.trim()) sections.push(current.trim());
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current.trim()) sections.push(current.trim());
  return sections.length > 0 ? sections : [markdown];
}

function scoreChunk(content: string, terms: string[]): number {
  if (!terms.length) return 0;
  const lower = content.toLowerCase();
  return terms.reduce((sum, term) => {
    const t = term.toLowerCase().trim();
    if (!t) return sum;
    return sum + (lower.includes(t) ? 1 : 0);
  }, 0);
}

function prioritizeChunks(chunks: string[], terms: string[]): string[] {
  if (chunks.length <= CHUNKS_PER_DOCUMENT_CAP) return chunks;
  return [...chunks]
    .sort((a, b) => scoreChunk(b, terms) - scoreChunk(a, terms))
    .slice(0, CHUNKS_PER_DOCUMENT_CAP);
}

export function chunkPageMarkdown(
  markdown: string,
  options?: { requiredTerms?: string[]; namedEntities?: string[] },
): EvidenceChunkDraft[] {
  const cleaned = stripBoilerplate(markdown);
  if (!cleaned || cleaned.length < CHUNK_MIN_CHARS) return [];

  const terms = [
    ...(options?.requiredTerms ?? []),
    ...(options?.namedEntities ?? []),
  ];

  const sections = splitByHeadings(cleaned);
  const rawChunks: string[] = [];
  for (const section of sections) {
    rawChunks.push(...hardWrap(section, CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS));
  }

  const prioritized = prioritizeChunks(rawChunks, terms);
  return prioritized.map((content, chunkIndex) => ({
    kind: 'page' as const,
    chunkIndex,
    content,
  }));
}

export function chunkAgentFacts(facts: string[]): EvidenceChunkDraft[] {
  return facts
    .map(f => f.trim())
    .filter(f => f.length >= CHUNK_MIN_CHARS)
    .slice(0, CHUNKS_PER_DOCUMENT_CAP)
    .map((content, chunkIndex) => ({
      kind: 'fact' as const,
      chunkIndex,
      content,
    }));
}
