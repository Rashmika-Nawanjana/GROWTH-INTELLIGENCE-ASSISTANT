/**
 * Per-model pricing (USD per 1M tokens).
 * Gemini 2.5 Flash list prices as of early 2026 — override via env for accuracy.
 */
const DEFAULT_RATES: Record<string, { inputPerM: number; outputPerM: number }> = {
  'gemini-2.5-flash': { inputPerM: 0.15, outputPerM: 0.60 },
  'gemini-2.5-flash-lite': { inputPerM: 0.075, outputPerM: 0.30 },
  'gemini-2.0-flash': { inputPerM: 0.10, outputPerM: 0.40 },
  'gemini-embedding-001': { inputPerM: 0.01, outputPerM: 0 },
};

function envRate(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getLlmRates(model: string): { inputPerM: number; outputPerM: number } {
  const normalized = model.toLowerCase();
  const match = Object.entries(DEFAULT_RATES).find(([key]) => normalized.includes(key));
  const base = match?.[1] ?? DEFAULT_RATES['gemini-2.5-flash'];
  return {
    inputPerM: envRate('LLM_PRICE_INPUT_PER_M', base.inputPerM),
    outputPerM: envRate('LLM_PRICE_OUTPUT_PER_M', base.outputPerM),
  };
}

export function getEmbeddingRatePerM(): number {
  return envRate('EMBED_PRICE_PER_M', 0.01);
}

export function estimateLlmCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const { inputPerM, outputPerM } = getLlmRates(model);
  const cost =
    (inputTokens / 1_000_000) * inputPerM +
    (outputTokens / 1_000_000) * outputPerM;
  return Number.parseFloat(cost.toFixed(6));
}

export function estimateEmbeddingCostUsd(estimatedTokens: number): number {
  const rate = getEmbeddingRatePerM();
  const cost = (estimatedTokens / 1_000_000) * rate;
  return Number.parseFloat(cost.toFixed(6));
}

/** Rough token estimate when provider omits usage_metadata. */
export function estimateTokensFromChars(charCount: number): number {
  return Math.max(1, Math.ceil(charCount / 4));
}

export function getPricingTableForUi(): {
  llmInputPerM: number;
  llmOutputPerM: number;
  embedPerM: number;
  defaultModel: string;
} {
  const defaultModel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  const rates = getLlmRates(defaultModel);
  return {
    llmInputPerM: rates.inputPerM,
    llmOutputPerM: rates.outputPerM,
    embedPerM: getEmbeddingRatePerM(),
    defaultModel,
  };
}
