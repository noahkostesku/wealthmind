"""
Integration test for the WealthMind backend rebuild.

Covers:
  1. Seed demo user — verify accounts and positions in SQLite
  2. Fetch live prices for SHOP.TO, CNQ.TO, XEQT.TO, VEQT.TO, BTC-CAD
  3. Confirm all prices returned successfully
  4. Run get_portfolio_snapshot() and confirm total_value_cad calculated correctly
  5. Execute mock buy of 5 shares SHOP.TO — confirm position updates
  6. Execute mock sell of 5 shares SHOP.TO — confirm position restores
  7. Run all 5 agents against live snapshot — confirm findings reference real numbers
  8. Confirm GET /portfolio structure is correct
"""

import asyncio
import os
import sys
from pathlib import Path

# Ensure backend root is on path
sys.path.insert(0, str(Path(__file__).parent))

os.environ.setdefault("DATABASE_URL", "sqlite:///./integration_test.db")

import logging
logging.basicConfig(level=logging.WARNING)

from database import (
    Account, AsyncSessionLocal, Position, User,
    create_tables, seed_demo_user,
)
from graph.agents import (
    allocation_agent, rate_arbitrage_agent,
    tax_implications_agent, timing_agent, tlh_agent,
)
from graph.state import GraphState
from services.portfolio import get_portfolio_snapshot
from services.prices import get_multiple_prices
from services.trading import execute_buy, execute_sell
from sqlalchemy import select

CHECKS_PASSED = 0
CHECKS_FAILED = 0

CRA_RULES = {"year": 2024, "tfsa_limit": 7000, "rrsp_limit_pct": 0.18}  # minimal


def check(label: str, condition: bool, detail: str = ""):
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
# Test 1: Seed and verify DB
# ---------------------------------------------------------------------------

async def test_seed(db):
    print("\n=== 1. SEED DEMO USER ===")
    await seed_demo_user()

    users = (await db.execute(select(User))).scalars().all()
    check("Demo user created", len(users) == 1, f"found {len(users)} user(s)")

    user = users[0]
    check("User email correct", user.email == "demo@wealthmind.ca", user.email)
    check("User tier is premium", user.wealthsimple_tier == "premium", user.wealthsimple_tier)

    accounts = (await db.execute(
        select(Account).where(Account.user_id == user.id)
    )).scalars().all()
    acct_types = {a.account_type for a in accounts}
    check(
        "All 7 account types present",
        acct_types >= {"chequing", "tfsa", "rrsp", "non_registered", "fhsa", "margin", "crypto"},
        str(acct_types),
    )

    positions = (await db.execute(
        select(Position).where(Position.user_id == user.id)
    )).scalars().all()
    tickers = {p.ticker for p in positions}
    check("XEQT.TO in RRSP", "XEQT.TO" in tickers, str(tickers))
    check("SHOP.TO in non-registered", "SHOP.TO" in tickers, str(tickers))
    check("CNQ.TO in non-registered", "CNQ.TO" in tickers, str(tickers))
    check("BTC-CAD in crypto", "BTC-CAD" in tickers, str(tickers))
    check("ETH-CAD in crypto", "ETH-CAD" in tickers, str(tickers))

    # Demo data seeds 6 positions: XEQT.TO (RRSP), SHOP.TO/CNQ.TO/VEQT.TO (non_reg), BTC-CAD/ETH-CAD (crypto)
    check("At least 6 positions seeded", len(positions) >= 6, f"got {len(positions)}")

    return user.id


# ---------------------------------------------------------------------------
# Test 2 + 3: Live prices
# ---------------------------------------------------------------------------

async def test_prices():
    print("\n=== 2. LIVE PRICE FETCH ===")
    test_tickers = ["SHOP.TO", "CNQ.TO", "XEQT.TO", "VEQT.TO", "BTC-CAD"]
    prices = await get_multiple_prices(test_tickers)

    for ticker in test_tickers:
        data = prices.get(ticker, {})
        price = data.get("cad_price") or data.get("price", 0)
        check(
            f"Price returned for {ticker}",
            price > 0 and "error" not in data,
            f"${price:.2f}" if price > 0 else str(data.get("error", "no price")),
        )

    return prices


