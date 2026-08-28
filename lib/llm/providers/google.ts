import type {
  GoogleProviderConfig,
  GoogleServiceAccountCredentials,
  LlmGenerateOptions,
  LlmProviderId,
} from '../types';

const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Loose env map so unit tests can pass partial env without ProcessEnv.NODE_ENV. */
export type EnvMap = Record<string, string | undefined>;

/**
 * Parse GOOGLE_SERVICE_ACCOUNT_JSON from env.
 * Accepts a single service-account object, or a one-element array (common paste mistake).
 * Also accepts the typo alias GOOGLE_SERVICE_ACCOUNT_JASON.
 */
export function parseServiceAccountJson(
  raw: string | undefined,
): GoogleServiceAccountCredentials | undefined {
  if (!raw?.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON must be valid JSON (one object on a single line, not an array of many)',
    );
  }

  const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be a service-account object');
  }

  const cred = candidate as Record<string, unknown>;
  if (
    cred.type !== 'service_account' ||
    typeof cred.project_id !== 'string' ||
    typeof cred.private_key !== 'string' ||
    typeof cred.client_email !== 'string'
  ) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is missing type/project_id/private_key/client_email',
    );
  }

  return cred as GoogleServiceAccountCredentials;
}

function readServiceAccountFromEnv(env: EnvMap): GoogleServiceAccountCredentials | undefined {
  // Prefer correct name; keep typo alias so existing .env.local still works after rename.
  return parseServiceAccountJson(
    env.GOOGLE_SERVICE_ACCOUNT_JSON ?? env.GOOGLE_SERVICE_ACCOUNT_JASON,
  );
}

/**
 * Resolve provider config from env (no network). Used by the factory and unit tests.
 */
export function resolveGoogleProviderConfig(
  options: LlmGenerateOptions = {},
  env: EnvMap = process.env,
): GoogleProviderConfig {
  const raw = (env.LLM_PROVIDER ?? 'gemini').trim().toLowerCase();
  const provider: LlmProviderId = raw === 'vertex' ? 'vertex' : 'gemini';
  const model =
    options.model?.trim() ||
    env.GEMINI_MODEL?.trim() ||
    DEFAULT_MODEL;
  const location = env.GOOGLE_CLOUD_LOCATION?.trim() || 'us-central1';

  if (provider === 'vertex') {
    const credentials = readServiceAccountFromEnv(env);
    const projectId =
      env.GOOGLE_CLOUD_PROJECT?.trim() ||
      credentials?.project_id?.trim();

    if (!projectId) {
      throw new Error(
        'LLM_PROVIDER=vertex requires GOOGLE_CLOUD_PROJECT or project_id inside GOOGLE_SERVICE_ACCOUNT_JSON',
      );
    }

    return {
      provider: 'vertex',
      model,
      projectId,
      location,
      platformType: 'gcp',
      ...(credentials ? { credentials } : {}),
    };
  }

  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
  }

  return {
    provider: 'gemini',
    model,
    apiKey,
    location,
    platformType: 'gai',
  };
}

export function getLlmProviderId(env: EnvMap = process.env): LlmProviderId {
  return (env.LLM_PROVIDER ?? 'gemini').trim().toLowerCase() === 'vertex' ? 'vertex' : 'gemini';
}

/**
 * Build a LangChain ChatGoogle instance for the configured provider.
 * - gemini: @langchain/google (AI Studio / Developer API)
 * - vertex: @langchain/google/node (Vertex AI + ADC or GOOGLE_SERVICE_ACCOUNT_JSON)
 */
export async function createGoogleChatModel(options: LlmGenerateOptions = {}) {
  const config = resolveGoogleProviderConfig(options);
  const temperature = options.temperature ?? 0.2;
  const maxOutputTokens = options.maxNewTokens;
  const thinkingBudget =
    options.thinkingBudget ?? Number(process.env.GEMINI_THINKING_BUDGET ?? 0);

  const shared = {
    model: config.model,
    temperature,
    ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
    thinkingBudget,
    ...(options.responseSchema ? { responseSchema: options.responseSchema } : {}),
  };

  if (config.provider === 'vertex') {
    // Dynamic import keeps Vertex/auth deps off the default Gemini path.
    const { ChatGoogle } = await import('@langchain/google/node');
    return new ChatGoogle({
      ...shared,
      platformType: 'gcp',
      vertexai: true,
      location: config.location,
      googleAuthOptions: {
        projectId: config.projectId,
        ...(config.credentials
          ? { credentials: config.credentials }
          : {}),
      },
    });
  }

  const { ChatGoogle } = await import('@langchain/google');
  return new ChatGoogle({
    ...shared,
    apiKey: config.apiKey,
    platformType: 'gai',
  });
}
