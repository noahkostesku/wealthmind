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


def _detect_repeat_question(message: str, history: list[dict]) -> bool:
    """
    Return True if the current message is semantically very similar to any of
    the last 3 user messages in history (Jaccard word-overlap >= 0.6).
    """
    past_user = [
        m["content"].lower().strip()
        for m in history
        if m.get("role") == "user"
    ][-3:]

    if not past_user:
        return False

    current_words = set(message.lower().split())
    if not current_words:
        return False

    for prev in past_user:
        prev_words = set(prev.split())
        if not prev_words:
            continue
        union = current_words | prev_words
        overlap = len(current_words & prev_words) / len(union)
        if overlap >= 0.6:
            return True
    return False


async def conversation_router(
    message: str,
    history: list[dict],
    last_findings: dict,
    page_context: dict | None = None,
    current_page: str | None = None,
    portfolio_snapshot: dict | None = None,
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

    repeat_question = _detect_repeat_question(message, history)

    # Inject last 6 messages and a summary of last_findings
    recent_history = history[-6:] if len(history) > 6 else history

    # Summarise findings to avoid huge payloads — first finding per domain only
    findings_summary: dict = {}
    for domain, findings in last_findings.items():
        if domain == "greeting_data":
            continue
        if isinstance(findings, list) and findings:
            findings_summary[domain] = findings[:1]

    payload: dict = {
        "user_message": message,
        "conversation_history": recent_history,
        "last_findings_summary": findings_summary,
    }
    if current_page or page_context:
        payload["page_context"] = {
            "current_page": current_page or "",
            **(page_context or {}),
        }

    if portfolio_snapshot:
        # Compact live snapshot — always more accurate than last_findings_summary
        payload["current_portfolio"] = {
            "total_value_cad": portfolio_snapshot.get("total_value_cad"),
            "total_gain_loss_cad": portfolio_snapshot.get("total_gain_loss_cad"),
            "contribution_room": portfolio_snapshot.get("contribution_room"),
            "margin": portfolio_snapshot.get("margin"),
            "accounts": [
                {
                    "account_type": a["account_type"],
                    "product_name": a.get("product_name", ""),
                    "balance_cad": a.get("balance_cad"),
                    "total_value_cad": a.get("total_value_cad"),
                    "contribution_room_remaining": a.get("contribution_room_remaining"),
                }
                for a in portfolio_snapshot.get("accounts", [])
            ],
            "positions_summary": [
                {
                    "ticker": p["ticker"],
                    "shares": p.get("shares"),
                    "current_value_cad": p.get("current_value_cad"),
                    "unrealized_gain_loss_cad": p.get("unrealized_gain_loss_cad"),
                    "unrealized_gain_loss_pct": p.get("unrealized_gain_loss_pct"),
                }
                for acct in portfolio_snapshot.get("accounts", [])
                for p in acct.get("positions", [])
            ],
        }

    user_content = json.dumps(payload, indent=2)

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
        result["repeat_question"] = repeat_question
        logger.info(
            "[ROUTER] agents=%s | web_search=%s | can_answer=%s | reasoning=%s",
            result.get("agents_to_invoke"),
            result.get("needs_web_search"),
            result.get("can_answer_from_context"),
            result.get("routing_reasoning"),
        )
        return result
    except Exception as exc:
        logger.error("Conversation router failed: %s", exc)
        return {
            "agents_to_invoke": _ALL_AGENTS,
            "routing_reasoning": "fallback: router error, invoking all agents",
            "can_answer_from_context": False,
            "direct_response": None,
            "repeat_question": repeat_question,
        }
