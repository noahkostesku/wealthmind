"""
Trade execution service.

Validates, executes, and records all portfolio transactions.
All operations are atomic within a single db session commit.
No external trades are placed — this is a simulation layer only.
"""

import datetime
import logging

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import Account, Position, Transaction
from services.prices import get_usdcad_rate

logger = logging.getLogger(__name__)

_SELF_DIRECTED = "self_directed"
_REGISTERED_TYPES = {"tfsa", "rrsp", "fhsa"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_account(user_id: int, account_id: int, db: AsyncSession) -> Account:
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.user_id == user_id)
    )
    acct = result.scalar_one_or_none()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")
    return acct


async def _get_position(account_id: int, ticker: str, db: AsyncSession) -> Position | None:
    result = await db.execute(
        select(Position).where(
            Position.account_id == account_id, Position.ticker == ticker
        )
    )
    return result.scalar_one_or_none()


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


# ---------------------------------------------------------------------------
# Buy
# ---------------------------------------------------------------------------

async def execute_buy(
    user_id: int,
    account_id: int,
    ticker: str,
    shares: float,
    price_cad: float,
    db: AsyncSession,
) -> dict:
    """
    Validates and executes a buy order.

    Validation:
    - Account must be self_directed
    - Account must have sufficient cash balance

    Returns: { success, position, transaction, new_balance }
    """
    acct = await _get_account(user_id, account_id, db)

    if acct.subtype != _SELF_DIRECTED:
        raise HTTPException(
            status_code=400,
            detail=f"Account is {acct.subtype or 'managed'} — only self-directed accounts allow trades",
        )
    if not acct.is_active:
        raise HTTPException(status_code=400, detail="Account is not active")

    total = round(shares * price_cad, 2)

    if acct.balance_cad < total:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance: ${acct.balance_cad:,.2f} available, ${total:,.2f} required",
        )

    # Deduct from cash balance
    acct.balance_cad = round(acct.balance_cad - total, 2)
    acct.updated_at = _now()

    # Create or update position
    pos = await _get_position(account_id, ticker, db)
    if pos:
        # Update average cost (weighted average)
        total_shares = pos.shares + shares
        total_cost = (pos.shares * pos.avg_cost_cad) + total
        pos.avg_cost_cad = round(total_cost / total_shares, 4)
        pos.shares = round(total_shares, 8)
        pos.updated_at = _now()
    else:
        pos = Position(
            account_id=account_id,
            user_id=user_id,
            ticker=ticker,
            name=ticker,
            shares=round(shares, 8),
            avg_cost_cad=round(price_cad, 4),
            currency="CAD" if ticker.endswith(".TO") or ticker.endswith("-CAD") else "USD",
            asset_type="crypto" if ticker.endswith("-CAD") else "stock",
        )
        db.add(pos)

    txn = Transaction(
        account_id=account_id,
        user_id=user_id,
        transaction_type="buy",
        ticker=ticker,
        shares=shares,
        price_cad=price_cad,
        total_cad=total,
        executed_at=_now(),
        notes=f"Buy {shares} {ticker} @ ${price_cad:.2f}",
    )
    db.add(txn)
    await db.commit()
    await db.refresh(acct)
    await db.refresh(pos)
    await db.refresh(txn)

    return {
        "success": True,
        "position": {
            "id": pos.id,
            "ticker": pos.ticker,
            "shares": pos.shares,
            "avg_cost_cad": pos.avg_cost_cad,
        },
        "transaction": {
            "id": txn.id,
            "type": txn.transaction_type,
            "ticker": txn.ticker,
            "shares": txn.shares,
            "price_cad": txn.price_cad,
            "total_cad": txn.total_cad,
            "executed_at": txn.executed_at.isoformat(),
        },
        "new_balance": acct.balance_cad,
    }


# ---------------------------------------------------------------------------
# Sell
# ---------------------------------------------------------------------------

