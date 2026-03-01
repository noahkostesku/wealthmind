import json
import logging
from pathlib import Path

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
_MODEL = "claude-sonnet-4-6"

_ALL_AGENTS = ["allocation", "tax_implications", "tlh", "rate_arbitrage", "timing"]


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8")


async def conversation_router(
    message: str,
    history: list[dict],
    last_findings: dict,
) -> dict:
    """
    Route user message to appropriate domain agents.

    Returns:
    {
        "agents_to_invoke": [...],
        "routing_reasoning": "...",
        "can_answer_from_context": bool,
        "direct_response": str | null
    }
    """
    system_prompt = _load_prompt("conversation_router.txt")

    # Inject last 6 messages and a summary of last_findings
    recent_history = history[-6:] if len(history) > 6 else history

    # Summarise findings to avoid huge payloads — first finding per domain only
    findings_summary: dict = {}
    for domain, findings in last_findings.items():
        if domain == "greeting_data":
            continue
        if isinstance(findings, list) and findings:
            findings_summary[domain] = findings[:1]

    user_content = json.dumps(
        {
            "user_message": message,
            "conversation_history": recent_history,
            "last_findings_summary": findings_summary,
        },
        indent=2,
    )

    llm = ChatAnthropic(model=_MODEL, max_tokens=512)

    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_content),
            ]
        )
        raw = response.content
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())
        # Normalise key name in case model uses old "reasoning" field
        if "reasoning" in result and "routing_reasoning" not in result:
            result["routing_reasoning"] = result.pop("reasoning")
        return result
    except Exception as exc:
        logger.error("Conversation router failed: %s", exc)
        return {
            "agents_to_invoke": _ALL_AGENTS,
            "routing_reasoning": "fallback: router error, invoking all agents",
            "can_answer_from_context": False,
            "direct_response": None,
        }
