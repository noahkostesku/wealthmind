import asyncio
import copy
import datetime
import json
import logging
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from database import Account, AdvisorCache, AsyncSessionLocal, Conversation, MonitorAlert, Position, Transaction, User, get_db
from graph.agents import (
    allocation_agent,
    rate_arbitrage_agent,
    tax_implications_agent,
    timing_agent,
    tlh_agent,
)
from graph.graph import compile_graph
from graph.proactive import generate_proactive_greeting
from graph.router import conversation_router
from graph.state import GraphState
from graph.synthesizer import generate_follow_up_chips, get_cross_referral_candidates, synthesize_response
from services.portfolio import calculate_tax_exposure, get_portfolio_snapshot, get_position_history
from services.prices import get_current_price, get_price_history, get_usdcad_rate, search_stocks
from services.trading import (
    execute_buy,
    execute_deposit,
    execute_exchange,
    execute_currency_exchange,
    execute_sell,
    execute_withdrawal,
)
from services.web_search import web_search, news_search

router = APIRouter()

_DATA_DIR = Path(__file__).parent.parent / "data"
_DEMO_USER_ID = 1


def _load_cra_rules() -> dict:
    return json.loads((_DATA_DIR / "cra_rules_2024.json").read_text())


# ===========================================================================
# ONBOARDING ROUTES
# ===========================================================================

@router.get("/user/onboarded")
async def get_onboarded(db: AsyncSession = Depends(get_db)):
    # DEV MODE: always return false so onboarding shows on every load
    return {"onboarded": False}


@router.post("/user/complete-onboarding")
async def complete_onboarding(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == _DEMO_USER_ID))
    user = result.scalar_one_or_none()
    if user:
        user.onboarded = True
        await db.commit()
    return {"success": True}


# ---------------------------------------------------------------------------
# GET /profile  (legacy — returns static demo JSON for backward compat)
# ---------------------------------------------------------------------------

@router.get("/profile")
async def get_profile():
    return json.loads((_DATA_DIR / "demo_profile.json").read_text())


# ---------------------------------------------------------------------------
# POST /analyze
# ---------------------------------------------------------------------------

@router.post("/analyze")
async def analyze(request: Request, db: AsyncSession = Depends(get_db)):
    cra_rules = _load_cra_rules()
    run_id = str(uuid.uuid4())

    # Use live portfolio snapshot as the financial profile for agents
    portfolio = await get_portfolio_snapshot(_DEMO_USER_ID, db)

    initial_state: GraphState = {
        "financial_profile": portfolio,
        "cra_rules": cra_rules,
        "domain_findings": {},
        "synthesized_insights": [],
        "hitl_status": "pending",
        "run_id": run_id,
    }

    compiled = compile_graph()
    final_state = await compiled.ainvoke(initial_state)

    insights = final_state.get("synthesized_insights", [])

    ws_manager = request.app.state.ws_manager
    await ws_manager.broadcast(run_id, {"run_id": run_id, "insights": insights})

    return {"run_id": run_id, "insight_count": len(insights), "insights": insights}


# ---------------------------------------------------------------------------
# WS /ws/{run_id}
# ---------------------------------------------------------------------------

@router.websocket("/ws/{run_id}")
async def websocket_endpoint(run_id: str, websocket: WebSocket):
    ws_manager = websocket.app.state.ws_manager
    await ws_manager.connect(run_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(run_id, websocket)


# ===========================================================================
# PORTFOLIO ROUTES
# ===========================================================================

@router.get("/portfolio")
async def portfolio(db: AsyncSession = Depends(get_db)):
    return await get_portfolio_snapshot(_DEMO_USER_ID, db)


@router.get("/portfolio/positions")
async def portfolio_positions(db: AsyncSession = Depends(get_db)):
    snapshot = await get_portfolio_snapshot(_DEMO_USER_ID, db)
    all_positions = []
    for acct in snapshot["accounts"]:
        for pos in acct["positions"]:
            pos["account_type"] = acct["account_type"]
            pos["account_id"] = acct["id"]
            pos["product_name"] = acct["product_name"]
            all_positions.append(pos)
    return all_positions


@router.get("/portfolio/performance")
async def portfolio_performance(db: AsyncSession = Depends(get_db)):
    """
    Returns portfolio value over time using transaction history + live prices.
    Simplified: shows monthly snapshots based on deposit/withdrawal history.
    """
    txn_result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == _DEMO_USER_ID)
        .order_by(Transaction.executed_at)
    )
    transactions = txn_result.scalars().all()

    current = await get_portfolio_snapshot(_DEMO_USER_ID, db)
    current_value = current["total_value_cad"]

    # Build running net-deposit timeline
    running = 0.0
    timeline = []
    for txn in transactions:
        if txn.transaction_type == "deposit":
            running += txn.total_cad
        elif txn.transaction_type == "withdraw":
            running -= txn.total_cad
        timeline.append({
            "date": txn.executed_at.date().isoformat(),
            "net_deposits": round(running, 2),
            "transaction_type": txn.transaction_type,
            "amount": txn.total_cad,
        })

    return {
        "current_value_cad": current_value,
        "total_gain_loss_cad": current["total_gain_loss_cad"],
        "total_gain_loss_pct": current["total_gain_loss_pct"],
        "timeline": timeline,
        "tax_exposure": await calculate_tax_exposure(_DEMO_USER_ID, db),
    }