async def execute_sell(
    user_id: int,
    account_id: int,
    ticker: str,
    shares: float,
    price_cad: float,
    db: AsyncSession,
) -> dict:
    """
    Validates and executes a sell order.

    Returns: { success, proceeds_cad, realized_gain_loss, transaction, new_balance }
    """
    acct = await _get_account(user_id, account_id, db)

    if acct.subtype != _SELF_DIRECTED:
        raise HTTPException(status_code=400, detail="Only self-directed accounts allow trades")

    pos = await _get_position(account_id, ticker, db)
    if not pos:
        raise HTTPException(status_code=404, detail=f"No position found for {ticker}")
    if pos.shares < shares:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient shares: {pos.shares:.4f} held, {shares:.4f} requested",
        )

    proceeds = round(shares * price_cad, 2)
    cost_basis = round(shares * pos.avg_cost_cad, 2)
    realized_gl = round(proceeds - cost_basis, 2)

    # Update position
    pos.shares = round(pos.shares - shares, 8)
    pos.updated_at = _now()
    if pos.shares <= 0.000001:
        await db.delete(pos)

    # Add proceeds to cash balance
    acct.balance_cad = round(acct.balance_cad + proceeds, 2)
    acct.updated_at = _now()

    txn = Transaction(
        account_id=account_id,
        user_id=user_id,
        transaction_type="sell",
        ticker=ticker,
        shares=shares,
        price_cad=price_cad,
        total_cad=proceeds,
        executed_at=_now(),
        notes=f"Sell {shares} {ticker} @ ${price_cad:.2f} | realized G/L: ${realized_gl:+.2f}",
    )
    db.add(txn)
    await db.commit()
    await db.refresh(acct)
    await db.refresh(txn)

    return {
        "success": True,
        "proceeds_cad": proceeds,
        "realized_gain_loss": realized_gl,
        "transaction": {
            "id": txn.id,
            "type": txn.transaction_type,
            "ticker": txn.ticker,
            "shares": shares,
            "price_cad": price_cad,
            "total_cad": proceeds,
            "executed_at": txn.executed_at.isoformat(),
        },
        "new_balance": acct.balance_cad,
    }


# ---------------------------------------------------------------------------
# Deposit
# ---------------------------------------------------------------------------

async def execute_deposit(
    user_id: int,
    account_id: int,
    amount_cad: float,
    db: AsyncSession,
) -> dict:
    """
    Deposits funds into an account.

    Validates contribution room for registered accounts.

    Returns: { success, new_balance, contribution_room_remaining }
    """
    acct = await _get_account(user_id, account_id, db)

    if amount_cad <= 0:
        raise HTTPException(status_code=400, detail="Deposit amount must be positive")

    # Check contribution room for registered accounts
    if acct.account_type in _REGISTERED_TYPES:
        room = acct.contribution_room_remaining or 0.0
        if amount_cad > room:
            raise HTTPException(
                status_code=400,
                detail=f"Over-contribution: ${amount_cad:,.2f} exceeds remaining room of ${room:,.2f}",
            )
        acct.contribution_room_remaining = round(room - amount_cad, 2)

    acct.balance_cad = round(acct.balance_cad + amount_cad, 2)
    acct.is_active = True
    acct.updated_at = _now()

    txn = Transaction(
        account_id=account_id,
        user_id=user_id,
        transaction_type="deposit",
        price_cad=amount_cad,
        total_cad=amount_cad,
        executed_at=_now(),
        notes=f"Deposit ${amount_cad:,.2f} to {acct.product_name}",
    )
    db.add(txn)
    await db.commit()

    return {
        "success": True,
        "new_balance": acct.balance_cad,
        "contribution_room_remaining": acct.contribution_room_remaining,
    }


# ---------------------------------------------------------------------------
# Withdrawal
# ---------------------------------------------------------------------------

async def execute_withdrawal(
    user_id: int,
    account_id: int,
    amount_cad: float,
    db: AsyncSession,
) -> dict:
    """
    Withdraws funds from an account.

    Returns: { success, new_balance }
    """
    acct = await _get_account(user_id, account_id, db)

    if amount_cad <= 0:
        raise HTTPException(status_code=400, detail="Withdrawal amount must be positive")
    if acct.balance_cad < amount_cad:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance: ${acct.balance_cad:,.2f} available",
        )

    acct.balance_cad = round(acct.balance_cad - amount_cad, 2)
    acct.updated_at = _now()

    txn = Transaction(
        account_id=account_id,
        user_id=user_id,
        transaction_type="withdraw",
        price_cad=amount_cad,
        total_cad=amount_cad,
        executed_at=_now(),
        notes=f"Withdrawal ${amount_cad:,.2f} from {acct.product_name}",
    )
    db.add(txn)
    await db.commit()

    return {"success": True, "new_balance": acct.balance_cad}


