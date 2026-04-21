const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
// DB column is `vector(768)`. gemini-embedding-001 default is 3072 dims, so
// we explicitly request 768 via outputDimensionality and re-normalize the
// returned vector (Gemini docs: normalization is required for <3072 dims).
const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768);

// Gemini 2.5 models have built-in "thinking" that consumes output tokens
// before emitting the actual response. For our agents (data synthesis,
// classification, structured extraction) thinking is unnecessary and causes
// JSON truncation on long prompts. We disable it by default, but callers can
// opt back in via `thinkingBudget`.
const DEFAULT_THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);

// Raised defaults: the previous 1024/1400 limits were too low for complex
// agent outputs (matrices, distributions, contributingSignals) once thinking
// tokens were removed we still want room for large structured responses.
const DEFAULT_TEXT_MAX_OUTPUT = 2048;
const DEFAULT_JSON_MAX_OUTPUT = 4096;

type GeminiOptions = {
  model?: string;
  maxNewTokens?: number;
  temperature?: number;
  thinkingBudget?: number; // override per-call; 0 disables, -1 = dynamic
};

function safePreview(value: string, maxLength = 300): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is required');
  return key;
}

function generationUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function buildGenerationConfig(
  options: GeminiOptions,
  defaultMax: number,
  responseMimeType?: string,
): Record<string, unknown> {
  const budget = options.thinkingBudget ?? DEFAULT_THINKING_BUDGET;
  const config: Record<string, unknown> = {
    temperature: options.temperature ?? 0.2,
    maxOutputTokens: options.maxNewTokens ?? defaultMax,
    thinkingConfig: { thinkingBudget: budget },
  };
  if (responseMimeType) config.responseMimeType = responseMimeType;
  return config;
}

export async function generateHuggingFaceText(
  prompt: string,
  options: GeminiOptions = {},
): Promise<string> {
  const apiKey = getApiKey();
  const model = options.model?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  const response = await fetch(generationUrl(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: buildGenerationConfig(options, DEFAULT_TEXT_MAX_OUTPUT),
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini generateContent failed (${response.status}): ${safePreview(raw)}`);
  }

  let parsed: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return raw.trim();
  }

  return parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

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

// ── JSON helper ───────────────────────────────────────────────────────────────
// Gemini supports responseMimeType: 'application/json' natively, so we use
// that instead of prompting for JSON and stripping fences.
export async function generateHuggingFaceJson<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  options: GeminiOptions = {},
): Promise<T> {
  const apiKey = getApiKey();
  const model = options.model?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  const combined = `${systemPrompt.trim()}\n\n${userPrompt.trim()}`;

  const response = await fetch(generationUrl(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: combined }] }],
      generationConfig: buildGenerationConfig(options, DEFAULT_JSON_MAX_OUTPUT, 'application/json'),
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini JSON generateContent failed (${response.status}): ${safePreview(raw)}`);
  }

  let parsed: {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error(`Gemini response is not valid JSON: ${safePreview(raw)}`);
  }

  const candidate = parsed.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text?.trim() ?? '';
  if (!text) {
    const reason = candidate?.finishReason ?? 'unknown';
    throw new Error(`Gemini returned empty JSON response (finishReason: ${reason})`);
  }

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
    throw new Error(`Gemini JSON parse failed: ${safePreview(text)}`);
  }
}
