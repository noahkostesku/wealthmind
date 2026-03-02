import datetime
import json
import os
from collections.abc import AsyncGenerator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, delete, select
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

load_dotenv()

_raw_url = os.getenv("DATABASE_URL", "sqlite:///./wealthmind.db")
DATABASE_URL = _raw_url.replace("sqlite:///", "sqlite+aiosqlite:///")

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

_DEMO_PROFILE = Path(__file__).parent / "data" / "demo_profile.json"


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    google_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    wealthsimple_tier: Mapped[str] = mapped_column(String, default="premium")
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    account_type: Mapped[str] = mapped_column(String)  # tfsa|rrsp|fhsa|non_registered|chequing|margin|crypto
    subtype: Mapped[str | None] = mapped_column(String, nullable=True)  # managed|self_directed|null
    product_name: Mapped[str] = mapped_column(String)
    balance_cad: Mapped[float] = mapped_column(Float, default=0.0)
    interest_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    contribution_room_remaining: Mapped[float | None] = mapped_column(Float, nullable=True)
    contribution_deadline: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


class Position(Base):
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    account_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    ticker: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String, default="")
    shares: Mapped[float] = mapped_column(Float)
    avg_cost_cad: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String, default="CAD")  # CAD|USD
    asset_type: Mapped[str] = mapped_column(String, default="stock")  # stock|etf|crypto
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    account_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    transaction_type: Mapped[str] = mapped_column(String)  # buy|sell|deposit|withdraw|exchange
    ticker: Mapped[str | None] = mapped_column(String, nullable=True)
    shares: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_cad: Mapped[float] = mapped_column(Float)
    total_cad: Mapped[float] = mapped_column(Float)
    currency_from: Mapped[str | None] = mapped_column(String, nullable=True)
    currency_to: Mapped[str | None] = mapped_column(String, nullable=True)
    exchange_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    executed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    ticker: Mapped[str] = mapped_column(String)
    added_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    session_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    messages: Mapped[list] = mapped_column(JSON, default=list)
    last_findings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    conversation_id: Mapped[int] = mapped_column(Integer, ForeignKey("conversations.id"))
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    agent_sources: Mapped[list] = mapped_column(JSON, default=list)
    timestamp: Mapped[str] = mapped_column(String)


class AdvisorCache(Base):
    __tablename__ = "advisor_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    headline: Mapped[str] = mapped_column(Text)
    full_picture: Mapped[str] = mapped_column(Text)
    do_not_do: Mapped[str] = mapped_column(Text)
    total_opportunity: Mapped[int] = mapped_column(Integer, default=0)
    chips: Mapped[list] = mapped_column(JSON, default=list)
    generated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )



class MonitorAlert(Base):
    __tablename__ = "monitor_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    alert_type: Mapped[str] = mapped_column(String)
    message: Mapped[str] = mapped_column(Text)
    ticker: Mapped[str | None] = mapped_column(String, nullable=True)
    dollar_impact: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    surfaced_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    dismissed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)


