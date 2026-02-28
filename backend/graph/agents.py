import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

from backend.graph.state import GraphState

# Load .env relative to this file's location (backend/.env)
load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
_MODEL = "claude-sonnet-4-6"


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8")


def _build_user_message(state: GraphState) -> str:
    return json.dumps(
        {
            "financial_profile": state["financial_profile"],
            "cra_rules": state["cra_rules"],
        },
        indent=2,
    )


async def _call_agent(prompt_file: str, state: GraphState, domain_key: str) -> dict:
    """Generic agent runner. Returns {domain_key: [findings...]} inside domain_findings."""
    system_prompt = _load_prompt(prompt_file)
    user_message = _build_user_message(state)

    llm = ChatAnthropic(model=_MODEL, max_tokens=2048)

    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_message),
            ]
        )
        raw = response.content
        # Strip markdown code fences if present
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())
        findings = result.get("findings", [])
    except Exception as exc:
        logger.error("Agent %s failed: %s", domain_key, exc)
        findings = []

    current = state.get("domain_findings") or {}
    current[domain_key] = findings
    return {"domain_findings": current}


async def allocation_agent(state: GraphState) -> dict:
    return await _call_agent("allocation.txt", state, "allocation")


async def tax_implications_agent(state: GraphState) -> dict:
    return await _call_agent("tax_implications.txt", state, "tax")


async def tlh_agent(state: GraphState) -> dict:
    return await _call_agent("tlh.txt", state, "tlh")


async def rate_arbitrage_agent(state: GraphState) -> dict:
    return await _call_agent("rate_arbitrage.txt", state, "rates")


async def timing_agent(state: GraphState) -> dict:
    return await _call_agent("timing.txt", state, "timing")