# ---------------------------------------------------------------------------
# Test 4: Portfolio snapshot
# ---------------------------------------------------------------------------

async def test_portfolio_snapshot(user_id: int, db):
    print("\n=== 3. PORTFOLIO SNAPSHOT ===")
    snapshot = await get_portfolio_snapshot(user_id, db)

    total = snapshot["total_value_cad"]
    check("total_value_cad > 0", total > 0, f"${total:,.2f}")
    check("accounts list present", len(snapshot["accounts"]) > 0, f"{len(snapshot['accounts'])} accounts")
    check("allocation by_account_type present", bool(snapshot["allocation"]["by_account_type"]))
    check("contribution_room has tfsa", snapshot["contribution_room"].get("tfsa") is not None)
    check("margin data present", "debit_balance" in snapshot["margin"])

    # Sanity: total should be > $50k given demo data
    check(
        "Total portfolio value is plausible (> $50k CAD)",
        total > 50_000,
        f"${total:,.2f}",
    )

    return snapshot


# ---------------------------------------------------------------------------
# Test 5 + 6: Mock buy and sell
# ---------------------------------------------------------------------------

async def test_trading(user_id: int, snapshot: dict, db):
    print("\n=== 4. MOCK BUY / SELL ===")

    # Find the non-registered self-directed account
    nr_acct = next(
        (a for a in snapshot["accounts"] if a["account_type"] == "non_registered"),
        None,
    )
    if not nr_acct:
        check("non_registered account found for trading", False, "not found")
        return

    acct_id = nr_acct["id"]
    initial_balance = nr_acct["balance_cad"]

    # Fetch SHOP.TO positions before buy
    pos_before = (await db.execute(
        select(Position).where(Position.account_id == acct_id, Position.ticker == "SHOP.TO")
    )).scalar_one_or_none()
    shares_before = pos_before.shares if pos_before else 0.0

    mock_price = 120.00  # Use a fixed price for reproducibility
    buy_total = 5 * mock_price

    # Add cash to account so we can buy (non-reg likely has $1200 cash)
    # We top up if needed
    from database import Account as AccountModel
    acct_row = (await db.execute(
        select(AccountModel).where(AccountModel.id == acct_id)
    )).scalar_one()
    if acct_row.balance_cad < buy_total:
        acct_row.balance_cad = buy_total + 1000
        await db.commit()

    # Execute buy
    buy_result = await execute_buy(user_id, acct_id, "SHOP.TO", 5, mock_price, db)
    check("Buy executed successfully", buy_result["success"], str(buy_result.get("success")))
    check("Buy returns position data", "position" in buy_result)
    check("Buy returns transaction data", "transaction" in buy_result)

    pos_after_buy = (await db.execute(
        select(Position).where(Position.account_id == acct_id, Position.ticker == "SHOP.TO")
    )).scalar_one_or_none()
    shares_after_buy = pos_after_buy.shares if pos_after_buy else 0.0
    check(
        f"SHOP.TO shares increased by 5 (was {shares_before:.2f}, now {shares_after_buy:.2f})",
        abs((shares_after_buy - shares_before) - 5) < 0.01,
    )

    # Execute sell
    sell_result = await execute_sell(user_id, acct_id, "SHOP.TO", 5, mock_price, db)
    check("Sell executed successfully", sell_result["success"])
    check("Sell returns proceeds", "proceeds_cad" in sell_result)
    check(
        f"Sell proceeds match buy cost (${sell_result.get('proceeds_cad', 0):,.2f})",
        abs(sell_result.get("proceeds_cad", 0) - buy_total) < 0.01,
    )

    pos_after_sell = (await db.execute(
        select(Position).where(Position.account_id == acct_id, Position.ticker == "SHOP.TO")
    )).scalar_one_or_none()
    shares_after_sell = pos_after_sell.shares if pos_after_sell else 0.0
    check(
        f"SHOP.TO shares restored to {shares_before:.2f} (now {shares_after_sell:.2f})",
        abs(shares_after_sell - shares_before) < 0.01,
    )


