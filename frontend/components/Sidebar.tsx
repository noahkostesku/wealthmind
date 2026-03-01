"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Briefcase,
  TrendingUp,
  Wallet,
  History,
  LogOut,
  BotMessageSquare,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/markets", label: "Markets", icon: TrendingUp },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/history", label: "History", icon: History },
];

interface SidebarProps {
  wellyOpen?: boolean;
  onToggleWelly?: () => void;
}

export function Sidebar({ wellyOpen, onToggleWelly }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const email = session?.user?.email ?? "";
  const initials = email.slice(0, 2).toUpperCase() || "WM";

  return (
    <aside className="flex flex-col h-full bg-white border-r border-[#E5E5E5]">
      {/* Wordmark */}
      <div className="h-14 flex items-center px-5 border-b border-[#E5E5E5] flex-shrink-0">
        <span className="text-[15px] font-semibold text-[#111827] tracking-tight">
          WealthMind
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-[#111827] text-white"
                  : "text-[#6B7280] hover:text-[#111827] hover:bg-zinc-100"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}

        {/* Welly toggle */}
        {onToggleWelly && (
          <button
            onClick={onToggleWelly}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full mt-1 ${
              wellyOpen
                ? "bg-green-50 text-green-700 border border-green-200"
                : "text-[#6B7280] hover:text-[#111827] hover:bg-zinc-100"
            }`}
          >
            <div className="relative flex-shrink-0">
              <BotMessageSquare className="w-4 h-4" />
              {wellyOpen && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
              )}
            </div>
            Welly
          </button>
        )}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-[#E5E5E5] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[#111827] flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-semibold text-white">
              {initials}
            </span>
          </div>
          <p className="flex-1 text-xs text-[#111827] truncate">{email}</p>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign out"
            className="text-[#6B7280] hover:text-[#111827] transition-colors p-1 rounded"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── Mobile bottom tab bar ────────────────────────────────────────────────────

interface MobileNavProps {
  wellyOpen?: boolean;
  onToggleWelly?: () => void;
}

export function MobileNav({ wellyOpen, onToggleWelly }: MobileNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center justify-around px-2 h-14">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors ${
              active ? "text-[#111827]" : "text-[#6B7280]"
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        );
      })}

      {/* Welly tab */}
      {onToggleWelly && (
        <button
          onClick={onToggleWelly}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors ${
            wellyOpen ? "text-green-600" : "text-[#6B7280]"
          }`}
        >
          <div className="relative">
            <BotMessageSquare className="w-5 h-5" />
            {wellyOpen && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
            )}
          </div>
          <span className="text-[10px] font-medium">Welly</span>
        </button>
      )}
    </nav>
  );
}
