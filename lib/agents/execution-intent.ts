// Deterministic execution-intent detector.
//
// Lives in its own file (no other imports) so regression tests can load it
// without pulling in the full orchestrator, agents, and tool clients — several
// of which create API clients at module import time and would blow up in a
// test environment that has no secrets.
//
// The patterns are intentionally biased toward generation verbs combined with
// marketing/outreach artifacts — they should not fire on pure research
// questions like "compare X vs Y" or "what is the market for X".

export const EXECUTION_INTENT_PATTERNS: RegExp[] = [
  // verb + artifact ("write a cold email", "draft an outreach sequence",
  //                   "give me 3 LinkedIn variants")
  /\b(write|draft|create|generate|produce|craft|compose|build|make|give\s+me|send\s+me|show\s+me)\b[^.?!]*\b(cold\s*email|email|linkedin|outreach|sequence|message|messages|copy|post|posts|caption|captions|brief|one[-\s]?pager|pitch|landing\s*page|ad|ads|campaign|cta|hook|hooks|headline|headlines|tagline|taglines|script|scripts|dm|dms|outbound|nurture|variant|variants|hypothesis|hypotheses)\b/i,
  // explicit framings — only fires when the phrase is a direct request.
  // "campaign brief for Q3" → trigger. "Which campaign brief frameworks are
  // most common?" → do NOT trigger (user is asking ABOUT briefs, not FOR one).
  // We gate on an informational preface ("which|what|how|why|when|where|are|do|does|is|explain|compare")
  // that, if present before the artifact, disqualifies the match.
  /^(?!.*\b(which|what|how|why|when|where|are|do|does|is|explain|compare|describe|tell\s+me\s+about)\b[^.?!]*\b(campaign\s*brief|positioning\s*guide|strategy\s*doc|messaging\s*guide|launch\s*plan|go[-\s]?to[-\s]?market\s*plan|gtm\s*plan))\b[^.?!]*\b(campaign\s*brief|positioning\s*guide|strategy\s*doc|messaging\s*guide|launch\s*plan|go[-\s]?to[-\s]?market\s*plan|gtm\s*plan)\b/i,
  // A/B testing language — imperative form (verb before artifact).
  // Fires when paired with a request framing so informational questions
  // like "what are variants?" don't trip.
  /\b(write|draft|create|generate|produce|craft|compose|build|make|give\s+me|send\s+me|show\s+me|suggest|run|need|want|i\s+need|we\s+need)\b[^.?!]*\b(a\/b\s*test|ab\s*test|a\s*b\s*test|variants?|test\s*angles?|message\s*variants?|message\s*test|hypotheses?|falsifiable)\b/i,
  // A/B testing — artifact-before-verb form. Catches sentences like
  // "what test angles should we run for X" where the artifact comes first
  // and the imperative verb ("run", "ship", "send") trails it.
  /\b(a\/b\s*test|ab\s*test|a\s*b\s*test|variants?|test\s*angles?|message\s*variants?|hypotheses?|falsifiable)\b[^.?!]*\b(should\s+(?:we|i|you)|we\s+should|i\s+should|we\s+need|i\s+need)\b[^.?!]*\b(run|write|draft|create|generate|send|ship|deploy|launch|test|try)\b/i,
  // Bare A/B testing artifact phrases ("message variants", "falsifiable
  // hypothesis for ..."). Kept separate from the imperative form so short
  // queries still trigger but generic informational mentions don't.
  /\b(message\s*variants?|falsifiable\s+hypothes[ei]s)\b/i,
  // ship / launch / deploy / roll out verbs paired with marketing artifact
  /\b(ship|launch|deploy|roll\s*out)\b[^.?!]*\b(campaign|outreach|email|sequence|copy|message|post|ad|ads)\b/i,
  // bare imperatives that almost always mean "generate something"
  /^\s*(write|draft|generate|create|compose|make)\s+/i,
];

export function detectExecutionIntent(query: string): boolean {
  if (!query?.trim()) return false;
  return EXECUTION_INTENT_PATTERNS.some(re => re.test(query));
}
