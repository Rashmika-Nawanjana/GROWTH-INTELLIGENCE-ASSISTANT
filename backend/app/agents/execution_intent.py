"""Deterministic execution-intent detector (parity with lib/agents/execution-intent.ts)."""

from __future__ import annotations

import re

# Intentionally biased toward generation verbs combined with marketing/outreach
# artifacts — they should not fire on pure research questions like "compare X vs Y"
# or "what is the market for X".
EXECUTION_INTENT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"\b(write|draft|create|generate|produce|craft|compose|build|make|give\s+me|send\s+me|show\s+me)\b[^.?!]*\b("
        r"cold\s*email|email|linkedin|outreach|sequence|message|messages|copy|post|posts|caption|captions|brief|"
        r"one[-\s]?pager|pitch|landing\s*page|ad|ads|campaign|cta|hook|hooks|headline|headlines|tagline|taglines|"
        r"script|scripts|dm|dms|outbound|nurture|variant|variants|hypothesis|hypotheses)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?!.*\b(which|what|how|why|when|where|are|do|does|is|explain|compare|describe|tell\s+me\s+about)\b[^.?!]*\b("
        r"campaign\s*brief|positioning\s*guide|strategy\s*doc|messaging\s*guide|launch\s*plan|"
        r"go[-\s]?to[-\s]?market\s*plan|gtm\s*plan))\b[^.?!]*\b("
        r"campaign\s*brief|positioning\s*guide|strategy\s*doc|messaging\s*guide|launch\s*plan|"
        r"go[-\s]?to[-\s]?market\s*plan|gtm\s*plan)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(write|draft|create|generate|produce|craft|compose|build|make|give\s+me|send\s+me|show\s+me|suggest|run|"
        r"need|want|i\s+need|we\s+need)\b[^.?!]*\b("
        r"a\/b\s*test|ab\s*test|a\s*b\s*test|variants?|test\s*angles?|message\s*variants?|message\s*test|"
        r"hypotheses?|falsifiable)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(a\/b\s*test|ab\s*test|a\s*b\s*test|variants?|test\s*angles?|message\s*variants?|hypotheses?|falsifiable)\b"
        r"[^.?!]*\b(should\s+(?:we|i|you)|we\s+should|i\s+should|we\s+need|i\s+need)\b[^.?!]*\b("
        r"run|write|draft|create|generate|send|ship|deploy|launch|test|try)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b(message\s*variants?|falsifiable\s+hypothes[ei]s)\b", re.IGNORECASE),
    re.compile(
        r"\b(ship|launch|deploy|roll\s*out)\b[^.?!]*\b(campaign|outreach|email|sequence|copy|message|post|ad|ads)\b",
        re.IGNORECASE,
    ),
    re.compile(r"^\s*(write|draft|generate|create|compose|make)\s+", re.IGNORECASE),
]


def detect_execution_intent(query: str) -> bool:
    if not query or not query.strip():
        return False
    return any(pattern.search(query) for pattern in EXECUTION_INTENT_PATTERNS)
