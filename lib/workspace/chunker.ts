import type { AgentOutput } from '@/lib/agents/types';
import { chunkAgentFacts } from '@/lib/evidence/chunker';
import {
  CHUNK_MIN_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNKS_PER_DOCUMENT_CAP,
  CHUNK_TARGET_CHARS,
} from '@/lib/evidence/config';
import type { WorkspaceChunkDraft, WorkspaceChunkSection } from './rag-types';

const BASE_PAYLOAD_KEYS = new Set([
  'agentId',
  'domain',
  'confidence',
  'confidenceScore',
  'facts',
  'interpretation',
  'sources',
  'generatedAt',
  'artifactType',
  'evidence',
  'toolCallCount',
  'searchCallCount',
  'scrapeCallCount',
  'droppedIrrelevantCount',
]);

function hardWrap(text: string): string[] {
  if (text.length <= CHUNK_TARGET_CHARS) {
    return text.length >= CHUNK_MIN_CHARS ? [text] : [];
  }
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_TARGET_CHARS);
    const slice = text.slice(start, end).trim();
    if (slice.length >= CHUNK_MIN_CHARS) out.push(slice);
    if (end >= text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP_CHARS);
  }
  return out;
}

function addChunks(
  drafts: WorkspaceChunkDraft[],
  section: WorkspaceChunkSection,
  texts: string[],
): void {
  const capped = texts.slice(0, CHUNKS_PER_DOCUMENT_CAP);
  for (const content of capped) {
    if (content.length < CHUNK_MIN_CHARS) continue;
    drafts.push({
      section,
      chunkIndex: drafts.filter(d => d.section === section).length,
      content,
    });
  }
}

function extractDomainFields(payload: AgentOutput): Record<string, unknown> {
  const extra: Record<string, unknown> = {
    ...(payload as unknown as Record<string, unknown>),
  };
  for (const key of BASE_PAYLOAD_KEYS) {
    delete extra[key];
  }
  return extra;
}

function serializeDomainFields(payload: AgentOutput): string[] {
  const extra = extractDomainFields(payload);
  const texts: string[] = [];

  for (const [key, value] of Object.entries(extra)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const line =
          typeof entry === 'object'
            ? `## ${key}\n${JSON.stringify(entry, null, 2)}`
            : `## ${key}\n${String(entry)}`;
        texts.push(...hardWrap(line));
      }
    } else if (typeof value === 'object') {
      texts.push(...hardWrap(`## ${key}\n${JSON.stringify(value, null, 2)}`));
    } else {
      const line = `## ${key}\n${String(value)}`;
      if (line.length >= CHUNK_MIN_CHARS) texts.push(line);
    }
  }

  return texts;
}

export function chunkWorkspaceArtifact(
  payload: AgentOutput,
  notes?: string | null,
): WorkspaceChunkDraft[] {
  const drafts: WorkspaceChunkDraft[] = [];

  const factChunks = chunkAgentFacts(payload.facts ?? []);
  for (const fc of factChunks) {
    drafts.push({ section: 'facts', chunkIndex: fc.chunkIndex, content: fc.content });
  }

  const interpretations = (payload.interpretation ?? [])
    .map(t => t.trim())
    .filter(t => t.length >= CHUNK_MIN_CHARS)
    .slice(0, CHUNKS_PER_DOCUMENT_CAP);
  addChunks(drafts, 'interpretation', interpretations);

  addChunks(drafts, 'domain', serializeDomainFields(payload));

  const sources = payload.sources ?? [];
  if (sources.length > 0) {
    const sourceBlock = sources
      .slice(0, 20)
      .map(s => `- [${s.title}](${s.url}) (${s.tool})`)
      .join('\n');
    if (sourceBlock.length >= CHUNK_MIN_CHARS) {
      drafts.push({ section: 'sources', chunkIndex: 0, content: sourceBlock });
    }
  }

  if (payload.evidence) {
    const evidenceText = JSON.stringify(payload.evidence, null, 2);
    addChunks(drafts, 'evidence', hardWrap(`Evidence assessment:\n${evidenceText}`));
  }

  const trimmedNotes = notes?.trim();
  if (trimmedNotes) {
    const content = `User notes:\n${trimmedNotes}`;
    if (content.length >= CHUNK_MIN_CHARS) {
      drafts.push({ section: 'notes', chunkIndex: 0, content });
    }
  }

  return drafts;
}
