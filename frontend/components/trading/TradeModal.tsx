"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { getQuote, executeBuy, executeSell } from "@/lib/api";
import { usePortfolio } from "@/contexts/PortfolioContext";
import type { Account } from "@/types";

interface TradeModalProps {
  open: boolean;
  onClose: () => void;
  initialTicker?: string;
  initialMode?: "buy" | "sell";
  accounts: Account[];
  onSuccess?: (msg: string) => void;
}

function cad(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function TradeModal({
  open,
  onClose,
  initialTicker = "",
  initialMode = "buy",
  accounts,
  onSuccess,
}: TradeModalProps) {
  const { refresh } = usePortfolio();
  const [mode, setMode] = useState<"buy" | "sell">(initialMode);
  const [ticker, setTicker] = useState(initialTicker);
  const [shares, setShares] = useState("");
  const [accountId, setAccountId] = useState<number | "">("");
  const [price, setPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setTicker(initialTicker);
      setShares("");
      setError("");
      setSuccess("");
      setPrice(null);
    }
  }, [open, initialTicker, initialMode]);

  // Fetch live price when ticker changes
  useEffect(() => {
    if (!ticker.trim()) {
      setPrice(null);
      return;
    }
    let cancelled = false;
    setPriceLoading(true);
    const t = setTimeout(async () => {
      try {
        const q = await getQuote(ticker.trim().toUpperCase());
        if (!cancelled) {
          setPrice(q.quote.cad_price ?? q.quote.price ?? null);
        }
      } catch {
        if (!cancelled) setPrice(null);
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ticker]);

  // Refresh price every 10s
  useEffect(() => {
    if (!open || !ticker.trim()) return;
    const iv = setInterval(async () => {
      try {
        const q = await getQuote(ticker.trim().toUpperCase());
        setPrice(q.quote.cad_price ?? q.quote.price ?? null);
      } catch {
        // silent
      }
    }, 10_000);
    return () => clearInterval(iv);
  }, [open, ticker]);

  // Auto-select first eligible account
  useEffect(() => {
    if (!accountId && eligibleAccounts.length > 0) {
      setAccountId(eligibleAccounts[0].id);
    }
  });

  const eligibleAccounts = accounts.filter(
    (a) => a.subtype === "self_directed" && a.is_active
  );

  const selectedAccount = eligibleAccounts.find((a) => a.id === accountId);
  const sharesNum = parseFloat(shares) || 0;
  const estimated = price != null && sharesNum > 0 ? price * sharesNum : null;

  // For sell: check current position
  const currentPosition = selectedAccount?.positions?.find(
    (p) => p.ticker.toUpperCase() === ticker.toUpperCase()
  );
  const maxSell = currentPosition?.shares ?? 0;

  async function handleSubmit() {
    if (!accountId || !ticker.trim() || sharesNum <= 0) {
      setError("Please fill in all fields.");
      return;
    }
    if (mode === "sell" && sharesNum > maxSell) {
      setError(`You only have ${maxSell} shares to sell.`);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const fn = mode === "buy" ? executeBuy : executeSell;
      const result = await fn(
        accountId as number,
        ticker.trim().toUpperCase(),
        sharesNum
      );
      const msg =
        result.message ??
        `Successfully ${mode === "buy" ? "bought" : "sold"} ${sharesNum} shares of ${ticker.toUpperCase()}`;
      setSuccess(msg);
      await refresh();
      onSuccess?.(msg);
      setTimeout(onClose, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Place Order">
      {/* Buy / Sell tabs */}
      <div className="flex bg-zinc-100 rounded-lg p-1 mb-5">
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setError("");
            }}
            className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors capitalize ${
              mode === m
                ? m === "buy"
                  ? "bg-white text-[#16A34A] shadow-sm"
                  : "bg-white text-[#DC2626] shadow-sm"
                : "text-[#6B7280]"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {/* Ticker */}
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
            Ticker
          </label>
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. SHOP.TO"
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827] transition-all"
          />
          {price != null && !priceLoading && (
            <p className="text-xs text-[#16A34A] font-medium mt-1.5">
              Live: {cad(price)} CAD
            </p>
          )}
          {priceLoading && (
            <p className="text-xs text-[#6B7280] mt-1.5">Fetching price…</p>
          )}
        </div>

        {/* Account */}
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
            Account
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827] transition-all bg-white"
          >
            {eligibleAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.product_name}
              </option>
            ))}
          </select>
          {selectedAccount && (
            <p className="text-xs text-[#6B7280] mt-1.5">
              Available cash:{" "}
              <span className="font-medium text-[#111827]">
                {cad(Math.max(0, selectedAccount.balance_cad))}
              </span>
            </p>
          )}
        </div>

        {/* Shares */}
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
            Shares
          </label>
          <input
            type="number"
            min="0.001"
            step="0.001"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="0"
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827] transition-all"
          />
          {mode === "sell" && currentPosition && (
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-xs text-[#6B7280]">
                You hold:{" "}
                <span className="font-medium text-[#111827]">
                  {currentPosition.shares} shares
                </span>
              </p>
              <button
                onClick={() => setShares(String(maxSell))}
                className="text-xs text-[#2563EB] hover:underline"
              >
                Sell all
              </button>
            </div>
          )}
        </div>

        {/* Estimate */}
        {estimated != null && (
          <div className="bg-zinc-50 border border-[#E5E5E5] rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#6B7280]">Estimated total</span>
            <span className="text-base font-semibold text-[#111827] tabular-nums">
              {cad(estimated)}
            </span>
          </div>
        )}

        {/* For sell: gain/loss estimate */}
        {mode === "sell" && currentPosition && sharesNum > 0 && price != null && (
          <div className="bg-zinc-50 border border-[#E5E5E5] rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-[#6B7280]">Estimated gain/loss</span>
            {(() => {
              const proceeds = price * sharesNum;
              const cost = currentPosition.avg_cost_cad * sharesNum;
              const gl = proceeds - cost;
              return (
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    gl >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"
                  }`}
                >
                  {gl >= 0 ? "+" : ""}
                  {cad(gl)}
                </span>
              );
            })()}
          </div>
        )}

        {error && (
          <p className="text-xs text-[#DC2626] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {success && (
          <p className="text-xs text-[#16A34A] bg-green-50 border border-green-200 rounded-lg px-3 py-2 font-medium">
            {success}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !ticker || !shares || !accountId}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            mode === "buy"
              ? "bg-[#16A34A] hover:bg-green-700"
              : "bg-[#DC2626] hover:bg-red-700"
          }`}
        >
          {submitting
            ? "Processing…"
            : `${mode === "buy" ? "Buy" : "Sell"} ${shares || "0"} share${sharesNum !== 1 ? "s" : ""}`}
        </button>
      </div>
    </Modal>
  );
}
