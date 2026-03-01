"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Send, BotMessageSquare, X, Check } from "lucide-react";
import { createChatSession, streamChatMessage } from "@/lib/api";
import type { ChatSession } from "@/types";
import { AGENT_CAPABILITIES } from "@/components/onboarding/WellyIntro";
import type { WellyMessage } from "@/components/onboarding/WellyIntro";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReferralSuggestion {
  agent: string;
  reason: string;
}

interface UIMessage {
  id: string;
  role: "user" | "assistant";
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
  const parts = clean.split(/(\$[\d,]+(?:\.\d{2})?)/g);
  return parts.map((part, i) =>
    /^\$[\d,]/.test(part) ? (
      <strong key={i} className="text-[#16A34A] font-semibold">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
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
}

function MessageBubble({ msg, onChip, onReferral }: MessageBubbleProps) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] bg-[#111827] text-white text-sm leading-relaxed rounded-2xl rounded-tr-sm px-4 py-2.5">
          {msg.content}
        </div>
      </div>
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
      <div
        className={`max-w-[92%] bg-white border rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-[#111827] leading-relaxed shadow-sm ${
          msg.isProactive
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
}

export function ChatPanel({
  onClose,
  onboardingMessages,
  onboardingChips,
  onboardingInProgress,
}: ChatPanelProps) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [agentCards, setAgentCards] = useState<AgentCard[]>([]);
  const [thinkingFading, setThinkingFading] = useState(false);
  const [headerStatus, setHeaderStatus] = useState<HeaderStatus>("");
  const [initError, setInitError] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingChipsRef = useRef<string[] | null>(null);
  const animatingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionInitedRef = useRef(false);
  // Tracks the most recent assistant message ID so chips always land on the last response
  const currentResponseIdRef = useRef<string>("");

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
            agent_sources: sess.agent_sources,
            isProactive: true,
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentCards, streaming]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
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
      setAgentCards([]);
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
          } else if (ev.type === "handoff") {
            setAgentCards((prev) => [
              ...prev,
              {
                id: ev.agent as string,
                agent: ev.agent as string,
                message: ev.message as string,
                done: false,
              },
            ]);
            setHeaderStatus("agents");
          } else if (ev.type === "agent_start") {
            setActiveAgents((prev) => [...prev, ev.agent as string]);
          } else if (ev.type === "agent_complete") {
            setActiveAgents((prev) =>
              prev.filter((a) => a !== (ev.agent as string))
            );
            setAgentCards((prev) =>
              prev.map((c) =>
                c.id === (ev.agent as string) ? { ...c, done: true } : c
              )
            );
          } else if (ev.type === "response") {
            setHeaderStatus("synthesizing");
            setThinkingFading(true);
            fadeTimerRef.current = setTimeout(() => {
              setAgentCards([]);
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
            if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = setTimeout(() => {
              setAgentCards([]);
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
        setAgentCards([]);
        setThinkingFading(false);
        setHeaderStatus("");
      }
    },
    [session, streaming]
  );

  function handleReferral(agent: string) {
    const agentName = AGENT_FULL_NAMES[agent] ?? agent;
    send(`Ask the ${agentName} agent about this`);
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
    const runningNames = agentCards
      .filter((c) => !c.done)
      .map((c) => AGENT_LABELS[c.agent] ?? c.agent);
    headerStatusText =
      runningNames.length > 0 ? runningNames.join(" · ") : "Running agents...";
  } else if (headerStatus === "synthesizing") {
    headerStatusText = "Synthesizing...";
  }

  const showThinkingDots =
    streaming && agentCards.length > 0 && !thinkingFading;

  const canSend = !streaming && !!input.trim() && !onboardingInProgress;

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
              <MessageBubble key={msg.id} msg={msg} onChip={send} onReferral={handleReferral} />
            ))}

            <AgentThinkingIndicator cards={agentCards} fading={thinkingFading} />
            {showThinkingDots && <WellyThinkingDots />}
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
          disabled={streaming || initError || onboardingInProgress}
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
