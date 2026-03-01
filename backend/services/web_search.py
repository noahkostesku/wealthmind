"""
DuckDuckGo web search service for Welly.
Returns news articles and citations relevant to user financial questions.
"""

import asyncio
import logging
import warnings
from typing import TypedDict

logger = logging.getLogger(__name__)

# Suppress the rename warning from duckduckgo_search
warnings.filterwarnings("ignore", message=".*has been renamed.*")


class SearchResult(TypedDict):
    title: str
    url: str
    snippet: str


async def web_search(query: str, max_results: int = 5) -> list[SearchResult]:
    """
    Search DuckDuckGo for articles relevant to a financial query.
    Runs the sync DDGS call in a thread pool to avoid blocking the event loop.
    """
    def _sync_search() -> list[SearchResult]:
        try:
            from duckduckgo_search import DDGS

            results: list[SearchResult] = []
            with DDGS() as ddgs:
                for r in ddgs.text(
                    query,
                    max_results=max_results,
                    region="ca-en",
                ):
                    title = r.get("title", "")
                    href = r.get("href", "")
                    if title and href:
                        results.append(
                            SearchResult(
                                title=title,
                                url=href,
                                snippet=r.get("body", ""),
                            )
                        )
            return results
        except Exception as exc:
            logger.error("DuckDuckGo search failed: %s", exc)
            return []

    return await asyncio.to_thread(_sync_search)


async def news_search(query: str, max_results: int = 5) -> list[SearchResult]:
    """
    Search DuckDuckGo News for recent articles relevant to a financial query.
    This is the primary source — news results are more relevant for financial queries.
    """
    def _sync_search() -> list[SearchResult]:
        try:
            from duckduckgo_search import DDGS

            results: list[SearchResult] = []
            with DDGS() as ddgs:
                for r in ddgs.news(query, max_results=max_results):
                    title = r.get("title", "")
                    url = r.get("url", "")
                    if title and url:
                        results.append(
                            SearchResult(
                                title=title,
                                url=url,
                                snippet=r.get("body", ""),
                            )
                        )
            return results
        except Exception as exc:
            logger.error("DuckDuckGo news search failed: %s", exc)
            return []

    return await asyncio.to_thread(_sync_search)
