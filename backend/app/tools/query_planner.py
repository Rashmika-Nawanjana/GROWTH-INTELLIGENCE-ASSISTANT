"""Query planner — mirrors lib/tools/query-planner.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Callable, TypedDict

from app.models import IntelligenceDomain


class QueryBundle(TypedDict):
    broad: str
    targeted: str
    hypothesis: str
    keywords: list[str]


class QueryPlanContext(TypedDict, total=False):
    product: str
    competitor: str | None
    domain: IntelligenceDomain
    query: str
    category: str | None
    audience: str | None


def _current_years() -> tuple[int, int]:
    year = datetime.now().year
    return year, year + 1


def _compact_join(parts: list[str | None]) -> str:
    return " ".join(p.strip() for p in parts if isinstance(p, str) and p.strip())


def _normalize_category(ctx: QueryPlanContext) -> str:
    category = ctx.get("category")
    if category and category.strip():
        return category.strip()
    return f"{ctx['product']} category"


def _normalize_competitor(ctx: QueryPlanContext) -> str:
    competitor = ctx.get("competitor")
    if competitor and competitor.strip():
        return competitor.strip()
    return "top competitors"


def _market_trends(ctx: QueryPlanContext) -> QueryBundle:
    year, next_year = _current_years()
    category = _normalize_category(ctx)
    product = ctx["product"]
    return {
        "broad": f"{product} market trends {year} {next_year} growth industry",
        "targeted": (
            f'site:reddit.com OR site:indiehackers.com OR site:x.com OR site:twitter.com '
            f'OR site:linkedin.com OR site:instagram.com "{product}" "{category}" trending growth'
        ),
        "hypothesis": f'"{product}" OR "{category}" (accelerating OR consolidating OR emerging) adoption',
        "keywords": [
            "growth", "trends", "adoption", "market", "category", "revenue",
            "x.com", "linkedin", "instagram",
        ],
    }


def _competitive(ctx: QueryPlanContext) -> QueryBundle:
    year, next_year = _current_years()
    competitor = _normalize_competitor(ctx)
    product = ctx["product"]
    return {
        "broad": f"{competitor} {product} features pricing positioning",
        "targeted": (
            f'site:linkedin.com OR site:x.com OR site:twitter.com OR site:instagram.com '
            f'"{competitor}" ("new feature" OR "just launched" OR positioning) {year} {next_year}'
        ),
        "hypothesis": f"{competitor} vs {product} differentiation competitive advantage",
        "keywords": [
            "feature", "competitor", "pricing", "positioning", "launch",
            "announcement", "linkedin", "x.com", "instagram",
        ],
    }


def _win_loss(ctx: QueryPlanContext) -> QueryBundle:
    competitor = _normalize_competitor(ctx)
    product = ctx["product"]
    return {
        "broad": f"why choose {competitor} over {product} review comparison",
        "targeted": f'site:g2.com OR site:capterra.com "{product}" review pros cons',
        "hypothesis": f"buyers switching from {product} to {competitor} reasons",
        "keywords": ["review", "comparison", "alternative", "why", "better", "difference"],
    }


def _pricing(ctx: QueryPlanContext) -> QueryBundle:
    competitor = _normalize_competitor(ctx)
    category = _normalize_category(ctx)
    product = ctx["product"]
    return {
        "broad": f"{product} pricing cost per seat willingness to pay {competitor}",
        "targeted": (
            f'site:reddit.com OR site:x.com OR site:linkedin.com OR site:instagram.com '
            f'"{product}" pricing (expensive OR cheap OR worth)'
        ),
        "hypothesis": f"pricing model SaaS {category} (ROI OR cost savings OR CAC)",
        "keywords": [
            "pricing", "cost", "willingness", "CAC", "ROI", "per-seat",
            "x.com", "linkedin", "instagram",
        ],
    }


def _positioning(ctx: QueryPlanContext) -> QueryBundle:
    competitor = _normalize_competitor(ctx)
    product = ctx["product"]
    return {
        "broad": f"{product} messaging positioning brand USP vs {competitor}",
        "targeted": (
            f'site:linkedin.com OR site:x.com OR site:twitter.com OR site:instagram.com '
            f'"{product}" brand message positioning ("think like" OR "move like")'
        ),
        "hypothesis": f"positioning gap {product} market opportunity messaging",
        "keywords": [
            "positioning", "messaging", "USP", "brand", "audience", "claim",
            "x.com", "linkedin", "instagram",
        ],
    }


def _adjacent(ctx: QueryPlanContext) -> QueryBundle:
    year, next_year = _current_years()
    category = _normalize_category(ctx)
    product = ctx["product"]
    return {
        "broad": (
            f"companies disrupting {product} category adjacent market threat "
            f"{year} {next_year}"
        ),
        "targeted": (
            f'site:crunchbase.com OR site:techcrunch.com "{category}" funding disruption threat'
        ),
        "hypothesis": f"platform expansion AI agents threat to {product} category",
        "keywords": ["threat", "disruption", "adjacent", "platform", "expansion", "funding"],
    }


def _execution_engine(ctx: QueryPlanContext) -> QueryBundle:
    category = _normalize_category(ctx)
    product = ctx["product"]
    return {
        "broad": f"{product} outreach email templates campaign copy examples",
        "targeted": (
            f'site:linkedin.com OR site:x.com OR site:instagram.com '
            f'"{product}" campaign message copy best practices'
        ),
        "hypothesis": f"high-performing {category} outreach email hooks ROI angle",
        "keywords": [
            "outreach", "copy", "email", "campaign", "hook", "variant",
            "linkedin", "x.com", "instagram",
        ],
    }


def _mirofish(ctx: QueryPlanContext) -> QueryBundle:
    year, next_year = _current_years()
    category = _normalize_category(ctx)
    product = ctx["product"]
    return {
        "broad": f"{product} forecast prediction market sizing TAM revenue projection",
        "targeted": (
            f'site:crunchbase.com OR site:techcrunch.com "{category}" market size growth projection'
        ),
        "hypothesis": (
            f"{product} category market expansion forecast {year} {next_year} opportunity"
        ),
        "keywords": ["forecast", "TAM", "market size", "projection", "growth", "opportunity"],
    }


TEMPLATES: dict[IntelligenceDomain, Callable[[QueryPlanContext], QueryBundle]] = {
    "market-trends": _market_trends,
    "competitive": _competitive,
    "win-loss": _win_loss,
    "pricing": _pricing,
    "positioning": _positioning,
    "adjacent": _adjacent,
    "execution-engine": _execution_engine,
    "mirofish": _mirofish,
    "mirofish-live": _mirofish,
}


def plan_queries(ctx: QueryPlanContext) -> QueryBundle:
    normalized: QueryPlanContext = {
        **ctx,
        "product": ctx["product"].strip(),
        "query": _compact_join([ctx.get("query", "")]).strip(),
    }
    if ctx.get("competitor"):
        normalized["competitor"] = ctx["competitor"].strip()  # type: ignore[index]
    if ctx.get("category"):
        normalized["category"] = ctx["category"].strip()  # type: ignore[index]
    if ctx.get("audience"):
        normalized["audience"] = ctx["audience"].strip()  # type: ignore[index]

    generator = TEMPLATES.get(ctx["domain"])
    if not generator:
        query = normalized["query"]
        return {
            "broad": query,
            "targeted": (
                f"{query} site:reddit.com OR site:linkedin.com OR site:x.com "
                f"OR site:twitter.com OR site:instagram.com"
            ),
            "hypothesis": f"{query} (ROI OR impact OR competitive)",
            "keywords": query.split()[:5],
        }
    return generator(normalized)


def extract_keywords(bundle: QueryBundle) -> set[str]:
    stop_words = {"site", "and", "the", "for", "with", "from"}
    all_terms: list[str] = []
    for key in ("keywords", "broad", "targeted", "hypothesis"):
        value = bundle[key]
        if isinstance(value, list):
            all_terms.extend(value)
        else:
            all_terms.extend(str(value).split())

    filtered = [
        t.lower()
        for t in all_terms
        if len(t) > 3 and t.lower() not in stop_words
    ]
    return set(filtered[:15])
