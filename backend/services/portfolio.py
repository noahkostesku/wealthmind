"""
Portfolio calculator service.

Combines live prices from prices.py with database positions and accounts
to produce complete portfolio snapshots with gain/loss calculations.
"""

import datetime
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import Account, Position, Transaction
from services.prices import get_multiple_prices, get_price_history, get_usdcad_rate

logger = logging.getLogger(__name__)

# Ontario combined marginal rate for the demo profile
_MARGINAL_RATE = 0.2965


async def get_portfolio_snapshot(user_id: int, db: AsyncSession) -> dict:
    """
    Returns complete portfolio state with live prices.

    Shape:
    {
        total_value_cad, total_gain_loss_cad, total_gain_loss_pct,
        accounts: [ { ...account fields, positions: [...] } ],
        allocation: { by_account_type, by_asset_type },
        contribution_room: { tfsa, rrsp, fhsa },
        margin: { debit_balance, interest_rate, annual_cost }
    }
    """
    # Load all accounts (including inactive — FHSA not yet opened)
    accts_result = await db.execute(
        select(Account).where(Account.user_id == user_id)
    )
    accounts = accts_result.scalars().all()

    # Load all positions for this user
    pos_result = await db.execute(
        select(Position).where(Position.user_id == user_id)
    )
    all_positions = pos_result.scalars().all()

    # Group positions by account_id
    positions_by_account: dict[int, list[Position]] = {}
    for pos in all_positions:
        positions_by_account.setdefault(pos.account_id, []).append(pos)

    # Fetch live prices for all unique tickers
    unique_tickers = list({p.ticker for p in all_positions})
    prices = await get_multiple_prices(unique_tickers)

    now = datetime.datetime.utcnow()

    total_value_cad = 0.0
    total_cost_cad = 0.0
    by_account_type: dict[str, float] = {}
    by_asset_type: dict[str, float] = {}
    accounts_data = []

    for acct in accounts:
        acct_positions = positions_by_account.get(acct.id, [])

        # Start acct value with its cash balance (clamp to 0 for margin debit)
        acct_cash = max(acct.balance_cad, 0.0)
        acct_equity = 0.0

        positions_data = []
        for pos in acct_positions:
            price_data = prices.get(pos.ticker, {})
            # Use cad_price (already converted for USD tickers)
            current_price_cad = price_data.get("cad_price") or price_data.get("price") or pos.avg_cost_cad

            current_value = pos.shares * current_price_cad
            cost_basis = pos.shares * pos.avg_cost_cad
            unrealized_gl = current_value - cost_basis
            unrealized_gl_pct = (unrealized_gl / cost_basis * 100) if cost_basis else 0.0
            held_days = (now - pos.created_at).days

            acct_equity += current_value
            total_cost_cad += cost_basis

            # Track by asset type
            by_asset_type[pos.asset_type] = by_asset_type.get(pos.asset_type, 0.0) + current_value

            positions_data.append({
                "id": pos.id,
                "ticker": pos.ticker,
                "name": pos.name or pos.ticker,
                "shares": pos.shares,
                "avg_cost_cad": pos.avg_cost_cad,
                "currency": pos.currency,
                "asset_type": pos.asset_type,
                "current_price": current_price_cad,
                "current_value_cad": round(current_value, 2),
                "unrealized_gain_loss_cad": round(unrealized_gl, 2),
                "unrealized_gain_loss_pct": round(unrealized_gl_pct, 2),
                "held_days": held_days,
                "change_pct": price_data.get("change_pct", 0.0),
            })

        acct_total = acct_cash + acct_equity

        # Only count active accounts in total portfolio value
        if acct.is_active:
            total_value_cad += acct_total
            by_account_type[acct.account_type] = (
                by_account_type.get(acct.account_type, 0.0) + acct_total
            )

        accounts_data.append({
            "id": acct.id,
            "account_type": acct.account_type,
            "subtype": acct.subtype,
            "product_name": acct.product_name,
            "balance_cad": acct.balance_cad,
            "total_value_cad": round(acct_total, 2),
            "interest_rate": acct.interest_rate,
            "contribution_room_remaining": acct.contribution_room_remaining,
            "contribution_deadline": acct.contribution_deadline,
            "is_active": acct.is_active,
            "positions": positions_data,
        })

    total_gl = total_value_cad - total_cost_cad
    total_gl_pct = (total_gl / total_cost_cad * 100) if total_cost_cad else 0.0

    # Contribution room helpers
    def _room(acct_type: str) -> float | None:
        acct = next((a for a in accounts if a.account_type == acct_type), None)
        return acct.contribution_room_remaining if acct else None

    # Margin summary
    margin_acct = next((a for a in accounts if a.account_type == "margin"), None)
    margin_data: dict = {}
    if margin_acct:
        debit = abs(margin_acct.balance_cad)
        annual_cost = debit * (margin_acct.interest_rate or 0.062)
        margin_data = {
            "debit_balance": debit,
            "interest_rate": margin_acct.interest_rate,
            "annual_cost": round(annual_cost, 2),
        }

    return {
        "total_value_cad": round(total_value_cad, 2),
        "total_gain_loss_cad": round(total_gl, 2),
        "total_gain_loss_pct": round(total_gl_pct, 2),
        "accounts": accounts_data,
        "allocation": {
            "by_account_type": {k: round(v, 2) for k, v in by_account_type.items()},
            "by_asset_type": {k: round(v, 2) for k, v in by_asset_type.items()},
        },
        "contribution_room": {
            "tfsa": _room("tfsa"),
            "rrsp": _room("rrsp"),
            "fhsa": _room("fhsa"),
        },
        "margin": margin_data,
    }


