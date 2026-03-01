// ─── Position ──────────────────────────────────────────────────────────────────
export interface Position {
  id: number;
  ticker: string;
  name: string;
  shares: number;
  avg_cost_cad: number;
  currency: string;
  asset_type: string;
  current_price: number;
  current_value_cad: number;
  unrealized_gain_loss_cad: number;
  unrealized_gain_loss_pct: number;
  held_days: number;
  change_pct: number;
  // Added by /portfolio/positions
  account_type?: string;
  account_id?: number;
  product_name?: string;
}

// ─── Account ───────────────────────────────────────────────────────────────────
export interface AccountSummary {
  id: number;
  account_type: string;
  subtype: string | null;
  product_name: string;
  balance_cad: number;
  interest_rate: number | null;
  contribution_room_remaining: number | null;
  contribution_deadline: string | null;
  is_active: boolean;
}

export interface Account extends AccountSummary {
  positions: Position[];
  total_value_cad?: number;
}

// ─── Portfolio Snapshot ────────────────────────────────────────────────────────
export interface PortfolioSnapshot {
  total_value_cad: number;
  total_gain_loss_cad: number;
  total_gain_loss_pct: number;
  accounts: Account[];
  allocation: {
    by_account_type: Record<string, number>;
    by_asset_type: Record<string, number>;
  };
  contribution_room: {
    tfsa: number | null;
    rrsp: number | null;
    fhsa: number | null;
  };
  margin: {
    debit_balance: number;
    interest_rate: number;
    annual_cost: number;
  };
}

export interface PerformanceTimeline {
  date: string;
  net_deposits: number;
  transaction_type: string;
  amount: number;
}

export interface PerformanceData {
  current_value_cad: number;
  total_gain_loss_cad: number;
  total_gain_loss_pct: number;
  timeline: PerformanceTimeline[];
  tax_exposure: {
    marginal_rate: number;
    inclusion_rate: number;
    positions: Array<{
      ticker: string;
      unrealized_gain_cad: number;
      taxable_gain_cad: number;
      estimated_tax_cad: number;
    }>;
    total_taxable_gain_cad: number;
    total_estimated_tax_cad: number;
  };
}

// ─── Position History ──────────────────────────────────────────────────────────
export interface PriceBar {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

export interface PositionHistory {
  ticker: string;
  period: string;
  price_chart: PriceBar[];
  cost_basis_line: Array<{ date: string; cost_basis: number | null }>;
  transactions: Array<{
    executed_at: string;
    transaction_type: string;
    shares: number;
    price_cad: number;
    total_cad: number;
  }>;
}

// ─── Transaction ───────────────────────────────────────────────────────────────
export interface Transaction {
  id: number;
  account_id: number;
  transaction_type: string;
  ticker: string | null;
  shares: number | null;
  price_cad: number | null;
  total_cad: number;
  currency_from: string | null;
  currency_to: string | null;
  exchange_rate: number | null;
  executed_at: string;
  notes: string | null;
}

// ─── Market Data ───────────────────────────────────────────────────────────────
export interface StockResult {
  ticker: string;
  name: string;
  exchange: string;
  price: number;
  cad_price?: number;
  change: number;
  change_pct: number;
  currency: string;
}

export interface QuoteResponse {
  quote: {
    ticker?: string;
    name?: string;
    price?: number;
    cad_price?: number;
    change_pct?: number;
    currency?: string;
  };
  chart_1d: PriceBar[];
}

// ─── Trading ───────────────────────────────────────────────────────────────────
export interface TradeResult {
  success?: boolean;
  transaction_id?: number;
  ticker?: string;
  shares?: number;
  price?: number;
  total?: number;
  account_id?: number;
  message?: string;
  detail?: string;
}

export interface ExchangeResult {
  success?: boolean;
  from_amount?: number;
  to_amount?: number;
  rate?: number;
  transaction_id?: number;
  message?: string;
  detail?: string;
}

// ─── Chat ──────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  agent_sources?: string[];
  findings_snapshot?: Record<string, unknown>;
}

export interface ChatSession {
  session_id: string;
  greeting: string;
  top_findings: Insight[];
  agent_sources: string[];
  restored?: boolean;
}

// ─── Insights ─────────────────────────────────────────────────────────────────
export interface Insight {
  id?: string;
  run_id?: string;
  user_id?: string;
  domain?: string;
  title: string;
  dollar_impact: number;
  impact_direction: "save" | "earn" | "avoid";
  urgency: "immediate" | "this_month" | "evergreen";
  reasoning: string;
  confidence: "high" | "medium" | "low";
  what_to_do: string;
  status?: string;
  dismissed_at?: string;
  dismiss_reason?: string;
}

export interface AnalysisRun {
  id: string;
  started_at: string;
  completed_at: string;
  insights: Insight[];
}

export interface AgentStatus {
  name: string;
  status: "idle" | "running" | "complete" | "error";
}

// ─── Trade Interception ────────────────────────────────────────────────────────
export interface InterceptionResult {
  should_intercept: boolean;
  urgency?: "warning" | "info" | "clear";
  headline?: string;
  findings?: Insight[];
  better_alternative?: string | null;
  proceed_anyway_label?: string;
}

// ─── Advisor Mode ─────────────────────────────────────────────────────────────
export interface AdvisorReport {
  headline: string;
  full_picture: string;
  do_not_do: string;
  total_opportunity: number;
  chips: string[];
  generated_at: string;
  cached: boolean;
}

// ─── Monitor Alerts ────────────────────────────────────────────────────────────
export interface MonitorAlertData {
  id: number;
  alert_type: string;
  message: string;
  ticker?: string | null;
  dollar_impact?: number | null;
  created_at: string;
}

// ─── Legacy profile type (backward compat with existing components) ───────────
export interface FinancialProfile {
  client: {
    age: number;
    province: string;
    annual_income: number;
    filing_status: string;
    wealthsimple_tier: string;
    total_assets_with_ws: number;
    member_since: string;
  };
  accounts: Record<string, unknown>;
  tax_profile: Record<string, unknown>;
}
