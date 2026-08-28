import { z } from 'zod';

const MAX_QUERY = 4000;
const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_CHARS = 32_000;
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 5 * 1024 * 1024; // ~5MB base64 chars

export const conversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(MAX_QUERY * 2),
  timestamp: z.string().optional(),
});

export const imageAttachmentSchema = z.object({
  data: z.string().max(MAX_IMAGE_CHARS),
  mimeType: z.string().max(100),
});

export const chatBodySchema = z.object({
  query: z.string().trim().min(1).max(MAX_QUERY),
  history: z.array(conversationMessageSchema).max(MAX_HISTORY_TURNS).default([]),
  images: z.array(imageAttachmentSchema).max(MAX_IMAGES).optional().default([]),
  /** Ignored server-side — memory is loaded from DB. Kept optional for compat. */
  memoryContext: z.string().max(8000).optional(),
  sessionId: z.string().uuid().optional().nullable(),
  includeMirofish: z.boolean().optional().default(false),
  includeMirofishLive: z.boolean().optional().default(false),
  followUpMode: z.enum(['full', 'targeted']).optional().default('full'),
  selectedAgents: z.array(z.string().max(64)).max(20).optional().default([]),
}).superRefine((val, ctx) => {
  const histChars = val.history.reduce((n, m) => n + m.content.length, 0);
  if (histChars > MAX_HISTORY_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `history exceeds ${MAX_HISTORY_CHARS} characters`,
      path: ['history'],
    });
  }
});

export const recallBodySchema = z.object({
  sessionId: z.string().uuid(),
  query: z.string().trim().min(1).max(MAX_QUERY),
  matchCount: z.number().int().min(1).max(20).optional().default(5),
});

export const embedBodySchema = z.object({
  sessionId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().trim().min(1).max(8000),
  messageId: z.string().uuid().optional().nullable(),
});

export const memoryBodySchema = z.object({
  sessionId: z.string().uuid(),
  userQuery: z.string().trim().min(1).max(MAX_QUERY),
  assistantAnswer: z.string().trim().min(1).max(16_000),
  existingMemory: z.record(z.string(), z.unknown()).optional(),
});

export const stealStrategyBodySchema = z.object({
  company: z.string().trim().min(2).max(200),
  newCompanyContext: z.string().max(4000).optional(),
  market: z.string().max(200).optional(),
});

export const workspaceExplainBodySchema = z.object({
  itemId: z.string().uuid(),
  question: z.string().trim().min(2).max(MAX_QUERY),
  chartType: z.string().max(64).optional().default('native'),
});

export const workspaceIndexBodySchema = z.object({
  itemId: z.string().uuid(),
});

export const refineBodySchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().uuid(),
  focus: z.string().max(1000).optional(),
});

export const feedbackBodySchema = z.object({
  kind: z.string().min(1).max(64),
  sessionId: z.string().uuid(),
}).passthrough();

export function formatZodError(err: z.ZodError): string {
  return err.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}
