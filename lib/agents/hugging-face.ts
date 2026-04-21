type HuggingFaceOptions = {
  model?: string;
  maxNewTokens?: number;
  temperature?: number;
};

type HuggingFaceResponse =
  | Array<{ generated_text?: string; text?: string }>
  | { generated_text?: string; text?: string; error?: string }
  | { choices?: Array<{ message?: { content?: string } }> }
  | string;

const DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
const DEFAULT_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

function safePreview(value: string, maxLength = 300): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function extractText(payload: HuggingFaceResponse): string {
  if (typeof payload === 'string') {
    return payload;
  }

  if (Array.isArray(payload)) {
    const first = payload[0];
    if (!first) return '';
    return first.generated_text ?? first.text ?? '';
  }

  const choiceText = payload.choices?.[0]?.message?.content;
  if (typeof choiceText === 'string') {
    return choiceText;
  }

  return payload.generated_text ?? payload.text ?? '';
}

export async function generateHuggingFaceText(
  prompt: string,
  options: HuggingFaceOptions = {},
): Promise<string> {
  const token = process.env.HUGGING_FACE_API_KEY?.trim();
  if (!token) {
    throw new Error('HUGGING_FACE_API_KEY is required');
  }

  const model = options.model?.trim() || process.env.HUGGING_FACE_MODEL?.trim() || DEFAULT_MODEL;
  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.maxNewTokens ?? 1024,
      temperature: options.temperature ?? 0.2,
      stream: false,
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Hugging Face inference request failed (${response.status}): ${safePreview(raw)}`);
  }

  let parsed: HuggingFaceResponse;
  try {
    parsed = JSON.parse(raw) as HuggingFaceResponse;
  } catch {
    return raw.trim();
  }

  const text = extractText(parsed).trim();
  if (text) return text;

  return raw.trim();
}

export async function embedTextWithHuggingFace(text: string): Promise<number[] | null> {
  const token = process.env.HUGGING_FACE_API_KEY?.trim();
  if (!token) {
    throw new Error('HUGGING_FACE_API_KEY is required');
  }

  const trimmed = text.trim();
  if (!trimmed) return null;

  const model = process.env.HUGGING_FACE_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  const encodedModel = model.split('/').map(segment => encodeURIComponent(segment)).join('/');
  const response = await fetch(`https://api-inference.huggingface.co/pipeline/feature-extraction/${encodedModel}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      inputs: trimmed.slice(0, 8000),
      options: { wait_for_model: true },
      parameters: { normalize: true, truncate: true },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Hugging Face embedding request failed (${response.status}): ${safePreview(raw)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
    const firstVector = parsed[0] as unknown[];
    return firstVector.filter((value): value is number => typeof value === 'number');
  }

  return null;
}