@router.get("/portfolio/position/{ticker}")
async def portfolio_position(
    ticker: str, period: str = "1mo", db: AsyncSession = Depends(get_db)
):
    return await get_position_history(_DEMO_USER_ID, ticker, period, db)


# ===========================================================================
# ACCOUNT ROUTES
# ===========================================================================

@router.get("/accounts")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Account).where(Account.user_id == _DEMO_USER_ID)
    )
    accounts = result.scalars().all()
    return [
        {
            "id": a.id,
            "account_type": a.account_type,
            "subtype": a.subtype,
            "product_name": a.product_name,
            "balance_cad": a.balance_cad,
            "interest_rate": a.interest_rate,
            "contribution_room_remaining": a.contribution_room_remaining,
            "contribution_deadline": a.contribution_deadline,
            "is_active": a.is_active,
        }
        for a in accounts
    ]


@router.get("/accounts/{account_id}")
async def get_account(account_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Account).where(
            Account.id == account_id, Account.user_id == _DEMO_USER_ID
        )
    )
    acct = result.scalar_one_or_none()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")

    pos_result = await db.execute(
        select(Position).where(Position.account_id == account_id)
    )
    positions = pos_result.scalars().all()
    tickers = [p.ticker for p in positions]

    from services.prices import get_multiple_prices
    prices = await get_multiple_prices(tickers)

    positions_data = []
    for pos in positions:
        pd = prices.get(pos.ticker, {})
        current_price = pd.get("cad_price") or pd.get("price") or pos.avg_cost_cad
        current_value = pos.shares * current_price
        cost_basis = pos.shares * pos.avg_cost_cad
        positions_data.append({
            "id": pos.id,
            "ticker": pos.ticker,
            "name": pos.name,
            "shares": pos.shares,
            "avg_cost_cad": pos.avg_cost_cad,
            "current_price": current_price,
            "current_value_cad": round(current_value, 2),
            "unrealized_gain_loss_cad": round(current_value - cost_basis, 2),
        })

    return {
        "id": acct.id,
        "account_type": acct.account_type,
        "subtype": acct.subtype,
        "product_name": acct.product_name,
        "balance_cad": acct.balance_cad,
        "interest_rate": acct.interest_rate,
        "contribution_room_remaining": acct.contribution_room_remaining,
        "contribution_deadline": acct.contribution_deadline,
        "is_active": acct.is_active,
        "positions": positions_data,
    }


class DepositRequest(BaseModel):
    amount_cad: float


class WithdrawRequest(BaseModel):
    amount_cad: float


class ExchangeRequest(BaseModel):
    from_account_id: int
    to_account_id: int
    amount_cad: float


@router.post("/accounts/{account_id}/deposit")
async def deposit(
    account_id: int, body: DepositRequest, db: AsyncSession = Depends(get_db)
):
    return await execute_deposit(_DEMO_USER_ID, account_id, body.amount_cad, db)


@router.post("/accounts/{account_id}/withdraw")
async def withdraw(
    account_id: int, body: WithdrawRequest, db: AsyncSession = Depends(get_db)
):
    return await execute_withdrawal(_DEMO_USER_ID, account_id, body.amount_cad, db)


@router.post("/accounts/exchange")
async def account_exchange(body: ExchangeRequest, db: AsyncSession = Depends(get_db)):
    return await execute_exchange(
        _DEMO_USER_ID, body.from_account_id, body.to_account_id, body.amount_cad, db
    )


# ===========================================================================
# MARKET DATA ROUTES
# ===========================================================================

@router.get("/markets/search")
async def market_search(q: str):
    if not q or len(q) < 1:
        raise HTTPException(status_code=400, detail="Query parameter 'q' is required")
    return await search_stocks(q)


@router.get("/markets/quote/{ticker}")
async def market_quote(ticker: str):
    quote = await get_current_price(ticker)
    chart = await get_price_history(ticker, "1d")
    return {"quote": quote, "chart_1d": chart}


@router.get("/markets/chart/{ticker}")
async def market_chart(ticker: str, period: str = "1mo"):
    return await get_price_history(ticker, period)


# ===========================================================================
# TRADING ROUTES
# ===========================================================================

class BuyRequest(BaseModel):
    account_id: int
    ticker: str
    shares: float


class SellRequest(BaseModel):
    account_id: int
    ticker: str
    shares: float


