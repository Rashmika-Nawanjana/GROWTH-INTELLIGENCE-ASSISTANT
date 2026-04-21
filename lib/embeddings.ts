import { embedTextWithHuggingFace } from './agents/hugging-face';

export async function embedText(text: string): Promise<number[] | null> {
  try {
    return await embedTextWithHuggingFace(text);
  } catch (err) {
    console.error('[embedText]', err instanceof Error ? err.message : err);
    return null;
  }
}
