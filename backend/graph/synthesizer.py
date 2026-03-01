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

_CHIP_SYSTEM_PROMPT = """You are generating follow-up question suggestions for a financial intelligence app.
Based on the user's question, the assistant's response, and the underlying agent findings,
generate exactly 2-3 specific follow-up questions the user might want to ask next.

Rules:
- Include real dollar figures from the findings where possible
- Each question should be a natural follow-up to the current response
- Keep each question under 70 characters
- Return ONLY a JSON array of strings: ["Question 1?", "Question 2?", "Question 3?"]"""


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8")


async def synthesize_response(
    user_message: str,
    findings: dict,
    history: list[dict],
) -> str:
    """
    Synthesize agent domain_findings into a conversational response.

    Args:
        user_message: The user's question.
        findings: dict keyed by domain (allocation, tax, tlh, rates, timing)
                  each value is a list of finding objects.
        history: Recent conversation messages for context.

    Returns:
        Plain text answer.
    """
    system_prompt = _load_prompt("response_synthesizer.txt")

    recent_history = history[-6:] if len(history) > 6 else history

    user_content = json.dumps(
        {
            "user_message": user_message,
            "agent_findings": findings,
            "recent_history": recent_history,
        },
        indent=2,
    )

    llm = ChatAnthropic(model=_MODEL, max_tokens=1024)

    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_content),
            ]
        )
        response_text = response.content.strip()

        # Enforce brevity: if over 80 words, make a second call to trim
        if len(response_text.split()) > 80:
            try:
                trim_llm = ChatAnthropic(model=_MODEL, max_tokens=256)
                trimmed = await trim_llm.ainvoke(
                    [
                        SystemMessage(
                            content=(
                                "You are a text editor. Shorten the following to under 60 words "
                                "while keeping all specific dollar figures. Remove any explanation "
                                "of process. Just the insight and the action. "
                                "Return only the shortened text, nothing else."
                            )
                        ),
                        HumanMessage(content=response_text),
                    ]
                )
                response_text = trimmed.content.strip()
            except Exception as trim_exc:
                logger.warning("Response trimming failed: %s", trim_exc)

        return response_text
    except Exception as exc:
        logger.error("Response synthesizer failed: %s", exc)
        return "I encountered an issue analysing your request. Please try again."


async def generate_follow_up_chips(
    user_message: str,
    response: str,
    findings: dict,
) -> list[str]:
    """
    Generate 2-3 specific follow-up question chips with real numbers from findings.

    Example output: ["What's the refund if I contribute $10,000 instead of $14,500?"]
    """
    user_content = json.dumps(
        {
            "user_message": user_message,
            "assistant_response": response,
            "findings_context": findings,
        },
        indent=2,
    )

    llm = ChatAnthropic(model=_MODEL, max_tokens=256)

    try:
        resp = await llm.ainvoke(
            [
                SystemMessage(content=_CHIP_SYSTEM_PROMPT),
                HumanMessage(content=user_content),
            ]
        )
        raw = resp.content.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        chips = json.loads(raw.strip())
        if isinstance(chips, list):
            return [str(c) for c in chips[:3]]
        return []
    except Exception as exc:
        logger.error("Follow-up chip generation failed: %s", exc)
        return []
