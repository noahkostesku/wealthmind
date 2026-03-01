"""
Trade interception service.

Before a trade executes, runs domain agents against a simulated
post-trade portfolio and surfaces material findings (delta > $50).
Completes within 8 seconds or returns should_intercept=False.
"""

import asyncio
import copy
import json
import logging
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from graph.agents import (
    allocation_agent,
    rate_arbitrage_agent,
    tax_implications_agent,
    tlh_agent,
)
from graph.state import GraphState
from services.portfolio import get_portfolio_snapshot

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).parent.parent / "data"

_AGENT_MAP = {
    "tax_implications": tax_implications_agent,
    "tlh": tlh_agent,
    "allocation": allocation_agent,
    "rate_arbitrage": rate_arbitrage_agent,
}


def _load_cra_rules() -> dict:
    return json.loads((_DATA_DIR / "cra_rules_2024.json").read_text())


def _simulate_trade(
    portfolio: dict, account_id: int, ticker: str, shares: float, action: str
) -> dict:
    """Deep-copy portfolio and apply the hypothetical trade to it."""
    p = copy.deepcopy(portfolio)
    ticker_upper = ticker.upper()

    for acct in p["accounts"]:
        if acct["id"] != account_id:
            continue

        # Find current price from existing position (or leave as-is)
        price = next(
            (pos["current_price"] for pos in acct["positions"]
             if pos["ticker"].upper() == ticker_upper),
            None,
        )
        if price is None:
            break

        trade_value = round(shares * price, 2)

        if action == "sell":
            new_positions = []
            for pos in acct["positions"]:
                if pos["ticker"].upper() == ticker_upper:
                    remaining = pos["shares"] - shares
                    if remaining > 0.0001:
                        np = dict(pos)
                        np["shares"] = remaining
                        np["current_value_cad"] = round(remaining * pos["current_price"], 2)
                        np["unrealized_gain_loss_cad"] = round(
                            remaining * (pos["current_price"] - pos["avg_cost_cad"]), 2
                        )
                        new_positions.append(np)
                    # else position fully sold — omit
                else:
                    new_positions.append(pos)
            acct["positions"] = new_positions
            acct["balance_cad"] = round(acct.get("balance_cad", 0.0) + trade_value, 2)

        elif action == "buy":
            found = False
            for pos in acct["positions"]:
                if pos["ticker"].upper() == ticker_upper:
                    old_shares = pos["shares"]
                    new_shares = old_shares + shares
                    old_cost = old_shares * pos["avg_cost_cad"]
                    new_avg = (old_cost + trade_value) / new_shares
                    pos["shares"] = new_shares
                    pos["avg_cost_cad"] = round(new_avg, 4)
                    pos["current_value_cad"] = round(new_shares * pos["current_price"], 2)
                    pos["unrealized_gain_loss_cad"] = round(
                        new_shares * (pos["current_price"] - new_avg), 2
                    )
                    found = True
                    break
            if not found:
                acct["positions"].append({
                    "ticker": ticker_upper,
                    "name": ticker_upper,
                    "shares": shares,
                    "avg_cost_cad": price,
                    "current_price": price,
                    "current_value_cad": trade_value,
                    "unrealized_gain_loss_cad": 0.0,
                    "unrealized_gain_loss_pct": 0.0,
                    "asset_type": "stock",
                    "held_days": 0,
                    "change_pct": 0.0,
                })
            acct["balance_cad"] = round(acct.get("balance_cad", 0.0) - trade_value, 2)
        break

    return p


def _select_agents(
    portfolio: dict, account_id: int, ticker: str, action: str
) -> list[str]:
    """Choose the minimum set of agents relevant to this trade."""
    agents = ["tax_implications"]  # always — every trade has tax implications

    target = next((a for a in portfolio["accounts"] if a["id"] == account_id), None)
    if not target:
        return agents

    if action == "sell":
        # Check if this position has an unrealized gain
        pos = next(
            (p for p in target["positions"]
             if p["ticker"].upper() == ticker.upper()),
            None,
        )
        has_gain = pos and pos.get("unrealized_gain_loss_cad", 0) > 0
        # Check if any portfolio-wide losses exist
        any_losses = any(
            p.get("unrealized_gain_loss_cad", 0) < 0
            for a in portfolio["accounts"]
            for p in a.get("positions", [])
        )
        if has_gain and any_losses:
            agents.append("tlh")

    if target.get("account_type") in ("rrsp", "tfsa", "fhsa"):
        agents.append("allocation")

    if action == "buy":
        agents.append("rate_arbitrage")

    return agents


