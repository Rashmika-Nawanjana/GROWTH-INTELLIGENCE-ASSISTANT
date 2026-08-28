export {
  getUserMemoryServer,
  getUserMemoryWithContext,
  upsertUserMemory,
  buildMemoryUpdateFromExchange,
  updateUserMemoryFromExchange,
  EMPTY_USER_MEMORY,
} from './user-memory';
export type { UserMemoryWithContext } from './user-memory';

export { recallSimilarTurns } from './recall';
export type { RecallSimilarTurnsInput } from './recall';

export {
  getPastOutcomes,
  getPastOutcomesWithTimeout,
  recordOutcome,
  DEFAULT_OUTCOMES_LIMIT,
  MAX_SUMMARY_BLOCK_CHARS,
} from './outcomes';
export type { GetPastOutcomesInput } from './outcomes';

export type {
  RecallHit,
  RecallResult,
  OutcomeScope,
  PastOutcomesResult,
  OutcomeRecordPayload,
  RecommendationFeedbackPayload,
  RecommendationActionPayload,
  VariantResultPayload,
  MemoryExtractionInput,
  MemoryExtractionResult,
} from './types';
