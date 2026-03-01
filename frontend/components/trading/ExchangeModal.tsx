"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { getExchangeRate, executeExchange } from "@/lib/api";
import { usePortfolio } from "@/contexts/PortfolioContext";
import type { AccountSummary } from "@/types";

interface ExchangeModalProps {
  open: boolean;
  onClose: () => void;
  accounts: AccountSummary[];
  onSuccess?: (msg: string) => void;
}

function cad(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function ExchangeModal({
  open,
  onClose,
  accounts,
  onSuccess,
}: ExchangeModalProps) {
  const { refresh } = usePortfolio();
  const [accountId, setAccountId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [fromCurrency, setFromCurrency] = useState("CAD");
  const [toCurrency, setToCurrency] = useState("USD");
  const [rate, setRate] = useState<number | null>(null);
  const [rateTs, setRateTs] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setError("");
    setSuccess("");
  }, [open]);

  // Fetch exchange rate
  useEffect(() => {
    let cancelled = false;
    getExchangeRate(fromCurrency, toCurrency)
      .then((r) => {
        if (!cancelled) {
          setRate(r.rate);
          setRateTs(new Date());
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [fromCurrency, toCurrency]);

  function swap() {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
    setRate(null);
  }

  const amountNum = parseFloat(amount) || 0;
  const converted = rate != null && amountNum > 0 ? amountNum * rate : null;

  async function handleSubmit() {
    if (!accountId || amountNum <= 0) {
      setError("Please fill in all fields.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await executeExchange(
        accountId as number,
        amountNum,
        fromCurrency,
        toCurrency
      );
      const msg =
        result.message ??
        `Exchanged ${fromCurrency} ${amountNum.toFixed(2)} → ${toCurrency} ${converted?.toFixed(2) ?? ""}`;
      setSuccess(msg);
      await refresh();
      onSuccess?.(msg);
      setTimeout(onClose, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Exchange failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Currency Exchange">
      <div className="flex flex-col gap-4">
        {/* Account */}
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
            Account
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 bg-white"
          >
            <option value="">Select account</option>
            {accounts
              .filter((a) => a.is_active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.product_name}
                </option>
              ))}
          </select>
        </div>

        {/* Currency pair */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
              From
            </label>
            <select
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value)}
              className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm text-[#111827] bg-white focus:outline-none focus:ring-2 focus:ring-[#111827]/20"
            >
              <option>CAD</option>
              <option>USD</option>
            </select>
          </div>

          <button
            onClick={swap}
            className="mt-5 px-3 py-2 text-[#6B7280] hover:text-[#111827] border border-[#E5E5E5] rounded-lg hover:bg-zinc-50 transition-colors text-xs"
          >
            ⇄
          </button>

          <div className="flex-1">
            <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
              To
            </label>
            <select
              value={toCurrency}
              onChange={(e) => setToCurrency(e.target.value)}
              className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm text-[#111827] bg-white focus:outline-none focus:ring-2 focus:ring-[#111827]/20"
            >
              <option>USD</option>
              <option>CAD</option>
            </select>
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
            Amount ({fromCurrency})
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827] transition-all"
          />
        </div>

        {/* Rate + preview */}
        {rate != null && (
          <div className="bg-zinc-50 border border-[#E5E5E5] rounded-xl px-4 py-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#6B7280]">Exchange rate</span>
              <span className="text-xs font-medium text-[#111827] tabular-nums">
                1 {fromCurrency} = {rate.toFixed(4)} {toCurrency}
              </span>
            </div>
            {converted != null && (
              <div className="flex items-center justify-between border-t border-[#E5E5E5] pt-1.5 mt-0.5">
                <span className="text-sm text-[#6B7280]">You receive</span>
                <span className="text-base font-semibold text-[#111827] tabular-nums">
                  {toCurrency} {converted.toFixed(2)}
                </span>
              </div>
            )}
            {rateTs && (
              <p className="text-[10px] text-[#9CA3AF]">
                Rate as of {rateTs.toLocaleTimeString()}
              </p>
            )}
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
          disabled={submitting || !accountId || amountNum <= 0 || rate == null}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#111827] hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Processing…" : `Exchange ${fromCurrency} → ${toCurrency}`}
        </button>
      </div>
    </Modal>
  );
}
