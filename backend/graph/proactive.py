import asyncio
import json
import logging
from pathlib import Path

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).parent.parent / "data"
_MODEL = "claude-sonnet-4-6"

_GREETING_SYSTEM_PROMPT = """You are WealthMind's proactive financial intelligence system.
Greet the user and summarise the top financial opportunities identified for them today.

Rules:
- Be direct and specific — use real dollar figures from the findings
- Lead with the highest-impact finding
- Mention 2-3 specific opportunities with exact amounts in CAD
- End with an invitation to explore further
- Keep it to 3-4 sentences
- Format amounts as $X,XXX
- Never say "As an AI"
- Do not start with "I" """

_DOMAIN_LABELS = ["allocation", "tax_implications", "tlh", "rate_arbitrage", "timing"]


def _make_state(portfolio: dict, cra_rules: dict) -> dict:
    """Create a fresh GraphState dict for a single agent invocation."""
    return {
        "financial_profile": portfolio,
        "cra_rules": cra_rules,
        "domain_findings": {},
        "synthesized_insights": [],
        "hitl_status": "pending",
        "run_id": "proactive",
    }


async def generate_proactive_greeting(user_id: int, db) -> dict:
    """
    Run all 5 domain agents against the live portfolio snapshot in parallel.
    Return the top 3 findings by dollar_impact plus a synthesized greeting.

    Returns:
    {
        "message": str,
        "top_findings": [ ...finding dicts with "_source" tag ... ],
        "agent_sources": [ "allocation", "timing", ... ]
    }
    """
    from graph.agents import (
        allocation_agent,
        rate_arbitrage_agent,
        tax_implications_agent,
        timing_agent,
        tlh_agent,
    )
    from services.portfolio import get_portfolio_snapshot

    portfolio = await get_portfolio_snapshot(user_id, db)
    cra_rules = json.loads((_DATA_DIR / "cra_rules_2024.json").read_text())

    # Run all 5 agents in parallel — each gets its own fresh state dict
    # to prevent concurrent dict-mutation conflicts.
    results = await asyncio.gather(
        allocation_agent(_make_state(portfolio, cra_rules)),
        tax_implications_agent(_make_state(portfolio, cra_rules)),
        tlh_agent(_make_state(portfolio, cra_rules)),
        rate_arbitrage_agent(_make_state(portfolio, cra_rules)),
        timing_agent(_make_state(portfolio, cra_rules)),
        return_exceptions=True,
    )

    all_findings: list[dict] = []
    agent_sources: list[str] = []

    for i, result in enumerate(results):
        label = _DOMAIN_LABELS[i]
        if isinstance(result, Exception):
            logger.error("Proactive agent %s failed: %s", label, result)
            continue
        domain_findings: dict = result.get("domain_findings", {})
        domain_had_findings = False
        for findings in domain_findings.values():
            for f in findings:
                f["_source"] = label
            all_findings.extend(findings)
            if findings:
                domain_had_findings = True
        if domain_had_findings:
            agent_sources.append(label)

    # Sort by dollar_impact descending and take top 3
    all_findings.sort(
        key=lambda f: float(f.get("dollar_impact", 0)), reverse=True
    )
    top_findings = all_findings[:3]

    message = await _synthesize_greeting(top_findings, portfolio)

    return {
        "message": message,
        "top_findings": top_findings,
        "agent_sources": agent_sources,
    }


async def _synthesize_greeting(top_findings: list[dict], portfolio: dict) -> str:
    user_content = json.dumps(
        {
            "top_findings": top_findings,
            "portfolio_summary": {
                "total_value_cad": portfolio.get("total_value_cad"),
                "total_gain_loss_cad": portfolio.get("total_gain_loss_cad"),
            },
        },
        indent=2,
    )

    llm = ChatAnthropic(model=_MODEL, max_tokens=512)

    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=_GREETING_SYSTEM_PROMPT),
                HumanMessage(content=user_content),
            ]
        )
        return response.content.strip()
    except Exception as exc:
        logger.error("Proactive greeting synthesis failed: %s", exc)
        total = portfolio.get("total_value_cad", 0)
        return (
            f"Welcome back to WealthMind. Your portfolio is worth ${total:,.2f} CAD. "
            "I've identified several opportunities — ask me anything to explore them."
        )
