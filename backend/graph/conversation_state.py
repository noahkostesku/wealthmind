from typing import TypedDict


class ConversationMessage(TypedDict):
    role: str  # 'user' | 'assistant' | 'system'
    content: str
    timestamp: str
    agent_sources: list[str]
    findings_snapshot: dict


class ConversationState(TypedDict):
    session_id: str
    messages: list[ConversationMessage]
    financial_profile: dict
    cra_rules: dict
    active_agents: list[str]
    last_findings: dict
