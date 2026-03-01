"""
Stock price service using yfinance.

All public functions are async. yfinance is synchronous, so all calls
run inside asyncio.to_thread to avoid blocking the event loop.

60-second in-memory cache prevents hammering the API on repeated calls.
"""

import asyncio
import logging
import time
from typing import Any

import yfinance as yf

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

_cache: dict[str, tuple[float, Any]] = {}  # key -> (timestamp, data)
_CACHE_TTL = 60.0


def _get_cached(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL:
        return entry[1]
    return None


def _set_cached(key: str, data: Any) -> None:
    _cache[key] = (time.time(), data)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _fetch_quote(ticker: str) -> dict:
    """Synchronous fetch — runs in a thread."""
    t = yf.Ticker(ticker)
    hist = t.history(period="5d")
    if hist.empty:
        raise ValueError(f"No price data for {ticker}")

    last_close = float(hist["Close"].iloc[-1])
    prev_close = float(hist["Close"].iloc[-2]) if len(hist) > 1 else last_close
    change_pct = ((last_close - prev_close) / prev_close * 100) if prev_close else 0.0

    try:
        fi = t.fast_info
        volume = int(fi.three_month_average_volume or hist["Volume"].iloc[-1])
        market_cap = fi.market_cap or 0
        name = fi.currency or ""
    except Exception:
        volume = int(hist["Volume"].iloc[-1])
        market_cap = 0
        name = ""

    try:
        info = t.info
        name = info.get("longName") or info.get("shortName") or ticker
        market_cap = info.get("marketCap", market_cap)
    except Exception:
        pass

    return {
        "ticker": ticker,
        "price": last_close,
        "currency": "CAD" if ticker.endswith(".TO") or ticker.endswith("-CAD") else "USD",
        "change_pct": round(change_pct, 4),
        "volume": volume,
        "market_cap": market_cap,
        "name": name,
    }


def _fetch_usdcad_rate() -> float:
    """Fetch live USDCAD exchange rate."""
    t = yf.Ticker("USDCAD=X")
    hist = t.history(period="2d")
    if hist.empty:
        return 1.36  # fallback
    return float(hist["Close"].iloc[-1])


def _fetch_history(ticker: str, period: str) -> list[dict]:
    """Synchronous history fetch."""
    t = yf.Ticker(ticker)
    hist = t.history(period=period)
    if hist.empty:
        return []

    result = []
    for dt_idx, row in hist.iterrows():
        result.append({
            "date": str(dt_idx.date()),
            "open": round(float(row["Open"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "close": round(float(row["Close"]), 4),
            "volume": int(row["Volume"]),
        })
    return result


def _search_query(query: str) -> list[dict]:
    """Synchronous stock search."""
    try:
        results = yf.Search(query, max_results=10)
        quotes = results.quotes
        return [
            {
                "ticker": q.get("symbol", ""),
                "name": q.get("shortname") or q.get("longname", ""),
                "exchange": q.get("exchange", ""),
                "type": q.get("typeDisp", "Equity"),
            }
            for q in quotes[:10]
            if q.get("symbol")
        ]
    except Exception as exc:
        logger.warning("Stock search failed for %r: %s", query, exc)
        return []


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def get_current_price(ticker: str) -> dict:
    """
    Returns: { ticker, price, currency, change_pct, volume, market_cap, name }

    For USD tickers, also includes cad_price and usdcad_rate.
    """
    cache_key = f"price:{ticker}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        data = await asyncio.to_thread(_fetch_quote, ticker)

        # For USD-denominated tickers, attach CAD conversion
        if data["currency"] == "USD":
            rate = await get_usdcad_rate()
            data["cad_price"] = round(data["price"] * rate, 4)
            data["usdcad_rate"] = rate
        else:
            data["cad_price"] = data["price"]

        _set_cached(cache_key, data)
        return data
    except Exception as exc:
        logger.error("Failed to fetch price for %s: %s", ticker, exc)
        return {
            "ticker": ticker,
            "price": 0.0,
            "cad_price": 0.0,
            "currency": "CAD",
            "change_pct": 0.0,
            "volume": 0,
            "market_cap": 0,
            "name": ticker,
            "error": str(exc),
        }


async def get_usdcad_rate() -> float:
    """Returns live USD→CAD exchange rate."""
    cached = _get_cached("fx:USDCAD")
    if cached is not None:
        return cached
    rate = await asyncio.to_thread(_fetch_usdcad_rate)
    _set_cached("fx:USDCAD", rate)
    return rate


async def get_price_history(ticker: str, period: str = "1mo") -> list[dict]:
    """
    period: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y'
    Returns list of { date, open, high, low, close, volume }
    """
    valid_periods = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "5y"}
    if period not in valid_periods:
        period = "1mo"

    cache_key = f"hist:{ticker}:{period}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        data = await asyncio.to_thread(_fetch_history, ticker, period)
        _set_cached(cache_key, data)
        return data
    except Exception as exc:
        logger.error("Failed to fetch history for %s: %s", ticker, exc)
        return []


async def get_multiple_prices(tickers: list[str]) -> dict[str, dict]:
    """
    Fetches all tickers in parallel.
    Returns dict keyed by ticker.
    """
    if not tickers:
        return {}

    results = await asyncio.gather(*[get_current_price(t) for t in tickers])
    return {r["ticker"]: r for r in results}


async def search_stocks(query: str) -> list[dict]:
    """
    Returns up to 10 matching tickers with name and exchange.
    """
    cache_key = f"search:{query.lower()}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    data = await asyncio.to_thread(_search_query, query)
    _set_cached(cache_key, data)
    return data
