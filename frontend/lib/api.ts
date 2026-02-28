import { getSession } from "next-auth/react";
import type { FinancialProfile, AnalysisRun, Insight } from "@/types";

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

export async function getProfile(): Promise<FinancialProfile> {
  const res = await fetch(`${API_URL}/profile`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

export async function startAnalysis(): Promise<{
  run_id: string;
  insight_count: number;
  insights: Insight[];
}> {
  const res = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to start analysis");
  return res.json();
}

export async function dismissInsight(id: string, reason: string): Promise<void> {
  const res = await fetch(`${API_URL}/insights/${id}/dismiss`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ dismiss_reason: reason }),
  });
  if (!res.ok) throw new Error("Failed to dismiss insight");
}

export async function getHistory(): Promise<AnalysisRun[]> {
  const res = await fetch(`${API_URL}/insights/history`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}