# ---------------------------------------------------------------------------
# Account-to-account exchange
# ---------------------------------------------------------------------------

async def execute_exchange(
    user_id: int,
    from_account_id: int,
    to_account_id: int,
    amount_cad: float,
    db: AsyncSession,
) -> dict:
    """
    Moves funds between two accounts.
    If accounts have different implied currencies (USD stock account vs CAD),
    fetches the live USDCAD rate and records it.

    Returns: { success, from_new_balance, to_new_balance, exchange_rate }
    """
    from_acct = await _get_account(user_id, from_account_id, db)
    to_acct = await _get_account(user_id, to_account_id, db)

    if amount_cad <= 0:
        raise HTTPException(status_code=400, detail="Transfer amount must be positive")
    if from_acct.balance_cad < amount_cad:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance in source account: ${from_acct.balance_cad:,.2f}",
        )

    from_acct.balance_cad = round(from_acct.balance_cad - amount_cad, 2)
    from_acct.updated_at = _now()
    to_acct.balance_cad = round(to_acct.balance_cad + amount_cad, 2)
    to_acct.updated_at = _now()

    now = _now()
    for acct_id, direction in [(from_account_id, "exchange_out"), (to_account_id, "exchange_in")]:
        db.add(Transaction(
            account_id=acct_id,
            user_id=user_id,
            transaction_type="exchange",
            price_cad=amount_cad,
            total_cad=amount_cad,
            executed_at=now,
            notes=f"Transfer ${amount_cad:,.2f} {'from' if direction == 'exchange_out' else 'to'} account {from_account_id if direction == 'exchange_out' else to_account_id}",
        ))

    await db.commit()

    return {
        "success": True,
        "from_new_balance": from_acct.balance_cad,
        "to_new_balance": to_acct.balance_cad,
        "exchange_rate": None,  # Same currency transfer
    }


# ---------------------------------------------------------------------------
# Currency exchange (within an account)
# ---------------------------------------------------------------------------

async def execute_currency_exchange(
    user_id: int,
    account_id: int,
    amount: float,
    from_currency: str,
    to_currency: str,
    db: AsyncSession,
) -> dict:
    """
    Executes a currency conversion within an account using the live USDCAD rate.

    Returns: { success, amount_in, amount_out, exchange_rate, new_balance }
    """
    acct = await _get_account(user_id, account_id, db)

    from_currency = from_currency.upper()
    to_currency = to_currency.upper()

    if from_currency not in ("CAD", "USD") or to_currency not in ("CAD", "USD"):
        raise HTTPException(status_code=400, detail="Only CAD and USD are supported")
    if from_currency == to_currency:
        raise HTTPException(status_code=400, detail="Cannot exchange same currency")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    usdcad_rate = await get_usdcad_rate()

    if from_currency == "USD":
        amount_cad_in = round(amount * usdcad_rate, 2)
        amount_cad_out = amount_cad_in
        rate_used = usdcad_rate
    else:  # CAD → USD
        amount_cad_in = amount
        amount_cad_out = amount  # Balance stays in CAD equivalent
        rate_used = 1 / usdcad_rate

    if acct.balance_cad < amount_cad_in:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance: ${acct.balance_cad:,.2f} CAD available",
        )

    # For simplicity, all balances are stored in CAD — no net change for CAD→USD
    acct.updated_at = _now()

    txn = Transaction(
        account_id=account_id,
        user_id=user_id,
        transaction_type="exchange",
        price_cad=rate_used,
        total_cad=amount_cad_out,
        currency_from=from_currency,
        currency_to=to_currency,
        exchange_rate=usdcad_rate,
        executed_at=_now(),
        notes=f"Currency exchange {amount:.4f} {from_currency} → {to_currency} @ {usdcad_rate:.4f}",
    )
    db.add(txn)
    await db.commit()

    return {
        "success": True,
        "amount_in": amount,
        "amount_out": round(amount * (usdcad_rate if from_currency == "USD" else 1 / usdcad_rate), 4),
        "exchange_rate": usdcad_rate,
        "new_balance": acct.balance_cad,
    }
