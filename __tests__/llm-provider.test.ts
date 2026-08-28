import { describe, expect, it } from 'vitest';
import {
  getLlmProviderId,
  resolveGoogleProviderConfig,
} from '@/lib/llm/providers/google';

describe('resolveGoogleProviderConfig', () => {
  it('defaults to gemini with API key', () => {
    const config = resolveGoogleProviderConfig(
      {},
      { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-2.5-flash' },
    );
    expect(config.provider).toBe('gemini');
    expect(config.platformType).toBe('gai');
    expect(config.apiKey).toBe('test-key');
    expect(config.model).toBe('gemini-2.5-flash');
  });

  it('accepts GOOGLE_API_KEY as gemini fallback', () => {
    const config = resolveGoogleProviderConfig(
      {},
      { GOOGLE_API_KEY: 'google-key' },
    );
    expect(config.provider).toBe('gemini');
    expect(config.apiKey).toBe('google-key');
  });

  it('throws when gemini has no API key', () => {
    expect(() =>
      resolveGoogleProviderConfig({}, { LLM_PROVIDER: 'gemini' }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it('selects vertex when LLM_PROVIDER=vertex', () => {
    const config = resolveGoogleProviderConfig(
      { model: 'gemini-2.5-pro' },
      {
        LLM_PROVIDER: 'vertex',
        GOOGLE_CLOUD_PROJECT: 'my-gcp-project',
        GOOGLE_CLOUD_LOCATION: 'europe-west1',
      },
    );
    expect(config.provider).toBe('vertex');
    expect(config.platformType).toBe('gcp');
    expect(config.projectId).toBe('my-gcp-project');
    expect(config.location).toBe('europe-west1');
    expect(config.model).toBe('gemini-2.5-pro');
    expect(config.apiKey).toBeUndefined();
  });

  it('derives project from GOOGLE_SERVICE_ACCOUNT_JSON and unwraps a one-element array', () => {
    const sa = {
      type: 'service_account',
      project_id: 'from-json-project',
      private_key: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
      client_email: 'sa@from-json-project.iam.gserviceaccount.com',
    };
    const config = resolveGoogleProviderConfig(
      {},
      {
        LLM_PROVIDER: 'vertex',
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify([sa]),
      },
    );
    expect(config.projectId).toBe('from-json-project');
    expect(config.credentials?.client_email).toBe(sa.client_email);
    expect(config.credentials?.private_key).toBe(sa.private_key);
  });

  it('accepts typo alias GOOGLE_SERVICE_ACCOUNT_JASON', () => {
    const sa = {
      type: 'service_account',
      project_id: 'typo-project',
      private_key: 'key',
      client_email: 'sa@typo-project.iam.gserviceaccount.com',
    };
    const config = resolveGoogleProviderConfig(
      {},
      {
        LLM_PROVIDER: 'vertex',
        GOOGLE_SERVICE_ACCOUNT_JASON: JSON.stringify(sa),
      },
    );
    expect(config.projectId).toBe('typo-project');
    expect(config.credentials?.client_email).toBe(sa.client_email);
  });

  it('throws when vertex has no project and no service account JSON', () => {
    expect(() =>
      resolveGoogleProviderConfig({}, { LLM_PROVIDER: 'vertex' }),
    ).toThrow(/GOOGLE_CLOUD_PROJECT|GOOGLE_SERVICE_ACCOUNT_JSON/);
  });

  it('treats unknown provider values as gemini', () => {
    const config = resolveGoogleProviderConfig(
      {},
      { LLM_PROVIDER: 'openai', GEMINI_API_KEY: 'k' },
    );
    expect(config.provider).toBe('gemini');
  });
});

describe('getLlmProviderId', () => {
  it('returns gemini by default', () => {
    expect(getLlmProviderId({})).toBe('gemini');
  });

  it('returns vertex when set', () => {
    expect(getLlmProviderId({ LLM_PROVIDER: 'VERTEX' })).toBe('vertex');
  });
});
