const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

type GeminiOptions = {
  model?: string;
  maxNewTokens?: number;
  temperature?: number;
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
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxNewTokens ?? 1024,
      },
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
  return Array.isArray(values) ? values : null;
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
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxNewTokens ?? 1400,
        responseMimeType: 'application/json',
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini JSON generateContent failed (${response.status}): ${safePreview(raw)}`);
  }

  let parsed: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error(`Gemini response is not valid JSON: ${safePreview(raw)}`);
  }

  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  if (!text) throw new Error('Gemini returned empty JSON response');

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
