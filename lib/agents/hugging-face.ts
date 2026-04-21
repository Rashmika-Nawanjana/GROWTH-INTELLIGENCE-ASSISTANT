type HuggingFaceOptions = {
  model?: string;
  maxNewTokens?: number;
  temperature?: number;
};

type HuggingFaceResponse =
  | Array<{ generated_text?: string; text?: string }>
  | { generated_text?: string; text?: string; error?: string }
  | string;

const DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct';

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
  const encodedModel = model.split('/').map(segment => encodeURIComponent(segment)).join('/');
  const response = await fetch(`https://api-inference.huggingface.co/models/${encodedModel}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: options.maxNewTokens ?? 1024,
        temperature: options.temperature ?? 0.2,
        do_sample: false,
        return_full_text: false,
      },
      options: {
        wait_for_model: true,
      },
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
