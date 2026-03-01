"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ShoppingCart,
  TrendingDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Download,
} from "lucide-react";
import { getTransactionHistory } from "@/lib/api";
import type { Transaction } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cad(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-200 rounded ${className}`} />;
}

const TX_TYPES = [
  { key: "all", label: "All" },
  { key: "buy", label: "Buys" },
  { key: "sell", label: "Sells" },
  { key: "deposit", label: "Deposits" },
  { key: "withdraw", label: "Withdrawals" },
  { key: "exchange", label: "Exchanges" },
] as const;

type TxFilter = (typeof TX_TYPES)[number]["key"];

const TX_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  buy: ShoppingCart,
  sell: TrendingDown,
  deposit: ArrowDownToLine,
  withdraw: ArrowUpFromLine,
  exchange: RefreshCw,
};

const TX_COLORS: Record<string, string> = {
  buy: "text-[#DC2626] bg-red-50",
  sell: "text-[#16A34A] bg-green-50",
  deposit: "text-[#16A34A] bg-green-50",
  withdraw: "text-[#DC2626] bg-red-50",
  exchange: "text-[#2563EB] bg-blue-50",
};

const TX_SIGN: Record<string, string> = {
  buy: "−",
  sell: "+",
  deposit: "+",
  withdraw: "−",
  exchange: "",
};

const TX_TEXT_COLOR: Record<string, string> = {
  buy: "text-[#DC2626]",
  sell: "text-[#16A34A]",
  deposit: "text-[#16A34A]",
  withdraw: "text-[#DC2626]",
  exchange: "text-[#111827]",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TxFilter>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    getTransactionHistory()
      .then(setTransactions)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      const type = tx.transaction_type.toLowerCase();
      if (filter !== "all" && type !== filter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matches =
          (tx.ticker ?? "").toLowerCase().includes(q) ||
          (tx.notes ?? "").toLowerCase().includes(q) ||
          type.includes(q);
        if (!matches) return false;
      }
      if (dateFrom) {
        if (new Date(tx.executed_at) < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        if (new Date(tx.executed_at) > new Date(dateTo + "T23:59:59")) return false;
      }
      return true;
    });
  }, [transactions, filter, search, dateFrom, dateTo]);

  function exportCsv() {
    const rows = [
      [
        "Date",
        "Type",
        "Ticker",
        "Shares",
        "Price",
        "Total",
        "Notes",
      ].join(","),
      ...filtered.map((tx) =>
        [
          tx.executed_at,
          tx.transaction_type,
          tx.ticker ?? "",
          tx.shares ?? "",
          tx.price_cad ?? "",
          tx.total_cad,
          tx.notes ?? "",
        ].join(",")
      ),
    ].join("\n");
    const blob = new Blob([rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wealthmind-transactions-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function describe(tx: Transaction) {
    if (tx.notes) return tx.notes;
    const type =
      tx.transaction_type.charAt(0).toUpperCase() +
      tx.transaction_type.slice(1);
    if (tx.ticker) return `${type} ${tx.ticker}`;
    if (tx.transaction_type === "exchange") {
      return `Currency exchange: ${tx.currency_from ?? ""} → ${tx.currency_to ?? ""}`;
    }
    return type;
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[#111827]">
          Transaction History
        </h1>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#111827] border border-[#E5E5E5] rounded-xl hover:bg-zinc-50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        {/* Type filter */}
        <div className="flex gap-2 flex-wrap">
          {TX_TYPES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filter === key
                  ? "bg-[#111827] text-white"
                  : "bg-white border border-[#E5E5E5] text-[#6B7280] hover:text-[#111827]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search + date range */}
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ticker or description"
            className="flex-1 min-w-48 border border-[#E5E5E5] rounded-xl px-3 py-2 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827] bg-white"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-[#E5E5E5] rounded-xl px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 bg-white"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-[#E5E5E5] rounded-xl px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 bg-white"
          />
          {(search || dateFrom || dateTo || filter !== "all") && (
            <button
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
                setFilter("all");
              }}
              className="text-xs text-[#6B7280] hover:text-[#111827] px-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Transaction count */}
      {!loading && (
        <p className="text-xs text-[#6B7280]">
          {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Table */}
      <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="divide-y divide-[#E5E5E5]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4">
                <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <Sk className="h-3.5 w-48" />
                  <Sk className="h-3 w-24" />
                </div>
                <Sk className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#6B7280]">
            No transactions found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E5E5]">
                  {["Date", "Type", "Description", "Account", "Shares", "Price", "Amount"].map(
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
                {filtered.map((tx) => {
                  const type = tx.transaction_type;
                  const Icon = TX_ICONS[type] ?? RefreshCw;
                  const sign = TX_SIGN[type] ?? "";
                  const amtColor = TX_TEXT_COLOR[type] ?? "text-[#111827]";
                  const iconCls = TX_COLORS[type] ?? "text-[#6B7280] bg-zinc-50";

                  return (
                    <tr
                      key={tx.id}
                      className="border-b border-[#E5E5E5] hover:bg-zinc-50/60 transition-colors"
                    >
                      <td className="px-5 py-3 text-[#6B7280] text-xs whitespace-nowrap">
                        {shortDate(tx.executed_at)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${iconCls}`}
                        >
                          <Icon className="w-3 h-3" />
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[#111827] font-medium max-w-48 truncate">
                        {describe(tx)}
                      </td>
                      <td className="px-5 py-3 text-[#6B7280] text-xs">
                        #{tx.account_id}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-[#6B7280] text-xs">
                        {tx.shares ?? "—"}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-[#6B7280] text-xs">
                        {tx.price_cad ? cad(tx.price_cad) : "—"}
                      </td>
                      <td
                        className={`px-5 py-3 tabular-nums font-semibold ${amtColor}`}
                      >
                        {sign}
                        {cad(tx.total_cad)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
