/**
 * Legacy export surface for agents/routes.
 * Text/JSON generation delegates to lib/llm (LangChain ChatGoogle).
 * Embeddings stay on the Gemini Developer API (pgvector vector(768)).
 */

import { generateText, generateJson } from '@/lib/llm/generate';
import type { LlmGenerateOptions } from '@/lib/llm/types';

const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
// DB column is `vector(768)`. gemini-embedding-001 default is 3072 dims, so
// we explicitly request 768 via outputDimensionality and re-normalize the
// returned vector (Gemini docs: normalization is required for <3072 dims).
const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768);

type GeminiOptions = LlmGenerateOptions;

function safePreview(value: string, maxLength = 300): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is required for embeddings');
  return key;
}

export async function generateHuggingFaceText(
  prompt: string,
  options: GeminiOptions = {},
): Promise<string> {
  return generateText(prompt, options);
}

export async function generateHuggingFaceJson<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  options: GeminiOptions = {},
): Promise<T> {
  return generateJson<T>(systemPrompt, userPrompt, options);
}

/**
 * Embeddings always use Gemini Developer API — do not follow LLM_PROVIDER=vertex
 * (avoids silent dimension mismatches with pgvector vector(768)).
 */
export async function embedTextWithHuggingFace(text: string): Promise<number[] | null> {
  const apiKey = getApiKey();
  const trimmed = text.trim();
  if (!trimmed) return null;

  const model =
    process.env.GEMINI_EMBEDDING_MODEL?.trim() ||
    process.env.HUGGING_FACE_EMBEDDING_MODEL?.trim() ||
    DEFAULT_EMBEDDING_MODEL;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: trimmed.slice(0, 8000) }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    },
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini embedContent failed (${response.status}): ${safePreview(raw)}`);
  }

  let parsed: { embedding?: { values?: number[] } };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }

  const values = parsed.embedding?.values;
  if (!Array.isArray(values)) return null;

  if (EMBEDDING_DIMENSIONS < 3072) {
    const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      return values.map(v => v / norm);
    }
  }
  return values;
}
