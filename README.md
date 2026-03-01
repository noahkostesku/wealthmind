# WealthMind

**AI-powered financial intelligence for Canadian investors.**

WealthMind is a multi-agent system that monitors a client's full financial profile — TFSA, RRSP, FHSA, non-registered, margin, crypto, and chequing — and surfaces ranked, dollar-quantified insights in real time. Five specialist LLM agents run in parallel via LangGraph, each analyzing a different financial domain. A synthesis layer merges their findings into plain-language recommendations delivered through "Welly," a conversational AI interface.

> No trades are executed. No money moves. The system surfaces intelligence. The human acts.

---

## Table of Contents

- [What It Does](#what-it-does)
- [System Architecture](#system-architecture)
- [LangGraph Agent Architecture](#langgraph-agent-architecture)
- [Agent Workflow Pipeline](#agent-workflow-pipeline)
- [Chat Pipeline (SSE Streaming)](#chat-pipeline-sse-streaming)
- [Cross-Referral System](#cross-referral-system)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [License](#license)

---

## What It Does

WealthMind ingests a Canadian investor's complete financial picture and answers one question: **"What should I do with my money right now?"**

The system:

- Runs **5 specialist agents in parallel** against live portfolio data and CRA tax rules
- Calculates **dollar-quantified impact** for every recommendation (e.g. "$4,297 RRSP tax refund")
- Ranks findings by urgency and dollar impact
- Delivers insights through **Welly**, a conversational AI that streams responses via SSE
- Supports **what-if scenario analysis** (e.g. "What if I contribute $5,000 to my RRSP?")
- Provides a full **portfolio management dashboard** with live prices via yfinance
- Simulates **buy/sell/deposit/withdraw/transfer/currency exchange** operations
- Tracks **CRA contribution room** for TFSA, RRSP, and FHSA with deadline awareness
- Computes **capital gains tax exposure** on non-registered positions in real time

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            WEALTHMIND                               │
├────────────────────────────┬────────────────────────────────────────┤
│          FRONTEND          │               BACKEND                  │
│          Next.js 16        │               FastAPI                  │
│                            │                                        │
│  ┌──────────────────────┐  │  ┌──────────────────────────────────┐  │
│  │  Dashboard           │  │  │         API Routes               │  │
│  │  Portfolio           │◄─┼──┤  /portfolio   /accounts          │  │
│  │  Accounts            │  │  │  /trade       /markets           │  │
│  │  Markets             │  │  │  /chat        /analyze           │  │
│  │  History             │  │  │  /fx          /health            │  │
│  └──────────────────────┘  │  └──────────────┬───────────────────┘  │
│                            │                 │                      │
│  ┌──────────────────────┐  │  ┌──────────────▼───────────────────┐  │
│  │  Welly Chat Panel    │◄─┼──┤       LangGraph Engine           │  │
│  │  (SSE Streaming)     │  │  │  Supervisor → Synthesis          │  │
│  │  Onboarding          │  │  │       → HITL → Stream            │  │
│  └──────────────────────┘  │  └──────────────┬───────────────────┘  │
│                            │                 │                      │
│  ┌──────────────────────┐  │  ┌──────────────▼───────────────────┐  │
│  │  Auth.js             │  │  │         Services Layer           │  │
│  │  Google OAuth        │  │  │  Portfolio · Prices · Trading    │  │
│  └──────────────────────┘  │  │  FX · CRA Rules                  │  │
│                            │  └──────────────┬───────────────────┘  │
│                            │                 │                      │
│                            │  ┌──────────────▼───────────────────┐  │
│                            │  │     SQLite + aiosqlite           │  │
│                            │  │  Users · Accounts · Positions    │  │
│                            │  │  Transactions · Conversations    │  │
│                            │  └──────────────────────────────────┘  │
└────────────────────────────┴────────────────────────────────────────┘
          External: Anthropic API  · yfinance · Google OAuth
```

---

## LangGraph Agent Architecture

```
                         ┌─────────────┐
                         │    START    │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │  SUPERVISOR │
                         └──────┬──────┘
                                │
          ┌──────────┬──────────┼──────────┬──────────┐
          │          │          │          │          │
   ┌──────▼─────┐ ┌──▼─────┐ ┌─▼──────┐ ┌─▼──────┐ ┌─▼──────┐
   │ Allocation │ │  Tax   │ │  TLH   │ │  Rate  │ │ Timing │
   │   Agent    │ │ Agent  │ │ Agent  │ │  Arb.  │ │ Agent  │
   └──────┬─────┘ └──┬─────┘ └─┬──────┘ └─┬──────┘ └─┬──────┘
          │          │         │          │          │
          └──────────┴─────────┴──────────┴──────────┘
                                │
                   (asyncio.gather — all run in parallel)
                                │
                         ┌──────▼──────┐
                         │    MERGE    │
                         │  domain_    │
                         │  findings   │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │  SYNTHESIS  │
                         │ Deduplicate │
                         │  Rank by $  │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │    HITL     │
                         │ Human-in-   │
                         │  the-Loop   │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │     END     │
                         └─────────────┘
```

### Agent Domain Grid

```
┌──────────────────┬──────────────────────────────────────────────────────┐
│      AGENT       │                    RESPONSIBILITY                    │
├──────────────────┼──────────────────────────────────────────────────────┤
│  Allocation      │  TFSA/RRSP/FHSA contribution room analysis           │
│                  │  Cash placement optimization                         │
│                  │  Registered account gap detection                    │
│                  │  Idle cash identification                            │
├──────────────────┼──────────────────────────────────────────────────────┤
│  Tax             │  Capital gains tax consequences of trades            │
│  Implications    │  Tax exposure on unrealized gains                    │
│                  │  CRA inclusion rate calculations                     │
│                  │  Marginal rate impact analysis                       │
├──────────────────┼──────────────────────────────────────────────────────┤
│  TLH             │  Tax-loss harvesting opportunities                   │
│  (Harvesting)    │  Unrealized losses eligible for harvest              │
│                  │  Superficial loss rule awareness (30-day)            │
│                  │  Wash sale avoidance                                 │
├──────────────────┼──────────────────────────────────────────────────────┤
│  Rate            │  Margin interest vs cash savings rate                │
│  Arbitrage       │  Capital inefficiency detection                      │
│                  │  Debt cost vs opportunity cost analysis              │
│                  │  6.2% margin vs 2.5% chequing arbitrage              │
├──────────────────┼──────────────────────────────────────────────────────┤
│  Timing          │  RRSP contribution deadline awareness                │
│                  │  Tax-year-end opportunities                          │
│                  │  Time-sensitive financial actions                    │
│                  │  Seasonal optimization windows                       │
└──────────────────┴──────────────────────────────────────────────────────┘
```

---

## Agent Workflow Pipeline

### Full Analysis Pipeline (`POST /analyze`)

```
Client Request
      │
      ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Load Live      │────▶│  Build Graph    │────▶│   Supervisor    │
│  Portfolio      │     │  State          │     │   Node          │
│  Snapshot       │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                          │
                          ┌──────────┬──────────┬─────────┼─────────┬
                          │          │          │         │         │          
                     ┌────▼────┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
                     │ Alloc-  │ │  Tax  │ │  TLH  │ │ Rate  │ │Timing │
                     │  ation  │ │       │ │       │ │  Arb. │ │       │
                     └────┬────┘ └───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘
                          │          │          │         │        │
                          │     Each agent:     │         │        │
                          │     1. Load prompt  │         │        │
                          │     2. Inject data  │         │        │
                          │     3. Call Claude  │         │        │
                          │     4. Parse JSON   │         │        │
                          └──────────┴──────────┴─────────┴────────┘
                                                │
                          ┌─────────────────────▼───────────────────────┐
                          │          Merge domain_findings              │
                          └─────────────────────┬───────────────────────┘
                                                │
                          ┌─────────────────────▼───────────────────────┐
                          │  Synthesis Node                             │
                          │  • Validate required keys                   │
                          │  • Deduplicate by title                     │
                          │  • Rank by dollar_impact DESC               │
                          └─────────────────────┬───────────────────────┘
                                                │
                          ┌─────────────────────▼───────────────────────┐
                          │  HITL Node                                  │
                          │  • Status: "surfaced"                       │
                          │  • Insights ready for human review          │
                          └─────────────────────┬───────────────────────┘
                                                │
                          ┌─────────────────────▼───────────────────────┐
                          │  WebSocket Broadcast                        │
                          │  • Push ranked insights to frontend         │
                          └─────────────────────────────────────────────┘
```

---

## Chat Pipeline (SSE Streaming)

```
User Message
      │
      ▼
┌─────────────────────┐
│  Conversation       │──── SSE: "routing" ────────────────▶ Frontend
│  Router             │
│  (Claude call)      │
│                     │
│  Decides:           │
│  • which agents     │
│  • can answer from  │
│    context?         │
└──────────┬──────────┘
           │
    ┌──────▼──────────────────────────────────────┐
    │         Can answer from context?            │
    └──────────┬───────────────────────┬──────────┘
               │ YES                   │ NO
               ▼                       ▼
    ┌──────────────────┐   ┌───────────────────────────┐
    │  Return direct   │   │  SSE: "agent_start" (×N)  │
    │  response        │   │  SSE: "handoff" (×N)      │
    │  SSE: "response" │   └─────────────┬─────────────┘
    └──────────────────┘                 │
                                         ▼
                             ┌───────────────────────────┐
                             │  Run agents in parallel   │
                             │  (asyncio.gather)         │
                             └─────────────┬─────────────┘
                                           │
                                SSE: "agent_complete" (×N)
                                           │
                             ┌─────────────▼─────────────┐
                             │  Synthesize Response      │
                             │  (Claude call)            │
                             │  • Enforces <60 words     │
                             │  • Dollar figures only    │
                             │  • No process talk        │
                             └─────────────┬─────────────┘
                                           │
                                    SSE: "response"
                                           │
                             ┌─────────────▼─────────────┐
                             │  Cross-Referral Check     │
                             │  (up to 2 auto-refs)      │
                             │  Evaluates: would another │
                             │  agent add value?         │
                             └─────────────┬─────────────┘
                                           │
                       SSE: "handoff" + "auto_referral_response"
                                           │
                             ┌─────────────▼─────────────┐
                             │  Follow-Up Chips          │
                             │  (2–3 suggestions)        │
                             │  with real $ figures      │
                             └─────────────┬─────────────┘
                                           │
                                    SSE: "follow_ups"
                                    SSE: "done"
```

---

## Cross-Referral System

After every agent response, WealthMind evaluates whether additional agents should automatically run:

```
┌──────────────────┬──────────────────────────────────────────────────────┐
│   Source Agent   │           Candidate Agents to Auto-Invoke            │
├──────────────────┼──────────────────────────────────────────────────────┤
│  Allocation      │  Timing, Rate Arbitrage                              │
│  Tax Implic.     │  TLH, Timing                                         │
│  TLH             │  Tax Implications, Timing                            │
│  Rate Arbitrage  │  Allocation                                          │
│  Timing          │  Allocation, Tax Implications                        │
│  Direct Response │  All 5 agents (evaluated individually)               │
└──────────────────┴──────────────────────────────────────────────────────┘
```

Max auto-referrals per turn: **2**. Each candidate is evaluated by Claude for relevance before invocation.

---

## Tech Stack

### Frontend

| Technology           | Purpose                              |
|----------------------|--------------------------------------|
| Next.js 16           | React framework with App Router      |
| React 19             | UI library                           |
| TypeScript           | Type safety                          |
| Tailwind CSS 4       | Utility-first styling                |
| shadcn/ui            | UI component primitives (Radix UI)   |
| Recharts             | Portfolio charts and visualizations  |
| Lucide React         | Icon system                          |
| Auth.js (NextAuth)   | Google OAuth authentication          |
| SSE (EventSource)    | Real-time chat streaming             |

### Backend

| Technology              | Purpose                              |
|-------------------------|--------------------------------------|
| FastAPI                 | Async Python web framework           |
| LangGraph               | Multi-agent orchestration graph      |
| LangChain Anthropic     | Claude API integration               |
| Claude Sonnet 4.6       | LLM for all agent reasoning          |
| SQLAlchemy 2.0          | Async ORM (aiosqlite driver)         |
| SQLite                  | Database (zero-config, file-based)   |
| yfinance                | Live stock prices and market data    |
| SSE-Starlette           | Server-Sent Events for chat streaming|
| Uvicorn                 | ASGI server                          |
| Pydantic                | Request/response validation          |

### Infrastructure

| Technology  | Purpose                              |
|-------------|--------------------------------------|
| Railway     | Cloud deployment (both services)     |
| Nixpacks    | Build system                         |
| WebSockets  | Real-time insight broadcasting       |
| JWT (demo)  | Stateless auth token passing         |

---

## Project Structure

```
wealthmind/
├── backend/
│   ├── main.py                      # FastAPI app, CORS, JWT middleware, lifespan
│   ├── database.py                  # SQLAlchemy models, async engine, demo seeder
│   ├── api/
│   │   └── routes.py                # All REST + SSE + WebSocket endpoints
│   ├── graph/
│   │   ├── graph.py                 # LangGraph compilation (supervisor → synthesis → HITL)
│   │   ├── agents.py                # 5 domain agent functions (Claude calls)
│   │   ├── router.py                # Conversation router (intent classification)
│   │   ├── synthesizer.py           # Response synthesis + cross-referral + follow-up chips
│   │   ├── proactive.py             # Proactive greeting generation
│   │   ├── state.py                 # GraphState TypedDict
│   │   └── conversation_state.py    # ConversationState TypedDict
│   ├── services/
│   │   ├── portfolio.py             # Portfolio snapshots, tax exposure calculations
│   │   ├── prices.py                # yfinance wrapper with 60s cache
│   │   └── trading.py               # Simulated trade execution (buy/sell/deposit/withdraw/fx)
│   ├── prompts/
│   │   ├── allocation.txt           # Allocation agent system prompt
│   │   ├── tax_implications.txt     # Tax agent system prompt
│   │   ├── tlh.txt                  # Tax-loss harvesting agent prompt
│   │   ├── rate_arbitrage.txt       # Rate arbitrage agent prompt
│   │   ├── timing.txt               # Timing agent system prompt
│   │   ├── conversation_router.txt  # Router system prompt
│   │   ├── response_synthesizer.txt # Synthesizer system prompt
│   │   └── welly_persona.txt        # Welly personality definition
│   ├── data/
│   │   ├── demo_profile.json        # Synthetic client seed data
│   │   └── cra_rules_2024.json      # CRA tax rules injected into agents
│   ├── requirements.txt
│   └── railway.toml
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx               # Root layout with providers
│   │   ├── page.tsx                 # Landing page
│   │   ├── login/page.tsx           # Google OAuth login
│   │   ├── dashboard/page.tsx       # Portfolio dashboard
│   │   ├── portfolio/page.tsx       # Positions & trading
│   │   ├── accounts/page.tsx        # Account management
│   │   ├── markets/page.tsx         # Market search & quotes
│   │   └── history/page.tsx         # Transaction history
│   ├── components/
│   │   ├── AppShell.tsx             # Layout shell with sidebar + Welly panel
│   │   ├── Sidebar.tsx              # Navigation sidebar
│   │   ├── Providers.tsx            # Auth + context providers
│   │   ├── chat/
│   │   │   └── ChatPanel.tsx        # Welly conversational interface
│   │   ├── onboarding/
│   │   │   ├── IntroScreen.tsx      # First-time intro overlay
│   │   │   └── WellyIntro.tsx       # Programmatic onboarding sequence
│   │   ├── trading/
│   │   │   ├── TradeModal.tsx       # Buy/sell order modal
│   │   │   └── ExchangeModal.tsx    # Currency exchange modal
│   │   └── ui/                      # shadcn/ui primitives
│   ├── contexts/
│   │   └── PortfolioContext.tsx      # Global portfolio state
│   ├── lib/
│   │   ├── api.ts                   # API client (REST + SSE streaming)
│   │   ├── websocket.ts             # WebSocket client for insights
│   │   └── utils.ts                 # Utility functions
│   ├── types/
│   │   └── index.ts                 # TypeScript interfaces
│   ├── middleware.ts                # Auth middleware (route protection)
│   ├── package.json
│   └── railway.toml
│
├── CLAUDE.md                        # AI development guidelines
└── README.md
```

---

## Getting Started

### Prerequisites

- Python 3.14+
- Node.js 20+
- Anthropic API key
- Google OAuth credentials

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env file
echo "ANTHROPIC_API_KEY=your_key_here" > .env
echo "FRONTEND_URL=http://localhost:3000" >> .env

uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install

# Create .env.local file
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
echo "NEXTAUTH_SECRET=your_secret_here" >> .env.local
echo "NEXTAUTH_URL=http://localhost:3000" >> .env.local
echo "GOOGLE_CLIENT_ID=your_google_client_id" >> .env.local
echo "GOOGLE_CLIENT_SECRET=your_google_client_secret" >> .env.local

npm run dev
```

The backend auto-creates the SQLite database and seeds a demo user on first startup.

---

## Environment Variables

### Backend (`.env`)

| Variable         | Description                                              |
|------------------|----------------------------------------------------------|
| `ANTHROPIC_API_KEY` | Anthropic API key                                     |
| `DATABASE_URL`   | SQLite path                                              |
| `FRONTEND_URL`   | Frontend origin for CORS                                 |

### Frontend (`.env.local`)

| Variable                | Description                              |
|-------------------------|------------------------------------------|
| `NEXT_PUBLIC_API_URL`   | Backend API URL                          |
| `NEXTAUTH_SECRET`       | NextAuth session encryption secret       |
| `NEXTAUTH_URL`          | Canonical app URL                        |
| `GOOGLE_CLIENT_ID`      | Google OAuth client ID                   |
| `GOOGLE_CLIENT_SECRET`  | Google OAuth client secret               |

---

## License

© Noah Kostesku. All rights reserved.

This project and its source code are proprietary. No part of this codebase may be reproduced, distributed, or transmitted in any form without prior written permission from the author.
