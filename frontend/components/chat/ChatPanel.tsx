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

// ─── Types ──────────────────────────────────────────────────────────────────

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  agent_sources?: string[];
  follow_up_chips?: string[];
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

interface MessageBubbleProps {
  msg: UIMessage;
  onChip: (text: string) => void;
}

function MessageBubble({ msg, onChip }: MessageBubbleProps) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] bg-[#111827] text-white text-sm leading-relaxed rounded-2xl rounded-tr-sm px-4 py-2.5">
          {msg.content}
        </div>
      </div>
    );
  }

  const isTyping = msg.streaming && !msg.content;
  const isAnimating = msg.streaming && !!msg.content;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="max-w-[92%] bg-white border border-[#E5E5E5] rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-[#111827] leading-relaxed shadow-sm">
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
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface ChatPanelProps {
  onClose?: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [agentCards, setAgentCards] = useState<AgentCard[]>([]);
  const [thinkingFading, setThinkingFading] = useState(false);
  const [headerStatus, setHeaderStatus] = useState<HeaderStatus>("");
  const [initError, setInitError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingChipsRef = useRef<string[] | null>(null);
  const animatingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    createChatSession()
      .then((sess) => {
        setSession(sess);
        setMessages([
          {
            id: "greeting",
            role: "assistant",
            content: sess.greeting,
            agent_sources: sess.agent_sources,
          },
        ]);
      })
      .catch(() => setInitError(true));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentCards, streaming]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  // Clean up fade timer on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!session || !text.trim() || streaming) return;

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
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

      try {
        await streamChatMessage(session.session_id, text.trim(), (ev) => {
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
            // Fade out thinking cards, then clear them after transition
            setThinkingFading(true);
            fadeTimerRef.current = setTimeout(() => {
              setAgentCards([]);
              setThinkingFading(false);
            }, 300);

            const fullText = ev.text as string;
            pendingChipsRef.current = null;
            animatingRef.current = true;

            // Chars per frame: target ~1.5s total regardless of length
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
          } else if (ev.type === "follow_ups") {
            const chips = ev.chips as string[];
            if (animatingRef.current) {
              pendingChipsRef.current = chips;
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstId ? { ...m, follow_up_chips: chips } : m
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

  // Header status line text
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

  // Show thinking dots when agents are running (between first handoff and response)
  const showThinkingDots =
    streaming && agentCards.length > 0 && !thinkingFading;

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
              <MessageBubble key={msg.id} msg={msg} onChip={send} />
            ))}

            {/* Agent thinking cards — shown while agents run, fade out on response */}
            <AgentThinkingIndicator cards={agentCards} fading={thinkingFading} />

            {/* Welly is thinking dots — shown while agents are active */}
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
          disabled={streaming || !session || initError}
          className="flex-1 resize-none rounded-xl border border-[#E5E5E5] px-3 py-2.5 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111827]/20 focus:border-[#111827] transition-all leading-snug"
          style={{ minHeight: "40px", maxHeight: "120px" }}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim() || !session}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-[#111827] text-white rounded-xl hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
