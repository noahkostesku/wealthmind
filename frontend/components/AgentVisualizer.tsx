"use client";

import type { AgentStatus } from "@/types";

const AGENTS = [
  { key: "tax", label: "Tax Implications" },
  { key: "allocation", label: "Allocation" },
  { key: "tlh", label: "Tax-Loss Harvesting" },
  { key: "rate", label: "Rate Arbitrage" },
  { key: "timing", label: "Timing" },
];

interface AgentVisualizerProps {
  agentStatuses: Record<string, AgentStatus["status"]>;
  synthesisStatus: AgentStatus["status"];
}

function StatusDot({ status }: { status: AgentStatus["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
    );
  }
  if (status === "complete") {
    return (
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
    );
  }
  if (status === "error") {
    return (
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
    );
  }
  return (
    <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-300" />
  );
}

export function AgentVisualizer({
  agentStatuses,
  synthesisStatus,
}: AgentVisualizerProps) {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm p-6">
      <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-4">
        Agent Pipeline
      </p>

      <div className="flex flex-col items-center gap-0">
        <div className="grid grid-cols-5 gap-3 w-full">
          {AGENTS.map((agent) => {
            const status = agentStatuses[agent.key] ?? "idle";
            return (
              <div
                key={agent.key}
                className="flex flex-col items-center gap-2"
              >
                <div className="flex flex-col items-center gap-2 bg-zinc-50 border border-[#E5E5E5] rounded-lg px-3 py-3 w-full min-h-[72px] justify-center">
                  <StatusDot status={status} />
                  <span className="text-xs font-medium text-zinc-700 text-center leading-tight">
                    {agent.label}
                  </span>
                </div>
                <div className="w-px h-4 bg-zinc-200" />
              </div>
            );
          })}
        </div>

        <div className="w-full relative flex items-center justify-center h-px">
          <div className="w-full border-t border-zinc-200" />
        </div>

        <div className="mt-0 flex flex-col items-center gap-2">
          <div className="w-px h-4 bg-zinc-200" />
          <div className="flex flex-col items-center gap-2 bg-zinc-50 border border-[#E5E5E5] rounded-lg px-6 py-3 min-w-[160px]">
            <StatusDot status={synthesisStatus} />
            <span className="text-xs font-medium text-zinc-700">
              {synthesisStatus === "running"
                ? "Synthesizing..."
                : synthesisStatus === "complete"
                ? "Complete"
                : "Synthesis"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
