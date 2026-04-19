import { GoogleGenAI } from '@google/genai';

// text-embedding-004 is only available on the stable v1 API, not v1beta
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { apiVersion: 'v1' } });

// Gemini text-embedding-004 → 768 dimensions
export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: trimmed.slice(0, 8000), // safety cap
    });

    // SDK returns embeddings array; pull the first vector
    const values = response.embeddings?.[0]?.values;
    if (!values || values.length === 0) return null;
    return values;
  } catch (err) {
    console.error('[embedText]', err instanceof Error ? err.message : err);
    return null;
  }
}
