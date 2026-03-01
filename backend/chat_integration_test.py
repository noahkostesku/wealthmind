"""
Integration test for the WealthMind conversational AI layer.

Covers:
  1. Create chat session — confirm proactive greeting has real dollar figures
  2. Send "Should I sell my SHOP.TO position?" — confirm routing to tax_implications + tlh
  3. Confirm response mentions SHOP.TO and contains dollar amounts
  4. Send "What if I harvested the CNQ.TO loss at the same time?" — confirm follow-up chips
  5. Test what-if: rrsp_contribution with amount=5000 — confirm delta comparison returned
"""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
os.environ.setdefault("DATABASE_URL", "sqlite:///./chat_integration_test.db")

import logging
logging.basicConfig(level=logging.WARNING)

from database import AsyncSessionLocal, Conversation, create_tables, seed_demo_user
from graph.proactive import generate_proactive_greeting
from graph.router import conversation_router
from graph.synthesizer import generate_follow_up_chips, synthesize_response
from graph.state import GraphState
from graph.agents import (
    allocation_agent, tax_implications_agent,
    tlh_agent, rate_arbitrage_agent, timing_agent,
)
from services.portfolio import get_portfolio_snapshot
from sqlalchemy import select

CHECKS_PASSED = 0
CHECKS_FAILED = 0

CRA_RULES = {"year": 2024, "tfsa_limit": 7000, "rrsp_limit_pct": 0.18}


def check(label: str, condition: bool, detail: str = "") -> None:
    global CHECKS_PASSED, CHECKS_FAILED
    status = "PASS" if condition else "FAIL"
    if condition:
        CHECKS_PASSED += 1
    else:
        CHECKS_FAILED += 1
    msg = f"  [{status}] {label}"
    if detail:
        msg += f" — {detail}"
    print(msg)


# ---------------------------------------------------------------------------
# Test 1: Proactive greeting
# ---------------------------------------------------------------------------

async def test_proactive_greeting(user_id: int, db) -> dict:
    print("\n=== 1. PROACTIVE GREETING ===")
    greeting_data = await generate_proactive_greeting(user_id, db)

    check("Greeting message is non-empty", bool(greeting_data.get("message")))
    check("Top findings returned", len(greeting_data.get("top_findings", [])) > 0,
          f"{len(greeting_data.get('top_findings', []))} findings")
    check("Agent sources listed", len(greeting_data.get("agent_sources", [])) > 0,
          str(greeting_data.get("agent_sources")))

    message = greeting_data.get("message", "")
    has_dollar = "$" in message
    check("Greeting contains dollar figure", has_dollar, message[:120])

    # Top findings must have dollar_impact > 0
    top = greeting_data.get("top_findings", [])
    if top:
        check(
            "Top finding has positive dollar_impact",
            float(top[0].get("dollar_impact", 0)) > 0,
            str(top[0].get("dollar_impact")),
        )
        check("Top finding has _source tag", "_source" in top[0], str(top[0].get("_source")))

    return greeting_data


# ---------------------------------------------------------------------------
# Test 2: Conversation routing — SHOP.TO sell question
# ---------------------------------------------------------------------------

async def test_routing_sell_question(last_findings: dict) -> dict:
    print("\n=== 2. ROUTING — SHOP.TO SELL QUESTION ===")
    message = "Should I sell my SHOP.TO position?"
    routing = await conversation_router(message, [], last_findings)

    agents = routing.get("agents_to_invoke", [])
    check("Routing returned agents_to_invoke", isinstance(agents, list), str(agents))
    check(
        "tax_implications in routing",
        "tax_implications" in agents,
        str(agents),
    )
    check("tlh in routing", "tlh" in agents, str(agents))
    check(
        "allocation NOT in routing (sell question, not contribution)",
        "allocation" not in agents,
        str(agents),
    )
    check("routing_reasoning present", bool(routing.get("routing_reasoning")))
    check("can_answer_from_context is False", routing.get("can_answer_from_context") is False)

    return routing


# ---------------------------------------------------------------------------
# Test 3: Full chat response — SHOP.TO sell
# ---------------------------------------------------------------------------

async def test_chat_response_shop(user_id: int, db) -> tuple[str, dict]:
    print("\n=== 3. CHAT RESPONSE — SHOP.TO SELL ===")
    portfolio = await get_portfolio_snapshot(user_id, db)
    cra_rules = {"year": 2024, "tfsa_limit": 7000, "rrsp_limit_pct": 0.18}

    def make_state():
        return {
            "financial_profile": portfolio,
            "cra_rules": cra_rules,
            "domain_findings": {},
            "synthesized_insights": [],
            "hitl_status": "pending",
            "run_id": "chat-test",
        }

    import asyncio
    tax_result, tlh_result = await asyncio.gather(
        tax_implications_agent(make_state()),
        tlh_agent(make_state()),
        return_exceptions=True,
    )

    domain_findings: dict = {}
    for result in [tax_result, tlh_result]:
        if not isinstance(result, Exception):
            domain_findings.update(result.get("domain_findings", {}))

    check("Tax and TLH agents produced findings",
          any(len(v) > 0 for v in domain_findings.values()),
          str({k: len(v) for k, v in domain_findings.items()}))

    message = "Should I sell my SHOP.TO position?"
    response = await synthesize_response(message, domain_findings, [])

    check("Response is non-empty", bool(response))
    check(
        "Response mentions SHOP",
        "SHOP" in response.upper(),
        response[:120],
    )
    has_dollar = "$" in response
    check("Response contains dollar amount", has_dollar, response[:120])
    check("Response is ≥ 2 sentences", response.count(".") >= 2, f"{response.count('.')} periods")

    return response, domain_findings


