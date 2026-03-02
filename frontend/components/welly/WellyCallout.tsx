"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { usePageContext } from "@/lib/pageContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface PageNoteResponse {
  has_note: boolean;
  note: string | null;
}

async function fetchPageNote(
  page: string,
  pageContext: Record<string, unknown>
): Promise<PageNoteResponse> {
  try {
    const res = await fetch(`${API_URL}/welly/page-note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, page_context: pageContext }),
    });
    if (!res.ok) return { has_note: false, note: null };
    return res.json() as Promise<PageNoteResponse>;
  } catch {
    return { has_note: false, note: null };
  }
}

export function WellyCallout() {
  const { currentPage, pageContext, expandWelly, prefillWelly } =
    usePageContext();
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const prevContextRef = useRef<string>("");

  // Reset on page navigation
  useEffect(() => {
    setNote(null);
    setDismissed(false);
    setVisible(false);
    prevContextRef.current = "";
  }, [currentPage]);

  // Refetch when page context changes (e.g. user clicks a position)
  useEffect(() => {
    const contextKey = JSON.stringify(pageContext);
    if (contextKey === prevContextRef.current) return;
    prevContextRef.current = contextKey;

    setNote(null);
    setVisible(false);

    fetchPageNote(currentPage, pageContext).then((res) => {
      if (res.has_note && res.note) {
        setNote(res.note);
        setDismissed(false);
        // Small delay so element exists before animating
        setTimeout(() => setVisible(true), 50);
      }
    });
  }, [currentPage, pageContext]);

  if (!note || dismissed) return null;

  function handleAskWelly() {
    expandWelly();
    prefillWelly(`Tell me more about: ${note}`);
  }

  return (
    <div
      className={`transition-all duration-200 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      }`}
    >
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm flex items-center gap-3">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
        <p className="text-sm text-gray-700 flex-1 leading-snug">{note}</p>
        <button
          onClick={handleAskWelly}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium flex-shrink-0 transition-colors whitespace-nowrap"
        >
          Ask Welly
        </button>
        <button
          onClick={() => {
            setVisible(false);
            setTimeout(() => setDismissed(true), 200);
          }}
          className="text-gray-400 hover:text-gray-600 transition-colors ml-1 flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
