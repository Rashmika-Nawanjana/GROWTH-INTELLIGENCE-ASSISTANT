"""Research agents package — six specialist domain agents."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from . import (
    adjacent,
    competitive,
    market_trends,
    positioning,
    pricing,
    win_loss,
)
from .execution_intent import EXECUTION_INTENT_PATTERNS, detect_execution_intent
from .refine_utils import build_feedback_summary, build_refinement_deltas, normalize_fact

AgentRunFn = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]

RESEARCH_AGENTS: list[dict[str, Any]] = [
    {
        "id": market_trends.AGENT_ID,
        "name": market_trends.AGENT_NAME,
        "description": market_trends.AGENT_DESCRIPTION,
        "run": market_trends.run,
    },
    {
        "id": competitive.AGENT_ID,
        "name": competitive.AGENT_NAME,
        "description": competitive.AGENT_DESCRIPTION,
        "run": competitive.run,
    },
    {
        "id": win_loss.AGENT_ID,
        "name": win_loss.AGENT_NAME,
        "description": win_loss.AGENT_DESCRIPTION,
        "run": win_loss.run,
    },
    {
        "id": pricing.AGENT_ID,
        "name": pricing.AGENT_NAME,
        "description": pricing.AGENT_DESCRIPTION,
        "run": pricing.run,
    },
    {
        "id": positioning.AGENT_ID,
        "name": positioning.AGENT_NAME,
        "description": positioning.AGENT_DESCRIPTION,
        "run": positioning.run,
    },
    {
        "id": adjacent.AGENT_ID,
        "name": adjacent.AGENT_NAME,
        "description": adjacent.AGENT_DESCRIPTION,
        "run": adjacent.run,
    },
]

AGENT_BY_ID: dict[str, dict[str, Any]] = {a["id"]: a for a in RESEARCH_AGENTS}

__all__ = [
    "RESEARCH_AGENTS",
    "AGENT_BY_ID",
    "AgentRunFn",
    "EXECUTION_INTENT_PATTERNS",
    "detect_execution_intent",
    "build_feedback_summary",
    "build_refinement_deltas",
    "normalize_fact",
    "market_trends",
    "competitive",
    "win_loss",
    "pricing",
    "positioning",
    "adjacent",
]
