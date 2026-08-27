"""Pydantic models mirroring lib/agents/types.ts — camelCase aliases for frontend."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


def to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


class CamelModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        extra="allow",
    )


ConfidenceLevel = Literal["high", "medium", "low"]
AgentStatus = Literal["pending", "running", "completed", "failed"]
ToolName = Literal[
    "serpapi", "firecrawl", "reddit", "hn", "apify", "synthesis", "mirofish", "mirofish-live"
]
IntelligenceDomain = Literal[
    "market-trends",
    "competitive",
    "win-loss",
    "pricing",
    "positioning",
    "adjacent",
    "execution-engine",
    "mirofish",
    "mirofish-live",
]
ArtifactType = Literal[
    "trend-chart",
    "competitive-matrix",
    "win-loss-scorecard",
    "pricing-table",
    "positioning-gap",
    "threat-heatmap",
    "mind-map",
    "scorecard",
    "execution-plan",
    "forecast-chart",
]


def score_to_level(score: float) -> ConfidenceLevel:
    if score >= 0.75:
        return "high"
    if score >= 0.5:
        return "medium"
    return "low"


class AgentSource(CamelModel):
    url: str
    title: str
    timestamp: str
    tool: ToolName


class AgentRun(CamelModel):
    agent_id: str
    name: str
    status: AgentStatus
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None


class AgentOutput(CamelModel):
    agent_id: str
    domain: IntelligenceDomain
    confidence: ConfidenceLevel
    confidence_score: float
    facts: list[str] = Field(default_factory=list)
    interpretation: list[str] = Field(default_factory=list)
    sources: list[AgentSource] = Field(default_factory=list)
    generated_at: str
    artifact_type: ArtifactType


class ImageAttachment(CamelModel):
    data: str
    mime_type: str


class ConversationMessage(CamelModel):
    role: Literal["user", "assistant"]
    content: str
    images: Optional[list[ImageAttachment]] = None
    agent_output: Optional[dict[str, Any]] = None
    timestamp: Optional[str] = None


class AgentContext(CamelModel):
    query: str
    product: str
    competitor: Optional[str] = None
    product_url: Optional[str] = None
    competitor_url: Optional[str] = None
    prior_context: Optional[str] = None
    images: Optional[list[ImageAttachment]] = None
    memory_context: Optional[str] = None
    research_outputs: Optional[list[dict[str, Any]]] = None


class Recommendation(CamelModel):
    title: str
    rationale: str
    evidence: list[str] = Field(default_factory=list)
    confidence: ConfidenceLevel = "medium"
    priority: Literal["immediate", "short-term", "strategic"] = "short-term"


class RunMetrics(CamelModel):
    total_latency_ms: int
    agent_latencies: dict[str, float] = Field(default_factory=dict)
    estimated_cost_usd: float
    tool_call_count: int
    gemini_call_count: int
    agent_count: int
    completed_agent_count: int
    failed_agent_count: int


class FeedbackAppliedCounts(CamelModel):
    recommendation_feedback: int = 0
    recommendation_actions: int = 0
    variant_results: int = 0


class RefinementDelta(CamelModel):
    domain: IntelligenceDomain
    summary: str
    before_confidence: Optional[ConfidenceLevel] = None
    after_confidence: Optional[ConfidenceLevel] = None


class RefinementInfo(CamelModel):
    refined_from_message_id: str
    focus: Optional[str] = None
    feedback_applied: FeedbackAppliedCounts
    deltas: list[RefinementDelta] = Field(default_factory=list)
    feedback_summary: str = ""


class OrchestratorOutput(CamelModel):
    query: str
    product: str
    competitor: Optional[str] = None
    agent_runs: list[AgentRun] = Field(default_factory=list)
    outputs: list[dict[str, Any]] = Field(default_factory=list)
    synthesized_answer: str = ""
    top_recommendations: list[Recommendation] = Field(default_factory=list)
    suggested_follow_ups: list[str] = Field(default_factory=list)
    total_confidence: ConfidenceLevel = "medium"
    generated_at: str = ""
    metrics: Optional[RunMetrics] = None
    refinement: Optional[RefinementInfo] = None


# ── Tool types ────────────────────────────────────────────────────────────────

ToolStatus = Literal["ok", "degraded", "failed"]


class ToolResult(CamelModel):
    data: Any
    source: str
    source_url: Optional[str] = None
    timestamp: str
    confidence: float
    status: Optional[ToolStatus] = None
    cached: bool = False


class SearchResult(CamelModel):
    title: str
    url: str
    snippet: str
    date: Optional[str] = None


class TrendPoint(CamelModel):
    date: str
    value: float
    keyword: str


class RedditPost(CamelModel):
    title: str
    subreddit: str
    score: int
    url: str
    snippet: str
    created: str
    sentiment: Optional[Literal["positive", "negative", "neutral"]] = None


class HNPost(CamelModel):
    title: str
    url: str
    score: int
    author: str
    created: str
    comment_count: int = 0


class ScrapedPage(CamelModel):
    url: str
    title: str
    markdown: str
    excerpt: str


class MetaAd(CamelModel):
    id: str
    page_name: str
    ad_creative_body: Optional[str] = None
    ad_creative_link_title: Optional[str] = None
    ad_delivery_start_time: Optional[str] = None
    spend: Optional[dict[str, str]] = None
    ad_snapshot_url: Optional[str] = None


# ── Chat request ──────────────────────────────────────────────────────────────

class ChatRequest(CamelModel):
    query: str
    history: list[ConversationMessage] = Field(default_factory=list)
    images: list[ImageAttachment] = Field(default_factory=list)
    memory_context: Optional[str] = None
    include_mirofish: bool = False
    include_mirofish_live: bool = False
    follow_up_mode: Literal["full", "targeted"] = "full"
    selected_agents: list[str] = Field(default_factory=list)


class LiveMetrics(CamelModel):
    elapsed_ms: int
    agent_count: int
    completed_agent_count: int
    failed_agent_count: int
    running_agent_count: int
    estimated_cost_usd: float
    gemini_call_count: int
    tool_call_count: int
