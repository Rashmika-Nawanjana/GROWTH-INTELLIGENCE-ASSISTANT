import type { UserMemory } from '@/lib/memory';

export interface RecallHit {
  id: string;
  message_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  similarity: number;
  created_at: string;
}

export interface RecallResult {
  hits: RecallHit[];
  contextBlock: string;
}

export type OutcomeScope = 'session' | 'user';

export interface PastOutcomesResult {
  feedback: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  variantResults: Array<Record<string, unknown>>;
  summaryBlock: string;
}

export type RecommendationFeedbackPayload = {
  kind: 'recommendation-feedback';
  sessionId: string;
  messageId?: string | null;
  recommendationKey: string;
  title: string;
  rating: 'up' | 'down' | 'neutral';
  note?: string;
};

export type RecommendationActionPayload = {
  kind: 'recommendation-action';
  sessionId: string;
  messageId?: string | null;
  recommendationKey: string;
  title: string;
  action: 'accepted' | 'rejected' | 'refined' | 'copied';
  metadata?: Record<string, unknown>;
};

export type VariantResultPayload = {
  kind: 'variant-result';
  sessionId: string;
  messageId?: string | null;
  variantId: string;
  variantAngle?: string;
  hypothesis?: string;
  successMetric?: string;
  sentCount?: number;
  openRate?: number;
  replyRate?: number;
  clickRate?: number;
  meetingsBooked?: number;
  hypothesisConfirmed?: 'yes' | 'no' | 'unclear';
  notes?: string;
};

export type OutcomeRecordPayload =
  | RecommendationFeedbackPayload
  | RecommendationActionPayload
  | VariantResultPayload;

export interface MemoryExtractionInput {
  sessionId: string;
  userQuery: string;
  assistantAnswer: string;
  existingMemory: UserMemory;
}

export interface MemoryExtractionResult {
  update: Record<string, unknown>;
}
