"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Insight } from "@/types";

function formatDollar(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
}

function domainLabel(domain: string): string {
  const labels: Record<string, string> = {
    allocation: "Allocation",
    tax: "Tax Implications",
    tlh: "Tax-Loss Harvesting",
    rate: "Rate Arbitrage",
    timing: "Timing",
  };
  return labels[domain.toLowerCase()] ?? domain;
}

interface InsightCardProps {
  insight: Insight;
  index?: number;
  onDismiss: (id: string, reason: string) => void;
}

export function InsightCard({ insight, index = 0, onDismiss }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isLowConfidence = insight.confidence === "low";

  const impactColor =
    insight.impact_direction === "avoid"
      ? "bg-red-100 text-red-700"
      : "bg-green-100 text-green-700";

  const impactSign =
    insight.impact_direction === "avoid" ? "-" : "+";

  const urgencyStyles: Record<string, string> = {
    immediate: "bg-red-100 text-red-700",
    this_month: "bg-amber-100 text-amber-700",
    evergreen: "bg-blue-100 text-blue-700",
  };

  const urgencyLabels: Record<string, string> = {
    immediate: "Immediate",
    this_month: "This Month",
    evergreen: "Evergreen",
  };

  return (
    <div
      className="bg-white border border-[#E5E5E5] rounded-xl shadow-sm p-6 flex flex-col gap-4 transition-all duration-300"
      style={{
        animationDelay: `${index * 100}ms`,
        opacity: isLowConfidence ? 0.6 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-400 font-medium uppercase tracking-wide">
              {domainLabel(insight.domain)}
            </span>
            {isLowConfidence && (
              <span className="text-xs text-zinc-400">· Low confidence</span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-zinc-900 leading-snug">
            {insight.title}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${impactColor}`}
            >
              {impactSign}{formatDollar(insight.dollar_impact)}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${urgencyStyles[insight.urgency]}`}
            >
              {urgencyLabels[insight.urgency]}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-xs text-zinc-400 hover:text-zinc-600 px-2 py-1 rounded transition-colors">
                Dismiss
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onDismiss(insight.id, "already_done")}
              >
                Already done
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDismiss(insight.id, "not_relevant")}
              >
                Not relevant
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDismiss(insight.id, "i_disagree")}
              >
                I disagree
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={() => setExpanded(!expanded)}
            className="text-zinc-400 hover:text-zinc-600 p-1 rounded transition-colors"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      <div
        className={`overflow-hidden transition-all duration-300 ${
          expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-col gap-4 pt-2 border-t border-[#E5E5E5]">
          <p className="text-sm text-zinc-600 leading-relaxed">
            {insight.reasoning}
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              What you could do
            </span>
            <p className="text-sm text-zinc-800 font-medium leading-relaxed">
              {insight.what_to_do}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
