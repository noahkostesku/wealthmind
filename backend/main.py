import base64
import json
import logging
import os
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from api.routes import router
from database import create_tables, seed_demo_user

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# WebSocket manager
# ---------------------------------------------------------------------------

class WebSocketManager:
    """Tracks active WebSocket connections keyed by run_id."""

    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, run_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[run_id].append(websocket)

    def disconnect(self, run_id: str, websocket: WebSocket) -> None:
        self._connections[run_id].remove(websocket)
        if not self._connections[run_id]:
            del self._connections[run_id]

    async def broadcast(self, run_id: str, message: Any) -> None:
        payload = json.dumps(message)
        dead = []
        for ws in self._connections.get(run_id, []):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(run_id, ws)


ws_manager = WebSocketManager()


# ---------------------------------------------------------------------------
# JWT middleware (demo — decodes payload without signature verification)
# ---------------------------------------------------------------------------

class JWTMiddleware(BaseHTTPMiddleware):
    """Extracts user info from Bearer JWT and stores in request.state."""

    _PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # WebSocket and public paths skip auth
        if path in self._PUBLIC_PATHS or path.startswith("/ws"):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                parts = token.split(".")
                if len(parts) == 3:
                    # Pad and decode the payload segment
                    payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
                    payload = json.loads(base64.urlsafe_b64decode(payload_b64))
                    request.state.user = payload
                else:
                    request.state.user = None
            except Exception:
                request.state.user = None
        else:
            request.state.user = None

        return await call_next(request)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    logger.info("Database tables created / verified.")
    await seed_demo_user()
    logger.info("Demo user seeded / already exists.")
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="WealthMind API", lifespan=lifespan)

_frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(JWTMiddleware)

# Attach WebSocket manager to app state so routes can access it
app.state.ws_manager = ws_manager

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok"}
