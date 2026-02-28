export interface Insight {
  id: string;
  run_id: string;
  user_id: string;
  domain: string;
  title: string;
  dollar_impact: number;
  impact_direction: "save" | "earn" | "avoid";
  urgency: "immediate" | "this_month" | "evergreen";
  reasoning: string;
  confidence: "high" | "medium" | "low";
  what_to_do: string;
  status: string;
  dismissed_at?: string;
  dismiss_reason?: string;
}

export interface AnalysisRun {
  id: string;
  started_at: string;
  completed_at: string;
  insights: Insight[];
}

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
  accounts: {
    chequing: {
      type: string;
      balance: number;
      interest_rate: number;
      product_name: string;
    };
    tfsa_managed: {
      type: string;
      subtype: string;
      portfolio: string;
      balance: number;
      contribution_room_remaining: number;
      annual_limit_2024: number;
      cumulative_room_if_eligible_since_2009: number;
      product_name: string;
    };
    rrsp_self_directed: {
      type: string;
      subtype: string;
      balance: number;
      contribution_room_remaining: number;
      contribution_deadline: string;
      product_name: string;
      positions: Array<{
        ticker: string;
        shares: number;
        avg_cost: number;
        current_price: number;
        unrealized_gain: number;
      }>;
    };
    non_registered_self_directed: {
      type: string;
      subtype: string;
      product_name: string;
      balance_cash: number;
      positions: Array<{
        ticker: string;
        shares: number;
        avg_cost: number;
        current_price: number;
        unrealized_gain?: number;
        unrealized_loss?: number;
        held_days: number;
      }>;
    };
    fhsa: {
      type: string;
      exists: boolean;
      eligible: boolean;
      annual_contribution_limit: number;
      lifetime_limit: number;
      note: string;
    };
    margin: {
      type: string;
      debit_balance: number;
      interest_rate: number;
      product_name: string;
    };
    crypto: {
      type: string;
      product_name: string;
      balance_cad: number;
      positions: Array<{
        asset: string;
        balance_cad: number;
        unrealized_gain_cad?: number;
        unrealized_loss_cad?: number;
      }>;
    };
  };
  tax_profile: {
    federal_bracket: string;
    provincial_bracket_on: string;
    marginal_rate_combined: string;
    capital_gains_inclusion_rate: number;
    rrsp_deduction_value_per_dollar: number;
  };
}

export interface AgentStatus {
  name: string;
  status: "idle" | "running" | "complete" | "error";
}
