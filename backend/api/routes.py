import datetime
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import AnalysisRun, Insight, get_db
from backend.graph.graph import compile_graph
from backend.graph.state import GraphState

router = APIRouter()

_DATA_DIR = Path(__file__).parent.parent / "data"


def _load_profile() -> dict:
    return json.loads((_DATA_DIR / "demo_profile.json").read_text())


def _load_cra_rules() -> dict:
    return json.loads((_DATA_DIR / "cra_rules_2024.json").read_text())


# ---------------------------------------------------------------------------
# GET /profile
# ---------------------------------------------------------------------------

@router.get("/profile")
async def get_profile():
    return _load_profile()


# ---------------------------------------------------------------------------
# POST /analyze
# ---------------------------------------------------------------------------

@router.post("/analyze")
async def analyze(request: Request, db: AsyncSession = Depends(get_db)):
    profile = _load_profile()
    cra_rules = _load_cra_rules()

    run_id = str(uuid.uuid4())
    user_id = 1  # demo: single user

    run = AnalysisRun(user_id=user_id, started_at=datetime.datetime.utcnow())
    db.add(run)
    await db.flush()  # populate run.id

    initial_state: GraphState = {
        "financial_profile": profile,
        "cra_rules": cra_rules,
        "domain_findings": {},
        "synthesized_insights": [],
        "hitl_status": "pending",
        "run_id": run_id,
    }

    compiled = compile_graph()
    final_state = await compiled.ainvoke(initial_state)

    # Persist insights
    insights = final_state.get("synthesized_insights", [])
    for finding in insights:
        insight = Insight(
            run_id=run.id,
            user_id=user_id,
            domain=finding.get("domain", "unknown"),
            title=finding["title"],
            dollar_impact=float(finding["dollar_impact"]),
            urgency=finding["urgency"],
            reasoning=finding["reasoning"],
            status="active",
        )
        db.add(insight)

    run.completed_at = datetime.datetime.utcnow()
    run.graph_state = {
        "domain_findings": final_state.get("domain_findings", {}),
        "hitl_status": final_state.get("hitl_status", "surfaced"),
    }

    await db.commit()

    # Broadcast to any waiting WebSocket clients
    ws_manager = request.app.state.ws_manager
    await ws_manager.broadcast(run_id, {"run_id": run_id, "insights": insights})

    return {"run_id": run_id, "insight_count": len(insights), "insights": insights}


# ---------------------------------------------------------------------------
# WS /ws/{run_id}
# ---------------------------------------------------------------------------

@router.websocket("/ws/{run_id}")
async def websocket_endpoint(run_id: str, websocket: WebSocket):
    ws_manager = websocket.app.state.ws_manager
    await ws_manager.connect(run_id, websocket)
    try:
        while True:
            # Keep connection alive — actual data is pushed via ws_manager.broadcast
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(run_id, websocket)


# ---------------------------------------------------------------------------
# POST /insights/{id}/dismiss
# ---------------------------------------------------------------------------

class DismissRequest(BaseModel):
    dismiss_reason: str = ""


@router.post("/insights/{insight_id}/dismiss")
async def dismiss_insight(
    insight_id: int,
    body: DismissRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Insight).where(Insight.id == insight_id))
    insight = result.scalar_one_or_none()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")

    insight.status = "dismissed"
    insight.dismiss_reason = body.dismiss_reason
    insight.dismissed_at = datetime.datetime.utcnow()
    await db.commit()

    return {"ok": True, "id": insight_id}


# ---------------------------------------------------------------------------
# GET /insights/history
# ---------------------------------------------------------------------------

@router.get("/insights/history")
async def insights_history(db: AsyncSession = Depends(get_db)):
    user_id = 1  # demo: single user

    runs_result = await db.execute(
        select(AnalysisRun)
        .where(AnalysisRun.user_id == user_id)
        .order_by(AnalysisRun.started_at.desc())
    )
    runs = runs_result.scalars().all()

    history = []
    for run in runs:
        insights_result = await db.execute(
            select(Insight).where(Insight.run_id == run.id)
        )
        insights = insights_result.scalars().all()
        history.append(
            {
                "run_id": run.id,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                "insights": [
                    {
                        "id": i.id,
                        "domain": i.domain,
                        "title": i.title,
                        "dollar_impact": i.dollar_impact,
                        "urgency": i.urgency,
                        "reasoning": i.reasoning,
                        "status": i.status,
                        "dismissed_at": i.dismissed_at.isoformat() if i.dismissed_at else None,
                        "dismiss_reason": i.dismiss_reason,
                    }
                    for i in insights
                ],
            }
        )

    return history
