"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Sidebar, MobileNav } from "./Sidebar";
import { ChatPanel } from "./chat/ChatPanel";
import { IntroScreen } from "./onboarding/IntroScreen";
import { WellyIntro } from "./onboarding/WellyIntro";
import type { WellyMessage } from "./onboarding/WellyIntro";
import { PortfolioProvider } from "@/contexts/PortfolioContext";
import { PageContextProvider } from "@/lib/pageContext";
import { registerWellyControl } from "@/lib/pageContextStore";
import { getOnboardedStatus, completeOnboarding, getMonitorAlerts } from "@/lib/api";
import type { MonitorAlertData } from "@/types";
import type { ReactNode } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MONITOR_USER_ID = "1";
const LS_PANEL_KEY = "welly_panel_expanded";

const PUBLIC_PATHS = ["/login", "/"];
const LS_KEY = "wm_onboarded";

type OnboardPhase = "idle" | "intro" | "welly" | "done";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  // ── Panel state — persisted in localStorage ──────────────────────────────
  const [wellyExpanded, setWellyExpandedState] = useState(true);
  const [lsLoaded, setLsLoaded] = useState(false);

  // Load from localStorage once on mount (client-side only)
  useEffect(() => {
    const stored = localStorage.getItem(LS_PANEL_KEY);
    if (stored !== null) {
      setWellyExpandedState(stored === "true");
    }
    setLsLoaded(true);
  }, []);

  function setWellyExpanded(val: boolean) {
    setWellyExpandedState(val);
    localStorage.setItem(LS_PANEL_KEY, String(val));
  }

  // ── Welly prefill (for WellyCallout → ChatPanel) ─────────────────────────
  const [wellyPrefill, setWellyPrefill] = useState("");

  // Register welly control functions so WellyCallout can call them
  useEffect(() => {
    registerWellyControl(
      () => setWellyExpanded(true),
      (text) => {
        setWellyExpanded(true);
        setWellyPrefill(text);
      }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Onboarding ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<OnboardPhase>("idle");
  const [skipIntro, setSkipIntro] = useState(false);
  const [onboardingMessages, setOnboardingMessages] = useState<WellyMessage[]>([]);
  const [onboardingChips, setOnboardingChips] = useState<string[]>([]);
  const checkedRef = useRef(false);

  // ── Monitor alerts ────────────────────────────────────────────────────────
  const [monitorAlerts, setMonitorAlerts] = useState<MonitorAlertData[]>([]);
  // Live alerts: only from WebSocket (injected into chat). Initial fetch is badge-only.
  const [liveAlerts, setLiveAlerts] = useState<MonitorAlertData[]>([]);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isAuthenticated = !isPublic && status !== "loading" && !!session;

  // ── Check onboarding status ───────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || checkedRef.current) return;
    checkedRef.current = true;

    getOnboardedStatus()
      .then(({ onboarded }) => {
        if (onboarded) {
          localStorage.setItem(LS_KEY, "true");
          setPhase("done");
        } else {
          setPhase("intro");
          setWellyExpanded(true);
        }
      })
      .catch(() => {
        setPhase("done");
      });
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Monitor alerts: fetch + WebSocket ────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    getMonitorAlerts()
      .then((alerts) => {
        if (alerts.length > 0) {
          setMonitorAlerts(alerts);
          setUnreadAlertCount(alerts.length);
        }
      })
      .catch(() => null);

    const wsUrl = API_URL.replace(/^http/, "ws") + `/ws/monitor/${MONITOR_USER_ID}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;
        if (data.type === "monitor_alert") {
          const alert: MonitorAlertData = {
            id: data.id as number,
            alert_type: data.alert_type as string,
            message: data.message as string,
            ticker: (data.ticker as string | null | undefined) ?? null,
            dollar_impact: (data.dollar_impact as number | null | undefined) ?? null,
            created_at: data.created_at as string,
          };
          setMonitorAlerts((prev) => {
            if (prev.some((a) => a.id === alert.id)) return prev;
            return [...prev, alert];
          });
          // Live alerts go to chat — only WebSocket arrivals, not initial fetch
          setLiveAlerts((prev) => {
            if (prev.some((a) => a.id === alert.id)) return prev;
            return [...prev, alert];
          });
          // Increment unread badge when panel is collapsed
          if (!wellyExpanded) {
            setUnreadAlertCount((n) => n + 1);
          }
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = () => null;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Clear unread count when panel expands
  useEffect(() => {
    if (wellyExpanded) setUnreadAlertCount(0);
  }, [wellyExpanded]);

  // ── Onboarding callbacks ──────────────────────────────────────────────────
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

  // Wait for onboarding check before rendering the full app layout.
  // Prevents: (a) flash of main app before IntroScreen, and
  // (b) ChatPanel mounting early and creating a session with ghost messages.
  if (phase === "idle") {
    return <div className="min-h-screen bg-[#FAFAFA]" />;
  }

  const onboardingInProgress = phase === "intro" || phase === "welly";

  return (
    <PageContextProvider>
      <PortfolioProvider>
        <div className="flex h-screen overflow-hidden bg-[#FAFAFA]">

          {/* ── First-time intro overlay ─────────────────────────────────── */}
          {phase === "intro" && (
            <IntroScreen onDismiss={handleIntroDismiss} />
          )}

          {/* ── WellyIntro: feeds messages into chat ─────────────────────── */}
          {phase === "welly" && (
            <WellyIntro
              skipped={skipIntro}
              onAddMessage={handleAddMessage}
              onSetChips={handleSetChips}
            />
          )}

          {/* ── Left sidebar (desktop) ───────────────────────────────────── */}
          <div className="hidden lg:flex flex-col w-56 fixed inset-y-0 left-0 z-30 flex-shrink-0">
            <Sidebar wellyOpen={wellyExpanded} onToggleWelly={() => setWellyExpanded(!wellyExpanded)} />
          </div>

          {/* ── Main content ─────────────────────────────────────────────── */}
          <main
            className={`flex-1 overflow-y-auto lg:ml-56 pb-16 lg:pb-0 transition-all duration-200 ease-in-out ${
              wellyExpanded ? "lg:mr-96" : "lg:mr-12"
            }`}
          >
            {children}
          </main>

          {/* ── Mobile backdrop ──────────────────────────────────────────── */}
          {wellyExpanded && (
            <div
              className="lg:hidden fixed inset-0 z-30 bg-black/40"
              onClick={() => setWellyExpanded(false)}
            />
          )}

          {/* ── Desktop collapsed strip (w-12) — shown when !wellyExpanded ─ */}
          {/* Only rendered after localStorage has been read to avoid flash */}
          {lsLoaded && (
            <div
              className={`hidden lg:flex fixed inset-y-0 right-0 z-50 w-12 flex-col items-center justify-center bg-white border-l border-[#E5E5E5] cursor-pointer transition-opacity duration-200 ${
                wellyExpanded
                  ? "opacity-0 pointer-events-none"
                  : "opacity-100 pointer-events-auto"
              }`}
              onClick={() => setWellyExpanded(true)}
              title="Open Welly"
            >
              <div className="relative">
                <span className="w-7 h-7 rounded-full bg-[#16A34A] flex items-center justify-center ring-4 ring-[#16A34A]/20">
                  <span className="w-2.5 h-2.5 rounded-full bg-white" />
                </span>
                {unreadAlertCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none ring-2 ring-white">
                    {unreadAlertCount > 9 ? "9+" : unreadAlertCount}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Welly chat panel ─────────────────────────────────────────── */}
          {/* Always mounted to preserve conversation state; hidden via CSS  */}
          {/* Desktop: invisible+non-interactive when collapsed             */}
          {/* Mobile: slides in/out as a drawer                             */}
          {lsLoaded && (
            <div
              className={`fixed inset-y-0 right-0 z-40 w-full sm:w-96 flex flex-col transition-all duration-200 ease-in-out ${
                wellyExpanded
                  ? "translate-x-0"
                  : "translate-x-full lg:translate-x-0 lg:invisible lg:pointer-events-none"
              }`}
            >
              <ChatPanel
                onClose={() => setWellyExpanded(false)}
                onCollapse={() => setWellyExpanded(false)}
                externalInput={wellyPrefill}
                onExternalInputConsumed={() => setWellyPrefill("")}
                onboardingMessages={onboardingMessages.length > 0 ? onboardingMessages : undefined}
                onboardingChips={onboardingChips.length > 0 ? onboardingChips : undefined}
                onboardingInProgress={onboardingInProgress}
                monitorAlerts={liveAlerts.length > 0 ? liveAlerts : undefined}
                unreadAlertCount={unreadAlertCount}
                onBellClick={() => {
                  setWellyExpanded(true);
                  setUnreadAlertCount(0);
                }}
              />
            </div>
          )}

          {/* ── Mobile bottom tab bar ────────────────────────────────────── */}
          <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E5E5E5]">
            <MobileNav wellyOpen={wellyExpanded} onToggleWelly={() => setWellyExpanded(!wellyExpanded)} />
          </div>
        </div>
      </PortfolioProvider>
    </PageContextProvider>
  );
}
