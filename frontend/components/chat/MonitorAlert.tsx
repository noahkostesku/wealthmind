"use client";

import type { MonitorAlertData } from "@/types";
import { dismissMonitorAlert } from "@/lib/api";

interface MonitorAlertProps {
  alert: MonitorAlertData;
  onTellMeMore: (message: string, alertContext: string) => void;
  onDismiss: (alertId: number) => void;
}

export function MonitorAlertBubble({
  alert,
  onTellMeMore,
  onDismiss,
}: MonitorAlertProps) {
  async function handleDismiss() {
    try {
      await dismissMonitorAlert(alert.id);
    } catch {
      // non-fatal
    }
    onDismiss(alert.id);
  }

  function handleTellMeMore() {
    // Pre-fill chat with the alert context so Welly has full information
    const ctx = `Tell me more about this alert: ${alert.message}`;
    onTellMeMore(ctx, alert.message);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-gray-400 ml-1">Welly noticed</span>
      <div className="max-w-[92%] border-l-4 border-amber-400 bg-amber-50 rounded-r-lg px-4 py-3 text-sm text-gray-800 leading-relaxed shadow-sm">
        {alert.message}
      </div>
      <div className="flex gap-2 ml-1 mt-0.5">
        <button
          onClick={handleTellMeMore}
          className="text-xs text-[#2563EB] hover:text-[#111827] px-3 py-1.5 rounded-lg border border-blue-100 hover:border-zinc-200 hover:bg-zinc-50 transition-colors"
        >
          Tell me more
        </button>
        <button
          onClick={handleDismiss}
          className="text-xs text-gray-400 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
