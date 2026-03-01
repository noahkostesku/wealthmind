"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Send, BotMessageSquare, X, Check, Bell } from "lucide-react";
import { createChatSession, clearChatSession, streamChatMessage, dismissMonitorAlert, getAdvisorReport } from "@/lib/api";
import type { ChatSession, MonitorAlertData } from "@/types";
import { AGENT_CAPABILITIES } from "@/components/onboarding/WellyIntro";
import type { WellyMessage } from "@/components/onboarding/WellyIntro";
import { MonitorAlertBubble } from "./MonitorAlert";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReferralSuggestion {
  agent: string;
  reason: string;
}

interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  type?: "orb";
  content: string;
  streaming?: boolean;
  agent_sources?: string[];
  follow_up_chips?: string[];
  /** amber left-border proactive insight style */
  isProactive?: boolean;
  /** structured capability-list render */
  isCapabilityList?: boolean;
  /** cross-agent referral suggestion from synthesizer */
  referral_suggestion?: ReferralSuggestion;
  /** monitor alert payload — renders MonitorAlertBubble */
  monitorAlert?: MonitorAlertData;
  /** advisor do-not-do — amber left border + "Worth noting" label */
  isAdvisorDoNotDo?: boolean;
  /** web search sources — rendered as clickable citation links */
  sources?: SearchSource[];
  // orb-specific fields (used when type === "orb")
  agent?: string;
  orbStatus?: "running" | "complete";
  fading?: boolean;
}

interface AgentCard {
  id: string;
  agent: string;
  message: string;
  done: boolean;
}

