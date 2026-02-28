from typing import Literal, TypedDict


class GraphState(TypedDict):
    financial_profile: dict
    cra_rules: dict
    # Keys: tax, allocation, tlh, rates, timing — each maps to a list of findings
    domain_findings: dict
    synthesized_insights: list
    hitl_status: Literal["pending", "surfaced", "dismissed"]
    run_id: str
