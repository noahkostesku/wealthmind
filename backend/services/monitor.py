"""
Autonomous portfolio monitor.

Runs every 5 minutes, evaluates threshold / price / opportunity triggers,
creates MonitorAlert rows in SQLite, and broadcasts to the user's WebSocket
if they are connected.
"""

import asyncio
import datetime
import json
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import select

from database import AsyncSessionLocal, MonitorAlert
from services.portfolio import get_portfolio_snapshot

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).parent.parent / "data"
_DEMO_USER_ID = 1
_INTERVAL_SECONDS = 300  # 5 minutes

# In-memory cooldown tracker — { "alert_type:ticker|*": last_fired_datetime }
_cooldowns: dict[str, datetime.datetime] = {}


def _cooldown_key(alert_type: str, ticker: str | None = None) -> str:
    return f"{alert_type}:{ticker or '*'}"


def _is_cooled(key: str, hours: float) -> bool:
    ts = _cooldowns.get(key)
    if ts is None:
        return True
    elapsed = (datetime.datetime.utcnow() - ts).total_seconds()
    return elapsed >= hours * 3600


def _arm(key: str) -> None:
    _cooldowns[key] = datetime.datetime.utcnow()


class PortfolioMonitor:
    """Background task that watches the portfolio and fires alerts."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._user_ws_manager: Any = None
        # In-memory snapshot from last check
        self._last_snapshot: dict | None = None

    def start(self, user_ws_manager: Any) -> None:
        self._user_ws_manager = user_ws_manager
        self._task = asyncio.create_task(self._loop())
        logger.info("PortfolioMonitor started.")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    # ── main loop ──────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        await asyncio.sleep(30)  # Let the app finish starting
        while True:
            try:
                await self._check()
            except Exception as exc:
                logger.error("PortfolioMonitor._check failed: %s", exc)
            await asyncio.sleep(_INTERVAL_SECONDS)

    async def _check(self) -> None:
        now = datetime.datetime.utcnow()
        async with AsyncSessionLocal() as db:
            portfolio = await get_portfolio_snapshot(_DEMO_USER_ID, db)
            alerts = self._evaluate_triggers(portfolio, now)

            for alert_data in alerts:
                row = MonitorAlert(
                    user_id=_DEMO_USER_ID,
                    alert_type=alert_data["alert_type"],
                    message=alert_data["message"],
                    ticker=alert_data.get("ticker"),
                    dollar_impact=alert_data.get("dollar_impact"),
                    created_at=now,
                )
                db.add(row)
            await db.commit()

        # Broadcast after commit so IDs are stable
        if alerts and self._user_ws_manager:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(MonitorAlert)
                    .where(
                        MonitorAlert.user_id == _DEMO_USER_ID,
                        MonitorAlert.dismissed_at.is_(None),
                        MonitorAlert.surfaced_at.is_(None),
                    )
                    .order_by(MonitorAlert.created_at.desc())
                    .limit(len(alerts))
                )
                rows = result.scalars().all()
            for row in rows:
                await self._broadcast({
                    "id": row.id,
                    "alert_type": row.alert_type,
                    "message": row.message,
                    "ticker": row.ticker,
                    "dollar_impact": row.dollar_impact,
                    "created_at": row.created_at.isoformat(),
                })

        self._last_snapshot = portfolio

    async def _broadcast(self, payload: dict) -> None:
        try:
            await self._user_ws_manager.broadcast(
                str(_DEMO_USER_ID),
                {"type": "monitor_alert", **payload},
            )
        except Exception as exc:
            logger.debug("Monitor broadcast failed: %s", exc)

    # ── trigger evaluation ─────────────────────────────────────────────────────

    def _evaluate_triggers(
        self, portfolio: dict, now: datetime.datetime
    ) -> list[dict]:
        alerts: list[dict] = []
        all_positions = [
            (pos, acct["account_type"])
            for acct in portfolio["accounts"]
            for pos in acct.get("positions", [])
        ]

        # ── PRICE TRIGGERS (require a previous snapshot) ───────────────────
        if self._last_snapshot:
            last_pos_map: dict[str, dict] = {
                pos["ticker"]: pos
                for acct in self._last_snapshot["accounts"]
                for pos in acct.get("positions", [])
            }
            for pos, _ in all_positions:
                ticker = pos["ticker"]
                lp = last_pos_map.get(ticker)
                if not lp or lp.get("current_price", 0) <= 0:
                    continue

                change_pct = (
                    (pos.get("current_price", 0) - lp["current_price"])
                    / lp["current_price"]
                ) * 100

                if change_pct <= -5:
                    key = _cooldown_key("price_drop", ticker)
                    if _is_cooled(key, hours=4):
                        unrealized = pos.get("unrealized_gain_loss_cad", 0)
                        label = "loss" if unrealized < 0 else "gain"
                        alerts.append({
                            "alert_type": "price_drop",
                            "message": (
                                f"{ticker} is down {abs(change_pct):.1f}% — "
                                f"your unrealized {label} is now ${abs(unrealized):,.0f}. "
                                f"That changes the harvesting math."
                            ),
                            "ticker": ticker,
                            "dollar_impact": abs(unrealized),
                        })
                        _arm(key)

                elif change_pct >= 10:
                    key = _cooldown_key("price_gain", ticker)
                    if _is_cooled(key, hours=4):
                        unrealized = pos.get("unrealized_gain_loss_cad", 0)
                        alerts.append({
                            "alert_type": "price_gain",
                            "message": (
                                f"{ticker} is up {change_pct:.1f}% — "
                                f"your unrealized gain is now ${unrealized:,.0f}. "
                                f"Worth knowing before you make any moves."
                            ),
                            "ticker": ticker,
                            "dollar_impact": unrealized,
                        })
                        _arm(key)

        # ── THRESHOLD TRIGGERS ─────────────────────────────────────────────
        margin = portfolio.get("margin", {})
        annual_cost = margin.get("annual_cost", 0)
        if annual_cost > 500:
            key = _cooldown_key("margin_interest")
            if _is_cooled(key, hours=7 * 24):
                quarterly = round(annual_cost / 4, 0)
                alerts.append({
                    "alert_type": "margin_interest",
                    "message": (
                        f"Your margin debt has now cost you ${quarterly:,.0f} in interest "
                        f"this quarter. At ${annual_cost:,.0f}/year, that's eroding your returns."
                    ),
                    "dollar_impact": quarterly,
                })
                _arm(key)

        # RRSP deadline within 7 days
        for acct in portfolio["accounts"]:
            if acct["account_type"] == "rrsp" and acct.get("contribution_deadline"):
                try:
                    deadline = datetime.datetime.strptime(
                        acct["contribution_deadline"], "%Y-%m-%d"
                    ).date()
                    days_left = (deadline - now.date()).days
                    if 0 <= days_left <= 7:
                        key = _cooldown_key("rrsp_deadline")
                        if _is_cooled(key, hours=24):
                            room = acct.get("contribution_room_remaining") or 0
                            day_word = "day" if days_left == 1 else "days"
                            if room > 0:
                                msg = (
                                    f"RRSP deadline is {days_left} {day_word} away. "
                                    f"You still have ${room:,.0f} in contribution room. "
                                    f"Every dollar contributed saves you ~$0.43 in tax."
                                )
                            else:
                                msg = f"RRSP deadline is {days_left} {day_word} away."
                            alerts.append({
                                "alert_type": "rrsp_deadline",
                                "message": msg,
                                "dollar_impact": room,
                            })
                            _arm(key)
                except ValueError:
                    pass

        # FHSA never opened — fire once per week
        fhsa = next(
            (a for a in portfolio["accounts"] if a["account_type"] == "fhsa"), None
        )
        if fhsa and not fhsa.get("is_active"):
            key = _cooldown_key("fhsa")
            if _is_cooled(key, hours=7 * 24):
                room = fhsa.get("contribution_room_remaining") or 8000
                alerts.append({
                    "alert_type": "fhsa",
                    "message": (
                        f"You haven't opened your FHSA yet. You're leaving ${room:,.0f} in "
                        f"tax-free contribution room on the table — open it today to start "
                        f"accumulating room."
                    ),
                    "dollar_impact": room,
                })
                _arm(key)

        # Net portfolio down 3%+ from last snapshot
        if self._last_snapshot:
            last_val = self._last_snapshot.get("total_value_cad", 0)
            curr_val = portfolio.get("total_value_cad", 0)
            if last_val > 0:
                chg = (curr_val - last_val) / last_val * 100
                if chg <= -3:
                    key = _cooldown_key("portfolio_down")
                    if _is_cooled(key, hours=24):
                        loss = last_val - curr_val
                        n_loss = sum(
                            1 for pos, _ in all_positions
                            if pos.get("unrealized_gain_loss_cad", 0) < 0
                        )
                        alerts.append({
                            "alert_type": "portfolio_down",
                            "message": (
                                f"Your portfolio is down {abs(chg):.1f}% since last check — "
                                f"${loss:,.0f} in unrealized losses across "
                                f"{n_loss} position{'s' if n_loss != 1 else ''}."
                            ),
                            "dollar_impact": loss,
                        })
                        _arm(key)

        # ── OPPORTUNITY TRIGGERS ───────────────────────────────────────────
        if self._last_snapshot:
            last_pos_map = {
                pos["ticker"]: pos
                for acct in self._last_snapshot["accounts"]
                for pos in acct.get("positions", [])
            }
            for pos, _ in all_positions:
                ticker = pos["ticker"]
                unrealized = pos.get("unrealized_gain_loss_cad", 0)
                if unrealized >= -200:
                    continue
                last = last_pos_map.get(ticker)
                if last and last.get("unrealized_gain_loss_cad", 0) > -200:
                    # Newly crossed -$200 threshold
                    key = _cooldown_key("tlh_window", ticker)
                    if _is_cooled(key, hours=24):
                        alerts.append({
                            "alert_type": "tlh_window",
                            "message": (
                                f"A new harvesting window just opened on {ticker} — "
                                f"${abs(unrealized):,.0f} loss you could use to offset gains."
                            ),
                            "ticker": ticker,
                            "dollar_impact": abs(unrealized),
                        })
                        _arm(key)

        return alerts
