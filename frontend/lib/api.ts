import { getSession } from "next-auth/react";
import type {
  PortfolioSnapshot,
  Account,
  AccountSummary,
  Position,
  Transaction,
  PerformanceData,
  PositionHistory,
  PriceBar,
  StockResult,
  QuoteResponse,
  TradeResult,
  ExchangeResult,
  ChatSession,
  FinancialProfile,
  AnalysisRun,
  Insight,
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function makeToken(email: string, id: string): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const payload = btoa(JSON.stringify({ sub: id, email }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.signature`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = await getSession();
  if (session?.user) {
    const token = makeToken(
      session.user.email ?? "",
      (session.user as { id?: string }).id ?? ""
    );
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      (err as { detail?: string }).detail ?? `${init?.method ?? "GET"} ${path} failed: ${res.status}`
    );
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ─── Portfolio ─────────────────────────────────────────────────────────────────

export async function getPortfolio(): Promise<PortfolioSnapshot> {
  return get<PortfolioSnapshot>("/portfolio");
}

export async function getPositions(): Promise<Position[]> {
  return get<Position[]>("/portfolio/positions");
}

export async function getPerformance(): Promise<PerformanceData> {
  return get<PerformanceData>("/portfolio/performance");
}

export async function getPositionHistory(
  ticker: string,
  period = "1mo"
): Promise<PositionHistory> {
  return get<PositionHistory>(
    `/portfolio/position/${encodeURIComponent(ticker)}?period=${period}`
  );
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function getAccounts(): Promise<AccountSummary[]> {
  return get<AccountSummary[]>("/accounts");
}

export async function getAccount(accountId: number): Promise<Account> {
  return get<Account>(`/accounts/${accountId}`);
}

export async function depositToAccount(
  accountId: number,
  amountCad: number
): Promise<{ success: boolean; message: string }> {
  return post(`/accounts/${accountId}/deposit`, { amount_cad: amountCad });
}

export async function withdrawFromAccount(
  accountId: number,
  amountCad: number
): Promise<{ success: boolean; message: string }> {
  return post(`/accounts/${accountId}/withdraw`, { amount_cad: amountCad });
}

export async function transferBetweenAccounts(
  fromId: number,
  toId: number,
  amountCad: number
): Promise<{ success: boolean; message: string }> {
  return post("/accounts/exchange", {
    from_account_id: fromId,
    to_account_id: toId,
    amount_cad: amountCad,
  });
}

// ─── Markets ──────────────────────────────────────────────────────────────────

export async function searchStocks(query: string): Promise<StockResult[]> {
  return get<StockResult[]>(`/markets/search?q=${encodeURIComponent(query)}`);
}

export async function getQuote(ticker: string): Promise<QuoteResponse> {
  return get<QuoteResponse>(`/markets/quote/${encodeURIComponent(ticker)}`);
}

export async function getChart(ticker: string, period = "1mo"): Promise<PriceBar[]> {
  const data = await get<unknown>(`/markets/chart/${encodeURIComponent(ticker)}?period=${period}`);
  // Handle both array and object responses
  if (Array.isArray(data)) return data as PriceBar[];
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data as PriceBar[];
  return [];
}

// ─── Trading ──────────────────────────────────────────────────────────────────

export async function executeBuy(
  accountId: number,
  ticker: string,
  shares: number
): Promise<TradeResult> {
  return post<TradeResult>("/trade/buy", { account_id: accountId, ticker, shares });
}

export async function executeSell(
  accountId: number,
  ticker: string,
  shares: number
): Promise<TradeResult> {
  return post<TradeResult>("/trade/sell", { account_id: accountId, ticker, shares });
}

export async function getTransactionHistory(): Promise<Transaction[]> {
  return get<Transaction[]>("/trade/history");
}

// ─── FX ───────────────────────────────────────────────────────────────────────

export async function getExchangeRate(
  from: string,
  to: string
): Promise<{ rate: number; usdcad: number }> {
  return get(`/fx/rate?from_currency=${from}&to_currency=${to}`);
}

export async function executeExchange(
  accountId: number,
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<ExchangeResult> {
  return post<ExchangeResult>("/fx/exchange", {
    account_id: accountId,
    amount,
    from_currency: fromCurrency,
    to_currency: toCurrency,
  });
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export async function createChatSession(): Promise<ChatSession> {
  return post<ChatSession>("/chat/session");
}

export async function streamChatMessage(
  sessionId: string,
  message: string,
  onEvent: (event: { type: string } & Record<string, unknown>) => void
): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}/chat/message`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(`Chat message failed: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (raw && raw !== "[DONE]") {
          try {
            const data = JSON.parse(raw) as Record<string, unknown>;
            onEvent({ type: currentEvent, ...data });
          } catch {
            // skip malformed lines
          }
        }
        currentEvent = "";
      }
    }
  }
}

export async function sendWhatIf(
  sessionId: string,
  scenario: string,
  parameters: Record<string, unknown>
): Promise<unknown> {
  return post("/chat/whatif", { session_id: sessionId, scenario, parameters });
}

export async function getChatHistory(sessionId: string): Promise<{
  session_id: string;
  messages: unknown[];
  last_findings: unknown;
}> {
  return get(`/chat/session/${sessionId}`);
}

// ─── Legacy (backward compat) ─────────────────────────────────────────────────

export async function getProfile(): Promise<FinancialProfile> {
  return get<FinancialProfile>("/profile");
}

export async function startAnalysis(): Promise<{
  run_id: string;
  insight_count: number;
  insights: Insight[];
}> {
  return post("/analyze");
}

export async function dismissInsight(id: string, reason: string): Promise<void> {
  await post(`/insights/${id}/dismiss`, { reason }).catch(() => null);
}

export async function getHistory(): Promise<AnalysisRun[]> {
  return get<AnalysisRun[]>("/history").catch(() => []);
}

// Re-export for convenience
export type { PriceBar };
