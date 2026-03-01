"use client";

import { useState } from "react";
import React from "react";
import {
  Wallet,
  TrendingUp,
  Shield,
  Bitcoin,
  CreditCard,
  AlertTriangle,
  ArrowRightLeft,
  Home,
} from "lucide-react";
import {
  depositToAccount,
  withdrawFromAccount,
  transferBetweenAccounts,
} from "@/lib/api";
import { ExchangeModal } from "@/components/trading/ExchangeModal";
import { Modal } from "@/components/ui/modal";
import { usePortfolio } from "@/contexts/PortfolioContext";
import type { Account, AccountSummary } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cad(n: number, cents = false) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: cents ? 2 : 0,
  }).format(Math.abs(n));
}

/** Strip "Wealthsimple " brand prefix from product names */
function stripBrand(name: string) {
  return name.replace(/^Wealthsimple\s+/i, "");
}

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-200 rounded ${className}`} />;
}

type LucideProps = { className?: string; style?: React.CSSProperties };

const ACCOUNT_META: Record<
  string,
  { icon: React.ComponentType<LucideProps>; color: string; label: string }
> = {
  wealthsimple_chequing: { icon: Wallet, color: "#16A34A", label: "Chequing" },
  chequing: { icon: Wallet, color: "#16A34A", label: "Chequing" },
  tfsa: { icon: Shield, color: "#2563EB", label: "TFSA" },
  rrsp: { icon: TrendingUp, color: "#7C3AED", label: "RRSP" },
  non_registered: { icon: TrendingUp, color: "#D97706", label: "Non-Registered" },
  fhsa: { icon: Home, color: "#D97706", label: "FHSA" },
  margin: { icon: CreditCard, color: "#DC2626", label: "Margin" },
  crypto: { icon: Bitcoin, color: "#F59E0B", label: "Crypto" },
};

// ─── Deposit/Withdraw Modal ───────────────────────────────────────────────────

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
  account: Account;
  mode: "deposit" | "withdraw";
  onSuccess: (msg: string) => void;
}

function DepositModal({ open, onClose, account, mode, onSuccess }: DepositModalProps) {
  const { refresh } = usePortfolio();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    const n = parseFloat(amount);
    if (!n || n <= 0) { setError("Enter a valid amount."); return; }
    setLoading(true);
    setError("");
    try {
      const fn = mode === "deposit" ? depositToAccount : withdrawFromAccount;
      const result = await fn(account.id, n);
      await refresh();
      onSuccess(result.message ?? `${mode} successful`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${mode === "deposit" ? "Deposit to" : "Withdraw from"} ${stripBrand(account.product_name)}`}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
            Amount (CAD)
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827]"
            autoFocus
          />
        </div>
        {mode === "withdraw" && (
          <p className="text-xs text-[#6B7280]">
            Available:{" "}
            <span className="font-medium text-[#111827]">
              {cad(Math.max(0, account.balance_cad))}
            </span>
          </p>
        )}
        {error && (
          <p className="text-xs text-[#DC2626] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading || !amount}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#111827] hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          {loading
            ? "Processing…"
            : `${mode === "deposit" ? "Deposit" : "Withdraw"} ${amount ? cad(parseFloat(amount), true) : ""}`}
        </button>
      </div>
    </Modal>
  );
}

// ─── FHSA Open Modal ─────────────────────────────────────────────────────────

interface FHSAModalProps {
  open: boolean;
  onClose: () => void;
  account: Account;
  onSuccess: (msg: string) => void;
}

