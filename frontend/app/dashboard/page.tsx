"use client";

import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { ArrowUpRight, ArrowDownRight, TrendingUp } from "lucide-react";
import { getPerformance, getTransactionHistory } from "@/lib/api";
import { usePortfolio } from "@/contexts/PortfolioContext";
import type { Transaction, PerformanceData } from "@/types";

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

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-200 rounded ${className}`} />;
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

const DONUT_COLORS = ["#16A34A", "#2563EB", "#D97706", "#6B7280"];

const PERIODS = ["1w", "1mo", "3mo", "1y"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_DAYS: Record<Period, number> = {
  "1w": 7,
  "1mo": 30,
  "3mo": 90,
  "1y": 365,
};

// Generate synthetic portfolio growth chart data
// Uses cost basis as start, current value as end, with realistic noise
function buildChartData(
  perf: PerformanceData,
  period: Period
): { date: string; value: number }[] {
  const { current_value_cad, total_gain_loss_cad } = perf;
  const costBasis = Math.max(1000, current_value_cad - total_gain_loss_cad);

  const days = PERIOD_DAYS[period];
  const points = days + 1; // one point per day + today

  const today = Date.now();
  const result: { date: string; value: number }[] = [];

  // Smooth exponential path from start to end with jitter
  const logStart = Math.log(costBasis);
  const logEnd = Math.log(current_value_cad);
  let prev = costBasis;

  for (let i = 0; i <= points; i++) {
    const t = i / points;
    // Smoothed path with a slight S-curve
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const base = Math.exp(logStart + (logEnd - logStart) * ease);
    // Add mild noise (±0.5%) — seeded by index so it's stable
    const noise = 1 + ((Math.sin(i * 7.3 + 1.2) * 0.005));
    const value = i === points ? current_value_cad : base * noise;

    const d = new Date(today - (points - i) * 86_400_000);
    const dateStr = d.toISOString().split("T")[0];
    result.push({ date: dateStr, value: Math.round(value) });
    prev = value;
  }

  void prev; // suppress unused warning
  return result;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { portfolio, loading: portLoading } = usePortfolio();
  const [perf, setPerf] = useState<PerformanceData | null>(null);
  const [chartData, setChartData] = useState<{ date: string; value: number }[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [period, setPeriod] = useState<Period>("1mo");
  const [txLoading, setTxLoading] = useState(true);

  useEffect(() => {
    getPerformance()
      .then((d) => {
        setPerf(d);
        setChartData(buildChartData(d, period));
      })
      .catch(() => null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-build chart when period changes (once perf is loaded)
  useEffect(() => {
    if (perf) setChartData(buildChartData(perf, period));
  }, [period, perf]);

  useEffect(() => {
    getTransactionHistory()
      .then((txs) => setTransactions(txs.slice(0, 5)))
      .catch(() => null)
      .finally(() => setTxLoading(false));
  }, []);

  // Derived values from portfolio
  const totalGain = portfolio?.total_gain_loss_cad ?? 0;
  const totalGainPct = portfolio?.total_gain_loss_pct ?? 0;
  const positive = totalGain >= 0;

  const allocation = portfolio?.allocation.by_account_type ?? {};
  const registered =
    (allocation["tfsa"] ?? 0) +
    (allocation["rrsp"] ?? 0) +
    (allocation["fhsa"] ?? 0);
  const nonReg = allocation["non_registered"] ?? 0;
  const crypto = allocation["crypto"] ?? 0;
  const cash = allocation["wealthsimple_chequing"] ?? 0;

  const donutData = [
    { name: "Registered", value: registered },
    { name: "Non-Reg", value: nonReg },
    { name: "Crypto", value: crypto },
    { name: "Cash", value: cash },
  ].filter((d) => d.value > 0);

  // All positions across all accounts
  const allPositions = (portfolio?.accounts ?? []).flatMap((a) =>
    (a.positions ?? []).map((p) => ({ ...p, account_type: a.account_type }))
  );

  // Contribution room accounts
  const contribAccounts = (portfolio?.accounts ?? []).filter(
    (a) =>
      (a.account_type === "tfsa" ||
        a.account_type === "rrsp" ||
        a.account_type === "fhsa") &&
      a.contribution_room_remaining != null
  );

  // FHSA not opened
  const fhsaNotOpened = (portfolio?.accounts ?? []).find(
    (a) => a.account_type === "fhsa" && !a.is_active
  );

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      {/* ── Net worth hero ─────────────────────────────────────────────────── */}
      <div>
        {portLoading ? (
          <>
            <Sk className="h-10 w-52 mb-2" />
            <Sk className="h-4 w-36" />
          </>
        ) : (
          <>
            <h1 className="text-4xl font-semibold text-[#111827] tabular-nums tracking-tight">
              {cad(portfolio?.total_value_cad ?? 0)}
            </h1>
            <div
              className={`flex items-center gap-1 mt-1 text-sm font-medium ${
                positive ? "text-[#16A34A]" : "text-[#DC2626]"
              }`}
            >
              {positive ? (
                <ArrowUpRight className="w-4 h-4" />
              ) : (
                <ArrowDownRight className="w-4 h-4" />
              )}
              <span className="tabular-nums">
                {positive ? "+" : ""}
                {cad(totalGain)}
              </span>
              <span className="text-[#6B7280] font-normal ml-0.5">
                ({pct(totalGainPct)}) total return
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Stat pills ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: "Registered", value: registered },
          { label: "Non-Registered", value: nonReg },
          { label: "Crypto", value: crypto },
          { label: "Cash", value: cash },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="bg-white border border-[#E5E5E5] rounded-xl p-4 shadow-sm"
          >
            <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">
              {label}
            </p>
            {portLoading ? (
              <Sk className="h-6 w-24 mt-2" />
            ) : (
              <p className="text-lg font-semibold text-[#111827] tabular-nums mt-1">
                {cad(value)}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Performance chart */}
        <div className="xl:col-span-2 bg-white border border-[#E5E5E5] rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-[#111827]">
              Portfolio Performance
            </h2>
            <div className="flex gap-1">
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
          </div>

          {portLoading ? (
            <Sk className="h-56 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="#16A34A"
                      stopOpacity={0.22}
                    />
                    <stop
                      offset="95%"
                      stopColor="#16A34A"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  tickFormatter={shortDate}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  tickFormatter={(v: number) =>
                    `$${(v / 1000).toFixed(0)}k`
                  }
                  width={40}
                />
                <Tooltip
                  formatter={(v) => [cad(v as number), "Value"]}
                  labelFormatter={(l) => shortDate(l as string)}
                  contentStyle={{
                    border: "1px solid #E5E5E5",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#16A34A"
                  strokeWidth={2.5}
                  fill="url(#perfGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#16A34A", strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Allocation donut */}
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-[#111827] mb-4">
            Allocation
          </h2>
          {portLoading ? (
            <Sk className="h-40 w-full" />
          ) : (
            <div className="flex flex-col gap-4">
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={60}
                    dataKey="value"
                    strokeWidth={2}
                    stroke="#FAFAFA"
                  >
                    {donutData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1.5">
                {donutData.map((d, i) => (
                  <div
                    key={d.name}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{
                          backgroundColor:
                            DONUT_COLORS[i % DONUT_COLORS.length],
                        }}
                      />
                      <span className="text-[#6B7280]">{d.name}</span>
                    </div>
                    <span className="text-[#111827] font-medium tabular-nums">
                      {cad(d.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Top positions ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E5E5] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#111827]">
            Top Positions
          </h2>
          <a
            href="/portfolio"
            className="text-xs text-[#2563EB] hover:text-[#111827] transition-colors"
          >
            View all
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E5E5]">
                {["Ticker", "Account", "Value", "Gain/Loss", "Return", "1d"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-5 py-2.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {portLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-[#E5E5E5]">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-5 py-3">
                          <Sk className="h-3.5 w-16" />
                        </td>
                      ))}
                    </tr>
                  ))
                : allPositions.slice(0, 5).map((pos) => {
                    const gl = pos.unrealized_gain_loss_cad;
                    const glPct = pos.unrealized_gain_loss_pct;
                    const up = gl >= 0;
                    const dayUp = (pos.change_pct ?? 0) >= 0;
                    return (
                      <tr
                        key={`${pos.ticker}-${pos.account_type}`}
                        className="border-b border-[#E5E5E5] hover:bg-zinc-50 transition-colors"
                      >
                        <td className="px-5 py-3 font-semibold text-[#111827]">
                          {pos.ticker}
                        </td>
                        <td className="px-5 py-3 text-[#6B7280] text-xs uppercase">
                          {pos.account_type?.replace("_", " ")}
                        </td>
                        <td className="px-5 py-3 tabular-nums text-[#111827]">
                          {cad(pos.current_value_cad)}
                        </td>
                        <td
                          className={`px-5 py-3 tabular-nums font-medium ${
                            up ? "text-[#16A34A]" : "text-[#DC2626]"
                          }`}
                        >
                          {up ? "+" : ""}
                          {cad(gl)}
                        </td>
                        <td
                          className={`px-5 py-3 tabular-nums text-xs ${
                            up ? "text-[#16A34A]" : "text-[#DC2626]"
                          }`}
                        >
                          {pct(glPct)}
                        </td>
                        <td
                          className={`px-5 py-3 tabular-nums text-xs ${
                            dayUp ? "text-[#16A34A]" : "text-[#DC2626]"
                          }`}
                        >
                          {pct(pos.change_pct ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!portLoading && allPositions.length === 0 && (
            <div className="py-10 text-center text-sm text-[#6B7280]">
              No positions yet
            </div>
          )}
        </div>
      </div>

      {/* ── Contribution room ────────────────────────────────────────────────── */}
      {!portLoading && (contribAccounts.length > 0 || fhsaNotOpened) && (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-[#111827] mb-5">
            Contribution Room
          </h2>
          <div className="flex flex-col gap-4">
            {contribAccounts.map((acc) => {
              const annualLimits: Record<string, number> = {
                tfsa: 7000,
                rrsp: 29210,
                fhsa: 8000,
              };
              const limit = annualLimits[acc.account_type] ?? 10000;
              const room = acc.contribution_room_remaining ?? 0;
              const used = Math.max(0, limit - room);
              const pctUsed = Math.min(100, (used / limit) * 100);

              const deadline = acc.contribution_deadline;
              const daysLeft = deadline
                ? Math.ceil(
                    (new Date(deadline).getTime() - Date.now()) / 86_400_000
                  )
                : null;
              const urgent = daysLeft != null && daysLeft <= 60;

              return (
                <div key={acc.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[#111827]">
                      {acc.account_type.toUpperCase()}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#6B7280] tabular-nums">
                        {cad(room)} remaining
                      </span>
                      {urgent && (
                        <span className="text-xs font-medium text-[#D97706] bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                          Due in {daysLeft}d
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#16A34A] transition-all duration-700"
                      style={{ width: `${pctUsed}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {fhsaNotOpened && (
              <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    FHSA — Not opened
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Eligible for $8,000 annual contribution room
                  </p>
                </div>
                <button className="text-xs font-semibold text-amber-800 border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition-colors">
                  Open FHSA
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Recent transactions ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E5E5] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#111827]">
            Recent Transactions
          </h2>
          <a
            href="/history"
            className="text-xs text-[#2563EB] hover:text-[#111827] transition-colors"
          >
            View all
          </a>
        </div>

        {txLoading ? (
          <div className="divide-y divide-[#E5E5E5]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-6 py-3 flex items-center justify-between">
                <div className="flex flex-col gap-1.5">
                  <Sk className="h-3.5 w-40" />
                  <Sk className="h-3 w-24" />
                </div>
                <Sk className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[#6B7280] flex flex-col items-center gap-2">
            <TrendingUp className="w-6 h-6 text-zinc-300" />
            No transactions yet
          </div>
        ) : (
          <div className="divide-y divide-[#E5E5E5]">
            {transactions.map((tx) => {
              const isCredit =
                tx.transaction_type === "deposit" ||
                tx.transaction_type === "sell";
              const isDebit =
                tx.transaction_type === "withdrawal" ||
                tx.transaction_type === "buy";
              return (
                <div
                  key={tx.id}
                  className="px-6 py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm text-[#111827] font-medium">
                      {tx.notes ??
                        (tx.ticker
                          ? `${tx.transaction_type.charAt(0).toUpperCase() + tx.transaction_type.slice(1)} ${tx.ticker}`
                          : tx.transaction_type.charAt(0).toUpperCase() +
                            tx.transaction_type.slice(1))}
                    </p>
                    <p className="text-xs text-[#6B7280] mt-0.5">
                      {fullDate(tx.executed_at)}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      isCredit
                        ? "text-[#16A34A]"
                        : isDebit
                        ? "text-[#DC2626]"
                        : "text-[#111827]"
                    }`}
                  >
                    {isCredit ? "+" : isDebit ? "−" : ""}
                    {cad(Math.abs(tx.total_cad))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
