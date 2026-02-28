Build a new LangGraph agent node for WealthMind.
Agent name: $ARGUMENTS
Requirements:
- Follow the agent output schema defined in CLAUDE.md exactly
- System prompt goes in backend/prompts/{agent-name}.txt
- Agent function goes in backend/graph/agents.py
- Must be async
- Must return structured JSON only — no prose
- Must include confidence scoring on every finding
- Never fabricate dollar figures — all numbers must derive from input data
- After building, write a quick test using the demo_profile.json and show output