@router.post("/trade/buy")
async def trade_buy(body: BuyRequest, db: AsyncSession = Depends(get_db)):
    quote = await get_current_price(body.ticker)
    price_cad = quote.get("cad_price") or quote.get("price")
    if not price_cad:
        raise HTTPException(status_code=422, detail=f"Could not fetch price for {body.ticker}")
    return await execute_buy(_DEMO_USER_ID, body.account_id, body.ticker, body.shares, price_cad, db)


@router.post("/trade/sell")
async def trade_sell(body: SellRequest, db: AsyncSession = Depends(get_db)):
    quote = await get_current_price(body.ticker)
    price_cad = quote.get("cad_price") or quote.get("price")
    if not price_cad:
        raise HTTPException(status_code=422, detail=f"Could not fetch price for {body.ticker}")
    return await execute_sell(_DEMO_USER_ID, body.account_id, body.ticker, body.shares, price_cad, db)


class InterceptRequest(BaseModel):
    account_id: int
    ticker: str
    shares: float
    action: str  # "buy" | "sell"


@router.post("/trade/intercept")
async def trade_intercept(body: InterceptRequest, db: AsyncSession = Depends(get_db)):
    """
    Simulate a trade and run relevant agents before execution.
    Returns interception analysis within 8 seconds.
    """
    from services.interception import intercept_trade
    result = await intercept_trade(
        _DEMO_USER_ID, body.account_id, body.ticker, body.shares, body.action, db
    )
    logger.debug(
        "trade_intercept: should_intercept=%s headline=%r ticker=%s action=%s",
        result.get("should_intercept"),
        result.get("headline"),
        body.ticker,
        body.action,
    )
    return result


@router.get("/trade/history")
async def trade_history(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == _DEMO_USER_ID)
        .order_by(Transaction.executed_at.desc())
    )
    transactions = result.scalars().all()
    return [
        {
            "id": t.id,
            "account_id": t.account_id,
            "transaction_type": t.transaction_type,
            "ticker": t.ticker,
            "shares": t.shares,
            "price_cad": t.price_cad,
            "total_cad": t.total_cad,
            "currency_from": t.currency_from,
            "currency_to": t.currency_to,
            "exchange_rate": t.exchange_rate,
            "executed_at": t.executed_at.isoformat(),
            "notes": t.notes,
        }
        for t in transactions
    ]


# ===========================================================================
# FX / CURRENCY ROUTES
# ===========================================================================

@router.get("/fx/rate")
async def fx_rate(from_currency: str = "USD", to_currency: str = "CAD"):
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()

    if {from_currency, to_currency} != {"CAD", "USD"}:
        raise HTTPException(status_code=400, detail="Only CAD/USD pairs are supported")

    usdcad = await get_usdcad_rate()
    rate = usdcad if from_currency == "USD" else 1 / usdcad
    return {
        "from": from_currency,
        "to": to_currency,
        "rate": round(rate, 6),
        "usdcad": round(usdcad, 6),
    }


class FxExchangeRequest(BaseModel):
    account_id: int
    amount: float
    from_currency: str
    to_currency: str


@router.post("/fx/exchange")
async def fx_exchange(body: FxExchangeRequest, db: AsyncSession = Depends(get_db)):
    return await execute_currency_exchange(
        _DEMO_USER_ID,
        body.account_id,
        body.amount,
        body.from_currency,
        body.to_currency,
        db,
    )


# ===========================================================================
# CHAT ROUTES
# ===========================================================================

# Maps router agent names → agent functions and domain_findings keys
_CHAT_AGENT_MAP = {
    "allocation": allocation_agent,
    "tax_implications": tax_implications_agent,
    "tlh": tlh_agent,
    "rate_arbitrage": rate_arbitrage_agent,
    "timing": timing_agent,
}

# Maps router agent name → key returned inside domain_findings dict
_AGENT_TO_DOMAIN_KEY = {
    "allocation": "allocation",
    "tax_implications": "tax",
    "tlh": "tlh",
    "rate_arbitrage": "rates",
    "timing": "timing",
}

# Natural one-sentence descriptions emitted as handoff events before each agent runs
_AGENT_HANDOFF_MESSAGES = {
    "allocation": "Reviewing your contribution room and cash placement...",
    "tax_implications": "Analyzing the tax consequences of this trade...",
    "tlh": "Scanning for tax-loss harvesting opportunities...",
    "rate_arbitrage": "Comparing your margin rate against your cash position...",
    "timing": "Checking for time-sensitive deadlines...",
}

