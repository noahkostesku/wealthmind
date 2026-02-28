# WealthMind

## What This Is
A demo for a Wealthsimple AI Builder application.
A parallel multi-agent LangGraph system that monitors a synthetic
Canadian client's full financial profile and surfaces ranked,
dollar-quantified intelligence. No transactions are executed.
The system surfaces intelligence. The human acts.

## Stack
- Frontend: Next.js 14, Tailwind, shadcn/ui, Auth.js (Google OAuth)
- Backend: FastAPI (Python), LangGraph, SQLite
- AI: claude-sonnet-4-6 via Anthropic API for all agent nodes
- Realtime: WebSockets for streaming insights to frontend
- Hosting: Railway

## Architecture
Five domain agents run in parallel via LangGraph supervisor:
Tax Agent → Allocation Agent → TLH Agent → Rate Agent → Timing Agent
All feed into Synthesis Agent → HITL interrupt → frontend WebSocket stream

## Key Files
- backend/graph/agents.py — all LangGraph agent nodes
- backend/graph/graph.py — LangGraph graph definition and supervisor
- backend/data/cra_rules_2024.json — injected into every agent prompt
- backend/data/demo_profile.json — synthetic client seed data
- frontend/components/InsightCard.tsx — core UI component
- frontend/app/dashboard/page.tsx — intelligence board

## Agent Output Schema (enforce this always)
Every agent returns ONLY this JSON shape — no exceptions:
{
  "findings": [
    {
      "title": string,
      "dollar_impact": number,
      "impact_direction": "save" | "earn" | "avoid",
      "urgency": "immediate" | "this_month" | "evergreen",
      "reasoning": string (2-3 sentences, specific numbers),
      "confidence": "high" | "medium" | "low",
      "what_to_do": string (one specific action)
    }
  ]
}

## Hard Rules
- Backend: always async/await in FastAPI routes
- Agents return structured JSON only — no prose in agent layer
- Every dollar figure must derive from input data — never fabricated
- SQLite only — no other database
- No RAG, no vector DB, no ML classifier
- Agent prompts live in separate files in backend/prompts/ not hardcoded
- No transaction execution of any kind
- Before creating a new file that replaces an existing one: verify the old
  file has no imports or dependencies pointing to it, confirm nothing in the
  codebase references it, delete the old file first, then create the new one.
  Never leave orphaned files.

## Wealthsimple Product Context (agents must understand this)
- Accounts are either managed (Wealthsimple controls allocation) or
  self-directed (client controls). This determines what intelligence
  is relevant — never suggest tax-loss harvesting on a managed account,
  Wealthsimple handles that automatically
- Client tiers: Core (<$100k), Premium ($100k-$500k), Generation ($500k+)
  The demo profile is Premium tier — all insights must be appropriate
  for this tier and not reference Generation-only features
- FHSA is a Wealthsimple priority product — if client is eligible and
  hasn't opened one, this is always a high-urgency, high-impact finding
- Chequing earns 2.5% interest — use this as the baseline when
  calculating rate arbitrage against margin (currently 6.2%)
- Crypto is a separate account product from self-directed investing —
  treat it as its own account type in all agent reasoning
- All Canadian tickers use .TO suffix (e.g. SHOP.TO, CNQ.TO, XEQT.TO)
- Dollar figures should always be in CAD unless explicitly noted

## What We Are NOT Building
- Real Wealthsimple API connection (synthetic data only)
- File upload system
- ML document classifier (that was a different project)
- Any system that moves money or executes trades

## Build Order
1. SQLite schema + database layer
2. FastAPI skeleton with WebSocket
3. Data loading (demo profile + CRA rules)
4. Allocation Agent (simplest — start here)
5. Full graph with just Allocation Agent working end-to-end
6. Remaining 4 agents one by one
7. Synthesis agent
8. HITL interrupt + WebSocket streaming
9. Frontend dashboard + insight board
10. Auth (add last)
11. Polish
