"""
Dismounted Commander's Associate — FastAPI Backend
===================================================
Endpoints:
  POST /api/soldier/report       – receive IMU window + GPS from soldier device
  GET  /api/force/status         – current status snapshot (REST)
  GET  /api/soldier/{id}/history – last N predictions for one soldier
  WS   /ws/commander             – WebSocket stream → commander map
  WS   /ws/soldier/{id}          – WebSocket stream ← soldier device (optional)

Run:
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

import asyncio
import json
import traceback
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Union

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware

from inference import classifier, PRONE_ALERT_WINDOWS
from models import (
    ForceStatus,
    GpsCoordinate,
    SensorWindow,
    SoldierRegistration,
    TacticalState,
    WsMessage,
)

# ─── App setup ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Dismounted Commander's Associate",
    description="Tactical edge activity recognition — RDF R&D prototype",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── In-memory state ──────────────────────────────────────────────────────────
# In a real system this would be Redis / a time-series DB
soldier_state:     dict[str, TacticalState]        = {}     # latest state per soldier
soldier_history:   dict[str, deque[TacticalState]] = defaultdict(lambda: deque(maxlen=200))
prone_counters:    dict[str, int]                  = defaultdict(int)
soldier_registry:  dict[str, SoldierRegistration]  = {}

# WebSocket connection pool for commander dashboards
commander_connections: list[WebSocket] = []


# ─── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    classifier.load()


# ─── Helper: broadcast to all commander WebSocket clients ─────────────────────
async def broadcast(message: dict) -> None:
    dead: list[WebSocket] = []
    for ws in commander_connections:
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            dead.append(ws)
    for ws in dead:
        commander_connections.remove(ws)


# ─── Helper: detect distress ──────────────────────────────────────────────────
def check_distress(soldier_id: str, activity: str) -> tuple[bool, Union[str, None]]:
    if activity == "PRONE_STILL":
        prone_counters[soldier_id] += 1
    else:
        prone_counters[soldier_id] = 0

    if prone_counters[soldier_id] >= PRONE_ALERT_WINDOWS:
        return True, (
            f"⚠️  POSSIBLE DISTRESS — {soldier_id} has been "
            f"PRONE_STILL for {prone_counters[soldier_id] * 0.64:.0f}s"
        )
    return False, None


# ─────────────────────────────────────────────────────────────────────────────
#  REST Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {"status": "operational", "service": "Dismounted Commander's Associate"}


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "soldiers_tracked": len(soldier_state)}


@app.post("/api/soldier/register", tags=["Soldier"])
async def register_soldier(reg: SoldierRegistration):
    soldier_registry[reg.soldier_id] = reg
    return {"registered": reg.soldier_id, "call_sign": reg.call_sign}


@app.post("/api/soldier/report", tags=["Soldier"], response_model=TacticalState)
async def soldier_report(window: SensorWindow):
    """
    Called by the soldier's Flutter app every ~0.64 s (50% overlapping window).
    Runs inference, updates state, and broadcasts to commander WebSocket clients.
    """
    try:
        channels = [
            window.body_acc_x,  window.body_acc_y,  window.body_acc_z,
            window.body_gyro_x, window.body_gyro_y, window.body_gyro_z,
        ]
        result = classifier.predict(channels)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Inference error: {e}")

    alert, alert_msg = check_distress(window.soldier_id, result['activity'])

    state = TacticalState(
        soldier_id    = window.soldier_id,
        timestamp     = window.timestamp,
        location      = window.location,
        activity      = result['activity'],
        confidence    = result['confidence'],
        all_probs     = result['all_probs'],
        alert         = alert,
        alert_message = alert_msg,
    )
    soldier_state[window.soldier_id]   = state
    soldier_history[window.soldier_id].append(state)

    # Broadcast to commander dashboards asynchronously
    asyncio.create_task(
        broadcast({
            "event": "alert" if alert else "state_update",
            "payload": state.model_dump(mode="json"),
        })
    )

    return state


@app.get("/api/force/status", tags=["Commander"], response_model=ForceStatus)
async def force_status():
    """Returns the latest known state for all active soldiers."""
    return ForceStatus(
        timestamp=datetime.now(timezone.utc),
        soldiers=list(soldier_state.values()),
    )


@app.get("/api/soldier/{soldier_id}/history", tags=["Soldier"])
async def soldier_history_endpoint(soldier_id: str, last_n: int = 50):
    if soldier_id not in soldier_history:
        raise HTTPException(status_code=404, detail="Soldier not found")
    history = list(soldier_history[soldier_id])[-last_n:]
    return {"soldier_id": soldier_id, "history": [s.model_dump(mode="json") for s in history]}


# ─────────────────────────────────────────────────────────────────────────────
#  WebSocket Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/commander")
async def commander_ws(ws: WebSocket):
    """
    Commander map subscribes here and receives real-time state update events.
    On connect, sends the full current force picture immediately.
    """
    await ws.accept()
    commander_connections.append(ws)
    print(f"[WS] Commander connected — total: {len(commander_connections)}")

    # Immediately push the current force picture
    await ws.send_text(json.dumps({
        "event": "force_picture",
        "payload": ForceStatus(
            timestamp=datetime.now(timezone.utc),
            soldiers=list(soldier_state.values()),
        ).model_dump(mode="json"),
    }))

    try:
        while True:
            # Keep-alive: client sends "ping", server responds "pong"
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text(json.dumps({"event": "pong"}))
    except WebSocketDisconnect:
        commander_connections.remove(ws)
        print(f"[WS] Commander disconnected — remaining: {len(commander_connections)}")


@app.websocket("/ws/soldier/{soldier_id}")
async def soldier_ws(ws: WebSocket, soldier_id: str):
    """
    Optional: soldiers can stream lightweight JSON sensor payloads over WebSocket
    instead of repeated HTTP POSTs. Lower overhead for high-frequency updates.
    """
    await ws.accept()
    print(f"[WS] Soldier {soldier_id} connected")
    try:
        while True:
            raw = await ws.receive_text()
            payload = json.loads(raw)
            window  = SensorWindow(soldier_id=soldier_id, **payload)
            # Reuse the same logic as the REST endpoint
            await soldier_report(window)
    except WebSocketDisconnect:
        print(f"[WS] Soldier {soldier_id} disconnected")
    except Exception as e:
        print(f"[WS] Soldier {soldier_id} error: {e}")
        await ws.close(code=status.WS_1011_INTERNAL_ERROR)