# Auto-referral handoff messages keyed by (source_agent, referred_agent)
_AUTO_REFERRAL_HANDOFF: dict[str, dict[str, str]] = {
    "allocation": {
        "rate_arbitrage": "Your cash position affects your rate picture too — checking that...",
        "timing": "Let me check if any deadlines apply to this...",
    },
    "tax_implications": {
        "tlh": "There may be losses worth harvesting against this — looking now...",
        "timing": "Checking if there are any time-sensitive considerations here...",
    },
    "tlh": {
        "timing": "Let me check the timing angle on this harvest...",
        "tax_implications": "Reviewing the full tax picture on this...",
    },
    "rate_arbitrage": {
        "allocation": "This changes your allocation calculus — checking contribution room...",
    },
    "timing": {
        "allocation": "Your cash position matters here — reviewing allocation...",
        "tax_implications": "Checking the tax angle on this timing...",
    },
}
_AUTO_REFERRAL_DEFAULT_HANDOFF = "Let me see if any agents can add to this..."


def _get_auto_referral_message(source_agents: list[str], target_agent: str) -> str:
    for src in source_agents:
        msg = _AUTO_REFERRAL_HANDOFF.get(src, {}).get(target_agent)
        if msg:
            return msg
    return _AUTO_REFERRAL_DEFAULT_HANDOFF


def _make_chat_state(portfolio: dict, cra_rules: dict, run_id: str) -> GraphState:
    return {
        "financial_profile": portfolio,
        "cra_rules": cra_rules,
        "domain_findings": {},
        "synthesized_insights": [],
        "hitl_status": "pending",
        "run_id": run_id,
    }


async def _save_chat_exchange(
    conv_id: int,
    user_message: str,
    assistant_response: str,
    agent_sources: list[str],
    domain_findings: dict,
) -> None:
    """Persist a user↔assistant exchange to the Conversation row."""
    now = datetime.datetime.utcnow().isoformat()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Conversation).where(Conversation.id == conv_id)
        )
        conv = result.scalar_one_or_none()
        if not conv:
            return
        messages = list(conv.messages or [])
        messages.append(
            {
                "role": "user",
                "content": user_message,
                "timestamp": now,
                "agent_sources": [],
                "findings_snapshot": {},
            }
        )
        messages.append(
            {
                "role": "assistant",
                "content": assistant_response,
                "timestamp": now,
                "agent_sources": agent_sources,
                "findings_snapshot": domain_findings,
            }
        )
        conv.messages = messages
        conv.last_findings = domain_findings
        conv.updated_at = datetime.datetime.utcnow()
        await db.commit()


# ---------------------------------------------------------------------------
# DELETE /chat/session  (clear conversation)
# ---------------------------------------------------------------------------

@router.delete("/chat/session")
async def clear_chat_session(db: AsyncSession = Depends(get_db)):
    """Delete today's chat session so the next POST /chat/session creates a fresh one."""
    today = datetime.date.today().isoformat()
    result = await db.execute(
        select(Conversation).where(
            Conversation.user_id == _DEMO_USER_ID,
            Conversation.session_id.like(f"chat-{today}%"),
        )
    )
    existing = result.scalars().first()
    if existing:
        await db.delete(existing)
        await db.commit()
    return {"cleared": True}


# ---------------------------------------------------------------------------
# POST /chat/session
# ---------------------------------------------------------------------------

@router.post("/chat/session")
async def create_chat_session(db: AsyncSession = Depends(get_db)):
    """
    Create or restore today's chat session for the demo user.
    Runs all 5 agents in parallel to generate a proactive greeting.
    Returns { session_id, greeting, top_findings, agent_sources }.
    """
    today = datetime.date.today().isoformat()
    existing_result = await db.execute(
        select(Conversation).where(
            Conversation.user_id == _DEMO_USER_ID,
            Conversation.session_id.like(f"chat-{today}%"),
        )
    )
    existing = existing_result.scalars().first()

    if existing:
        stored = existing.last_findings.get("greeting_data", {})
        return {
            "session_id": existing.session_id,
            "greeting": stored.get("message", "Welcome back. Ask me anything."),
            "top_findings": [],
            "agent_sources": [],
            "restored": True,
        }

    session_id = f"chat-{today}-{str(uuid.uuid4())[:8]}"
    greeting_data = await generate_proactive_greeting(_DEMO_USER_ID, db)

    initial_message = {
        "role": "assistant",
        "content": greeting_data["message"],
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "agent_sources": greeting_data["agent_sources"],
        "findings_snapshot": {"top_findings": greeting_data["top_findings"]},
    }

    conv = Conversation(
        user_id=_DEMO_USER_ID,
        session_id=session_id,
        messages=[initial_message],
        last_findings={"greeting_data": greeting_data},
    )
    db.add(conv)
    await db.commit()

    return {
        "session_id": session_id,
        "greeting": greeting_data["message"],
        "top_findings": greeting_data["top_findings"],
        "agent_sources": greeting_data["agent_sources"],
    }


# ---------------------------------------------------------------------------
# POST /chat/message  (SSE streaming)
# ---------------------------------------------------------------------------

class ChatMessageRequest(BaseModel):
    session_id: str
    message: str


