"use client";

import { useState, useEffect, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Search, Star, StarOff, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { searchStocks, getQuote, getChart } from "@/lib/api";
import { TradeModal } from "@/components/trading/TradeModal";
import { usePortfolio } from "@/contexts/PortfolioContext";
import type { StockResult, PriceBar, Account } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cad(n: number, cents = true) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-200 rounded ${className}`} />;
}

const PERIODS = ["1d", "5d", "1mo", "3mo", "1y"] as const;
type Period = (typeof PERIODS)[number];

const WATCHLIST_KEY = "wm_watchlist";

function loadWatchlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveWatchlist(list: string[]) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

// ─── Stock Detail ─────────────────────────────────────────────────────────────

interface StockDetailProps {
  ticker: string;
  onTrade: (ticker: string) => void;
  isWatched: boolean;
  onToggleWatch: () => void;
}

function StockDetail({
  ticker,
  onTrade,
  isWatched,
  onToggleWatch,
}: StockDetailProps) {
  const [period, setPeriod] = useState<Period>("1mo");
  const [chart, setChart] = useState<{ date: string; value: number }[]>([]);
  const [quote, setQuote] = useState<StockResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getQuote(ticker), getChart(ticker, period)])
      .then(([q, ch]) => {
        const qdata = q.quote;
        setQuote({
          ticker: qdata.ticker ?? ticker,
          name: qdata.name ?? ticker,
          exchange: "",
          price: qdata.cad_price ?? qdata.price ?? 0,
          cad_price: qdata.cad_price,
          change: 0,
          change_pct: qdata.change_pct ?? 0,
          currency: qdata.currency ?? "CAD",
        });
        const bars = Array.isArray(ch) ? (ch as PriceBar[]) : [];
        setChart(
          bars.map((b) => ({ date: b.date, value: b.close ?? b.open ?? 0 }))
        );
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [ticker, period]);

  const up = (quote?.change_pct ?? 0) >= 0;
  const price = quote?.price ?? 0;

  return (
    <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {loading ? (
            <>
              <Sk className="h-6 w-24 mb-1.5" />
              <Sk className="h-4 w-36" />
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-[#111827]">
                {quote?.ticker ?? ticker}
              </h2>
              <p className="text-sm text-[#6B7280]">{quote?.name}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleWatch}
            className="text-[#6B7280] hover:text-amber-500 transition-colors"
            title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
          >
            {isWatched ? (
              <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
            ) : (
              <StarOff className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={() => onTrade(ticker)}
            className="px-4 py-2 bg-[#111827] text-white text-sm font-semibold rounded-xl hover:bg-zinc-700 transition-colors"
          >
            Buy
          </button>
        </div>
      </div>

      {/* Price */}
      {loading ? (
        <Sk className="h-8 w-32" />
      ) : (
        <div>
          <p className="text-3xl font-semibold text-[#111827] tabular-nums">
            {cad(price)}
          </p>
          <div
            className={`flex items-center gap-1 text-sm font-medium mt-0.5 ${
              up ? "text-[#16A34A]" : "text-[#DC2626]"
            }`}
          >
            {up ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : (
              <ArrowDownRight className="w-4 h-4" />
            )}
            {(quote?.change_pct ?? 0).toFixed(2)}% today
          </div>
        </div>
      )}

      {/* Chart */}
      <div>
        <div className="flex gap-1 mb-3">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                period === p
                  ? "bg-[#111827] text-white"
                  : "text-[#6B7280] hover:text-[#111827] hover:bg-zinc-100"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        {loading || chart.length === 0 ? (
          <Sk className="h-40 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart
              data={chart}
              margin={{ top: 2, right: 2, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="mktGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={up ? "#16A34A" : "#DC2626"}
                    stopOpacity={0.1}
                  />
                  <stop
                    offset="95%"
                    stopColor={up ? "#16A34A" : "#DC2626"}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 9, fill: "#9CA3AF" }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 9, fill: "#9CA3AF" }}
                width={50}
                tickFormatter={(v: number) => cad(v)}
                domain={["auto", "auto"]}
              />
              <Tooltip
                formatter={(v) => [cad(v as number), "Price"]}
                contentStyle={{
                  border: "1px solid #E5E5E5",
                  borderRadius: "8px",
                  fontSize: "11px",
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={up ? "#16A34A" : "#DC2626"}
                strokeWidth={1.5}
                fill="url(#mktGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MarketsPage() {
  const { portfolio } = usePortfolio();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchPrices, setWatchPrices] = useState<
    Record<string, StockResult>
  >({});
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeTicker, setTradeTicker] = useState("");
  const [toast, setToast] = useState("");
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load watchlist from localStorage
  useEffect(() => {
    setWatchlist(loadWatchlist());
  }, []);

  // Fetch live prices for watchlist
  useEffect(() => {
    if (watchlist.length === 0) return;
    let cancelled = false;
    async function fetchPrices() {
      const prices: Record<string, StockResult> = {};
      await Promise.all(
        watchlist.map(async (t) => {
          try {
            const q = await getQuote(t);
            if (!cancelled) {
              prices[t] = {
                ticker: t,
                name: q.quote.name ?? t,
                exchange: "",
                price: q.quote.cad_price ?? q.quote.price ?? 0,
                cad_price: q.quote.cad_price,
                change: 0,
                change_pct: q.quote.change_pct ?? 0,
                currency: q.quote.currency ?? "CAD",
              };
            }
          } catch {
            // silent
          }
        })
      );
      if (!cancelled) setWatchPrices(prices);
    }
    fetchPrices();
    return () => {
      cancelled = true;
    };
  }, [watchlist]);

  // Search with debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (searchRef.current) clearTimeout(searchRef.current);
    setSearching(true);
    searchRef.current = setTimeout(async () => {
      try {
        const r = await searchStocks(query);
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query]);

  function toggleWatch(ticker: string) {
    setWatchlist((prev) => {
      const next = prev.includes(ticker)
        ? prev.filter((t) => t !== ticker)
        : [...prev, ticker];
      saveWatchlist(next);
      return next;
    });
  }

  function openTrade(ticker: string) {
    setTradeTicker(ticker);
    setTradeOpen(true);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const eligibleAccounts = (portfolio?.accounts ?? []).filter(
    (a) => a.subtype === "self_directed" && a.is_active
  ) as Account[];

  return (
    <div className="p-6 flex flex-col gap-6">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#111827] text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <h1 className="text-2xl font-semibold text-[#111827]">Markets</h1>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stocks (e.g. Royal Bank, SHOP.TO)"
          className="w-full pl-10 pr-4 py-3 border border-[#E5E5E5] rounded-xl text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827] bg-white shadow-sm transition-all"
        />
        {searching && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#111827] border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Search results */}
      {results.length > 0 && (
        <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E5E5E5]">
            <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">
              Results
            </p>
          </div>
          <div className="divide-y divide-[#E5E5E5]">
            {results.map((r) => {
              const up = (r.change_pct ?? 0) >= 0;
              const price = r.cad_price ?? r.price;
              return (
                <div
                  key={r.ticker}
                  onClick={() => {
                    setSelectedTicker(r.ticker);
                    setQuery("");
                    setResults([]);
                  }}
                  className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-zinc-50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#111827]">
                      {r.ticker}
                    </p>
                    <p className="text-xs text-[#6B7280]">
                      {r.name} · {r.exchange}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-[#111827] tabular-nums">
                      {price ? cad(price) : "—"}
                    </p>
                    {r.change_pct != null && (
                      <p
                        className={`text-xs tabular-nums ${
                          up ? "text-[#16A34A]" : "text-[#DC2626]"
                        }`}
                      >
                        {up ? "+" : ""}
                        {r.change_pct.toFixed(2)}%
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stock detail */}
      {selectedTicker && (
        <StockDetail
          ticker={selectedTicker}
          onTrade={openTrade}
          isWatched={watchlist.includes(selectedTicker)}
          onToggleWatch={() => toggleWatch(selectedTicker)}
        />
      )}

      {/* Watchlist */}
      <div>
        <h2 className="text-sm font-semibold text-[#111827] mb-3">
          Watchlist
        </h2>
        {watchlist.length === 0 ? (
          <div className="bg-white border border-[#E5E5E5] rounded-xl p-8 text-center text-sm text-[#6B7280]">
            <Star className="w-6 h-6 text-zinc-300 mx-auto mb-2" />
            Search for a stock and click the star to add to your watchlist
          </div>
        ) : (
          <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm overflow-hidden">
            <div className="divide-y divide-[#E5E5E5]">
              {watchlist.map((ticker) => {
                const q = watchPrices[ticker];
                const up = (q?.change_pct ?? 0) >= 0;
                return (
                  <div
                    key={ticker}
                    onClick={() => setSelectedTicker(ticker)}
                    className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-zinc-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWatch(ticker);
                        }}
                        className="text-amber-400 hover:text-[#6B7280] transition-colors"
                      >
                        <Star className="w-4 h-4 fill-current" />
                      </button>
                      <div>
                        <p className="text-sm font-semibold text-[#111827]">
                          {ticker}
                        </p>
                        {q?.name && (
                          <p className="text-xs text-[#6B7280]">{q.name}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {q ? (
                        <>
                          <p className="text-sm font-medium text-[#111827] tabular-nums">
                            {cad(q.cad_price ?? q.price)}
                          </p>
                          <p
                            className={`text-xs tabular-nums ${
                              up ? "text-[#16A34A]" : "text-[#DC2626]"
                            }`}
                          >
                            {up ? "+" : ""}
                            {(q.change_pct ?? 0).toFixed(2)}%
                          </p>
                        </>
                      ) : (
                        <Sk className="h-4 w-16" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <TradeModal
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        initialTicker={tradeTicker}
        initialMode="buy"
        accounts={eligibleAccounts}
        onSuccess={showToast}
      />
    </div>
  );
}