# ---------------------------------------------------------------------------
# Test 4: Follow-up chips
# ---------------------------------------------------------------------------

async def test_follow_up_chips(response: str, domain_findings: dict) -> None:
    print("\n=== 4. FOLLOW-UP CHIPS ===")
    message = "What if I harvested the CNQ.TO loss at the same time?"
    chips = await generate_follow_up_chips(message, response, domain_findings)

    check("Follow-up chips returned", isinstance(chips, list), str(chips))
    check("2-3 chips generated", 2 <= len(chips) <= 3, f"{len(chips)} chip(s)")
    if chips:
        check("Each chip is a non-empty string", all(isinstance(c, str) and c for c in chips))
        # At least one chip should reference a number or ticker
        has_specific = any(
            any(char.isdigit() or char == "$" for char in c) or
            any(t in c.upper() for t in ["SHOP", "CNQ", "RRSP", "TFSA", "FHSA"])
            for c in chips
        )
        check("At least one chip has specific number or ticker", has_specific, str(chips))


# ---------------------------------------------------------------------------
# Test 5: What-if endpoint logic
# ---------------------------------------------------------------------------

async def test_whatif(user_id: int, db) -> None:
    print("\n=== 5. WHAT-IF: RRSP CONTRIBUTION $5,000 ===")
    import copy

    baseline = await get_portfolio_snapshot(user_id, db)
    cra_rules = {"year": 2024, "tfsa_limit": 7000, "rrsp_limit_pct": 0.18}

    # Apply what-if modification
    amount = 5000.0
    modified = copy.deepcopy(baseline)
    for acct in modified["accounts"]:
        if acct["account_type"] == "rrsp":
            room = acct.get("contribution_room_remaining") or 0
            acct["contribution_room_remaining"] = max(0.0, room - amount)
            acct["balance_cad"] = acct.get("balance_cad", 0.0) + amount
            acct["total_value_cad"] = acct.get("total_value_cad", 0.0) + amount
    if modified.get("contribution_room", {}).get("rrsp") is not None:
        modified["contribution_room"]["rrsp"] = max(
            0.0, (modified["contribution_room"]["rrsp"] or 0) - amount
        )

    check(
        "Modified RRSP contribution_room reduced by $5,000",
        (baseline["contribution_room"].get("rrsp") or 0) - (modified["contribution_room"].get("rrsp") or 0) == amount,
        f"baseline={baseline['contribution_room'].get('rrsp')} modified={modified['contribution_room'].get('rrsp')}",
    )

    def make_state(portfolio):
        return {
            "financial_profile": portfolio,
            "cra_rules": cra_rules,
            "domain_findings": {},
            "synthesized_insights": [],
            "hitl_status": "pending",
            "run_id": "whatif-test",
        }

    import asyncio
    baseline_results, modified_results = await asyncio.gather(
        asyncio.gather(
            allocation_agent(make_state(baseline)),
            timing_agent(make_state(baseline)),
            return_exceptions=True,
        ),
        asyncio.gather(
            allocation_agent(make_state(modified)),
            timing_agent(make_state(modified)),
            return_exceptions=True,
        ),
    )

    def collect(results) -> list[dict]:
        out = []
        for r in results:
            if not isinstance(r, Exception):
                for findings in r.get("domain_findings", {}).values():
                    out.extend(findings)
        return out

    bf = collect(baseline_results)
    mf = collect(modified_results)

    check("Baseline findings returned", len(bf) > 0, f"{len(bf)} findings")
    check("Modified findings returned", len(mf) > 0, f"{len(mf)} findings")

    # Build delta
    b_by_title = {f["title"]: f for f in bf}
    m_by_title = {f["title"]: f for f in mf}
    all_titles = set(b_by_title) | set(m_by_title)
    delta = []
    for title in all_titles:
        b = b_by_title.get(title, {})
        m = m_by_title.get(title, {})
        b_impact = float(b.get("dollar_impact", 0))
        m_impact = float(m.get("dollar_impact", 0))
        delta.append({
            "title": title,
            "baseline_dollar_impact": b_impact,
            "modified_dollar_impact": m_impact,
            "delta_dollar_impact": round(m_impact - b_impact, 2),
        })

    check("Delta comparison built", len(delta) > 0, f"{len(delta)} delta entries")
    check(
        "Delta entries have required keys",
        all("delta_dollar_impact" in d for d in delta),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    print("=" * 60)
    print("WealthMind Chat Integration Test")
    print("=" * 60)

    db_path = Path(__file__).parent / "chat_integration_test.db"
    if db_path.exists():
        db_path.unlink()

    await create_tables()
    await seed_demo_user()

    async with AsyncSessionLocal() as db:
        users_result = await db.execute(
            select(__import__("database").User)
        )
        user = users_result.scalar_one()
        user_id = user.id

        greeting_data = await test_proactive_greeting(user_id, db)
        last_findings = {"greeting_data": greeting_data}

        routing = await test_routing_sell_question(last_findings)
        response, domain_findings = await test_chat_response_shop(user_id, db)
        await test_follow_up_chips(response, domain_findings)
        await test_whatif(user_id, db)

    print(f"\n{'=' * 60}")
    print("FINAL RESULT")
    print("=" * 60)
    print(f"  Passed: {CHECKS_PASSED}")
    print(f"  Failed: {CHECKS_FAILED}")

    if db_path.exists():
        db_path.unlink()

    if CHECKS_FAILED > 0:
        print("\nWARNING: Some checks failed. Review output above.")
        sys.exit(1)
    else:
        print("\nAll chat integration checks passed.")


if __name__ == "__main__":
    asyncio.run(main())