@router.post("/chat/message")
async def chat_message(body: ChatMessageRequest, db: AsyncSession = Depends(get_db)):
    """
    Stream a chat response via SSE.

    SSE event sequence:
      routing → [web_search_start → web_search_complete] → agent_start (×N) → agent_complete (×N) → response → follow_ups → done
    """
    conv_result = await db.execute(
        select(Conversation).where(Conversation.session_id == body.session_id)
    )
    conv = conv_result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Session not found")

    conv_id = conv.id
    history: list[dict] = list(conv.messages or [])
    last_findings: dict = dict(conv.last_findings or {})
    cra_rules = _load_cra_rules()

    async def generate():
        # Chain-protection state — tracks every agent invoked this turn
        turn_agents_invoked: set[str] = set()
        auto_referral_count = 0
        MAX_AUTO_REFERRALS = 1

        try:
            run_id = f"chat-{body.session_id}"

            # ── 0. Fresh portfolio — never use cached/session-stored data ─
            async with AsyncSessionLocal() as fresh_db:
                portfolio = await get_portfolio_snapshot(_DEMO_USER_ID, fresh_db)

            # ── 1. Route ──────────────────────────────────────────────────
            routing = await conversation_router(body.message, history, last_findings)
            agents_to_invoke = routing.get("agents_to_invoke") or []
            needs_web_search = routing.get("needs_web_search", False)
            web_search_query = routing.get("web_search_query") or ""

            yield {
                "event": "routing",
                "data": json.dumps(
                    {
                        "agents_to_invoke": agents_to_invoke,
                        "routing_reasoning": routing.get("routing_reasoning", ""),
                        "can_answer_from_context": routing.get("can_answer_from_context", False),
                        "needs_web_search": needs_web_search,
                    }
                ),
            }

            # ── 1b. Web search (runs even for direct/context responses) ──
            search_results: list[dict] = []
            if needs_web_search and web_search_query:
                yield {"event": "web_search_start", "data": json.dumps({"query": web_search_query})}
                try:
                    # Run both text and news search in parallel, take best results
                    text_results, news_results = await asyncio.gather(
                        web_search(web_search_query, max_results=4),
                        news_search(web_search_query, max_results=3),
                    )
                    # Combine and deduplicate by URL
                    seen_urls: set[str] = set()
                    for r in news_results + text_results:
                        if r["url"] not in seen_urls and r["title"]:
                            search_results.append(r)
                            seen_urls.add(r["url"])
                    search_results = search_results[:5]
                    yield {
                        "event": "web_search_complete",
                        "data": json.dumps({
                            "result_count": len(search_results),
                            "results": search_results,
                        }),
                    }
                except Exception as exc:
                    logger.error("Web search failed: %s", exc)
                    yield {"event": "web_search_complete", "data": json.dumps({"result_count": 0, "results": [], "error": str(exc)})}

            # ── 2. Can answer from context / no agents needed ─────────────
            if routing.get("can_answer_from_context") or not agents_to_invoke:
                direct = routing.get("direct_response") or ""
                # If we have search results but no agents, synthesize a response that includes search context
                if search_results and direct:
                    direct = await synthesize_response(
                        body.message,
                        {**last_findings, "web_search_results": search_results},
                        history,
                    )
                elif search_results:
                    direct = await synthesize_response(
                        body.message,
                        {"web_search_results": search_results},
                        history,
                    )
                yield {"event": "response", "data": json.dumps({"text": direct})}
                if search_results:
                    yield {"event": "sources", "data": json.dumps({"sources": search_results})}
                turn_agents_invoked.add("direct_response")

                all_findings = dict(last_findings)
                if search_results:
                    all_findings["web_search_results"] = search_results
                final_response = direct
                referral_agents_run: list[str] = []

                # Universal cross-referral check — runs after every response
                referrals = await get_cross_referral_candidates(
                    ["direct_response"], direct, all_findings,
                    body.message, turn_agents_invoked, MAX_AUTO_REFERRALS,
                )
                for referral in referrals:
                    if auto_referral_count >= MAX_AUTO_REFERRALS:
                        break
                    ref_agent = referral["agent"]
                    if ref_agent in turn_agents_invoked:
                        continue
                    handoff_msg = _get_auto_referral_message(["direct_response"], ref_agent)
                    yield {"event": "handoff", "data": json.dumps({"agent": ref_agent, "message": handoff_msg})}
                    yield {"event": "agent_start", "data": json.dumps({"agent": ref_agent})}
                    try:
                        ref_result = await _CHAT_AGENT_MAP[ref_agent](_make_chat_state(portfolio, cra_rules, run_id))
                        ref_findings = ref_result.get("domain_findings", {})
                        domain_key = _AGENT_TO_DOMAIN_KEY.get(ref_agent, ref_agent)
                        finding_count = len(ref_findings.get(domain_key, []))
                        yield {"event": "agent_complete", "data": json.dumps({"agent": ref_agent, "finding_count": finding_count})}
                        all_findings.update(ref_findings)
                        turn_agents_invoked.add(ref_agent)
                        referral_agents_run.append(ref_agent)
                        auto_referral_count += 1
                        ref_synth_findings = dict(ref_findings)
                        if search_results:
                            ref_synth_findings["web_search_results"] = search_results
                        followup_text = await synthesize_response(body.message, ref_synth_findings, history)
                        final_response = followup_text
                        yield {"event": "auto_referral_response", "data": json.dumps({"agent": ref_agent, "text": followup_text})}
                    except Exception as exc:
                        logger.error("Auto-referral agent %s failed: %s", ref_agent, exc)
                        yield {"event": "agent_complete", "data": json.dumps({"agent": ref_agent, "finding_count": 0, "error": str(exc)})}

                chips = await generate_follow_up_chips(body.message, final_response, all_findings)
                yield {"event": "follow_ups", "data": json.dumps({"chips": chips})}
                yield {"event": "done", "data": json.dumps({"session_id": body.session_id})}
                await _save_chat_exchange(conv_id, body.message, final_response, referral_agents_run, all_findings)
                return

            # ── 3. Agent start + handoff events ─────────────────────────
            valid_agents = [d for d in agents_to_invoke if d in _CHAT_AGENT_MAP]
            turn_agents_invoked.update(valid_agents)
            for domain in valid_agents:
                yield {"event": "agent_start", "data": json.dumps({"agent": domain})}
                yield {
                    "event": "handoff",
                    "data": json.dumps({
                        "agent": domain,
                        "message": _AGENT_HANDOFF_MESSAGES.get(
                            domain, f"Running {domain} analysis..."
                        ),
                    }),
                }

            # ── 4. Run selected agents in parallel ────────────────────────
            agent_results = await asyncio.gather(
                *[
                    _CHAT_AGENT_MAP[domain](_make_chat_state(portfolio, cra_rules, run_id))
                    for domain in valid_agents
                ],
                return_exceptions=True,
            )

            domain_findings: dict = {}
            for domain, result in zip(valid_agents, agent_results):
                if isinstance(result, Exception):
                    logger.error("Agent %s failed in chat: %s", domain, result)
                    yield {
                        "event": "agent_complete",
                        "data": json.dumps({"agent": domain, "finding_count": 0, "error": str(result)}),
                    }
                else:
                    domain_findings.update(result.get("domain_findings", {}))
                    domain_key = _AGENT_TO_DOMAIN_KEY.get(domain, domain)
                    count = len(domain_findings.get(domain_key, []))
                    yield {
                        "event": "agent_complete",
                        "data": json.dumps({"agent": domain, "finding_count": count}),
                    }

            # ── 5. Synthesise primary response ────────────────────────────
            # Include web search results in the findings if available
            synth_findings = dict(domain_findings)
            if search_results:
                synth_findings["web_search_results"] = search_results
            response_text = await synthesize_response(body.message, synth_findings, history)
            yield {"event": "response", "data": json.dumps({"text": response_text})}
            if search_results:
                yield {"event": "sources", "data": json.dumps({"sources": search_results})}

            # ── 6. Universal cross-referral — runs after every agent response ──
            all_findings = dict(domain_findings)
            if search_results:
                all_findings["web_search_results"] = search_results
            final_response = response_text

            referrals = await get_cross_referral_candidates(
                valid_agents, response_text, domain_findings,
                body.message, turn_agents_invoked, MAX_AUTO_REFERRALS,
            )
            for referral in referrals:
                if auto_referral_count >= MAX_AUTO_REFERRALS:
                    break
                ref_agent = referral["agent"]
                if ref_agent in turn_agents_invoked:
                    continue
                handoff_msg = _get_auto_referral_message(valid_agents, ref_agent)
                yield {"event": "handoff", "data": json.dumps({"agent": ref_agent, "message": handoff_msg})}
                yield {"event": "agent_start", "data": json.dumps({"agent": ref_agent})}
                try:
                    ref_result = await _CHAT_AGENT_MAP[ref_agent](_make_chat_state(portfolio, cra_rules, run_id))
                    ref_findings = ref_result.get("domain_findings", {})
                    domain_key = _AGENT_TO_DOMAIN_KEY.get(ref_agent, ref_agent)
                    finding_count = len(ref_findings.get(domain_key, []))
                    yield {"event": "agent_complete", "data": json.dumps({"agent": ref_agent, "finding_count": finding_count})}
                    all_findings.update(ref_findings)
                    turn_agents_invoked.add(ref_agent)
                    auto_referral_count += 1
                    # Include web search results so the synthesizer doesn't claim they're missing
                    ref_synth_findings = dict(ref_findings)
                    if search_results:
                        ref_synth_findings["web_search_results"] = search_results
                    followup_text = await synthesize_response(body.message, ref_synth_findings, history)
                    final_response = followup_text
                    yield {"event": "auto_referral_response", "data": json.dumps({"agent": ref_agent, "text": followup_text})}
                except Exception as exc:
                    logger.error("Auto-referral agent %s failed: %s", ref_agent, exc)
                    yield {"event": "agent_complete", "data": json.dumps({"agent": ref_agent, "finding_count": 0, "error": str(exc)})}

            # ── 7. Follow-up chips + save ────────────────────────────────
            chips = await generate_follow_up_chips(body.message, final_response, all_findings)
            yield {"event": "follow_ups", "data": json.dumps({"chips": chips})}

            saved_sources = [a for a in turn_agents_invoked if a != "direct_response"]
            if search_results:
                saved_sources.append("web_search")
            await _save_chat_exchange(conv_id, body.message, final_response, saved_sources, all_findings)
            yield {"event": "done", "data": json.dumps({"session_id": body.session_id})}

        except Exception as exc:
            logger.error("Chat message generator failed: %s", exc)
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(generate())