type HeaderStatus = "" | "routing" | "agents" | "synthesizing";

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  allocation: "Allocation",
  tax_implications: "Tax",
  tlh: "TLH",
  rate_arbitrage: "Rate",
  timing: "Timing",
  web_search: "Web",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/\\n/g, " ")
    .replace(/^---*\s*$/gm, "")
    .replace(/^\s*-\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatContent(text: string) {
  const clean = stripMarkdown(text);
  // Split on dollar amounts and markdown links [Title](url)
  const parts = clean.split(/(\$[\d,]+(?:\.\d{2})?|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if (/^\$[\d,]/.test(part)) {
      return (
        <strong key={i} className="text-[#16A34A] font-semibold">
          {part}
        </strong>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#2563EB] hover:underline text-xs"
        >
          [{linkMatch[1]}]
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function AgentPill({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-500">
      {AGENT_LABELS[name] ?? name}
    </span>
  );
}

function AgentThinkingIndicator({
  cards,
  fading,
}: {
  cards: AgentCard[];
  fading: boolean;
}) {
  if (cards.length === 0) return null;
  return (
    <div
      className={`flex flex-col gap-1.5 transition-opacity duration-300 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      {cards.map((card) => (
        <div
          key={card.id}
          className="bg-[#F3F4F6] rounded-lg px-3 py-2 flex items-center gap-2.5"
        >
          {card.done ? (
            <span className="w-3.5 h-3.5 rounded-full bg-[#16A34A] flex-shrink-0 flex items-center justify-center">
              <Check className="w-2 h-2 text-white" strokeWidth={3} />
            </span>
          ) : (
            <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-600 animate-spin flex-shrink-0" />
          )}
          <span className="text-xs text-[#6B7280]">{card.message}</span>
        </div>
      ))}
    </div>
  );
}

function WellyThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className="text-[11px] text-[#9CA3AF]">Welly is thinking</span>
      <span className="flex gap-0.5 items-center">
        <span className="w-1 h-1 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
        <span className="w-1 h-1 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
        <span className="w-1 h-1 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
      </span>
    </div>
  );
}

/** Structured agent-capability list (shown in Message 2 of WellyIntro) */
function CapabilityListBubble() {
  return (
    <div className="max-w-[92%] bg-white border border-[#E5E5E5] rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
      <p className="text-sm text-[#111827] mb-2.5">
        Here&apos;s what each agent looks for — in plain terms:
      </p>
      <div className="flex flex-col divide-y divide-zinc-100">
        {AGENT_CAPABILITIES.map(({ agent, desc }) => (
          <div key={agent} className="flex items-baseline gap-2 py-1.5 first:pt-0 last:pb-0">
            <span className="text-xs font-medium text-black w-20 flex-shrink-0">{agent}</span>
            <span className="text-xs text-gray-500">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const AGENT_FULL_NAMES: Record<string, string> = {
  allocation: "Allocation",
  tax_implications: "Tax",
  tlh: "Tax-Loss Harvesting",
  rate_arbitrage: "Rate Arbitrage",
  timing: "Timing",
};

function ReferralSuggestionCard({
  suggestion,
  onAskNow,
}: {
  suggestion: ReferralSuggestion;
  onAskNow: (agent: string) => void;
}) {
  const agentName = AGENT_FULL_NAMES[suggestion.agent] ?? suggestion.agent;
  return (
    <div className="max-w-[92%] border-l-4 border-blue-400 bg-blue-50 rounded-r-lg px-4 py-2 flex items-center justify-between gap-3">
      <p className="text-xs text-blue-700 leading-snug flex-1">
        The <span className="font-semibold">{agentName}</span> agent can go deeper on this.
        {suggestion.reason ? ` ${suggestion.reason}` : ""}
      </p>
      <button
        onClick={() => onAskNow(suggestion.agent)}
        className="flex-shrink-0 text-xs font-medium text-blue-700 border border-blue-300 bg-white hover:bg-blue-100 rounded-lg px-3 py-1 transition-colors"
      >
        Ask now
      </button>
    </div>
  );
}

interface MessageBubbleProps {
  msg: UIMessage;
  onChip: (text: string) => void;
  onReferral: (agent: string) => void;
  onDismissAlert: (alertId: number) => void;
}

function MessageBubble({ msg, onChip, onReferral, onDismissAlert }: MessageBubbleProps) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] bg-[#111827] text-white text-sm leading-relaxed rounded-2xl rounded-tr-sm px-4 py-2.5">
          {msg.content}
        </div>
      </div>
    );
  }

  // Agent orb — inline pulse pill in the message stream
  if (msg.type === "orb") {
    const isRunning = msg.orbStatus === "running";
    const agentLabel = AGENT_LABELS[msg.agent ?? ""] ?? msg.agent ?? "";
    return (
      <div
        className={`transition-opacity duration-300 ${
          msg.fading ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="rounded-full inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 shadow-sm">
          <span
            className={`w-2 h-2 rounded-full bg-green-500 flex-shrink-0 ${
              isRunning ? "animate-pulse" : ""
            }`}
          />
          {isRunning ? (
            <span className="text-sm text-gray-600">
              {msg.agent === "web_search" ? "Searching the web..." : `Referring to ${agentLabel} agent...`}
            </span>
          ) : (
            <span className="text-sm text-gray-400">{agentLabel}</span>
          )}
        </div>
      </div>
    );
  }

  // Monitor alert — special amber bordered bubble with chips
  if (msg.monitorAlert) {
    return (
      <MonitorAlertBubble
        alert={msg.monitorAlert}
        onTellMeMore={(ctx) => onChip(ctx)}
        onDismiss={onDismissAlert}
      />
    );
  }

  // Structured capability list
  if (msg.isCapabilityList) {
    return <CapabilityListBubble />;
  }

  const isTyping = msg.streaming && !msg.content;
  const isAnimating = msg.streaming && !!msg.content;

  return (
    <div className="flex flex-col gap-1.5">
      {msg.isAdvisorDoNotDo && (
        <span className="text-xs text-gray-400 ml-1">Worth noting</span>
      )}
      <div
        className={`max-w-[92%] bg-white border rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-[#111827] leading-relaxed shadow-sm ${
          msg.isProactive || msg.isAdvisorDoNotDo
            ? "border-amber-300 border-l-4 border-l-amber-400"
            : "border-[#E5E5E5]"
        }`}
      >
        {isTyping ? (
          <span className="inline-flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
          </span>
        ) : (
          <>
            {formatContent(msg.content)}
            {isAnimating && (
              <span className="inline-block w-0.5 h-3.5 bg-zinc-400 animate-pulse ml-0.5 align-middle rounded-full" />
            )}
          </>
        )}
      </div>

      {msg.agent_sources && msg.agent_sources.length > 0 && (
        <div className="flex flex-wrap gap-1 ml-1">
          {msg.agent_sources.map((src) => (
            <AgentPill key={src} name={src} />
          ))}
        </div>
      )}

      {msg.sources && msg.sources.length > 0 && !msg.streaming && (
        <div className="flex flex-col gap-1 ml-1 mt-1">
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Sources</span>
          {msg.sources.map((src, idx) => (
            <a
              key={idx}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 transition-colors"
            >
              <span className="flex-shrink-0 w-4 h-4 rounded bg-zinc-100 flex items-center justify-center mt-0.5">
                <span className="text-[9px] font-bold text-zinc-400">{idx + 1}</span>
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-[#111827] group-hover:text-[#2563EB] truncate transition-colors">
                  {src.title}
                </span>
                <span className="text-[10px] text-zinc-400 truncate">{new URL(src.url).hostname}</span>
              </span>
            </a>
          ))}
        </div>
      )}

      {msg.follow_up_chips && msg.follow_up_chips.length > 0 && (
        <div className="flex flex-col gap-1 ml-1 mt-0.5">
          {msg.follow_up_chips.map((chip) => (
            <button
              key={chip}
              onClick={() => onChip(chip)}
              className="text-left text-xs text-[#2563EB] hover:text-[#111827] px-3 py-1.5 rounded-lg border border-blue-100 hover:border-zinc-200 hover:bg-zinc-50 transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {msg.referral_suggestion && !msg.streaming && (
        <ReferralSuggestionCard
          suggestion={msg.referral_suggestion}
          onAskNow={onReferral}
        />
      )}
    </div>
  );
}

const ADVISOR_AGENT_ORDER = [
  "allocation",
  "tax_implications",
  "tlh",
  "rate_arbitrage",
  "timing",
];

function AdvisorOrbRow({ orbs, fading }: { orbs: string[]; fading: boolean }) {
  if (orbs.length === 0) return null;
  return (
    <div
      className={`flex flex-col gap-1.5 transition-opacity duration-300 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      {orbs.map((agent) => (
        <div
          key={agent}
          className="bg-[#F3F4F6] rounded-lg px-3 py-2 flex items-center gap-2.5"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-[#16A34A] ring-2 ring-[#16A34A]/40 animate-pulse flex-shrink-0" />
          <span className="text-xs text-[#6B7280]">
            <span className="font-medium text-[#111827]">
              {AGENT_LABELS[agent] ?? agent}
            </span>
            {" — "}Running full portfolio analysis...
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Agent Capability Popover ─────────────────────────────────────────────────

function AgentCapabilityPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-72 bg-white border border-[#E5E5E5] rounded-xl shadow-lg z-20 p-4"
      style={{ right: "0.5rem" }}
    >
      <p className="text-xs font-semibold text-[#111827] mb-3 uppercase tracking-wide">
        Welly&apos;s 5 Agents
      </p>
      <div className="flex flex-col divide-y divide-zinc-100">
        {AGENT_CAPABILITIES.map(({ agent, desc }) => (
          <div key={agent} className="flex items-baseline gap-2 py-2 first:pt-0 last:pb-0">
            <span className="text-xs font-medium text-black w-20 flex-shrink-0">{agent}</span>
            <span className="text-xs text-gray-500">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface ChatPanelProps {
  onClose?: () => void;
  /** Injected onboarding messages from WellyIntro */
  onboardingMessages?: WellyMessage[];
  /** Chips to pre-load (from WellyIntro proactive briefing) */
  onboardingChips?: string[];
  /** Whether onboarding is in progress (suppress auto-session creation) */
  onboardingInProgress?: boolean;
  /** Monitor alerts to inject — new items trigger injection */
  monitorAlerts?: MonitorAlertData[];
  /** Unread alert count for badge display */
  unreadAlertCount?: number;
}

export function ChatPanel({
  onClose,
  onboardingMessages,
  onboardingChips,
  onboardingInProgress,
  monitorAlerts,
  unreadAlertCount,
}: ChatPanelProps) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [thinkingFading, setThinkingFading] = useState(false);
  const [headerStatus, setHeaderStatus] = useState<HeaderStatus>("");
  const [initError, setInitError] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  // Advisor mode state
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorOrbs, setAdvisorOrbs] = useState<string[]>([]);
  const [advisorOrbsFading, setAdvisorOrbsFading] = useState(false);
  const advisorTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingChipsRef = useRef<string[] | null>(null);
  const animatingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionInitedRef = useRef(false);
  // Tracks the most recent assistant message ID so chips always land on the last response
  const currentResponseIdRef = useRef<string>("");
  // Always-current snapshot of messages (send() is memoized without messages in deps)
  const messagesRef = useRef<UIMessage[]>([]);
  // Alert IDs we've already sent an auto-dismiss call for (fire-once per alert)
  const autoDismissedRef = useRef<Set<number>>(new Set());

  // Normal session init — skipped if onboarding is active or if onboarding messages
  // were injected (WellyIntro already created the session for Message 3)
  const hasOnboardingContent =
    onboardingInProgress ||
    (onboardingMessages && onboardingMessages.length > 0);

  useEffect(() => {
    if (hasOnboardingContent) return;
    if (sessionInitedRef.current) return;
    sessionInitedRef.current = true;

    createChatSession()
      .then((sess) => {
        setSession(sess);
        setMessages([
          {
            id: "greeting",
            role: "assistant",
            content: sess.greeting,
          },
        ]);
      })
      .catch(() => setInitError(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOnboardingContent]);

  // Inject onboarding messages when they arrive
  useEffect(() => {
    if (!onboardingMessages || onboardingMessages.length === 0) return;
    setMessages(
      onboardingMessages.map((m) => ({
        id: m.id,
        role: "assistant" as const,
        content: m.content,
        isProactive: m.isProactive,
        isCapabilityList: m.isCapabilityList,
        agent_sources: m.agent_sources,
      }))
    );
  }, [onboardingMessages]);

  // Set onboarding chips on last message
  useEffect(() => {
    if (!onboardingChips || onboardingChips.length === 0) return;
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        follow_up_chips: onboardingChips,
      };
      return updated;
    });
  }, [onboardingChips]);

  // Inject monitor alerts into the chat stream
  // Track injected IDs to avoid duplicates
  const injectedAlertIds = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!monitorAlerts || monitorAlerts.length === 0) return;
    const newAlerts = monitorAlerts.filter(
      (a) => !injectedAlertIds.current.has(a.id)
    );
    if (newAlerts.length === 0) return;
    const alertMessages: UIMessage[] = newAlerts.map((a) => ({
      id: `monitor-${a.id}`,
      role: "assistant",
      content: a.message,
      monitorAlert: a,
    }));
    newAlerts.forEach((a) => injectedAlertIds.current.add(a.id));
    setMessages((prev) => [...prev, ...alertMessages]);
  }, [monitorAlerts]);

  // Keep messagesRef in sync so send() always sees current messages
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      advisorTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      // If session doesn't exist yet (onboarding just finished), create it silently
      let activeSession = session;
      if (!activeSession) {
        try {
          activeSession = await createChatSession();
          setSession(activeSession);
        } catch {
          return;
        }
      }

      if (!text.trim() || streaming) return;

      // ── welly-clear: reset conversation ──────────────────────────────
      if (text.trim().toLowerCase() === "welly-clear") {
        setMessages([]);
        setInput("");
        setSession(null);
        sessionInitedRef.current = false;
        pendingChipsRef.current = null;
        currentResponseIdRef.current = "";
        autoDismissedRef.current = new Set();
        // Delete old session from DB, then create a fresh one
        try {
          await clearChatSession();
          const fresh = await createChatSession();
          setSession(fresh);
          if (fresh.greeting) {
            setMessages([
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                content: fresh.greeting,
              },
            ]);
          }
        } catch {
          // session will be created on next message
        }
        return;
      }

      // Auto-dismiss any monitor alerts still in the thread when the user replies
      messagesRef.current
        .filter((m) => m.monitorAlert != null && !autoDismissedRef.current.has(m.monitorAlert!.id))
        .forEach((m) => {
          const id = m.monitorAlert!.id;
          autoDismissedRef.current.add(id);
          dismissMonitorAlert(id).catch(() => null);
        });

      const userMsg: UIMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text.trim(),
      };
      const asstId = `a-${Date.now()}`;
      const asstMsg: UIMessage = {
        id: asstId,
        role: "assistant",
        content: "",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, asstMsg]);
      setInput("");
      setStreaming(true);
      setActiveAgents([]);
      setThinkingFading(false);
      setHeaderStatus("");
      pendingChipsRef.current = null;
      animatingRef.current = false;
      currentResponseIdRef.current = asstId;
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

      try {
        await streamChatMessage(activeSession.session_id, text.trim(), (ev) => {
          if (ev.type === "routing") {
            setHeaderStatus("routing");
          } else if (ev.type === "web_search_start") {
            // Show a search orb in the message stream
            const searchOrbId = `orb-web_search-${Date.now()}`;
            setMessages((prev) => [
              ...prev,
              {
                id: searchOrbId,
                role: "assistant" as const,
                type: "orb" as const,
                content: "",
                agent: "web_search",
                orbStatus: "running" as const,
              },
            ]);
            setHeaderStatus("agents");
          } else if (ev.type === "web_search_complete") {
            // Mark search orb as complete
            setMessages((prev) =>
              prev.map((m) =>
                m.type === "orb" && m.agent === "web_search"
                  ? { ...m, orbStatus: "complete" as const }
                  : m
              )
            );
          } else if (ev.type === "sources") {
            // Attach web sources to the current response message
            const sources = ev.sources as SearchSource[];
            const targetId = currentResponseIdRef.current;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? { ...m, sources, agent_sources: [...(m.agent_sources || []), "web_search"] }
                  : m
              )
            );
          } else if (ev.type === "handoff") {
            const orbId = `orb-${ev.agent as string}-${Date.now()}`;
            setMessages((prev) => [
              ...prev,
              {
                id: orbId,
                role: "assistant" as const,
                type: "orb" as const,
                content: "",
                agent: ev.agent as string,
                orbStatus: "running" as const,
              },
            ]);
            setHeaderStatus("agents");
          } else if (ev.type === "agent_start") {
            setActiveAgents((prev) => [...prev, ev.agent as string]);
          } else if (ev.type === "agent_complete") {
            setActiveAgents((prev) =>
              prev.filter((a) => a !== (ev.agent as string))
            );
            setMessages((prev) =>
              prev.map((m) =>
                m.type === "orb" && m.agent === (ev.agent as string)
                  ? { ...m, orbStatus: "complete" as const }
                  : m
              )
            );
          } else if (ev.type === "response") {
            setHeaderStatus("synthesizing");
            setThinkingFading(true);
            setMessages((prev) =>
              prev.map((m) => (m.type === "orb" ? { ...m, fading: true } : m))
            );
            fadeTimerRef.current = setTimeout(() => {
              setMessages((prev) => prev.filter((m) => m.type !== "orb"));
              setThinkingFading(false);
            }, 300);

            const fullText = ev.text as string;
            pendingChipsRef.current = null;
            animatingRef.current = true;
            // Primary response always targets asstId
            currentResponseIdRef.current = asstId;

            const charsPerFrame = Math.max(2, Math.ceil(fullText.length / 90));
            let pos = 0;

            const tick = () => {
              pos = Math.min(pos + charsPerFrame, fullText.length);
              const partial = fullText.slice(0, pos);
              const done = pos >= fullText.length;

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstId
                    ? {
                        ...m,
                        content: partial,
                        streaming: !done,
                        ...(done && pendingChipsRef.current
                          ? { follow_up_chips: pendingChipsRef.current }
                          : {}),
                      }
                    : m
                )
              );

              if (!done) {
                requestAnimationFrame(tick);
              } else {
                animatingRef.current = false;
              }
            };

            requestAnimationFrame(tick);
          } else if (ev.type === "auto_referral_response") {
            // Auto-referral: add a new message bubble, fade agent cards
            const refText = ev.text as string;
            const refAgent = ev.agent as string;
            const refId = `a-${Date.now()}-ref-${refAgent}`;
            currentResponseIdRef.current = refId;

            setThinkingFading(true);
            setMessages((prev) =>
              prev.map((m) => (m.type === "orb" ? { ...m, fading: true } : m))
            );
            if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = setTimeout(() => {
              setMessages((prev) => prev.filter((m) => m.type !== "orb"));
              setThinkingFading(false);
            }, 300);

            const newMsg: UIMessage = {
              id: refId,
              role: "assistant",
              content: refText,
              streaming: false,
              agent_sources: [refAgent],
            };
            setMessages((prev) => [...prev, newMsg]);
          } else if (ev.type === "follow_ups") {
            const chips = ev.chips as string[];
            const targetId = currentResponseIdRef.current;
            if (animatingRef.current) {
              pendingChipsRef.current = chips;
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === targetId ? { ...m, follow_up_chips: chips } : m
                )
              );
            }
          } else if (ev.type === "done") {
            setHeaderStatus("");
          }
        });
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId
              ? {
                  ...m,
                  content: "Something went wrong. Please try again.",
                  streaming: false,
                }
              : m
          )
        );
      } finally {
        setStreaming(false);
        setActiveAgents([]);
        setMessages((prev) => prev.filter((m) => m.type !== "orb"));
        setThinkingFading(false);
        setHeaderStatus("");
      }
    },
    [session, streaming]
  );

  async function handleGetFullAdvice() {
    if (advisorLoading || streaming) return;

    setAdvisorLoading(true);
    setAdvisorOrbs([]);
    setAdvisorOrbsFading(false);

    // Clear any previous stagger timers
    advisorTimersRef.current.forEach(clearTimeout);
    advisorTimersRef.current = [];

    // Stagger orb appearance at 300ms intervals
    ADVISOR_AGENT_ORDER.forEach((agent, i) => {
      const t = setTimeout(() => {
        setAdvisorOrbs((prev) => [...prev, agent]);
      }, i * 300);
      advisorTimersRef.current.push(t);
    });

    try {
      const report = await getAdvisorReport();

      // Clear stagger timers (likely already fired, but safety)
      advisorTimersRef.current.forEach(clearTimeout);
      advisorTimersRef.current = [];

      // Ensure all orbs shown before fading
      setAdvisorOrbs(ADVISOR_AGENT_ORDER);
      setAdvisorOrbsFading(true);

      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      setAdvisorOrbs([]);
      setAdvisorOrbsFading(false);

      // Message 1: headline
      const msg1: UIMessage = {
        id: `advisor-1-${Date.now()}`,
        role: "assistant",
        content: report.headline,
      };
      setMessages((prev) => [...prev, msg1]);

      // Message 2: full_picture (800ms gap)
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
      const msg2: UIMessage = {
        id: `advisor-2-${Date.now()}`,
        role: "assistant",
        content: report.full_picture,
      };
      setMessages((prev) => [...prev, msg2]);

      // Message 3: do_not_do (800ms gap) — amber border + "Worth noting" + chips
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
      const msg3: UIMessage = {
        id: `advisor-3-${Date.now()}`,
        role: "assistant",
        content: report.do_not_do,
        isAdvisorDoNotDo: true,
        follow_up_chips: report.chips || [],
      };
      setMessages((prev) => [...prev, msg3]);
    } catch {
      advisorTimersRef.current.forEach(clearTimeout);
      advisorTimersRef.current = [];
      setAdvisorOrbs([]);
      setAdvisorOrbsFading(false);
    } finally {
      setAdvisorLoading(false);
    }
  }

  function handleReferral(agent: string) {
    const agentName = AGENT_FULL_NAMES[agent] ?? agent;
    send(`Ask the ${agentName} agent about this`);
  }

  function handleDismissAlert(alertId: number) {
    setMessages((prev) =>
      prev.filter((m) => m.monitorAlert?.id !== alertId)
    );
  }

  function handleKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  let headerStatusText = "";
  if (headerStatus === "routing") {
    headerStatusText = "Routing your question...";
  } else if (headerStatus === "agents") {
    const runningNames = messages
      .filter((m) => m.type === "orb" && m.orbStatus === "running")
      .map((m) => AGENT_LABELS[m.agent ?? ""] ?? m.agent ?? "");
    headerStatusText =
      runningNames.length > 0 ? runningNames.join(" · ") : "Running agents...";
  } else if (headerStatus === "synthesizing") {
    headerStatusText = "Synthesizing...";
  }

  const showThinkingDots =
    streaming &&
    messages.some(
      (m) => m.type === "orb" && m.orbStatus === "running" && !m.fading
    ) &&
    !thinkingFading;

  const canSend = !streaming && !advisorLoading && !!input.trim() && !onboardingInProgress;

  return (
    <div className="flex flex-col h-full bg-white border-l border-[#E5E5E5]">
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-2.5 border-b border-[#E5E5E5] flex-shrink-0">
        <div className="relative">
          <BotMessageSquare className="w-5 h-5 text-[#111827]" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#16A34A] ring-2 ring-white" />
        </div>
        <div className="flex-1 flex flex-col justify-center gap-0.5">
          <span className="text-sm font-semibold text-[#111827] leading-none">
            Welly
          </span>
          {headerStatusText && (
            <span className="text-[10px] text-[#9CA3AF] leading-none">
              {headerStatusText}
            </span>
          )}
        </div>

        {/* Unread alert badge */}
        {unreadAlertCount != null && unreadAlertCount > 0 && (
          <div className="relative flex items-center">
            <Bell className="w-4 h-4 text-amber-500" />
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-400 text-white text-[9px] font-bold flex items-center justify-center leading-none">
              {unreadAlertCount > 9 ? "9+" : unreadAlertCount}
            </span>
          </div>
        )}

        {/* Get Full Advice button */}
        {!onboardingInProgress && (
          <button
            onClick={handleGetFullAdvice}
            disabled={advisorLoading || streaming}
            className="flex items-center gap-1.5 text-sm font-medium rounded-full bg-black text-white px-4 py-1.5 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {advisorLoading ? (
              <>
                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              "Get Full Advice"
            )}
          </button>
        )}

        {/* Agent capability tooltip trigger */}
        <div className="relative">
          <button
            onClick={() => setShowCapabilities((v) => !v)}
            className="px-2 py-1 rounded-lg text-[10px] font-medium text-[#9CA3AF] hover:text-[#111827] hover:bg-zinc-100 transition-colors leading-none"
            title="Agent Information"
            aria-label="Agent Information"
          >
            Agent Information
          </button>
          {showCapabilities && (
            <AgentCapabilityPopover onClose={() => setShowCapabilities(false)} />
          )}
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#111827] hover:bg-zinc-100 transition-colors"
            title="Close Welly"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {initError ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-[#6B7280]">
              Couldn&apos;t connect to Welly.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-[#2563EB] hover:underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onChip={send}
                onReferral={handleReferral}
                onDismissAlert={handleDismissAlert}
              />
            ))}

            {showThinkingDots && <WellyThinkingDots />}
            <AdvisorOrbRow orbs={advisorOrbs} fading={advisorOrbsFading} />
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-[#E5E5E5] flex-shrink-0 flex gap-2 items-end"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask Welly anything…"
          rows={1}
          disabled={streaming || advisorLoading || initError || onboardingInProgress}
          className="flex-1 resize-none rounded-xl border border-[#E5E5E5] px-3 py-2.5 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827] transition-all leading-snug"
          style={{ minHeight: "40px", maxHeight: "120px" }}
        />
        <button
          type="submit"
          disabled={!canSend}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-[#111827] text-white rounded-xl hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
