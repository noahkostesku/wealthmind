"use client";

/**
 * WellyIntro — programmatic onboarding message sequence.
 *
 * Usage:
 *   <WellyIntro skipped={false} onComplete={(chips) => ...} />
 *
 * Props:
 *   skipped   — if true, skip intro messages and go straight to ready state
 *   onComplete — called with the follow-up chips once the sequence finishes
 *   onAddMessage — callback to inject messages into the parent chat
 */

import { useEffect, useRef } from "react";
import { createChatSession } from "@/lib/api";

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

// ─── Default suggestion chips ────────────────────────────────────────────────

const DEFAULT_CHIPS = [
  "What's my biggest tax risk right now?",
  "Should I pay down my margin or invest?",
  "What contribution room do I have left?",
];

// ─── Component ───────────────────────────────────────────────────────────────

export function WellyIntro({ skipped, onAddMessage, onSetChips }: WellyIntroProps) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    async function run() {
      // Pre-create the session so it's ready when the user sends their first message
      try {
        await createChatSession();
      } catch {
        // session will be created on first message
      }

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

        await delay(600);

        // Message 3 — simple invitation to ask, no unsolicited analysis
        onAddMessage({
          id: "welly-intro-3",
          content: "Ask me anything about your portfolio and I'll pull in the right agents.",
        });
      } else {
        // Skipped onboarding — just show a simple ready message
        onAddMessage({
          id: "welly-intro-3",
          content: "Ask me anything about your portfolio and I'll pull in the right agents.",
        });
      }

      onSetChips(DEFAULT_CHIPS);
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
