/**
 * LLM facade — provider-flexible generation (Gemini Developer API | Vertex AI).
 * Agent call sites keep using lib/agents/gemini.ts exports.
 */
export type { LlmGenerateOptions, LlmProviderId, GoogleProviderConfig } from './types';
export { generateText, generateJson } from './generate';
export {
  resolveGoogleProviderConfig,
  getLlmProviderId,
  createGoogleChatModel,
} from './providers/google';
