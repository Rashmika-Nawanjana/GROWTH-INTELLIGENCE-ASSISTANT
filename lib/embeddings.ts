import { embedTextWithHuggingFace } from './agents/gemini';
import type { EmbeddingPurpose } from '@/lib/observability/types';

export async function embedText(
  text: string,
  purpose: EmbeddingPurpose = 'unknown',
): Promise<number[] | null> {
  try {
    return await embedTextWithHuggingFace(text, purpose);
  } catch (err) {
    console.error('[embedText]', err instanceof Error ? err.message : err);
    return null;
  }
}