# ---------------------------------------------------------------------------
# Test 7: Agents against live snapshot
# ---------------------------------------------------------------------------

async def test_agents(snapshot: dict):
    print("\n=== 5. AGENT RUN AGAINST LIVE SNAPSHOT ===")

    state: GraphState = {
        "financial_profile": snapshot,
        "cra_rules": CRA_RULES,
        "domain_findings": {},
        "synthesized_insights": [],
        "hitl_status": "pending",
        "run_id": "integration-test",
    }

    agents = [
        ("allocation", allocation_agent),
        ("tax", tax_implications_agent),
        ("tlh", tlh_agent),
        ("rates", rate_arbitrage_agent),
        ("timing", timing_agent),
    ]

    all_findings = []
    for name, agent_fn in agents:
        try:
            result = await agent_fn(state)
            findings = []
            for domain_findings in result.get("domain_findings", {}).values():
                findings.extend(domain_findings)
            # TLH may legitimately return 0 findings if no positions have unrealized losses
            # (with live prices CNQ.TO may be profitable at time of test)
            if name == "tlh":
                check(f"{name} agent ran without error", True, f"{len(findings)} finding(s) (0 is valid if no losses)")
            else:
                check(f"{name} agent returned findings", len(findings) > 0, f"{len(findings)} finding(s)")
            all_findings.extend(findings)
        except Exception as exc:
            check(f"{name} agent completed without error", False, str(exc))

    check("All agents produced at least 1 finding total", len(all_findings) >= 5, f"{len(all_findings)} total")

    # Verify findings reference real numbers from live data (dollar_impact > 0)
    findings_with_impact = [f for f in all_findings if isinstance(f.get("dollar_impact"), (int, float)) and f["dollar_impact"] > 0]
    check(
        "Findings contain real dollar_impact values",
        len(findings_with_impact) >= 3,
        f"{len(findings_with_impact)} findings with dollar impact",
    )

    # Verify schema
    required = {"title", "dollar_impact", "impact_direction", "urgency", "reasoning", "confidence", "what_to_do"}
    valid = [f for f in all_findings if required.issubset(f.keys())]
    check(
        f"All findings have valid schema ({len(valid)}/{len(all_findings)})",
        len(valid) == len(all_findings),
    )


# ---------------------------------------------------------------------------
# Test 8: Portfolio route structure
# ---------------------------------------------------------------------------

async def test_portfolio_route_structure(user_id: int, db):
    print("\n=== 6. GET /portfolio STRUCTURE ===")
    snapshot = await get_portfolio_snapshot(user_id, db)
    required_keys = {"total_value_cad", "total_gain_loss_cad", "total_gain_loss_pct", "accounts", "allocation", "contribution_room", "margin"}
    check(
        "GET /portfolio returns all required top-level keys",
        required_keys.issubset(snapshot.keys()),
        str(set(snapshot.keys())),
    )
    for acct in snapshot["accounts"]:
        check(
            f"Account {acct['account_type']} has positions list",
            "positions" in acct,
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    print("=" * 60)
    print("WealthMind Integration Test")
    print("=" * 60)

    # Fresh DB for testing
    db_path = Path(__file__).parent / "integration_test.db"
    if db_path.exists():
        db_path.unlink()

    await create_tables()

    async with AsyncSessionLocal() as db:
        user_id = await test_seed(db)
        prices = await test_prices()
        snapshot = await test_portfolio_snapshot(user_id, db)
        await test_trading(user_id, snapshot, db)
        await test_agents(snapshot)
        await test_portfolio_route_structure(user_id, db)

    print(f"\n{'=' * 60}")
    print("FINAL RESULT")
    print("=" * 60)
    print(f"  Passed: {CHECKS_PASSED}")
    print(f"  Failed: {CHECKS_FAILED}")
    if CHECKS_FAILED > 0:
        print("\nWARNING: Some checks failed. Review output above.")
        sys.exit(1)
    else:
        print("\nAll integration checks passed.")

    # Clean up test DB
    if db_path.exists():
        db_path.unlink()


if __name__ == "__main__":
    asyncio.run(main())
