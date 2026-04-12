/**
 * E2E check: execution intent triggers Stage 2.
 *
 * Validates the deterministic regex detector in orchestrator.ts. These queries
 * gate whether the Execution Engine runs, so this suite is mission-critical for
 * the demo flow — miss a "give me 3 LinkedIn variants" and judges see research
 * output only.
 *
 * We import `detectExecutionIntent` directly from the orchestrator so the test
 * stays pinned to the real patterns. No duplication, no drift.
 */

import { describe, it, expect } from 'vitest';
import { detectExecutionIntent } from '@/lib/agents/execution-intent';

describe('execution intent detector', () => {
  describe('should trigger execution (runExecution = true)', () => {
    const positive = [
      // ── Original baseline ──
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

      // ── Real demo-critical edge prompts ──
      // Numeric + artifact quantity ("give me 3 LinkedIn variants")
      'give me 3 LinkedIn variants',
      'give me 5 cold email variants for SDRs',
      'show me 3 message variants tied to our pricing gap',
      'send me 2 LinkedIn hooks for enterprise CTOs',

      // Lower-case, no punctuation, casual phrasing
      'draft 3 cold emails',
      'make a campaign brief',
      'write me a pitch for the landing page',
      'compose an outbound sequence',
      'create a nurture sequence for mid-market',

      // Trailing punctuation and question form
      'Can you draft a cold email?',
      'Could you generate A/B test variants for us?',
      'Please write a LinkedIn post.',

      // Multi-line / multi-sentence that still contains a trigger
      'We need messaging. Draft a LinkedIn post about the launch.',
      'Context: Q3 push. Generate 3 cold email variants.',

      // Unusual artifact casing
      'write COLD EMAIL copy for the ICP',
      'DRAFT a one-pager targeting CROs',

      // "test angles" / hypothesis phrasings the old tests missed
      'what test angles should we run for the ICP?',
      'give me falsifiable hypotheses for our outreach',
      'I need three variants with hypotheses',

      // A/B test spelling variants
      'suggest a/b test ideas for our cold email',
      'run an AB test on our subject lines',

      // Outreach deployment verbs
      'roll out the outreach sequence to the CTO list',
      'deploy a new ad campaign',
    ];

    for (const q of positive) {
      it(`"${q}"`, () => {
        expect(detectExecutionIntent(q)).toBe(true);
      });
    }
  });

  describe('should NOT trigger execution (runExecution = false)', () => {
    const negative = [
      // ── Pure research questions ──
      'Is Lilian competitive in the AI SDR market?',
      'Compare Vector Agents vs 11x.ai',
      'What is the market for digital workers?',
      'Is the category accelerating or consolidating?',
      'Who are the top competitors in AI SDR?',
      'What pricing does Artisan charge?',

      // ── Empty / whitespace ──
      '',
      '   ',

      // ── Questions that *mention* execution nouns but don't ask for them ──
      'What cold email strategies are competitors using?',
      'How is Artisan positioning their outreach product?',
      'What does the LinkedIn landscape look like for AI SDR?',
      'Which campaign brief frameworks are most common in B2B?',
      'Are competitors running A/B tests on their landing pages?',

      // ── Informational queries about variants/hypotheses as concepts ──
      'Explain why hypothesis-driven marketing works',
      'What are variants in A/B testing?',
    ];

    for (const q of negative) {
      it(`"${q || '(empty)'}"`, () => {
        expect(detectExecutionIntent(q)).toBe(false);
      });
    }
  });
});
