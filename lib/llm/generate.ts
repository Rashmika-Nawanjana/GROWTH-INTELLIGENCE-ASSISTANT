import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createGoogleChatModel } from './providers/google';
import type { LlmGenerateOptions } from './types';

const DEFAULT_TEXT_MAX_OUTPUT = 2048;
const DEFAULT_JSON_MAX_OUTPUT = 4096;

function safePreview(value: string, maxLength = 300): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: string }).text ?? '');
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function parseJsonLoose<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        // fall through
      }
    }
    throw new Error(`LLM JSON parse failed: ${safePreview(text)}`);
  }
}

/**
 * Plain-text generation via LangChain ChatGoogle (Gemini API or Vertex).
 */
export async function generateText(
  prompt: string,
  options: LlmGenerateOptions = {},
): Promise<string> {
  const model = await createGoogleChatModel({
    ...options,
    maxNewTokens: options.maxNewTokens ?? DEFAULT_TEXT_MAX_OUTPUT,
  });

  try {
    const result = await model.invoke([new HumanMessage(prompt)]);
    return messageContentToText(result.content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM generateText failed: ${safePreview(msg)}`);
  }
}

/**
 * JSON generation. Uses responseSchema so the provider sets application/json.
 * Gaps vs legacy raw Gemini fetch: some thinkingConfig edge cases may differ by
 * LangChain version; prefer thinkingBudget=0 for structured agent outputs.
 */
export async function generateJson<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  options: LlmGenerateOptions = {},
): Promise<T> {
  // Permissive object schema forces JSON MIME type without constraining fields.
  const model = await createGoogleChatModel({
    ...options,
    maxNewTokens: options.maxNewTokens ?? DEFAULT_JSON_MAX_OUTPUT,
    responseSchema: options.responseSchema ?? {
      type: 'object',
      additionalProperties: true,
    },
  });

  try {
    const result = await model.invoke([
      new SystemMessage(systemPrompt.trim()),
      new HumanMessage(userPrompt.trim()),
    ]);

    const text = messageContentToText(result.content);
    if (!text) {
      throw new Error('LLM returned empty JSON response');
    }
    return parseJsonLoose<T>(text);
  } catch (err) {
    // Fallback: single combined prompt without schema (still via LangChain).
    if (err instanceof Error && /JSON parse|empty JSON|responseSchema/i.test(err.message)) {
      const combined = `${systemPrompt.trim()}\n\n${userPrompt.trim()}\n\nRespond with valid JSON only.`;
      const { responseSchema: _omit, ...rest } = options;
      const text = await generateText(combined, {
        ...rest,
        maxNewTokens: options.maxNewTokens ?? DEFAULT_JSON_MAX_OUTPUT,
        temperature: options.temperature ?? 0.2,
      });
      return parseJsonLoose<T>(text);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM generateJson failed: ${safePreview(msg)}`);
  }
}
