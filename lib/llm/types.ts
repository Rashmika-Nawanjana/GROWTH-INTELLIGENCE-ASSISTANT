export type LlmProviderId = 'gemini' | 'vertex';

export type LlmGenerateOptions = {
  model?: string;
  maxNewTokens?: number;
  temperature?: number;
  /** Gemini 2.5 thinking budget; 0 disables, -1 = dynamic. */
  thinkingBudget?: number;
  /** When set, provider returns application/json matching this schema. */
  responseSchema?: Record<string, unknown>;
};

/** Google service-account key (subset used by google-auth-library). */
export type GoogleServiceAccountCredentials = {
  type: 'service_account';
  project_id: string;
  private_key: string;
  client_email: string;
  [key: string]: unknown;
};

export type GoogleProviderConfig = {
  provider: LlmProviderId;
  model: string;
  /** Gemini Developer API key (provider=gemini). */
  apiKey?: string;
  /** Vertex / GCP project id (provider=vertex). */
  projectId?: string;
  location: string;
  platformType: 'gai' | 'gcp';
  /** Inline service-account JSON from GOOGLE_SERVICE_ACCOUNT_JSON. */
  credentials?: GoogleServiceAccountCredentials;
};
