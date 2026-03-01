import json
import logging
from pathlib import Path

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

_MODEL = "claude-sonnet-4-6"

_GREETING_SYSTEM_PROMPT = """You are Welly, a financial intelligence system.
Greet the user briefly. Do NOT give unsolicited financial advice, recommendations, or opportunities.

Rules:
- One sentence only — a warm, simple greeting
- You may reference their portfolio total at a high level (e.g., "Your portfolio is at $117K") but nothing more
- Do NOT suggest actions, opportunities, or strategies
- Do NOT mention specific stocks, contribution room, tax savings, or deadlines
- End with something like "What would you like to look at?" or "Ask me anything."
- Never say "As an AI"
- Do not start with "I"
- No markdown, no emojis """


async def generate_proactive_greeting(user_id: int, db) -> dict:
    """
    Generate a simple greeting using only the portfolio total.
    No agents are invoked — Welly only provides info when asked.

    Returns:
    {
        "message": str,
        "top_findings": [],
        "agent_sources": []
    }
    """
    from services.portfolio import get_portfolio_snapshot

    portfolio = await get_portfolio_snapshot(user_id, db)

    message = await _synthesize_greeting(portfolio)

    return {
        "message": message,
        "top_findings": [],
        "agent_sources": [],
    }


async def _synthesize_greeting(portfolio: dict) -> str:
    user_content = json.dumps(
        {
            "portfolio_summary": {
                "total_value_cad": portfolio.get("total_value_cad"),
            },
        },
        indent=2,
    )

    llm = ChatAnthropic(model=_MODEL, max_tokens=128)

    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=_GREETING_SYSTEM_PROMPT),
                HumanMessage(content=user_content),
            ]
        )
        return response.content.strip()
    except Exception as exc:
        logger.error("Proactive greeting synthesis failed: %s", exc)
        total = portfolio.get("total_value_cad", 0)
        return (
            f"Welcome back — your portfolio is at ${total:,.0f} CAD. "
            "Ask me anything."
        )
