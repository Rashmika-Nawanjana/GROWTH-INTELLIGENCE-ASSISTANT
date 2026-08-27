"""Growth intelligence tools — Python ports of lib/tools/*."""

from .apify_twitter import scrape_twitter_x
from .fallback import (
    build_tool_result,
    compute_signal_quality_penalty,
    extract_tool_results,
    summarise_tool_health,
)
from .firecrawl import scrape_competitor_pricing, scrape_page
from .hn_algolia import get_tech_sentiment, search_hn, search_hn_comments
from .linkedin_ads import scrape_competitor_linkedin_ads, scrape_linkedin_ads
from .meta_ads import get_ad_messaging, search_meta_ads
from .patents import company_patents, search_patents
from .query_planner import extract_keywords, plan_queries
from .reddit import search_product_reviews, search_reddit, search_subreddits
from .serpapi import search_ads_transparency, search_news, search_trends, search_web
from .source_validator import (
    filter_and_rank_sources,
    filter_display_sources,
    is_trusted_source,
    is_valid_source_url,
)

__all__ = [
    # SerpAPI
    "search_web",
    "search_news",
    "search_trends",
    "search_ads_transparency",
    # Firecrawl
    "scrape_page",
    "scrape_competitor_pricing",
    # Reddit
    "search_reddit",
    "search_product_reviews",
    "search_subreddits",
    # HN
    "search_hn",
    "search_hn_comments",
    "get_tech_sentiment",
    # Meta / LinkedIn ads
    "search_meta_ads",
    "get_ad_messaging",
    "scrape_linkedin_ads",
    "scrape_competitor_linkedin_ads",
    # Patents
    "search_patents",
    "company_patents",
    # Apify
    "scrape_twitter_x",
    # Query planner
    "plan_queries",
    "extract_keywords",
    # Source validation
    "is_valid_source_url",
    "is_trusted_source",
    "filter_and_rank_sources",
    "filter_display_sources",
    # Fallback utilities
    "build_tool_result",
    "compute_signal_quality_penalty",
    "extract_tool_results",
    "summarise_tool_health",
]
