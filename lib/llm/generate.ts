import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getLangchainCallbacks } from '@/lib/observability/langfuse';
import { estimateTokensFromChars } from '@/lib/observability/pricing';
import { recordLlmCall } from '@/lib/observability/usage-ledger';
import type { UsageStage } from '@/lib/observability/types';
import { createGoogleChatModel, resolveGoogleProviderConfig } from './providers/google';
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

type UsageMeta = {
  inputChars: number;
  outputChars: number;
};

function extractUsageFromResult(
  result: { usage_metadata?: { input_tokens?: number; output_tokens?: number } },
  meta: UsageMeta,
): { inputTokens: number; outputTokens: number; tokensEstimated: boolean } {
  const u = result.usage_metadata;
  if (u && (u.input_tokens != null || u.output_tokens != null)) {
    return {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      tokensEstimated: false,
    };
  }
  return {
    inputTokens: estimateTokensFromChars(meta.inputChars),
    outputTokens: estimateTokensFromChars(meta.outputChars),
    tokensEstimated: true,
  };
}

async function invokeWithUsage(
  model: Awaited<ReturnType<typeof createGoogleChatModel>>,
  messages: InstanceType<typeof HumanMessage | typeof SystemMessage>[],
  options: LlmGenerateOptions,
  inputChars: number,
) {
  const stage: UsageStage = options.stage ?? 'agent';
  const resolvedModel = resolveGoogleProviderConfig(options).model;
  const callbacks = await getLangchainCallbacks({ stage });
  const t0 = Date.now();

  const result = await model.invoke(messages, {
    callbacks: callbacks as never[],
    runName: stage,
  });

  const outputText = messageContentToText(result.content);
  const usage = extractUsageFromResult(result, {
    inputChars,
    outputChars: outputText.length,
  });

  recordLlmCall({
    stage,
    model: resolvedModel,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - t0,
    ok: true,
    tokensEstimated: usage.tokensEstimated,
  });

  return result;
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
    const result = await invokeWithUsage(
      model,
      [new HumanMessage(prompt)],
      options,
      prompt.length,
    );
    return messageContentToText(result.content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM generateText failed: ${safePreview(msg)}`);
  }
}

/**
 * JSON generation. Uses responseSchema so the provider sets application/json.
 */
export async function generateJson<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  options: LlmGenerateOptions = {},
): Promise<T> {
  const model = await createGoogleChatModel({
    ...options,
    maxNewTokens: options.maxNewTokens ?? DEFAULT_JSON_MAX_OUTPUT,
    responseSchema: options.responseSchema ?? {
      type: 'object',
      additionalProperties: true,
    },
  });

  const inputChars = systemPrompt.length + userPrompt.length;

  try {
    const result = await invokeWithUsage(
      model,
      [
        new SystemMessage(systemPrompt.trim()),
        new HumanMessage(userPrompt.trim()),
      ],
      options,
      inputChars,
    );

    const text = messageContentToText(result.content);
    if (!text) {
      throw new Error('LLM returned empty JSON response');
    }
    return parseJsonLoose<T>(text);
  } catch (err) {
    if (err instanceof Error && /JSON parse|empty JSON|responseSchema/i.test(err.message)) {
      const combined = `${systemPrompt.trim()}\n\n${userPrompt.trim()}\n\nRespond with valid JSON only.`;
      const { responseSchema: _omit, ...rest } = options;
      const text = await generateText(combined, {
        ...rest,
        maxNewTokens: options.maxNewTokens ?? DEFAULT_JSON_MAX_OUTPUT,
        temperature: options.temperature ?? 0.2,
        stage: options.stage ?? 'agent',
      });
      return parseJsonLoose<T>(text);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM generateJson failed: ${safePreview(msg)}`);
  }
}
