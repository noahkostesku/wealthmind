import datetime
import json
import os
from collections.abc import AsyncGenerator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, select
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


async def create_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def seed_demo_user() -> None:
    """Create demo user with all accounts and positions if no users exist."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User))
        existing = result.scalar_one_or_none()
        if existing:
            return

        profile = json.loads(_DEMO_PROFILE.read_text())
        accts = profile["accounts"]

        user = User(
            google_id="demo_google_id",
            email="demo@wealthmind.ca",
            wealthsimple_tier="premium",
        )
        session.add(user)
        await session.flush()
        user_id = user.id

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

        # TFSA Managed
        tfsa = Account(
            user_id=user_id,
            account_type="tfsa",
            subtype="managed",
            product_name="Wealthsimple Managed TFSA",
            balance_cad=accts["tfsa_managed"]["balance"],
            contribution_room_remaining=accts["tfsa_managed"]["contribution_room_remaining"],
            is_active=True,
        )
        session.add(tfsa)

        # RRSP Self-directed
        rrsp = Account(
            user_id=user_id,
            account_type="rrsp",
            subtype="self_directed",
            product_name="Wealthsimple Self-Directed RRSP",
            balance_cad=accts["rrsp_self_directed"]["balance"],
            contribution_room_remaining=accts["rrsp_self_directed"]["contribution_room_remaining"],
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

        # FHSA (not yet opened — is_active=False)
        session.add(Account(
            user_id=user_id,
            account_type="fhsa",
            subtype=None,
            product_name="Wealthsimple FHSA",
            balance_cad=0.0,
            contribution_room_remaining=float(accts["fhsa"]["annual_contribution_limit"]),
            is_active=False,
        ))

        # Margin (negative balance = debit owed)
        session.add(Account(
            user_id=user_id,
            account_type="margin",
            subtype=None,
            product_name="Wealthsimple Margin",
            balance_cad=-float(accts["margin"]["debit_balance"]),
            interest_rate=accts["margin"]["interest_rate"],
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

        # Crypto positions — approximate shares at seed time
        # BTC at ~$140k CAD: 0.015 BTC = $2,100 CAD (gain of $340 = cost $1,760 → avg $117,333)
        # ETH at ~$4,200 CAD: 0.27 ETH = $1,134 CAD (loss of $85 = cost $1,185 → avg $4,389)
        for ticker, name, shares, avg_cost in [
            ("BTC-CAD", "Bitcoin", 0.015, 117333.33),
            ("ETH-CAD", "Ethereum", 0.27, 4388.89),
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
