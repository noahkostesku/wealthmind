Audit all LangGraph agent nodes in backend/graph/agents.py.
For each agent, verify:
1. Returns JSON matching the schema in CLAUDE.md exactly
2. All required fields present (title, dollar_impact, impact_direction,
   urgency, reasoning, confidence, what_to_do)
3. No prose returned outside the JSON structure
4. Prompt file exists in backend/prompts/
5. Function is async
Report any violations. Fix them if found.
