import asyncio
import datetime
import json
import logging
import re
from pathlib import Path

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import select

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).parent.parent / "data"
_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
_MODEL = "claude-sonnet-4-6"
_CACHE_MINUTES = 10
_DOMAIN_LABELS = ["allocation", "tax_implications", "tlh", "rate_arbitrage", "timing"]


def _make_state(portfolio: dict, cra_rules: dict) -> dict:
    return {
        "financial_profile": portfolio,
        "cra_rules": cra_rules,
        "domain_findings": {},
        "synthesized_insights": [],
        "hitl_status": "pending",
        "run_id": "advisor",
    }


def _parse_xml_section(text: str, tag: str) -> str:
    match = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
    return match.group(1).strip() if match else ""


async def generate_advisor_report(user_id: int, db) -> dict:
    from database import AdvisorCache

    # 1. Check cache — return within 10 minutes
    cache_result = await db.execute(
        select(AdvisorCache)
        .where(AdvisorCache.user_id == user_id)
        .order_by(AdvisorCache.generated_at.desc())
        .limit(1)
    )
    cached = cache_result.scalar_one_or_none()
    if cached:
        age = datetime.datetime.utcnow() - cached.generated_at
        if age.total_seconds() < _CACHE_MINUTES * 60:
            return {
                "headline": cached.headline,
                "full_picture": cached.full_picture,
                "do_not_do": cached.do_not_do,
                "total_opportunity": cached.total_opportunity,
                "chips": cached.chips or [],
                "generated_at": cached.generated_at.isoformat(),
                "cached": True,
            }

    # 2. Get live data
    from services.portfolio import get_portfolio_snapshot

    portfolio = await get_portfolio_snapshot(user_id, db)
    cra_rules = json.loads((_DATA_DIR / "cra_rules_2024.json").read_text())

    # 3. Run all 5 agents in parallel
    from graph.agents import (
        allocation_agent,
        rate_arbitrage_agent,
        tax_implications_agent,
        timing_agent,
        tlh_agent,
    )

    results = await asyncio.gather(
        allocation_agent(_make_state(portfolio, cra_rules)),
        tax_implications_agent(_make_state(portfolio, cra_rules)),
        tlh_agent(_make_state(portfolio, cra_rules)),
        rate_arbitrage_agent(_make_state(portfolio, cra_rules)),
        timing_agent(_make_state(portfolio, cra_rules)),
        return_exceptions=True,
    )

    all_findings: list[dict] = []
    for i, result in enumerate(results):
        label = _DOMAIN_LABELS[i]
        if isinstance(result, Exception):
            logger.error("Advisor agent %s failed: %s", label, result)
            continue
        for findings in result.get("domain_findings", {}).values():
            for f in findings:
                f["_source"] = label
            all_findings.extend(findings)

    all_findings.sort(key=lambda f: float(f.get("dollar_impact", 0)), reverse=True)

    # 4. Build user message for Claude
    portfolio_summary = {
        "total_value_cad": portfolio.get("total_value_cad"),
        "accounts": [
            {
                "account_type": a.get("account_type"),
                "product_name": a.get("product_name"),
                "total_value_cad": a.get("total_value_cad"),
                "contribution_room_remaining": a.get("contribution_room_remaining"),
            }
            for a in portfolio.get("accounts", [])
        ],
    }
    user_content = json.dumps(
        {"agent_findings": all_findings[:10], "portfolio_summary": portfolio_summary},
        indent=2,
    )

    # 5. Call Claude with advisor_mode.txt system prompt
    system_prompt = (_PROMPTS_DIR / "advisor_mode.txt").read_text(encoding="utf-8")
    llm = ChatAnthropic(model=_MODEL, max_tokens=1024)

    try:
        response = await llm.ainvoke(
            [SystemMessage(content=system_prompt), HumanMessage(content=user_content)]
        )
        raw = response.content.strip()
    except Exception as exc:
        logger.error("Advisor Claude call failed: %s", exc)
        raise

    # 6. Parse XML sections
    headline = _parse_xml_section(raw, "headline")
    full_picture = _parse_xml_section(raw, "full_picture")
    do_not_do = _parse_xml_section(raw, "do_not_do")

    # 7. total_opportunity = sum of top 5 findings by dollar_impact
    total_opportunity = int(sum(float(f.get("dollar_impact", 0)) for f in all_findings[:5]))

    # 8. Generate advisor chips
    from graph.synthesizer import generate_advisor_chips

    chips = await generate_advisor_chips(headline, full_picture)

    # 9. Save to AdvisorCache
    now = datetime.datetime.utcnow()
    cache_entry = AdvisorCache(
        user_id=user_id,
        headline=headline,
        full_picture=full_picture,
        do_not_do=do_not_do,
        total_opportunity=total_opportunity,
        chips=chips,
        generated_at=now,
    )
    db.add(cache_entry)
    await db.commit()

    return {
        "headline": headline,
        "full_picture": full_picture,
        "do_not_do": do_not_do,
        "total_opportunity": total_opportunity,
        "chips": chips,
        "generated_at": now.isoformat(),
        "cached": False,
    }