def _build_state(portfolio: dict, cra_rules: dict, run_id: str) -> GraphState:
    return {
        "financial_profile": portfolio,
        "cra_rules": cra_rules,
        "domain_findings": {},
        "synthesized_insights": [],
        "hitl_status": "pending",
        "run_id": run_id,
    }


async def intercept_trade(
    user_id: int,
    account_id: int,
    ticker: str,
    shares: float,
    action: str,
    db: AsyncSession,
) -> dict:
    """
    Simulate the trade and run relevant agents against the simulated portfolio.
    Returns { should_intercept, urgency, headline, findings, better_alternative,
              proceed_anyway_label } or { should_intercept: false }.
    Times out after 8 seconds and returns should_intercept=False.
    """

    async def _run() -> dict:
        portfolio = await get_portfolio_snapshot(user_id, db)
        simulated = _simulate_trade(portfolio, account_id, ticker, shares, action)
        agents_to_run = _select_agents(portfolio, account_id, ticker, action)
        cra_rules = _load_cra_rules()
        run_id = f"intercept-{ticker}-{action}"

        state = _build_state(simulated, cra_rules, run_id)

        agents_valid = [a for a in agents_to_run if a in _AGENT_MAP]
        logger.info(
            "intercept_trade: running agents %s for %s %s (acct %s)",
            agents_valid, action, ticker, account_id,
        )
        results = await asyncio.gather(
            *[_AGENT_MAP[a](state) for a in agents_valid],
            return_exceptions=True,
        )

        all_findings: list[dict] = []
        for agent_name, result in zip(agents_valid, results):
            if isinstance(result, Exception):
                logger.error("intercept_trade: agent %s raised: %s", agent_name, result)
            else:
                agent_findings = list(result.get("domain_findings", {}).values())
                finding_count = sum(len(fl) for fl in agent_findings)
                logger.info(
                    "intercept_trade: agent %s returned %d finding(s)",
                    agent_name, finding_count,
                )
                for findings_list in agent_findings:
                    all_findings.extend(findings_list)

        # Only surface findings with dollar impact >= $50
        material = [f for f in all_findings if abs(f.get("dollar_impact", 0)) >= 50]
        if not material:
            logger.info(
                "intercept_trade: no material findings (>=$50) for %s %s — not intercepting",
                action, ticker,
            )
            return {"should_intercept": False}

        material.sort(key=lambda f: abs(f.get("dollar_impact", 0)), reverse=True)
        top = material[0]

        urgency_map = {
            "immediate": "warning",
            "this_month": "warning",
            "evergreen": "info",
        }
        urgency = urgency_map.get(top.get("urgency", "evergreen"), "info")

        # Build headline from top finding
        headline = top.get("title", "")
        impact = top.get("dollar_impact", 0)
        direction = top.get("impact_direction", "")
        if impact and not headline.endswith("."):
            headline = f"{headline} — ${impact:,.0f} {direction} at stake."

        # Better alternative from TLH findings
        better_alternative: str | None = None
        tlh_hits = [
            f for f in material
            if any(kw in (f.get("title", "") + f.get("what_to_do", "")).lower()
                   for kw in ("harvest", "loss", "tlh", "offset"))
        ]
        if tlh_hits:
            better_alternative = tlh_hits[0].get("what_to_do")

        action_label = "Sell" if action == "sell" else "Buy"
        return {
            "should_intercept": True,
            "urgency": urgency,
            "headline": headline,
            "findings": material[:3],
            "better_alternative": better_alternative,
            "proceed_anyway_label": f"{action_label} {ticker.upper()} anyway",
        }

    try:
        return await asyncio.wait_for(_run(), timeout=8.0)
    except asyncio.TimeoutError:
        logger.warning("intercept_trade timed out for %s %s (acct %s)", action, ticker, account_id)
        return {"should_intercept": False}
    except Exception as exc:
        logger.error("intercept_trade failed: %s", exc)
        return {"should_intercept": False}
