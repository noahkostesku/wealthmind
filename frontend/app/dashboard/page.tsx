"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { LayoutDashboard } from "lucide-react";
import { InsightCard } from "@/components/InsightCard";
import { AgentVisualizer } from "@/components/AgentVisualizer";
import { AccountOverview } from "@/components/AccountOverview";
import { Button } from "@/components/ui/button";
import { getProfile, startAnalysis, dismissInsight, getHistory } from "@/lib/api";
import { createInsightStream } from "@/lib/websocket";
import type { Insight, AnalysisRun, FinancialProfile, AgentStatus } from "@/types";

const AGENT_KEYS = ["tax", "allocation", "tlh", "rate", "timing"];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [profile, setProfile] = useState<FinancialProfile | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [history, setHistory] = useState<AnalysisRun[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [agentStatuses, setAgentStatuses] = useState<
    Record<string, AgentStatus["status"]>
  >({});
  const [synthesisStatus, setSynthesisStatus] =
    useState<AgentStatus["status"]>("idle");
  const [visibleCount, setVisibleCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    getProfile()
      .then(setProfile)
      .catch(() => null);
    getHistory()
      .then(setHistory)
      .catch(() => null);
  }, []);

  function handleAgentUpdate(status: AgentStatus) {
    setAgentStatuses((prev) => ({ ...prev, [status.name]: status.status }));
  }

  async function handleRunAnalysis() {
    if (isRunning) return;

    setIsRunning(true);
    setInsights([]);
    setVisibleCount(0);
    setAgentStatuses(
      Object.fromEntries(AGENT_KEYS.map((k) => [k, "running" as const]))
    );
    setSynthesisStatus("running");

    try {
      const result = await startAnalysis();

      // Mark all agents complete
      setAgentStatuses(
        Object.fromEntries(AGENT_KEYS.map((k) => [k, "complete" as const]))
      );
      setSynthesisStatus("complete");

      // Stream cards in with staggered entrance
      const incoming = result.insights;
      setInsights(incoming);
      incoming.forEach((_, i) => {
        setTimeout(() => setVisibleCount(i + 1), i * 100);
      });

      // Also try WebSocket for any streaming updates
      if (wsRef.current) wsRef.current.close();
      wsRef.current = createInsightStream(
        result.run_id,
        (insight) => {
          setInsights((prev) => {
            const exists = prev.find((x) => x.id === insight.id);
            if (exists) return prev;
            return [...prev, insight];
          });
        },
        handleAgentUpdate
      );

      // Refresh history
      getHistory()
        .then(setHistory)
        .catch(() => null);
    } catch {
      setAgentStatuses(
        Object.fromEntries(AGENT_KEYS.map((k) => [k, "error" as const]))
      );
      setSynthesisStatus("error");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleDismiss(id: string, reason: string) {
    await dismissInsight(id, reason).catch(() => null);
    setInsights((prev) => prev.filter((x) => x.id !== id));
  }

  const visibleInsights = insights.slice(0, visibleCount);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Demo Mode Banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center">
        <p className="text-sm text-amber-700 font-medium">
          Demo Mode — synthetic data only. No real accounts connected.
        </p>
      </div>

      {/* Header */}
      <header className="bg-white border-b border-[#E5E5E5] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-xl font-semibold text-zinc-900 tracking-tight">
            WealthMind
          </span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500">{session?.user?.email}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        {/* Account Overview */}
        {profile && <AccountOverview profile={profile} />}

        {/* Run Analysis */}
        <div className="flex items-center gap-4">
          <Button
            onClick={handleRunAnalysis}
            disabled={isRunning}
            className="bg-zinc-900 text-white hover:bg-zinc-700"
          >
            {isRunning ? "Analyzing..." : "Run Analysis"}
          </Button>
          {insights.length > 0 && !isRunning && (
            <span className="text-sm text-zinc-500">
              {insights.length} insight{insights.length !== 1 ? "s" : ""} found
            </span>
          )}
        </div>

        {/* Agent Visualizer (shown while running) */}
        {isRunning && (
          <AgentVisualizer
            agentStatuses={agentStatuses}
            synthesisStatus={synthesisStatus}
          />
        )}

        {/* Intelligence Board */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-900">
              Your Financial Intelligence
            </h2>
            {insights.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600">
                {insights.length}
              </span>
            )}
          </div>

          {visibleInsights.length === 0 && !isRunning ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <LayoutDashboard className="w-8 h-8 text-zinc-300" />
              <p className="text-zinc-400 text-sm">
                Run your first analysis to surface opportunities
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visibleInsights.map((insight, i) => (
                <div
                  key={insight.id ?? i}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <InsightCard
                    insight={insight}
                    index={i}
                    onDismiss={handleDismiss}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* History */}
        {history.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-zinc-700">
              Past Analyses
            </h2>
            <div className="flex flex-col gap-2">
              {history.map((run) => (
                <div
                  key={run.id}
                  className="bg-white border border-[#E5E5E5] rounded-lg px-4 py-3 flex items-center justify-between"
                >
                  <span className="text-sm text-zinc-600">
                    {run.started_at ? formatTime(run.started_at) : "—"}
                  </span>
                  <span className="text-sm text-zinc-400">
                    {run.insights?.length ?? 0} finding
                    {(run.insights?.length ?? 0) !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
