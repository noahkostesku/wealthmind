"use client";

import type { FinancialProfile } from "@/types";

function formatDollar(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(amount);
}

interface AccountCardProps {
  label: string;
  productName: string;
  balance: number;
  badge?: React.ReactNode;
  note?: string;
}

function AccountCard({ label, productName, balance, badge, note }: AccountCardProps) {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm p-5 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          {label}
        </span>
        {badge}
      </div>
      <span className="text-sm text-zinc-600 leading-snug">{productName}</span>
      <span className="text-xl font-semibold text-zinc-900 mt-1">
        {formatDollar(balance)}
      </span>
      {note && (
        <span className="text-xs text-zinc-500 leading-snug mt-0.5">{note}</span>
      )}
    </div>
  );
}

interface AccountOverviewProps {
  profile: FinancialProfile;
}

export function AccountOverview({ profile }: AccountOverviewProps) {
  const { accounts, client } = profile;

  const managedBadge = (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
      Managed
    </span>
  );

  const selfDirectedBadge = (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      Self-Directed
    </span>
  );

  const nonRegisteredBalance =
    accounts.non_registered_self_directed.balance_cash +
    accounts.non_registered_self_directed.positions.reduce(
      (sum, p) => sum + p.shares * p.current_price,
      0
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-semibold text-zinc-900">
          {formatDollar(client.total_assets_with_ws)}
        </span>
        <span className="text-sm text-zinc-500">Total with Wealthsimple</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <AccountCard
          label="Chequing"
          productName={accounts.chequing.product_name}
          balance={accounts.chequing.balance}
        />

        <AccountCard
          label="TFSA"
          productName={accounts.tfsa_managed.product_name}
          balance={accounts.tfsa_managed.balance}
          badge={managedBadge}
        />

        <AccountCard
          label="RRSP"
          productName={accounts.rrsp_self_directed.product_name}
          balance={accounts.rrsp_self_directed.balance}
          badge={selfDirectedBadge}
        />

        <AccountCard
          label="Non-Registered"
          productName={accounts.non_registered_self_directed.product_name}
          balance={nonRegisteredBalance}
          badge={selfDirectedBadge}
        />

        <AccountCard
          label="Crypto"
          productName={accounts.crypto.product_name}
          balance={accounts.crypto.balance_cad}
        />

        {accounts.fhsa.exists === false && accounts.fhsa.eligible && (
          <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm p-5 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                FHSA
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                Not Opened
              </span>
            </div>
            <span className="text-sm text-zinc-600 leading-snug">
              First Home Savings Account
            </span>
            <span className="text-xl font-semibold text-zinc-900 mt-1">—</span>
            <span className="text-xs text-zinc-500 leading-snug mt-0.5">
              Eligible — {formatDollar(accounts.fhsa.annual_contribution_limit)} available
            </span>
          </div>
        )}

        <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm p-5 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
              Margin
            </span>
          </div>
          <span className="text-sm text-zinc-600 leading-snug">
            {accounts.margin.product_name}
          </span>
          <span className="text-xl font-semibold text-red-600 mt-1">
            -{formatDollar(accounts.margin.debit_balance)}
          </span>
          <span className="text-xs text-zinc-500 leading-snug mt-0.5">
            {(accounts.margin.interest_rate * 100).toFixed(1)}% interest rate
          </span>
        </div>
      </div>
    </div>
  );
}
