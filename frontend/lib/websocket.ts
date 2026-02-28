import type { Insight, AgentStatus } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function createInsightStream(
  run_id: string,
  onInsight: (insight: Insight) => void,
  onAgentUpdate: (status: AgentStatus) => void
): WebSocket {
  const wsUrl = API_URL.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/ws/${run_id}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);
      if (data.type === "agent_status") {
        onAgentUpdate({ name: data.name, status: data.status });
      } else if (data.type === "insight") {
        onInsight(data.insight as Insight);
      } else if (Array.isArray(data.insights)) {
        (data.insights as Insight[]).forEach((insight) => onInsight(insight));
      }
    } catch {
      // ignore parse errors
    }
  };

  ws.onerror = () => {
    ws.close();
  };

  return ws;
}