# ---------------------------------------------------------------------------
# GET /chat/session/{session_id}
# ---------------------------------------------------------------------------

@router.get("/chat/session/{session_id}")
async def get_chat_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation).where(Conversation.session_id == session_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": conv.session_id,
        "messages": conv.messages,
        "last_findings": conv.last_findings,
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# POST /chat/whatif
# ---------------------------------------------------------------------------

class WhatIfRequest(BaseModel):
    session_id: str
    scenario: str          # e.g. "rrsp_contribution"
    parameters: dict       # e.g. {"amount": 5000}


def _apply_whatif(portfolio: dict, scenario: str, parameters: dict) -> dict:
    """Return a deep-copied, modified portfolio snapshot for what-if analysis."""
    modified = copy.deepcopy(portfolio)
    amount = float(parameters.get("amount", 0))

    if scenario == "rrsp_contribution":
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

    elif scenario == "tfsa_contribution":
        for acct in modified["accounts"]:
            if acct["account_type"] == "tfsa":
                room = acct.get("contribution_room_remaining") or 0
                acct["contribution_room_remaining"] = max(0.0, room - amount)
                acct["balance_cad"] = acct.get("balance_cad", 0.0) + amount
                acct["total_value_cad"] = acct.get("total_value_cad", 0.0) + amount
        if modified.get("contribution_room", {}).get("tfsa") is not None:
            modified["contribution_room"]["tfsa"] = max(
                0.0, (modified["contribution_room"]["tfsa"] or 0) - amount
            )

    elif scenario == "pay_margin":
        for acct in modified["accounts"]:
            if acct["account_type"] == "margin":
                current_debit = abs(acct.get("balance_cad", 0.0))
                new_debit = max(0.0, current_debit - amount)
                acct["balance_cad"] = -new_debit
        if modified.get("margin"):
            current_debit = modified["margin"].get("debit_balance", 0.0)
            new_debit = max(0.0, current_debit - amount)
            rate = modified["margin"].get("interest_rate") or 0.062
            modified["margin"] = {
                "debit_balance": new_debit,
                "interest_rate": rate,
                "annual_cost": round(new_debit * rate, 2),
            }

    return modified


def _compute_whatif_delta(baseline: list[dict], modified: list[dict]) -> list[dict]:
    """Side-by-side delta comparison of findings by title."""
    b_by_title = {f["title"]: f for f in baseline}
    m_by_title = {f["title"]: f for f in modified}
    all_titles = set(b_by_title) | set(m_by_title)
    delta = []

    for title in all_titles:
        b = b_by_title.get(title)
        m = m_by_title.get(title)
        b_impact = float((b or {}).get("dollar_impact", 0))
        m_impact = float((m or {}).get("dollar_impact", 0))
        delta_impact = m_impact - b_impact
        delta_pct = round((delta_impact / b_impact * 100) if b_impact else 0.0, 1)
        direction = (
            "unchanged"
            if abs(delta_impact) < 0.01
            else ("improved" if delta_impact > 0 else "worsened")
        )
        delta.append(
            {
                "title": title,
                "baseline_dollar_impact": round(b_impact, 2),
                "modified_dollar_impact": round(m_impact, 2),
                "delta_dollar_impact": round(delta_impact, 2),
                "delta_pct": delta_pct,
                "direction": direction,
                "present_in": (
                    "both"
                    if (b and m)
                    else ("modified_only" if m else "baseline_only")
                ),
            }
        )

    return sorted(delta, key=lambda d: abs(d["delta_dollar_impact"]), reverse=True)


@router.post("/chat/whatif")
async def chat_whatif(body: WhatIfRequest, db: AsyncSession = Depends(get_db)):
    """
    Run agents against both the baseline and a modified portfolio snapshot.
    Returns a side-by-side delta comparison of findings.
    """
    # Validate session
    conv_result = await db.execute(
        select(Conversation).where(Conversation.session_id == body.session_id)
    )
    if not conv_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    baseline = await get_portfolio_snapshot(_DEMO_USER_ID, db)
    cra_rules = _load_cra_rules()
    modified = _apply_whatif(baseline, body.scenario, body.parameters)

    # Choose relevant agents for the scenario
    scenario_agents: dict[str, list[str]] = {
        "rrsp_contribution": ["allocation", "timing"],
        "tfsa_contribution": ["allocation"],
        "pay_margin": ["rate_arbitrage"],
        "sell_position": ["tax_implications", "tlh"],
    }
    agents_to_run = [
        d for d in scenario_agents.get(body.scenario, ["allocation", "timing"])
        if d in _CHAT_AGENT_MAP
    ]

    run_id = f"whatif-{body.session_id}"

    baseline_results, modified_results = await asyncio.gather(
        asyncio.gather(
            *[_CHAT_AGENT_MAP[d](_make_chat_state(baseline, cra_rules, run_id)) for d in agents_to_run],
            return_exceptions=True,
        ),
        asyncio.gather(
            *[_CHAT_AGENT_MAP[d](_make_chat_state(modified, cra_rules, run_id)) for d in agents_to_run],
            return_exceptions=True,
        ),
    )

    def _collect(results, agents) -> list[dict]:
        out = []
        for result, domain in zip(results, agents):
            if not isinstance(result, Exception):
                for findings in result.get("domain_findings", {}).values():
                    out.extend(findings)
        return out

    baseline_findings = _collect(baseline_results, agents_to_run)
    modified_findings = _collect(modified_results, agents_to_run)
    delta = _compute_whatif_delta(baseline_findings, modified_findings)

    return {
        "scenario": body.scenario,
        "parameters": body.parameters,
        "agents_run": agents_to_run,
        "baseline_findings": baseline_findings,
        "modified_findings": modified_findings,
        "delta": delta,
    }


# ===========================================================================
# MONITOR ROUTES
# ===========================================================================

@router.get("/monitor/alerts")
async def get_monitor_alerts(db: AsyncSession = Depends(get_db)):
    """Return unsurfaced (pending) alerts for the demo user and mark them surfaced."""
    result = await db.execute(
        select(MonitorAlert)
        .where(
            MonitorAlert.user_id == _DEMO_USER_ID,
            MonitorAlert.dismissed_at.is_(None),
        )
        .order_by(MonitorAlert.created_at.desc())
        .limit(10)
    )
    alerts = result.scalars().all()

    now = datetime.datetime.utcnow()
    for a in alerts:
        if a.surfaced_at is None:
            a.surfaced_at = now
    if alerts:
        await db.commit()

    return [
        {
            "id": a.id,
            "alert_type": a.alert_type,
            "message": a.message,
            "ticker": a.ticker,
            "dollar_impact": a.dollar_impact,
            "created_at": a.created_at.isoformat(),
        }
        for a in alerts
    ]


@router.post("/monitor/alerts/{alert_id}/dismiss")
async def dismiss_monitor_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MonitorAlert).where(
            MonitorAlert.id == alert_id,
            MonitorAlert.user_id == _DEMO_USER_ID,
        )
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.dismissed_at = datetime.datetime.utcnow()
    await db.commit()
    return {"success": True}


