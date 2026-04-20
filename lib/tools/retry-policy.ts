// Retry policy — domain-specific strategies for handling flaky sites.
// e.g. LinkedIn, Twitter require special handling; standard sites have simple fallback.

export interface RetryPolicy {
  maxAttempts: number;
  delayMs: number;
  useFirecrawlStrict?: boolean;  // use Firecrawl with stricter render options
  useBrowserFallback?: boolean;  // try browser-based scrape if available
  useSearchSnippets?: boolean;   // use search results as degraded signal
  description: string;
}

// Domain-specific retry strategies
const DOMAIN_POLICIES: Record<string, RetryPolicy> = {
  'linkedin.com': {
    maxAttempts: 3,
    delayMs: 2000,
    useFirecrawlStrict: true,
    useBrowserFallback: true,
    useSearchSnippets: true,
    description: 'LinkedIn — heavily anti-bot; multiple fallbacks',
  },

  'twitter.com': {
    maxAttempts: 2,
    delayMs: 1000,
    useSearchSnippets: true,
    description: 'Twitter — limited scrape access; prefer search snippets',
  },

  'facebook.com': {
    maxAttempts: 2,
    delayMs: 1000,
    useFirecrawlStrict: true,
    description: 'Facebook — JS-heavy, ad library scrape only',
  },

  'g2.com': {
    maxAttempts: 2,
    delayMs: 500,
    useBrowserFallback: true,
    description: 'G2 Reviews — requires browser render',
  },

  'capterra.com': {
    maxAttempts: 2,
    delayMs: 500,
    useBrowserFallback: true,
    description: 'Capterra Reviews — requires browser render',
  },

  'reddit.com': {
    maxAttempts: 1,
    delayMs: 0,
    description: 'Reddit — JSON API is primary; direct scrape rarely needed',
  },

  'crunchbase.com': {
    maxAttempts: 2,
    delayMs: 1000,
    useSearchSnippets: true,
    description: 'Crunchbase — limited free scrape access',
  },

  // Default policy for unknown domains
  default: {
    maxAttempts: 2,
    delayMs: 500,
    useSearchSnippets: false,
    description: 'Standard site — Firecrawl primary, direct fetch fallback',
  },
};

/**
 * Get the retry policy for a domain.
 */
export function getPolicyForDomain(url: string): RetryPolicy {
  try {
    const hostname = new URL(url).hostname || '';
    for (const [domain, policy] of Object.entries(DOMAIN_POLICIES)) {
      if (hostname.includes(domain)) {
        return policy;
      }
    }
  } catch {
    // invalid URL, use default
  }
  return DOMAIN_POLICIES.default;
}

/**
 * Compute backoff delay for retry attempt.
 * Exponential backoff: base delay * 2^(attempt-1)
 */
export function computeRetryDelay(policy: RetryPolicy, attemptNumber: number): number {
  const baseDelay = policy.delayMs;
  const exponentialMultiplier = Math.pow(2, Math.max(0, attemptNumber - 1));
  // Add jitter (±20%)
  const jitter = (Math.random() - 0.5) * 0.4 * baseDelay;
  return Math.max(0, baseDelay * exponentialMultiplier + jitter);
}

/**
 * Summary of retry policy for logging.
 */
export function describePolicyForLogging(url: string): string {
  const policy = getPolicyForDomain(url);
  return `${policy.description} (max ${policy.maxAttempts} attempts, ${policy.delayMs}ms base delay)`;
}
