"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ChevronUp,
  ChevronDown,
  X,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { getPositionHistory } from "@/lib/api";
import { TradeModal } from "@/components/trading/TradeModal";
import { usePortfolio } from "@/contexts/PortfolioContext";
import type { Position, PositionHistory, Account } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cad(n: number, cents = false) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-200 rounded ${className}`} />;
}

const ACCOUNT_FILTERS = [
  { key: "all", label: "All Accounts" },
  { key: "tfsa", label: "TFSA" },
  { key: "rrsp", label: "RRSP" },
  { key: "non_registered", label: "Non-Registered" },
  { key: "crypto", label: "Crypto" },
] as const;

type FilterKey = (typeof ACCOUNT_FILTERS)[number]["key"];

type SortKey =
  | "ticker"
  | "current_value_cad"
  | "unrealized_gain_loss_cad"
  | "unrealized_gain_loss_pct"
  | "change_pct";

const PERIODS = ["1d", "1mo", "3mo", "1y"] as const;
type Period = (typeof PERIODS)[number];

// ─── Position Detail Panel ────────────────────────────────────────────────────

function PositionPanel({
  position,
  onClose,
  onTrade,
}: {
  position: Position;
  onClose: () => void;
  onTrade: (mode: "buy" | "sell") => void;
}) {
  const [history, setHistory] = useState<PositionHistory | null>(null);
  const [chartPeriod, setChartPeriod] = useState<Period>("1mo");
  const [loadingChart, setLoadingChart] = useState(false);

  const loadHistory = useCallback(
    async (period: Period) => {
      setLoadingChart(true);
      try {
        const h = await getPositionHistory(position.ticker, period);
        setHistory(h);
      } catch {
        setHistory(null);
      } finally {
        setLoadingChart(false);
      }
    },
    [position.ticker]
  );

  // Load on mount and period change
  useEffect(() => {
    loadHistory(chartPeriod);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.ticker]);

  function changePeriod(p: Period) {
    setChartPeriod(p);
    loadHistory(p);
  }

  const chartData =
    history?.price_chart.map((b) => ({
      date: b.date,
      value: b.close ?? b.open ?? 0,
    })) ?? [];

  const gl = position.unrealized_gain_loss_cad;
  const glPct = position.unrealized_gain_loss_pct;
  const up = gl >= 0;

  return (
    <div className="w-80 flex-shrink-0 bg-white border-l border-[#E5E5E5] flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E5] sticky top-0 bg-white z-10">
        <div>
          <h3 className="text-base font-semibold text-[#111827]">
            {position.ticker}
          </h3>
          <p className="text-xs text-[#6B7280]">{position.name}</p>
        </div>
        <button
          onClick={onClose}
          className="text-[#6B7280] hover:text-[#111827] p-1 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-5 p-5">
        {/* Price */}
        <div>
          <p className="text-2xl font-semibold text-[#111827] tabular-nums">
            {cad(position.current_price, true)}
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
            {up ? "+" : ""}
            {cad(gl, true)} ({pct(glPct)})
          </div>
        </div>

        {/* Chart */}
        <div>
          <div className="flex gap-1 mb-3">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => changePeriod(p)}
                className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                  chartPeriod === p
                    ? "bg-[#111827] text-white"
                    : "text-[#6B7280] hover:text-[#111827] hover:bg-zinc-100"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          {loadingChart || chartData.length === 0 ? (
            <Sk className="h-32 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart
                data={chartData}
                margin={{ top: 2, right: 2, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1">
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
                <XAxis dataKey="date" hide />
                <YAxis
                  domain={["auto", "auto"]}
                  hide
                />
                <Tooltip
                  formatter={(v) => [cad(v as number, true), "Price"]}
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
                  fill="url(#posGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Position details */}
        <div className="bg-zinc-50 rounded-xl p-4 flex flex-col gap-2.5">
          {[
            { label: "Shares", value: position.shares.toString() },
            { label: "Avg Cost", value: cad(position.avg_cost_cad, true) },
            {
              label: "Market Value",
              value: cad(position.current_value_cad),
            },
            { label: "Days held", value: `${position.held_days}d` },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-[#6B7280]">{label}</span>
              <span className="font-medium text-[#111827]">{value}</span>
            </div>
          ))}
        </div>

        {/* Transaction history for this position */}
        {history?.transactions && history.transactions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-2">
              Transactions
            </p>
            <div className="flex flex-col gap-1.5">
              {history.transactions.map((tx, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs"
                >
                  <div>
                    <span
                      className={`font-semibold ${
                        tx.transaction_type === "buy"
                          ? "text-[#16A34A]"
                          : "text-[#DC2626]"
                      }`}
                    >
                      {tx.transaction_type.toUpperCase()}
                    </span>
                    <span className="text-[#6B7280] ml-1.5">
                      {tx.shares} @ {cad(tx.price_cad, true)}
                    </span>
                  </div>
                  <span className="text-[#9CA3AF]">
                    {new Date(tx.executed_at).toLocaleDateString("en-CA", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trade buttons */}
        <div className="flex gap-2 mt-auto">
          <button
            onClick={() => onTrade("buy")}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-[#16A34A] hover:bg-green-700 rounded-xl transition-colors"
          >
            Buy More
          </button>
          <button
            onClick={() => onTrade("sell")}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-[#DC2626] hover:bg-red-700 rounded-xl transition-colors"
          >
            Sell
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { portfolio, loading } = usePortfolio();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("current_value_cad");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(
    null
  );
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [tradeOpen, setTradeOpen] = useState(false);
  const [toast, setToast] = useState("");

  // Build flat position list with account_type
  const allPositions: Position[] = (portfolio?.accounts ?? []).flatMap((a) =>
    (a.positions ?? []).map((p) => ({
      ...p,
      account_type: a.account_type,
      account_id: a.id,
    }))
  );

  // Filter
  const filtered =
    filter === "all"
      ? allPositions
      : allPositions.filter((p) => p.account_type === filter);

  // Sort
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey] as number | string;
    const vb = b[sortKey] as number | string;
    if (typeof va === "string") {
      return sortDir === "asc"
        ? va.localeCompare(vb as string)
        : (vb as string).localeCompare(va);
    }
    return sortDir === "asc"
      ? (va as number) - (vb as number)
      : (vb as number) - (va as number);
  });

  // Summary
  const totalValue = portfolio?.total_value_cad ?? 0;
  const totalGl = portfolio?.total_gain_loss_cad ?? 0;
  const totalGlPct = portfolio?.total_gain_loss_pct ?? 0;
  const positive = totalGl >= 0;

  // Eligible accounts for trading
  const eligibleAccounts = (portfolio?.accounts ?? []).filter(
    (a) => a.subtype === "self_directed" && a.is_active
  ) as Account[];

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col)
      return <ChevronUp className="w-3 h-3 opacity-20 ml-1" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 ml-1" />
    ) : (
      <ChevronDown className="w-3 h-3 ml-1" />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#111827] text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Header */}
          <div>
            {loading ? (
              <>
                <Sk className="h-9 w-44 mb-2" />
                <Sk className="h-4 w-32" />
              </>
            ) : (
              <>
                <h1 className="text-3xl font-semibold text-[#111827] tabular-nums">
                  {cad(totalValue)}
                </h1>
                <div
                  className={`flex items-center gap-1 text-sm font-medium mt-1 ${
                    positive ? "text-[#16A34A]" : "text-[#DC2626]"
                  }`}
                >
                  {positive ? (
                    <ArrowUpRight className="w-4 h-4" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4" />
                  )}
                  {positive ? "+" : ""}
                  {cad(totalGl)} ({pct(totalGlPct)}) total return
                </div>
              </>
            )}
          </div>

          {/* Filter bar */}
          <div className="flex gap-2 flex-wrap">
            {ACCOUNT_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filter === key
                    ? "bg-[#111827] text-white"
                    : "bg-white border border-[#E5E5E5] text-[#6B7280] hover:text-[#111827] hover:border-[#111827]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Positions table */}
          <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E5E5]">
                    {(
                      [
                        { key: "ticker", label: "Ticker" },
                        { key: null, label: "Name" },
                        { key: null, label: "Shares" },
                        { key: null, label: "Avg Cost" },
                        { key: null, label: "Price" },
                        {
                          key: "current_value_cad",
                          label: "Value",
                        },
                        {
                          key: "unrealized_gain_loss_cad",
                          label: "Gain/Loss",
                        },
                        {
                          key: "unrealized_gain_loss_pct",
                          label: "Return",
                        },
                        { key: "change_pct", label: "1d" },
                        { key: null, label: "Account" },
                        { key: null, label: "" },
                      ] as { key: SortKey | null; label: string }[]
                    ).map(({ key, label }) => (
                      <th
                        key={label}
                        onClick={() => key && toggleSort(key)}
                        className={`px-4 py-2.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide whitespace-nowrap ${
                          key ? "cursor-pointer hover:text-[#111827] select-none" : ""
                        }`}
                      >
                        <span className="inline-flex items-center">
                          {label}
                          {key && <SortIcon col={key} />}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <tr
                          key={i}
                          className="border-b border-[#E5E5E5]"
                        >
                          {Array.from({ length: 11 }).map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <Sk className="h-3.5 w-14" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : sorted.map((pos) => {
                        const gl = pos.unrealized_gain_loss_cad;
                        const glPct = pos.unrealized_gain_loss_pct;
                        const up = gl >= 0;
                        const dayUp = (pos.change_pct ?? 0) >= 0;
                        const isSelected =
                          selectedPosition?.ticker === pos.ticker &&
                          selectedPosition?.account_id === pos.account_id;

                        return (
                          <tr
                            key={`${pos.ticker}-${pos.account_id}`}
                            onClick={() =>
                              setSelectedPosition(
                                isSelected ? null : pos
                              )
                            }
                            className={`border-b border-[#E5E5E5] cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-zinc-50"
                                : "hover:bg-zinc-50/60"
                            }`}
                          >
                            <td className="px-4 py-3 font-semibold text-[#111827]">
                              {pos.ticker}
                            </td>
                            <td className="px-4 py-3 text-[#6B7280] text-xs max-w-28 truncate">
                              {pos.name}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {pos.shares}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-[#6B7280]">
                              {cad(pos.avg_cost_cad, true)}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {cad(pos.current_price, true)}
                            </td>
                            <td className="px-4 py-3 tabular-nums font-medium">
                              {cad(pos.current_value_cad)}
                            </td>
                            <td
                              className={`px-4 py-3 tabular-nums font-medium ${
                                up ? "text-[#16A34A]" : "text-[#DC2626]"
                              }`}
                            >
                              {up ? "+" : ""}
                              {cad(gl)}
                            </td>
                            <td
                              className={`px-4 py-3 tabular-nums text-xs ${
                                up ? "text-[#16A34A]" : "text-[#DC2626]"
                              }`}
                            >
                              {pct(glPct)}
                            </td>
                            <td
                              className={`px-4 py-3 tabular-nums text-xs ${
                                dayUp ? "text-[#16A34A]" : "text-[#DC2626]"
                              }`}
                            >
                              {pct(pos.change_pct ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-xs text-[#6B7280] uppercase">
                              {pos.account_type?.replace("_", " ")}
                            </td>
                            <td
                              className="px-4 py-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => {
                                    setSelectedPosition(pos);
                                    setTradeMode("buy");
                                    setTradeOpen(true);
                                  }}
                                  className="text-xs px-2 py-1 rounded-lg bg-green-50 text-[#16A34A] hover:bg-green-100 font-medium transition-colors"
                                >
                                  Buy
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedPosition(pos);
                                    setTradeMode("sell");
                                    setTradeOpen(true);
                                  }}
                                  className="text-xs px-2 py-1 rounded-lg bg-red-50 text-[#DC2626] hover:bg-red-100 font-medium transition-colors"
                                >
                                  Sell
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
              {!loading && sorted.length === 0 && (
                <div className="py-12 text-center text-sm text-[#6B7280]">
                  No positions
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Position detail panel */}
        {selectedPosition && (
          <PositionPanel
            position={selectedPosition}
            onClose={() => setSelectedPosition(null)}
            onTrade={(mode) => {
              setTradeMode(mode);
              setTradeOpen(true);
            }}
          />
        )}
      </div>

      <TradeModal
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        initialTicker={selectedPosition?.ticker ?? ""}
        initialMode={tradeMode}
        accounts={eligibleAccounts}
        onSuccess={showToast}
      />
    </div>
  );
}
