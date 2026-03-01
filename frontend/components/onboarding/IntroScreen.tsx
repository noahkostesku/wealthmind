"use client";

import { useState, useEffect } from "react";
import { BarChart2, Sparkles, MessageSquare } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface IntroScreenProps {
  /** Called when the user clicks "Meet Welly" or "Skip".
   *  skipped=true means they hit Skip → jump straight to Message 3. */
  onDismiss: (skipped: boolean) => void;
}

// ─── Capability cards data ───────────────────────────────────────────────────

const CARDS = [
  {
    Icon: BarChart2,
    title: "Full Portfolio View",
    description: "Every account, position, and balance in one place",
  },
  {
    Icon: Sparkles,
    title: "5 Specialist Agents",
    description: "Tax, allocation, timing, harvesting, and rate analysis",
  },
  {
    Icon: MessageSquare,
    title: "Ask Welly Anything",
    description: "Conversational intelligence that knows your exact numbers",
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function IntroScreen({ onDismiss }: IntroScreenProps) {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const [exiting, setExiting] = useState(false);

  // Advance through phases automatically
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 100);   // logo visible immediately
    const t2 = setTimeout(() => setPhase(2), 800);   // cards start sliding up
    const t3 = setTimeout(() => setPhase(3), 2000);  // CTA appears
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  function handleDismiss(skipped: boolean) {
    setExiting(true);
    setTimeout(() => onDismiss(skipped), 400);
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-400 ${
        exiting ? "opacity-0" : "opacity-100"
      }`}
      style={{ background: "#0A0F1E" }}
    >
      {/* Animated gradient background — subtle Northern Lights effect */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 20% 60%, rgba(22,163,74,0.12) 0%, transparent 60%), " +
            "radial-gradient(ellipse at 80% 30%, rgba(37,99,235,0.10) 0%, transparent 60%)",
          animation: "aurora 8s ease-in-out infinite alternate",
        }}
      />

      {/* Skip button */}
      <button
        onClick={() => handleDismiss(true)}
        className="fixed top-6 right-6 text-sm text-gray-400 hover:text-white transition-colors bg-transparent border-none cursor-pointer"
      >
        Skip
      </button>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-10 px-6 max-w-lg w-full">

        {/* Phase 1 — Logo */}
        <div
          className={`flex flex-col items-center gap-2 transition-all duration-700 ${
            phase >= 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <h1 className="text-4xl font-bold text-white tracking-tight">
            WealthMind
          </h1>
          <p
            className="text-lg text-gray-400 transition-all duration-700"
            style={{ transitionDelay: "200ms" }}
          >
            Your financial intelligence layer
          </p>
        </div>

        {/* Phase 2 — Capability cards */}
        <div className="flex flex-col gap-3 w-full">
          {CARDS.map(({ Icon, title, description }, i) => (
            <div
              key={title}
              className="flex items-start gap-4 bg-white/10 backdrop-blur-sm rounded-xl p-5 border border-white/20 transition-all duration-500"
              style={{
                transitionDelay: `${i * 150}ms`,
                opacity: phase >= 2 ? 1 : 0,
                transform: phase >= 2 ? "translateY(0)" : "translateY(20px)",
              }}
            >
              <Icon className="w-5 h-5 text-white flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-white font-semibold text-sm">{title}</p>
                <p className="text-gray-400 text-sm mt-0.5">{description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Phase 3 — CTA */}
        <div
          className="transition-all duration-500"
          style={{
            opacity: phase >= 3 ? 1 : 0,
            transform: phase >= 3 ? "translateY(0)" : "translateY(8px)",
          }}
        >
          <button
            onClick={() => handleDismiss(false)}
            className="px-8 py-3 bg-white text-black font-semibold rounded-full hover:bg-zinc-100 transition-colors"
            style={{ animation: phase >= 3 ? "ctaPulse 2s ease-in-out infinite" : "none" }}
          >
            Meet Welly
          </button>
        </div>
      </div>

      {/* Keyframes injected via style tag */}
      <style>{`
        @keyframes aurora {
          0%   { opacity: 0.7; transform: scale(1) translate(0, 0); }
          50%  { opacity: 1;   transform: scale(1.05) translate(2%, -1%); }
          100% { opacity: 0.7; transform: scale(1) translate(-2%, 1%); }
        }
        @keyframes ctaPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.3); }
          50%       { box-shadow: 0 0 0 8px rgba(255,255,255,0); }
        }
        .duration-400 { transition-duration: 400ms; }
      `}</style>
    </div>
  );
}