# ===========================================================================
# ADVISOR ROUTES
# ===========================================================================

@router.post("/advisor/report")
async def advisor_report(db: AsyncSession = Depends(get_db)):
    """
    Run all 5 agents + synthesize a three-part advisor report.
    Returns cached result if generated within last 10 minutes.
    """
    from services.advisor import generate_advisor_report
    return await generate_advisor_report(_DEMO_USER_ID, db)



@router.get("/debug/consistency")
async def debug_consistency(db: AsyncSession = Depends(get_db)):
    """
    Audit and repair data consistency.
    Deletes zero-share positions and reports negative balances.
    """
    pos_result = await db.execute(
        select(Position).where(Position.user_id == _DEMO_USER_ID)
    )
    all_positions = pos_result.scalars().all()

    zero_share_deleted = 0
    for pos in all_positions:
        if pos.shares <= 0.000001:
            await db.delete(pos)
            zero_share_deleted += 1

    acct_result = await db.execute(
        select(Account).where(Account.user_id == _DEMO_USER_ID)
    )
    accounts = acct_result.scalars().all()

    negative_balances = [
        {"id": a.id, "product_name": a.product_name, "balance_cad": a.balance_cad}
        for a in accounts
        if a.balance_cad < 0 and a.account_type != "margin"
    ]

    if zero_share_deleted > 0:
        await db.commit()

    return {
        "positions_checked": len(all_positions),
        "zero_share_rows_deleted": zero_share_deleted,
        "negative_balances_found": len(negative_balances),
        "accounts_checked": len(accounts),
        "negative_balance_accounts": negative_balances,
    }


@router.websocket("/ws/monitor/{user_id}")
async def monitor_websocket(user_id: str, websocket: WebSocket):
    """Per-user WebSocket for real-time monitor alerts."""
    user_ws_manager = websocket.app.state.user_ws_manager
    await user_ws_manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        user_ws_manager.disconnect(user_id, websocket)
