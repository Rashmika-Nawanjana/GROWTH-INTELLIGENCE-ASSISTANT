import type { AgentOutput, RefinementDelta } from '@/lib/agents/types';

// Turn raw outcome rows into a compact text block the execution sub-agents can
// read as part of `priorContext`. Deliberately human-readable so Gemini can
// reason over it directly.
export function buildFeedbackSummary(
  feedback: Array<Record<string, unknown>>,
  actions: Array<Record<string, unknown>>,
  variantResults: Array<Record<string, unknown>>,
  focus?: string,
): string {
  const lines: string[] = ['[USER FEEDBACK & OUTCOMES — treat these as the highest-priority signal]'];

  if (focus) lines.push(`Refinement focus: ${focus}`);

  // Recommendations the user liked / disliked
  const likes = feedback.filter(f => f.rating === 'up').map(f => `+ liked: ${f.title}`);
  const dislikes = feedback.filter(f => f.rating === 'down').map(f => `- rejected: ${f.title}${f.note ? ` (${f.note})` : ''}`);

  if (likes.length) lines.push('Recommendations the user validated:', ...likes);
  if (dislikes.length) lines.push('Recommendations the user rejected (do NOT repeat these angles):', ...dislikes);

  // Accepted / refined actions — strong positive signal
  const accepted = actions.filter(a => a.action === 'accepted' || a.action === 'refined').map(a => `~ ${a.action}: ${a.title}`);
  if (accepted.length) lines.push('Actions the user took:', ...accepted);

  // Variant outcomes — the real gold
  if (variantResults.length) {
    lines.push('Variant performance from prior runs:');
    for (const r of variantResults) {
      const parts: string[] = [`  ${r.variant_id}${r.variant_angle ? ` (${r.variant_angle})` : ''}`];
      if (r.sent_count) parts.push(`sent=${r.sent_count}`);
      if (r.open_rate != null) parts.push(`open=${r.open_rate}%`);
      if (r.reply_rate != null) parts.push(`reply=${r.reply_rate}%`);
      if (r.click_rate != null) parts.push(`click=${r.click_rate}%`);
      if (r.meetings_booked) parts.push(`meetings=${r.meetings_booked}`);
      if (r.hypothesis_confirmed) parts.push(`hypothesis=${r.hypothesis_confirmed}`);
      if (r.notes) parts.push(`what_resonated="${String(r.notes).slice(0, 160)}"`);
      lines.push(parts.join(' | '));
    }

    lines.push(
      '',
      'REFINEMENT RULES:',
      '- Keep hypotheses that were confirmed; drop or rewrite hypotheses that were rejected.',
      '- If a variant performed well (reply_rate > 3% or hypothesis=yes), generate a NEW variant that extends its winning angle, not a copy.',
      '- If a variant underperformed (reply_rate < 1% or hypothesis=no), explicitly test the opposite angle.',
      '- Do not reuse identical subject lines or hooks from prior variants.',
    );
  }

  return lines.join('\n');
}

export function normalizeFact(fact: string): string {
  return fact.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function buildRefinementDeltas(previous: AgentOutput[], next: AgentOutput[]): RefinementDelta[] {
  const previousByDomain = new Map(previous.map(o => [o.domain, o]));

  return next
    .filter(o => o.artifactType !== 'mind-map')
    .map((current): RefinementDelta => {
      const prior = previousByDomain.get(current.domain);
      if (!prior) {
        return {
          domain: current.domain,
          summary: `New ${current.domain} output added in this refined cycle.`,
          afterConfidence: current.confidence,
        };
      }

      const confidenceShift = current.confidenceScore - prior.confidenceScore;
      const priorFacts = new Set(prior.facts.map(normalizeFact));
      const newFacts = current.facts.filter(f => !priorFacts.has(normalizeFact(f)));

      if (Math.abs(confidenceShift) >= 0.08) {
        const direction = confidenceShift > 0 ? 'increased' : 'decreased';
        return {
          domain: current.domain,
          summary: `${current.domain} confidence ${direction} from ${prior.confidence} to ${current.confidence}.`,
          beforeConfidence: prior.confidence,
          afterConfidence: current.confidence,
        };
      }

      if (newFacts.length > 0) {
        return {
          domain: current.domain,
          summary: `${current.domain} added new evidence: ${newFacts[0].slice(0, 140)}.`,
          beforeConfidence: prior.confidence,
          afterConfidence: current.confidence,
        };
      }

      return {
        domain: current.domain,
        summary: `${current.domain} direction retained with refreshed validation from latest feedback context.`,
        beforeConfidence: prior.confidence,
        afterConfidence: current.confidence,
      };
    })
    .slice(0, 8);
}