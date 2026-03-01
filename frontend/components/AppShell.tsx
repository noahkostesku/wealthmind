"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { BotMessageSquare } from "lucide-react";
import { Sidebar, MobileNav } from "./Sidebar";
import { ChatPanel } from "./chat/ChatPanel";
import { PortfolioProvider } from "@/contexts/PortfolioContext";
import type { ReactNode } from "react";

const PUBLIC_PATHS = ["/login", "/"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [wellyOpen, setWellyOpen] = useState(true);

  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (isPublic || status === "loading" || !session) {
    return <div className="min-h-screen bg-[#FAFAFA]">{children}</div>;
  }

  return (
    <PortfolioProvider>
      <div className="flex h-screen overflow-hidden bg-[#FAFAFA]">
        {/* ── Left sidebar (desktop) ─────────────────────────────────── */}
        <div className="hidden lg:flex flex-col w-56 fixed inset-y-0 left-0 z-30 flex-shrink-0">
          <Sidebar wellyOpen={wellyOpen} onToggleWelly={() => setWellyOpen((o) => !o)} />
        </div>

        {/* ── Main content ───────────────────────────────────────────── */}
        <main
          className={`flex-1 overflow-y-auto lg:ml-56 pb-16 lg:pb-0 transition-all duration-300 ${
            wellyOpen ? "lg:mr-96" : "lg:mr-0"
          }`}
        >
          {children}
        </main>

        {/* ── Mobile backdrop ────────────────────────────────────────── */}
        {wellyOpen && (
          <div
            className="lg:hidden fixed inset-0 z-30 bg-black/40"
            onClick={() => setWellyOpen(false)}
          />
        )}

        {/* ── Welly panel (all screen sizes) ─────────────────────────── */}
        <div
          className={`fixed inset-y-0 right-0 z-40 w-full sm:w-96 flex flex-col transition-transform duration-300 ease-in-out ${
            wellyOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <ChatPanel onClose={() => setWellyOpen(false)} />
        </div>

        {/* ── Floating Welly button (when closed) ────────────────────── */}
        {!wellyOpen && (
          <button
            onClick={() => setWellyOpen(true)}
            className="fixed bottom-20 lg:bottom-6 right-4 z-50 w-12 h-12 bg-[#111827] text-white rounded-full shadow-lg flex items-center justify-center hover:bg-zinc-700 transition-colors"
            title="Open Welly"
          >
            <BotMessageSquare className="w-5 h-5" />
          </button>
        )}

        {/* ── Mobile bottom tab bar ──────────────────────────────────── */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E5E5E5]">
          <MobileNav wellyOpen={wellyOpen} onToggleWelly={() => setWellyOpen((o) => !o)} />
        </div>
      </div>
    </PortfolioProvider>
  );
}