async def create_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def seed_demo_user() -> None:
    """
    Create or reset demo user to clean seed state.

    Always drops and recreates all accounts and positions for the demo user
    so that the live DB never drifts from the authoritative demo_profile.json
    values. Safe to call repeatedly — the User row is preserved if it exists.
    """
    async with AsyncSessionLocal() as session:
        # Find or create the demo user
        result = await session.execute(
            select(User).where(User.google_id == "demo_google_id")
        )
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                google_id="demo_google_id",
                email="demo@wealthmind.ca",
                wealthsimple_tier="premium",
            )
            session.add(user)
            await session.flush()

        user_id = user.id

        # Drop all existing positions and accounts so reseed is idempotent
        await session.execute(delete(Position).where(Position.user_id == user_id))
        await session.execute(delete(Account).where(Account.user_id == user_id))
        await session.flush()

        profile = json.loads(_DEMO_PROFILE.read_text())
        accts = profile["accounts"]

        # Chequing
        chequing = Account(
            user_id=user_id,
            account_type="chequing",
            subtype=None,
            product_name="Wealthsimple Chequing",
            balance_cad=accts["chequing"]["balance"],
            interest_rate=accts["chequing"]["interest_rate"],
            is_active=True,
        )
        session.add(chequing)

        # TFSA Managed — contribution room always reset to seed value
        tfsa = Account(
            user_id=user_id,
            account_type="tfsa",
            subtype="managed",
            product_name="Wealthsimple Managed TFSA",
            balance_cad=accts["tfsa_managed"]["balance"],
            contribution_room_remaining=7000.0,
            is_active=True,
        )
        session.add(tfsa)

        # RRSP Self-directed — contribution room always reset to seed value
        rrsp = Account(
            user_id=user_id,
            account_type="rrsp",
            subtype="self_directed",
            product_name="Wealthsimple Self-Directed RRSP",
            balance_cad=accts["rrsp_self_directed"]["balance"],
            contribution_room_remaining=14500.0,
            contribution_deadline=accts["rrsp_self_directed"]["contribution_deadline"],
            is_active=True,
        )
        session.add(rrsp)
        await session.flush()

        _etf_tickers = {"XEQT.TO", "VEQT.TO"}
        for p in accts["rrsp_self_directed"]["positions"]:
            session.add(Position(
                account_id=rrsp.id,
                user_id=user_id,
                ticker=p["ticker"],
                name=p["ticker"],
                shares=p["shares"],
                avg_cost_cad=p["avg_cost"],
                currency="CAD",
                asset_type="etf" if p["ticker"] in _etf_tickers else "stock",
            ))

        # Non-registered Self-directed
        non_reg = Account(
            user_id=user_id,
            account_type="non_registered",
            subtype="self_directed",
            product_name="Wealthsimple Self-Directed Non-Registered",
            balance_cad=accts["non_registered_self_directed"]["balance_cash"],
            is_active=True,
        )
        session.add(non_reg)
        await session.flush()

        _nr_types = {"SHOP.TO": "stock", "CNQ.TO": "stock", "VEQT.TO": "etf"}
        for p in accts["non_registered_self_directed"]["positions"]:
            session.add(Position(
                account_id=non_reg.id,
                user_id=user_id,
                ticker=p["ticker"],
                name=p["ticker"],
                shares=p["shares"],
                avg_cost_cad=p["avg_cost"],
                currency="CAD",
                asset_type=_nr_types.get(p["ticker"], "stock"),
            ))

        # FHSA — not yet opened (is_active=False) but contribution_room_remaining
        # is always explicitly set to 8000 so agents can surface the opportunity
        session.add(Account(
            user_id=user_id,
            account_type="fhsa",
            subtype=None,
            product_name="Wealthsimple FHSA",
            balance_cad=0.0,
            contribution_room_remaining=8000.0,
            is_active=False,
        ))

        # Margin — debit_balance and interest_rate always seeded explicitly;
        # balance_cad is negative (debit owed), interest_rate is never null
        session.add(Account(
            user_id=user_id,
            account_type="margin",
            subtype=None,
            product_name="Wealthsimple Margin",
            balance_cad=-11200.0,
            interest_rate=0.062,
            is_active=True,
        ))

        # Crypto account
        crypto_acct = Account(
            user_id=user_id,
            account_type="crypto",
            subtype=None,
            product_name="Wealthsimple Crypto",
            balance_cad=0.0,
            is_active=True,
        )
        session.add(crypto_acct)
        await session.flush()

        # Crypto positions — avg_cost_cad sourced from demo_profile.json
        for ticker, name, shares, avg_cost in [
            ("BTC-CAD", "Bitcoin", 0.015, 104841.91),
            ("ETH-CAD", "Ethereum", 0.27, 3342.53),
        ]:
            session.add(Position(
                account_id=crypto_acct.id,
                user_id=user_id,
                ticker=ticker,
                name=name,
                shares=shares,
                avg_cost_cad=avg_cost,
                currency="CAD",
                asset_type="crypto",
            ))

        await session.commit()
