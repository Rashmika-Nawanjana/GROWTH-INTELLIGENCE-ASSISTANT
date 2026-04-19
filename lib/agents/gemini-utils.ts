// Shared helpers for building Gemini request payloads across every agent.
//
// Centralising this keeps multimodal behaviour uniform: any attached
// image from the user is passed to every specialist and execution sub-agent,
// not just the classifier. Without this helper each agent would independently
// drop ctx.images on the floor.

import type { ImageAttachment } from './types';

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Build the `parts` array for a Gemini generateContent call.
 *
 * Always includes the prompt text. If images are provided, they are appended
 * as inlineData parts in the same order the user attached them, and a short
 * visual-context note is injected so the model knows to reference them.
 */
export function buildContentParts(
  prompt: string,
  images: ImageAttachment[] | undefined,
): GeminiPart[] {
  const hasImages = !!images && images.length > 0;
  const textWithImageNote = hasImages
    ? `${prompt}\n\nThe user has attached ${images!.length} image(s). Use their visual content (screenshots, pricing tables, UI, charts, logos, ad creative) as direct evidence in your analysis. Treat visible text and numbers as ground-truth facts.`
    : prompt;

  const parts: GeminiPart[] = [{ text: textWithImageNote }];
  if (hasImages) {
    for (const img of images!) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }
  return parts;
}
