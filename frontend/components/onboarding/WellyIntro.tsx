"use client";

/**
 * WellyIntro — programmatic onboarding message sequence.
 *
 * Usage:
 *   <WellyIntro skipped={false} onComplete={(chips) => ...} />
 *
 * Props:
 *   skipped   — if true, jump straight to Message 3 (live proactive briefing)
 *   onComplete — called with the follow-up chips once the sequence finishes
 *   onAddMessage — callback to inject messages into the parent chat
 */

import { useEffect, useRef } from "react";
import { createChatSession } from "@/lib/api";
import type { ChatSession } from "@/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WellyMessage {
  id: string;
  content: string;
  /** render as structured agent-capability list */
  isCapabilityList?: boolean;
  /** render with amber left-border (proactive insight style) */
  isProactive?: boolean;
  agent_sources?: string[];
}

interface WellyIntroProps {
  skipped: boolean;
  onAddMessage: (msg: WellyMessage) => void;
  onSetChips: (chips: string[]) => void;
}

// ─── Agent capability rows for Message 2 ─────────────────────────────────────

export const AGENT_CAPABILITIES = [
  { agent: "Allocation", desc: "spots idle cash that should be in a registered account" },
  { agent: "Tax",        desc: "flags what you'd owe if you sold a position today" },
  { agent: "Harvesting", desc: "finds losses you can use to offset gains" },
  { agent: "Rates",      desc: "catches situations where debt is costing more than savings earn" },
  { agent: "Timing",     desc: "surfaces deadlines before they pass" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function WellyIntro({ skipped, onAddMessage, onSetChips }: WellyIntroProps) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    async function run() {
      if (!skipped) {
        // Message 1
        onAddMessage({
          id: "welly-intro-1",
          content:
            "I'm Welly. I can see all your accounts — your TFSA, RRSP, chequing, non-registered portfolio, crypto, and margin. I work with five specialist agents to find opportunities in your finances.",
        });

        await delay(800);

        // Message 2 — structured capability list (special render)
        onAddMessage({
          id: "welly-intro-2",
          content: "Here's what each agent looks for — in plain terms:",
          isCapabilityList: true,
        });

        await delay(800);
      }

      // Message 3 — live proactive briefing
      try {
        const sess: ChatSession = await createChatSession();
        onAddMessage({
          id: "welly-intro-3",
          content: sess.greeting,
          isProactive: true,
          agent_sources: sess.agent_sources,
        });

        // Derive chips from top_findings titles
        const chips = buildChips(sess);
        onSetChips(chips);
      } catch {
        onAddMessage({
          id: "welly-intro-3",
          content:
            "I've finished scanning your accounts. Ask me anything to dig in.",
          isProactive: true,
        });
        onSetChips([
          "What's my biggest tax risk right now?",
          "Should I pay down my margin or invest?",
          "What contribution room do I have left?",
        ]);
      }
    }

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Renders nothing — side-effect only
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function buildChips(sess: ChatSession): string[] {
  const findings = (sess.top_findings ?? []) as Array<{ title?: string }>;
  const fromFindings = findings
    .slice(0, 3)
    .map((f) => f.title)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .map((t) => `Tell me more about: ${t}`);

  // Fallback chips
  const fallback = [
    "What's my biggest tax risk right now?",
    "Should I pay down my margin or invest?",
    "What contribution room do I have left?",
  ];

  return fromFindings.length >= 2 ? fromFindings : fallback;
}
