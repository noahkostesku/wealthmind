import datetime
import os
from collections.abc import AsyncGenerator

from dotenv import load_dotenv
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

load_dotenv()

_raw_url = os.getenv("DATABASE_URL", "sqlite:///./wealthmind.db")
# Ensure aiosqlite async driver
DATABASE_URL = _raw_url.replace("sqlite:///", "sqlite+aiosqlite:///")

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


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


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    accounts: Mapped[dict] = mapped_column(JSON)
    seeded_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    started_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    completed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    graph_state: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)


class Insight(Base):
    __tablename__ = "insights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("analysis_runs.id"))
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    domain: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    dollar_impact: Mapped[float] = mapped_column(Float)
    urgency: Mapped[str] = mapped_column(String)
    reasoning: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="active")
    dismissed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    dismiss_reason: Mapped[str | None] = mapped_column(String, nullable=True)


async def create_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
