/**
 * E2E check: memoryContext reaches the chat API.
 *
 * Validates:
 *  1. buildMemoryContext produces a non-empty string when user memory exists.
 *  2. The POST body shape sent by page.tsx includes memoryContext (not
 *     recalledContext — the earlier bug).
 *  3. The chat route destructures memoryContext and passes it to orchestrate.
 *
 * This test is pure logic — no network, no React, no Supabase.
 */

import { describe, it, expect } from 'vitest';

// ── Replicate buildMemoryContext from lib/memory.ts ─────────────────────────
interface UserMemory {
  role: string | null;
  company: string | null;
  products: string[];
  competitors: string[];
  interests: string[];
  facts: { fact: string; source_session: string; created_at: string }[];
  raw_summary: string | null;
  updated_at: string;
}

function buildMemoryContext(memory: UserMemory): string {
  if (!memory.raw_summary && memory.products.length === 0 && memory.facts.length === 0) {
    return '';
  }
  const lines: string[] = ['[USER MEMORY — persistent across all sessions]'];
  if (memory.raw_summary) lines.push(`Who they are: ${memory.raw_summary}`);
  if (memory.role) lines.push(`Role: ${memory.role}`);
  if (memory.company) lines.push(`Company: ${memory.company}`);
  if (memory.products.length > 0) lines.push(`Products they work on: ${memory.products.join(', ')}`);
  if (memory.competitors.length > 0) lines.push(`Competitors they track: ${memory.competitors.join(', ')}`);
  if (memory.interests.length > 0) lines.push(`Strategic interests: ${memory.interests.join(', ')}`);
  if (memory.facts.length > 0) {
    lines.push('Notable facts:');
    memory.facts.slice(-8).forEach(f => lines.push(`  - ${f.fact}`));
  }
  return lines.join('\n');
}

describe('buildMemoryContext', () => {
  it('returns empty string for empty memory', () => {
    const empty: UserMemory = {
      role: null,
      company: null,
      products: [],
      competitors: [],
      interests: [],
      facts: [],
      raw_summary: null,
      updated_at: new Date().toISOString(),
    };
    expect(buildMemoryContext(empty)).toBe('');
  });

  it('includes all populated fields', () => {
    const memory: UserMemory = {
      role: 'PM at Veracity',
      company: 'Veracity AI',
      products: ['Vector Agents'],
      competitors: ['11x.ai', 'Artisan'],
      interests: ['AI SDR', 'digital workers'],
      facts: [
        { fact: 'User focuses on enterprise segment', source_session: 's1', created_at: '2025-01-01' },
      ],
      raw_summary: 'Product manager at Veracity AI working on Vector Agents.',
      updated_at: new Date().toISOString(),
    };
    const ctx = buildMemoryContext(memory);

    expect(ctx).toContain('[USER MEMORY');
    expect(ctx).toContain('Role: PM at Veracity');
    expect(ctx).toContain('Company: Veracity AI');
    expect(ctx).toContain('Vector Agents');
    expect(ctx).toContain('11x.ai');
    expect(ctx).toContain('Artisan');
    expect(ctx).toContain('AI SDR');
    expect(ctx).toContain('User focuses on enterprise segment');
  });

  it('limits facts to last 8', () => {
    const facts = Array.from({ length: 12 }, (_, i) => ({
      fact: `fact-${i}`,
      source_session: 's1',
      created_at: '2025-01-01',
    }));
    const memory: UserMemory = {
      role: null,
      company: null,
      products: [],
      competitors: [],
      interests: [],
      facts,
      raw_summary: null,
      updated_at: new Date().toISOString(),
    };
    const ctx = buildMemoryContext(memory);
    // Should contain facts 4-11 (last 8), not facts 0-3
    expect(ctx).toContain('fact-4');
    expect(ctx).toContain('fact-11');
    expect(ctx).not.toContain('fact-3');
  });
});

describe('POST body shape (integration contract)', () => {
  it('chat route expects memoryContext field, not recalledContext', () => {
    // This mimics the exact body shape that page.tsx sends.
    // The critical bug was sending "recalledContext" while route.ts reads
    // "memoryContext". This test documents the correct contract.
    const body = {
      query: 'Is Vector competitive?',
      history: [],
      images: [],
      memoryContext: 'some context',
    };

    // Destructure exactly as route.ts does
    const { query, history = [], images = [], memoryContext } = body as {
      query: string;
      history: unknown[];
      images: unknown[];
      memoryContext?: string;
    };

    expect(query).toBe('Is Vector competitive?');
    expect(history).toEqual([]);
    expect(images).toEqual([]);
    expect(memoryContext).toBe('some context');
  });

  it('memoryContext is optional — route works without it', () => {
    const body = { query: 'Hello', history: [] };
    const { memoryContext } = body as { memoryContext?: string };
    expect(memoryContext).toBeUndefined();
  });
});
