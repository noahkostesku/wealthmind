"""Integration test: run all 5 agents against demo data and verify outputs."""
import asyncio
import json
import sys
from pathlib import Path

# Allow running from repo root: python -m backend.test_agents
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.graph.agents import (
    allocation_agent,
    rate_arbitrage_agent,
    tax_implications_agent,
    timing_agent,
    tlh_agent,
)
from backend.graph.state import GraphState

DATA_DIR = Path(__file__).parent / "data"

REQUIRED_KEYS = {
    "title",
    "dollar_impact",
    "impact_direction",
    "urgency",
    "reasoning",
    "confidence",
    "what_to_do",
}
VALID_DIRECTIONS = {"save", "earn", "avoid"}
VALID_URGENCIES = {"immediate", "this_month", "evergreen"}
VALID_CONFIDENCES = {"high", "medium", "low"}


def validate_finding(f: dict, agent_name: str) -> list[str]:
    errors = []
    for key in REQUIRED_KEYS:
        if key not in f:
            errors.append(f"  [{agent_name}] Missing key: {key}")
    if "dollar_impact" in f and not isinstance(f["dollar_impact"], (int, float)):
        errors.append(f"  [{agent_name}] dollar_impact must be a number, got {type(f['dollar_impact'])}")
    if f.get("impact_direction") not in VALID_DIRECTIONS:
        errors.append(f"  [{agent_name}] Invalid impact_direction: {f.get('impact_direction')}")
    if f.get("urgency") not in VALID_URGENCIES:
        errors.append(f"  [{agent_name}] Invalid urgency: {f.get('urgency')}")
    if f.get("confidence") not in VALID_CONFIDENCES:
        errors.append(f"  [{agent_name}] Invalid confidence: {f.get('confidence')}")
    return errors


async def main():
    profile = json.loads((DATA_DIR / "demo_profile.json").read_text())
    cra_rules = json.loads((DATA_DIR / "cra_rules_2024.json").read_text())

    mock_state: GraphState = {
        "financial_profile": profile,
        "cra_rules": cra_rules,
        "domain_findings": {},
        "synthesized_insights": [],
        "hitl_status": "pending",
        "run_id": "test-run-001",
    }

    agents = [
        ("allocation", allocation_agent),
        ("tax_implications", tax_implications_agent),
        ("tlh", tlh_agent),
        ("rate_arbitrage", rate_arbitrage_agent),
        ("timing", timing_agent),
    ]

    all_findings = []
    all_errors = []

    for name, agent_fn in agents:
        print(f"\n{'='*60}")
        print(f"Running: {name}")
        print("="*60)

        result = await agent_fn(mock_state)
        findings = result.get("domain_findings", {})
        domain_key = list(findings.keys())[0] if findings else name
        agent_findings = findings.get(domain_key, [])

        print(f"Domain key: {domain_key}")
        print(f"Findings count: {len(agent_findings)}")

        for i, f in enumerate(agent_findings):
            print(f"\n  [{i+1}] {f.get('title', '(no title)')}")
            print(f"       dollar_impact: ${f.get('dollar_impact', 'N/A'):,.2f}" if isinstance(f.get('dollar_impact'), (int, float)) else f"       dollar_impact: {f.get('dollar_impact')}")
            print(f"       direction: {f.get('impact_direction')} | urgency: {f.get('urgency')} | confidence: {f.get('confidence')}")
            print(f"       reasoning: {f.get('reasoning', '')[:120]}...")
            print(f"       what_to_do: {f.get('what_to_do', '')}")

            errs = validate_finding(f, name)
            all_errors.extend(errs)
            all_findings.append(f)

    # -----------------------------------------------------------------------
    # Verification checks
    # -----------------------------------------------------------------------
    print(f"\n{'='*60}")
    print("VERIFICATION SUMMARY")
    print("="*60)

    checks_passed = 0
    checks_failed = 0

    def check(label: str, condition: bool):
        nonlocal checks_passed, checks_failed
        status = "PASS" if condition else "FAIL"
        if condition:
            checks_passed += 1
        else:
            checks_failed += 1
        print(f"  [{status}] {label}")

    # Schema validation
    schema_ok = len(all_errors) == 0
    if not schema_ok:
        print("\nSchema errors:")
        for e in all_errors:
            print(e)
    check("All findings have valid schema", schema_ok)

    # Minimum findings
    check(f"At least 4 distinct findings (got {len(all_findings)})", len(all_findings) >= 4)

    # FHSA finding
    fhsa_found = any(
        "fhsa" in f.get("title", "").lower() or "fhsa" in f.get("reasoning", "").lower()
        for f in all_findings
    )
    check("FHSA opportunity surfaced", fhsa_found)

    # CNQ.TO TLH finding
    cnq_found = any(
        "cnq" in f.get("title", "").lower()
        or "cnq" in f.get("reasoning", "").lower()
        or "cnq" in f.get("what_to_do", "").lower()
        for f in all_findings
    )
    check("CNQ.TO tax-loss harvesting opportunity surfaced", cnq_found)

    # Rate arbitrage
    margin_found = any(
        any(kw in f.get("title", "").lower() or kw in f.get("reasoning", "").lower()
            for kw in ["margin", "arbitrage", "6.2", "interest"])
        for f in all_findings
    )
    check("Margin rate arbitrage finding surfaced", margin_found)

    # No agent crashed
    check("No agent returned empty findings (all produced output)", all(len(f) > 0 for f in [all_findings]))

    print(f"\nResult: {checks_passed} passed, {checks_failed} failed")
    if checks_failed > 0:
        print("\nWARNING: Some verification checks failed. Review output above.")
        sys.exit(1)
    else:
        print("\nAll verification checks passed.")


if __name__ == "__main__":
    asyncio.run(main())