function FHSAModal({ open, onClose, account, onSuccess }: FHSAModalProps) {
  const { refresh } = usePortfolio();
  const [amount, setAmount] = useState("8000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleOpen() {
    const n = parseFloat(amount);
    if (!n || n <= 0) { setError("Enter an opening deposit amount."); return; }
    setLoading(true);
    setError("");
    try {
      await depositToAccount(account.id, n);
      await refresh();
      onSuccess(`FHSA opened with ${cad(n, true)} deposit`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open FHSA.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Open FHSA">
      <div className="flex flex-col gap-5">
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-col gap-1">
          <p className="text-sm font-semibold text-amber-800">
            First Home Savings Account
          </p>
          <p className="text-xs text-amber-700 leading-relaxed">
            Up to <strong>$8,000/year</strong> tax-deductible contributions and
            tax-free withdrawals for a qualifying first home. Lifetime room:{" "}
            <strong>$40,000</strong>.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs text-[#6B7280]">
            Available contribution room:{" "}
            <span className="font-semibold text-[#111827]">
              {account.contribution_room_remaining
                ? cad(account.contribution_room_remaining)
                : "$8,000"}
            </span>
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
            Opening Deposit (CAD)
          </label>
          <input
            type="number"
            min="1"
            max={account.contribution_room_remaining ?? 8000}
            step="100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            autoFocus
          />
        </div>

        {error && (
          <p className="text-xs text-[#DC2626] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={handleOpen}
          disabled={loading || !amount}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Opening…" : `Open FHSA & Deposit ${amount ? cad(parseFloat(amount), true) : ""}`}
        </button>
      </div>
    </Modal>
  );
}

// ─── Pay Down Margin Modal ────────────────────────────────────────────────────

interface PayDownModalProps {
  open: boolean;
  onClose: () => void;
  marginAccount: Account;
  onSuccess: (msg: string) => void;
}

function PayDownModal({ open, onClose, marginAccount, onSuccess }: PayDownModalProps) {
  const { refresh } = usePortfolio();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const debit = Math.abs(marginAccount.balance_cad);
  const annualCost = debit * (marginAccount.interest_rate ?? 0.062);

  async function handleSubmit() {
    const n = parseFloat(amount);
    if (!n || n <= 0) { setError("Enter a valid amount."); return; }
    if (n > debit) { setError(`Maximum paydown is ${cad(debit, true)}.`); return; }
    setLoading(true);
    setError("");
    try {
      const result = await depositToAccount(marginAccount.id, n);
      await refresh();
      onSuccess(result.message ?? "Margin paid down successfully");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  const savingsPreview =
    amount && parseFloat(amount) > 0
      ? (parseFloat(amount) / debit) * annualCost
      : null;

  return (
    <Modal open={open} onClose={onClose} title="Pay Down Margin">
      <div className="flex flex-col gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-col gap-1">
          <p className="text-sm font-semibold text-[#DC2626]">
            Current debit: {cad(debit)}
          </p>
          <p className="text-xs text-red-600">
            At {((marginAccount.interest_rate ?? 0.062) * 100).toFixed(1)}% —
            costing {cad(annualCost)}/yr in interest
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">
            Amount to Pay Down (CAD)
          </label>
          <input
            type="number"
            min="1"
            max={debit}
            step="100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Up to ${cad(debit, true)}`}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827]"
            autoFocus
          />
        </div>

        {savingsPreview !== null && savingsPreview > 0 && (
          <p className="text-xs text-[#16A34A] bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            Saves ≈ {cad(savingsPreview, true)}/yr in interest charges
          </p>
        )}

        {error && (
          <p className="text-xs text-[#DC2626] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !amount}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#DC2626] hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Processing…" : `Pay Down ${amount ? cad(parseFloat(amount), true) : ""}`}
        </button>
      </div>
    </Modal>
  );
}

// ─── Transfer Modal ───────────────────────────────────────────────────────────

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  onSuccess: (msg: string) => void;
}

function TransferModal({ open, onClose, accounts, onSuccess }: TransferModalProps) {
  const { refresh } = usePortfolio();
  const [fromId, setFromId] = useState<number | "">("");
  const [toId, setToId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    const n = parseFloat(amount);
    if (!fromId || !toId || !n || n <= 0 || fromId === toId) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await transferBetweenAccounts(fromId as number, toId as number, n);
      await refresh();
      onSuccess(result.message ?? "Transfer successful");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transfer failed.");
    } finally {
      setLoading(false);
    }
  }

  const activeAccounts = accounts.filter((a) => a.is_active);

  return (
    <Modal open={open} onClose={onClose} title="Transfer Between Accounts">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">From</label>
          <select
            value={fromId}
            onChange={(e) => setFromId(Number(e.target.value))}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#111827]/20"
          >
            <option value="">Select account</option>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {stripBrand(a.product_name)} — {cad(Math.max(0, a.balance_cad))}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">To</label>
          <select
            value={toId}
            onChange={(e) => setToId(Number(e.target.value))}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#111827]/20"
          >
            <option value="">Select account</option>
            {activeAccounts.filter((a) => a.id !== fromId).map((a) => (
              <option key={a.id} value={a.id}>
                {stripBrand(a.product_name)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide block mb-1.5">Amount (CAD)</label>
          <input
            type="number" min="0.01" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#111827]/20"
          />
        </div>
        {error && (
          <p className="text-xs text-[#DC2626] bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading || !fromId || !toId || !amount}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#111827] hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Processing…" : "Transfer"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Account Card ─────────────────────────────────────────────────────────────

function AccountCard({
  account,
  onDeposit,
  onWithdraw,
  onOpenFHSA,
}: {
  account: Account;
  onDeposit: () => void;
  onWithdraw: () => void;
  onOpenFHSA: () => void;
}) {
  const meta = ACCOUNT_META[account.account_type] ?? {
    icon: Wallet,
    color: "#6B7280",
    label: account.account_type,
  };
  const Icon = meta.icon;

  const isMargin = account.account_type === "margin";
  const isFhsaInactive = account.account_type === "fhsa" && !account.is_active;
  const balance = account.balance_cad;
  const totalValue = account.total_value_cad ?? balance;

  const deadline = account.contribution_deadline;
  const daysLeft = deadline
    ? Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000)
    : null;
  const deadlineUrgent = daysLeft != null && daysLeft <= 60 && daysLeft >= 0;

  // FHSA not opened
  if (isFhsaInactive) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800">FHSA</p>
              <p className="text-xs text-amber-600">Not opened</p>
            </div>
          </div>
          <span className="text-xs font-medium px-2 py-1 bg-amber-200 text-amber-800 rounded-full">
            Eligible
          </span>
        </div>
        <p className="text-xs text-amber-700 leading-relaxed">
          You&apos;re eligible for a First Home Savings Account.{" "}
          {account.contribution_room_remaining
            ? `Up to ${cad(account.contribution_room_remaining)} annual contribution.`
            : ""}
        </p>
        <button
          onClick={onOpenFHSA}
          className="text-xs font-semibold text-amber-800 border border-amber-300 bg-white rounded-lg px-4 py-2 hover:bg-amber-100 transition-colors w-fit"
        >
          Open FHSA →
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E5E5E5] rounded-xl p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${meta.color}15` }}
          >
            <Icon className="w-4 h-4" style={{ color: meta.color }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#111827]">
              {stripBrand(account.product_name)}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {account.subtype && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 bg-zinc-100 text-[#6B7280] rounded-full uppercase">
                  {account.subtype.replace("_", " ")}
                </span>
              )}
              {!account.is_active && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 bg-zinc-100 text-[#9CA3AF] rounded-full">
                  Inactive
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Balance */}
      <div>
        {isMargin ? (
          <>
            <p className="text-2xl font-semibold text-[#DC2626] tabular-nums">
              −{cad(Math.abs(balance))}
            </p>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Debit at{" "}
              {account.interest_rate
                ? `${(account.interest_rate * 100).toFixed(1)}%`
                : "6.2%"}{" "}
              ·{" "}
              {account.interest_rate
                ? `${cad(Math.abs(balance) * account.interest_rate)}/yr`
                : ""}
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-semibold text-[#111827] tabular-nums">
              {cad(totalValue)}
            </p>
            {account.interest_rate && (
              <p className="text-xs text-[#16A34A] mt-0.5 font-medium">
                {(account.interest_rate * 100).toFixed(1)}% interest
              </p>
            )}
          </>
        )}
      </div>

      {/* Contribution room */}
      {account.contribution_room_remaining != null && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#6B7280]">Contribution room</span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-[#111827] tabular-nums">
                {cad(account.contribution_room_remaining)}
              </span>
              {deadlineUrgent && (
                <span className="text-[#D97706] font-medium">
                  Due in {daysLeft}d
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Positions */}
      {(account.positions ?? []).length > 0 && (
        <div className="border-t border-[#E5E5E5] pt-3">
          <p className="text-xs font-medium text-[#6B7280] mb-2">Holdings</p>
          <div className="flex flex-col gap-1.5">
            {account.positions.map((pos) => {
              const gl = pos.unrealized_gain_loss_cad;
              const up = gl >= 0;
              return (
                <div key={pos.ticker} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#111827]">{pos.ticker}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[#6B7280] tabular-nums">
                      {cad(pos.current_value_cad)}
                    </span>
                    <span className={`tabular-nums ${up ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                      {up ? "+" : ""}{cad(gl, true)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      {account.is_active && (
        <div className="flex gap-2 border-t border-[#E5E5E5] pt-3">
          <button
            onClick={onDeposit}
            className="flex-1 py-2 text-xs font-semibold text-white bg-[#111827] hover:bg-zinc-700 rounded-lg transition-colors"
          >
            {isMargin ? "Pay Down" : "Deposit"}
          </button>
          {!isMargin && (
            <button
              onClick={onWithdraw}
              className="flex-1 py-2 text-xs font-semibold text-[#111827] border border-[#E5E5E5] hover:bg-zinc-50 rounded-lg transition-colors"
            >
              Withdraw
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const { portfolio, loading } = usePortfolio();
  const [depositAccount, setDepositAccount] = useState<Account | null>(null);
  const [withdrawAccount, setWithdrawAccount] = useState<Account | null>(null);
  const [fhsaAccount, setFhsaAccount] = useState<Account | null>(null);
  const [payDownAccount, setPayDownAccount] = useState<Account | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [toast, setToast] = useState("");

  const accounts = (portfolio?.accounts ?? []) as Account[];
  const marginAccount = accounts.find((a) => a.account_type === "margin");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#111827] text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[#111827]">Accounts</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setFxOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#111827] border border-[#E5E5E5] rounded-xl hover:bg-zinc-50 transition-colors"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Exchange
          </button>
          <button
            onClick={() => setTransferOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#111827] rounded-xl hover:bg-zinc-700 transition-colors"
          >
            Transfer
          </button>
        </div>
      </div>

      {/* Account grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Sk key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onDeposit={() =>
                account.account_type === "margin"
                  ? setPayDownAccount(account)
                  : setDepositAccount(account)
              }
              onWithdraw={() => setWithdrawAccount(account)}
              onOpenFHSA={() => setFhsaAccount(account)}
            />
          ))}
        </div>
      )}

      {/* Margin summary banner */}
      {portfolio?.margin && portfolio.margin.debit_balance > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#DC2626]">
              Margin debit: {cad(portfolio.margin.debit_balance)}
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              At {(portfolio.margin.interest_rate * 100).toFixed(1)}% — costs{" "}
              {cad(portfolio.margin.annual_cost)}/yr
            </p>
          </div>
          <button
            onClick={() => marginAccount && setPayDownAccount(marginAccount)}
            className="text-xs font-semibold text-[#DC2626] border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors"
          >
            Pay down
          </button>
        </div>
      )}

      {/* Modals */}
      {depositAccount && (
        <DepositModal
          open={!!depositAccount}
          onClose={() => setDepositAccount(null)}
          account={depositAccount}
          mode="deposit"
          onSuccess={showToast}
        />
      )}

      {withdrawAccount && (
        <DepositModal
          open={!!withdrawAccount}
          onClose={() => setWithdrawAccount(null)}
          account={withdrawAccount}
          mode="withdraw"
          onSuccess={showToast}
        />
      )}

      {fhsaAccount && (
        <FHSAModal
          open={!!fhsaAccount}
          onClose={() => setFhsaAccount(null)}
          account={fhsaAccount}
          onSuccess={showToast}
        />
      )}

      {payDownAccount && (
        <PayDownModal
          open={!!payDownAccount}
          onClose={() => setPayDownAccount(null)}
          marginAccount={payDownAccount}
          onSuccess={showToast}
        />
      )}

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={accounts}
        onSuccess={showToast}
      />

      <ExchangeModal
        open={fxOpen}
        onClose={() => setFxOpen(false)}
        accounts={accounts as AccountSummary[]}
        onSuccess={showToast}
      />
    </div>
  );
}
