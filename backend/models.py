"""
Pydantic data models for the Dismounted Commander's Associate backend.
"""
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ─── Incoming from soldier device ────────────────────────────────────────────

class GpsCoordinate(BaseModel):
    latitude:  float = Field(..., ge=-90,  le=90)
    longitude: float = Field(..., ge=-180, le=180)
    altitude_m: Optional[float] = None
    accuracy_m: Optional[float] = None


class SensorWindow(BaseModel):
    """
    One 128-sample window of raw IMU data from the soldier's tablet.
    Each channel list has exactly 128 float values.
    Channels (9): body_acc_xyz, body_gyro_xyz, total_acc_xyz
    """
    soldier_id: str
    timestamp:  datetime
    location:   GpsCoordinate
    # Raw inertial signal channels — 128 samples each @ 50 Hz
    body_acc_x:  list[float] = Field(..., min_length=128, max_length=128)
    body_acc_y:  list[float] = Field(..., min_length=128, max_length=128)
    body_acc_z:  list[float] = Field(..., min_length=128, max_length=128)
    body_gyro_x: list[float] = Field(..., min_length=128, max_length=128)
    body_gyro_y: list[float] = Field(..., min_length=128, max_length=128)
    body_gyro_z: list[float] = Field(..., min_length=128, max_length=128)
    total_acc_x: list[float] = Field(..., min_length=128, max_length=128)
    total_acc_y: list[float] = Field(..., min_length=128, max_length=128)
    total_acc_z: list[float] = Field(..., min_length=128, max_length=128)


# ─── Outgoing to commander ────────────────────────────────────────────────────

class TacticalState(BaseModel):
    """Current classified state for one soldier."""
    soldier_id:      str
    timestamp:       datetime
    location:        GpsCoordinate
    gps_valid:       bool = True
    detected:        bool = True
    activity:        str          # WALKING | KNEELING_READY | PRONE_STILL | UNKNOWN
    confidence:      float
    all_probs:       dict[str, float]
    alert:           bool = False  # True when PRONE_STILL > ALERT_THRESHOLD seconds
    alert_message:   Optional[str] = None
    temperature:     float = 0.0
    rssi:            int = -120
    signal_quality:  str = "POOR"
    load:            str = "UNKNOWN"  # LIGHT | HEAVY | UNKNOWN
    speed_mps:       float = 0.0
    movement_m:      float = 0.0
    small_movement:  bool = False
    calibrated:      bool = False


class ForceStatus(BaseModel):
    """Snapshot of the entire section/platoon for the commander map."""
    timestamp:  datetime
    soldiers:   list[TacticalState]


# ─── WebSocket messages ───────────────────────────────────────────────────────

class WsMessage(BaseModel):
    event:   str          # "state_update" | "alert" | "ping"
    payload: dict


class SoldierRegistration(BaseModel):
    soldier_id:  str
    call_sign:   str
    unit:        str