async def get_position_history(user_id: int, ticker: str, period: str, db: AsyncSession) -> dict:
    """
    Combines yfinance price history with user's transaction history for that ticker.

    Returns:
    {
        ticker, period,
        price_chart: [ { date, open, high, low, close, volume } ],
        cost_basis_line: [ { date, cost_basis } ],
        transactions: [ { executed_at, transaction_type, shares, price_cad, total_cad } ]
    }
    """
    # Fetch price history
    price_chart = await get_price_history(ticker, period)

    # Load user's transactions for this ticker
    txn_result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id, Transaction.ticker == ticker)
        .order_by(Transaction.executed_at)
    )
    transactions = txn_result.scalars().all()

    # Build cost basis line: running avg cost per date
    running_shares = 0.0
    running_cost = 0.0
    cost_by_date: dict[str, float] = {}

    for txn in transactions:
        date_str = txn.executed_at.date().isoformat()
        if txn.transaction_type == "buy":
            running_cost += txn.total_cad
            running_shares += (txn.shares or 0)
        elif txn.transaction_type == "sell":
            sold = txn.shares or 0
            if running_shares > 0:
                running_cost -= (running_cost / running_shares) * sold
            running_shares = max(0, running_shares - sold)
        avg = (running_cost / running_shares) if running_shares > 0 else None
        cost_by_date[date_str] = avg  # type: ignore[assignment]

    # Build cost basis overlay for each chart date
    last_cost = None
    cost_basis_line = []
    for bar in price_chart:
        date_str = bar["date"]
        if date_str in cost_by_date:
            last_cost = cost_by_date[date_str]
        cost_basis_line.append({"date": date_str, "cost_basis": last_cost})

    return {
        "ticker": ticker,
        "period": period,
        "price_chart": price_chart,
        "cost_basis_line": cost_basis_line,
        "transactions": [
            {
                "executed_at": txn.executed_at.isoformat(),
                "transaction_type": txn.transaction_type,
                "shares": txn.shares,
                "price_cad": txn.price_cad,
                "total_cad": txn.total_cad,
            }
            for txn in transactions
        ],
    }


async def calculate_tax_exposure(user_id: int, db: AsyncSession) -> dict:
    """
    For all non-registered positions with unrealized gains, calculates
    tax owing at the current marginal rate using the 50% capital gains
    inclusion rate.

    Returns:
    {
        marginal_rate, inclusion_rate,
        positions: [ { ticker, unrealized_gain_cad, taxable_gain_cad, estimated_tax_cad } ],
        total_taxable_gain_cad, total_estimated_tax_cad
    }
    """
    # Find non-registered accounts
    accts_result = await db.execute(
        select(Account).where(
            Account.user_id == user_id,
            Account.account_type == "non_registered",
        )
    )
    nr_accounts = accts_result.scalars().all()
    if not nr_accounts:
        return {"positions": [], "total_taxable_gain_cad": 0, "total_estimated_tax_cad": 0}

    nr_ids = [a.id for a in nr_accounts]
    pos_result = await db.execute(
        select(Position).where(Position.account_id.in_(nr_ids))
    )
    positions = pos_result.scalars().all()

    tickers = [p.ticker for p in positions]
    prices = await get_multiple_prices(tickers)

    inclusion_rate = 0.50
    result_positions = []
    total_taxable = 0.0
    total_tax = 0.0

    for pos in positions:
        price_data = prices.get(pos.ticker, {})
        current_price = price_data.get("cad_price") or price_data.get("price") or pos.avg_cost_cad
        current_value = pos.shares * current_price
        cost_basis = pos.shares * pos.avg_cost_cad
        unrealized = current_value - cost_basis

        if unrealized <= 0:
            continue  # Only tax gains

        taxable = unrealized * inclusion_rate
        tax = taxable * _MARGINAL_RATE
        total_taxable += taxable
        total_tax += tax

        result_positions.append({
            "ticker": pos.ticker,
            "shares": pos.shares,
            "avg_cost_cad": pos.avg_cost_cad,
            "current_price_cad": round(current_price, 2),
            "unrealized_gain_cad": round(unrealized, 2),
            "taxable_gain_cad": round(taxable, 2),
            "estimated_tax_cad": round(tax, 2),
        })

    return {
        "marginal_rate": _MARGINAL_RATE,
        "inclusion_rate": inclusion_rate,
        "positions": result_positions,
        "total_taxable_gain_cad": round(total_taxable, 2),
        "total_estimated_tax_cad": round(total_tax, 2),
    }
