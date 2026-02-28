import asyncio
import logging

from langgraph.graph import END, START, StateGraph

from graph.agents import (
    allocation_agent,
    rate_arbitrage_agent,
    tax_implications_agent,
    timing_agent,
    tlh_agent,
)
from graph.state import GraphState

logger = logging.getLogger(__name__)

_REQUIRED_FINDING_KEYS = {
    "title",
    "dollar_impact",
    "impact_direction",
    "urgency",
    "reasoning",
    "confidence",
    "what_to_do",
}


def _is_valid_finding(f: dict) -> bool:
    return _REQUIRED_FINDING_KEYS.issubset(f.keys()) and isinstance(
        f.get("dollar_impact"), (int, float)
    )


async def supervisor_node(state: GraphState) -> dict:
    """Run all five domain agents in parallel and merge their findings."""
    results = await asyncio.gather(
        allocation_agent(state),
        tax_implications_agent(state),
        tlh_agent(state),
        rate_arbitrage_agent(state),
        timing_agent(state),
    )

    merged: dict = {}
    for result in results:
        merged.update(result.get("domain_findings", {}))

    return {"domain_findings": merged}


def synthesis_node(state: GraphState) -> dict:
    """Collect all domain findings, deduplicate, rank by dollar_impact descending."""
    domain_findings: dict = state.get("domain_findings", {})
    all_findings = []

    for domain, findings in domain_findings.items():
        for f in findings:
            if not _is_valid_finding(f):
                logger.warning("Skipping malformed finding in domain %s: %s", domain, f)
                continue
            f["domain"] = domain
            all_findings.append(f)

    # Deduplicate by title (case-insensitive)
    seen_titles: set[str] = set()
    deduped = []
    for f in all_findings:
        key = f["title"].lower().strip()
        if key not in seen_titles:
            seen_titles.add(key)
            deduped.append(f)

    # Rank by dollar_impact descending
    ranked = sorted(deduped, key=lambda f: f["dollar_impact"], reverse=True)

    return {"synthesized_insights": ranked}


def hitl_node(state: GraphState) -> dict:
    """Human-in-the-loop gate — surfaces insights and sets status."""
    return {"hitl_status": "surfaced"}


def compile_graph():
    """Build and compile the WealthMind LangGraph."""
    graph = StateGraph(GraphState)

    graph.add_node("supervisor", supervisor_node)
    graph.add_node("synthesis", synthesis_node)
    graph.add_node("hitl", hitl_node)

    graph.add_edge(START, "supervisor")
    graph.add_edge("supervisor", "synthesis")
    graph.add_edge("synthesis", "hitl")
    graph.add_edge("hitl", END)

    return graph.compile()
