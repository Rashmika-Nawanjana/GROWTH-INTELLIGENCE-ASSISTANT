/**
 * Veracity Memory MCP — stdio server for Cursor (local dev only).
 *
 * Loads .env.local from project root. Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (local dev only)
 *   MEMORY_MCP_USER_ID         (auth.users uuid)
 *   GEMINI_API_KEY             (only for update_user_memory)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnvLocal() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const envPath = resolve(root, '.env.local');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  getUserMemoryInputSchema,
  recallSimilarTurnsInputSchema,
  getPastOutcomesInputSchema,
  recordOutcomeInputSchema,
  updateUserMemoryInputSchema,
  toolGetUserMemory,
  toolRecallSimilarTurns,
  toolGetPastOutcomes,
  toolRecordRecommendationOutcome,
  toolUpdateUserMemory,
  toolSearchEvidence,
  searchEvidenceInputSchema,
} from '../../lib/mcp/memory-tools';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function createMcpSupabase() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toolContext() {
  const userId = requireEnv('MEMORY_MCP_USER_ID');
  return {
    supabase: createMcpSupabase(),
    userId,
  };
}

function jsonContent(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function main() {
  const server = new McpServer(
    { name: 'veracity-memory-mcp', version: '1.0.0' },
    {
      instructions:
        'Persistent user memory, session recall (pgvector), and feedback/outcome loop for Growth Intelligence Assistant.',
    },
  );

  server.registerTool(
    'get_user_memory',
    {
      description: 'Read persistent user memory (role, company, products, competitors) across all sessions.',
      inputSchema: getUserMemoryInputSchema,
    },
    async () => {
      const result = await toolGetUserMemory(toolContext(), {});
      return jsonContent(result);
    },
  );

  server.registerTool(
    'recall_similar_turns',
    {
      description: 'Semantic recall of similar prior turns within a chat session (pgvector).',
      inputSchema: recallSimilarTurnsInputSchema,
    },
    async (args) => {
      const result = await toolRecallSimilarTurns(toolContext(), args);
      return jsonContent(result);
    },
  );

  server.registerTool(
    'get_past_outcomes',
    {
      description: 'Load recommendation ratings, actions, and variant campaign results.',
      inputSchema: getPastOutcomesInputSchema,
    },
    async (args) => {
      const result = await toolGetPastOutcomes(toolContext(), args);
      return jsonContent(result);
    },
  );

  server.registerTool(
    'record_recommendation_outcome',
    {
      description: 'Record recommendation feedback, action, or variant performance outcome.',
      inputSchema: recordOutcomeInputSchema,
    },
    async (args) => {
      const result = await toolRecordRecommendationOutcome(toolContext(), args);
      return jsonContent(result);
    },
  );

  server.registerTool(
    'update_user_memory',
    {
      description: 'Extract and merge durable user facts from a query/answer exchange (requires GEMINI_API_KEY).',
      inputSchema: updateUserMemoryInputSchema,
    },
    async (args) => {
      const result = await toolUpdateUserMemory(toolContext(), args);
      return jsonContent(result);
    },
  );

  server.registerTool(
    'search_evidence',
    {
      description: 'Semantic search over indexed research evidence (scraped pages and agent facts).',
      inputSchema: searchEvidenceInputSchema,
    },
    async (args) => {
      const result = await toolSearchEvidence(toolContext(), args);
      return jsonContent(result);
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[veracity-memory-mcp]', err);
  process.exit(1);
});
