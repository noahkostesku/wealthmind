"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { BotMessageSquare } from "lucide-react";
import { Sidebar, MobileNav } from "./Sidebar";
import { ChatPanel } from "./chat/ChatPanel";
import { IntroScreen } from "./onboarding/IntroScreen";
import { WellyIntro } from "./onboarding/WellyIntro";
import type { WellyMessage } from "./onboarding/WellyIntro";
import { PortfolioProvider } from "@/contexts/PortfolioContext";
import { getOnboardedStatus, completeOnboarding } from "@/lib/api";
import type { ReactNode } from "react";

const PUBLIC_PATHS = ["/login", "/"];
const LS_KEY = "wm_onboarded";

// Onboarding phase machine:
//  "idle"    — not yet checked / returning user
//  "intro"   — IntroScreen is visible
//  "welly"   — IntroScreen dismissed, WellyIntro is running
//  "done"    — onboarding complete, normal chat
type OnboardPhase = "idle" | "intro" | "welly" | "done";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [wellyOpen, setWellyOpen] = useState(true);

  const [phase, setPhase] = useState<OnboardPhase>("idle");
  const [skipIntro, setSkipIntro] = useState(false);
  const [onboardingMessages, setOnboardingMessages] = useState<WellyMessage[]>([]);
  const [onboardingChips, setOnboardingChips] = useState<string[]>([]);
  const checkedRef = useRef(false);

  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isAuthenticated = !isPublic && status !== "loading" && !!session;

  // ── Check onboarding status on auth ──────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || checkedRef.current) return;
    checkedRef.current = true;

    // DEV MODE: localStorage fast-path disabled — always show onboarding
    // Re-enable for production: check localStorage.getItem(LS_KEY) === "true" first

    getOnboardedStatus()
      .then(({ onboarded }) => {
        if (onboarded) {
          localStorage.setItem(LS_KEY, "true");
          setPhase("done");
        } else {
          setPhase("intro");
          setWellyOpen(true);
        }
      })
      .catch(() => {
        setPhase("done"); // fail-safe: skip onboarding
      });
  }, [isAuthenticated]);

  // ── IntroScreen dismissed ─────────────────────────────────────────────────
  const handleIntroDismiss = useCallback(async (skipped: boolean) => {
    setSkipIntro(skipped);
    setPhase("welly");
    try {
      await completeOnboarding();
    } catch {
      // non-fatal
    }
    localStorage.setItem(LS_KEY, "true");
  }, []);

  // ── WellyIntro message + chip injection ───────────────────────────────────
  const handleAddMessage = useCallback((msg: WellyMessage) => {
    setOnboardingMessages((prev) => [...prev, msg]);
  }, []);

  const handleSetChips = useCallback((chips: string[]) => {
    setOnboardingChips(chips);
    setPhase("done");
  }, []);

  if (isPublic || status === "loading" || !session) {
    return <div className="min-h-screen bg-[#FAFAFA]">{children}</div>;
  }

  const onboardingInProgress = phase === "intro" || phase === "welly";

  return (
    <PortfolioProvider>
      <div className="flex h-screen overflow-hidden bg-[#FAFAFA]">

        {/* ── First-time intro overlay ──────────────────────────────────── */}
        {phase === "intro" && (
          <IntroScreen onDismiss={handleIntroDismiss} />
        )}

        {/* ── WellyIntro: side-effect component, feeds messages into chat ── */}
        {phase === "welly" && (
          <WellyIntro
            skipped={skipIntro}
            onAddMessage={handleAddMessage}
            onSetChips={handleSetChips}
          />
        )}

        {/* ── Left sidebar (desktop) ──────────────────────────────────── */}
        <div className="hidden lg:flex flex-col w-56 fixed inset-y-0 left-0 z-30 flex-shrink-0">
          <Sidebar wellyOpen={wellyOpen} onToggleWelly={() => setWellyOpen((o) => !o)} />
        </div>

        {/* ── Main content ────────────────────────────────────────────── */}
        <main
          className={`flex-1 overflow-y-auto lg:ml-56 pb-16 lg:pb-0 transition-all duration-300 ${
            wellyOpen ? "lg:mr-96" : "lg:mr-0"
          }`}
        >
          {children}
        </main>

        {/* ── Mobile backdrop ─────────────────────────────────────────── */}
        {wellyOpen && (
          <div
            className="lg:hidden fixed inset-0 z-30 bg-black/40"
            onClick={() => setWellyOpen(false)}
          />
        )}

        {/* ── Welly panel ─────────────────────────────────────────────── */}
        <div
          className={`fixed inset-y-0 right-0 z-40 w-full sm:w-96 flex flex-col transition-transform duration-300 ease-in-out ${
            wellyOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <ChatPanel
            onClose={() => setWellyOpen(false)}
            onboardingMessages={onboardingMessages.length > 0 ? onboardingMessages : undefined}
            onboardingChips={onboardingChips.length > 0 ? onboardingChips : undefined}
            onboardingInProgress={onboardingInProgress}
          />
        </div>

        {/* ── Floating Welly button (when closed) ─────────────────────── */}
        {!wellyOpen && (
          <button
            onClick={() => setWellyOpen(true)}
            className="fixed bottom-20 lg:bottom-6 right-4 z-50 w-12 h-12 bg-[#111827] text-white rounded-full shadow-lg flex items-center justify-center hover:bg-zinc-700 transition-colors"
            title="Open Welly"
          >
            <BotMessageSquare className="w-5 h-5" />
          </button>
        )}

        {/* ── Mobile bottom tab bar ─────────────────────────────────── */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E5E5E5]">
          <MobileNav wellyOpen={wellyOpen} onToggleWelly={() => setWellyOpen((o) => !o)} />
        </div>
      </div>
    </PortfolioProvider>
  );
}
