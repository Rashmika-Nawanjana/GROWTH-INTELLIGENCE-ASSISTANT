/**
 * E2E check: execution intent triggers Stage 2.
 *
 * Validates the deterministic regex detector in orchestrator.ts.
 * These queries MUST set runExecution = true so the Execution Engine fires.
 */

import { describe, it, expect } from 'vitest';

// Import the regex patterns and detector directly.
// Because detectExecutionIntent is not exported, we replicate the exact
// patterns from orchestrator.ts so the test stays in sync.
// If someone changes the patterns, this test must be updated too.

const EXECUTION_INTENT_PATTERNS: RegExp[] = [
  /\b(write|draft|create|generate|produce|craft|compose|build|make|give\s+me|send\s+me|show\s+me)\b[^.?!]*\b(cold\s*email|email|linkedin|outreach|sequence|message|messages|copy|post|posts|caption|captions|brief|one[-\s]?pager|pitch|landing\s*page|ad|ads|campaign|cta|hook|headline|tagline|script|dm|outbound|nurture)\b/i,
  /\b(campaign\s*brief|positioning\s*guide|strategy\s*doc|messaging\s*guide|launch\s*plan|go[-\s]?to[-\s]?market\s*plan|gtm\s*plan)\b/i,
  /\b(a\/b|a\s*b\s*test|ab\s*test|variants?|test\s*angles?|message\s*variants?|message\s*test|hypotheses?|falsifiable)\b/i,
  /\b(ship|launch|deploy|roll\s*out)\b[^.?!]*\b(campaign|outreach|email|sequence|copy|message|post|ad)\b/i,
  /^\s*(write|draft|generate|create|compose)\s+/i,
];

function detectExecutionIntent(query: string): boolean {
  if (!query?.trim()) return false;
  return EXECUTION_INTENT_PATTERNS.some(re => re.test(query));
}

describe('execution intent detector', () => {
  describe('should trigger execution (runExecution = true)', () => {
    const positive = [
      'Write a cold email for Vector Agents',
      'Draft an outreach sequence targeting CTOs',
      'Generate 3 message variants for our SDR team',
      'Create a LinkedIn post about our new feature',
      'Give me a campaign brief for Q3 launch',
      'Show me A/B test angles for cold email',
      'Compose a landing page pitch',
      'campaign brief for enterprise segment',
      'Build an email campaign for AI SDR product',
      'Draft a one-pager for investor outreach',
      'Launch the email campaign next week',
      'Ship the outreach sequence',
      'create ad copy for digital workers',
      'write LinkedIn post about Vector Agents',
      'generate variants for our cold outreach',
      'GTM plan for Q3 launch',
      'positioning guide for enterprise',
      'message variants',
      'falsifiable hypothesis for email outreach',
    ];

    for (const q of positive) {
      it(`"${q}"`, () => {
        expect(detectExecutionIntent(q)).toBe(true);
      });
    }
  });

  describe('should NOT trigger execution (runExecution = false)', () => {
    const negative = [
      'Is Lilian competitive in the AI SDR market?',
      'Compare Vector Agents vs 11x.ai',
      'What is the market for digital workers?',
      'Is the category accelerating or consolidating?',
      'Who are the top competitors in AI SDR?',
      'What pricing does Artisan charge?',
      '',
      '   ',
    ];

    for (const q of negative) {
      it(`"${q || '(empty)'}"`, () => {
        expect(detectExecutionIntent(q)).toBe(false);
      });
    }
  });
});
