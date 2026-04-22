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
import glob
import json
import math
import os
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

# ─── Live LoRa ingestion state ───────────────────────────────────────────────
LORA_WINDOW_SIZE = 128
LORA_STRIDE = 1
LORA_BOOTSTRAP_MIN_SAMPLES = 4
LORA_STATUS_WINDOW = 24
LORA_GPS_DEADBAND_M = 1.0
LORA_SAMPLE_RATE_HZ = float(os.getenv("LORA_SAMPLE_RATE_HZ", "20.0"))
LORA_CALIBRATION_SECONDS = 2
LORA_CALIBRATION_SAMPLES = max(20, int(LORA_SAMPLE_RATE_HZ * LORA_CALIBRATION_SECONDS))
lora_task: asyncio.Task | None = None
lora_should_run: bool = False
lora_last_error: str | None = None
lora_port: str | None = None
lora_baud: int = 9600
lora_last_packet_at: str | None = None
lora_samples_seen: int = 0
lora_windows_sent: int = 0
lora_presence_timeout_s: float = 8.0
lora_last_seen: dict[str, datetime] = {}
lora_presence_task: asyncio.Task | None = None

lora_last_location: dict[str, tuple[float, float]] = {}
lora_gravity_estimate: dict[str, tuple[float, float, float]] = {}
lora_buffers: dict[str, dict[str, deque[float]]] = defaultdict(
    lambda: {
        "body_acc_x": deque(maxlen=LORA_WINDOW_SIZE),
        "body_acc_y": deque(maxlen=LORA_WINDOW_SIZE),
        "body_acc_z": deque(maxlen=LORA_WINDOW_SIZE),
        "body_gyro_x": deque(maxlen=LORA_WINDOW_SIZE),
        "body_gyro_y": deque(maxlen=LORA_WINDOW_SIZE),
        "body_gyro_z": deque(maxlen=LORA_WINDOW_SIZE),
        "total_acc_x": deque(maxlen=LORA_WINDOW_SIZE),
        "total_acc_y": deque(maxlen=LORA_WINDOW_SIZE),
        "total_acc_z": deque(maxlen=LORA_WINDOW_SIZE),
    }
)
lora_since_last_post: dict[str, int] = defaultdict(int)
lora_latest_telemetry: dict[str, dict[str, float | int]] = defaultdict(dict)
lora_slow_walk_score: dict[str, int] = defaultdict(int)
lora_transition_candidate: dict[str, str] = defaultdict(str)
lora_transition_count: dict[str, int] = defaultdict(int)
lora_fused_pitch_deg: dict[str, float] = {}
lora_last_pitch_ts: dict[str, datetime] = {}
lora_slope_offset_deg: dict[str, float] = defaultdict(float)
lora_calibration: dict[str, dict[str, float | int | bool]] = defaultdict(
    lambda: {
        "count": 0,
        "mag_sum": 0.0,
        "gx_sum": 0.0,
        "gy_sum": 0.0,
        "gz_sum": 0.0,
        "scale": 1.0,
        "gx_bias": 0.0,
        "gy_bias": 0.0,
        "gz_bias": 0.0,
        "ready": False,
    }
)


def auto_detect_lora_port() -> str | None:
    """Pick the first likely USB serial device for the LoRa receiver."""
    candidates = sorted(glob.glob("/dev/ttyACM*")) + sorted(glob.glob("/dev/ttyUSB*"))
    return candidates[0] if candidates else None


# ─── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    classifier.load()
    # Optional auto-start if serial port is provided via env.
    env_port = os.getenv("LORA_SERIAL_PORT", "").strip()
    env_baud = int(os.getenv("LORA_SERIAL_BAUD", "9600"))
    if env_port:
        await start_lora_ingest_worker(env_port, env_baud)
        return

    # Fallback: try auto-detecting a connected receiver serial port.
    auto_port = auto_detect_lora_port()
    if auto_port:
        print(f"[LoRa] Auto-detected serial port: {auto_port}")
        await start_lora_ingest_worker(auto_port, env_baud)
    else:
        print("[LoRa] No serial port auto-detected on startup. Use /api/lora/ingest/start.")

    global lora_presence_task
    if lora_presence_task is None or lora_presence_task.done():
        lora_presence_task = asyncio.create_task(lora_presence_watchdog())


@app.on_event("shutdown")
async def shutdown():
    await stop_lora_ingest_worker()
    global lora_presence_task
    if lora_presence_task and not lora_presence_task.done():
        lora_presence_task.cancel()
        try:
            await lora_presence_task
        except BaseException:
            pass


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


def parse_lora_csv_payload(payload: str) -> dict[str, str] | None:
    """
        Expected payload from receiver raw line:
            ID,LAT,LON,AX,AY,AZ,GX,GY,GZ,TEMP_RAW[,RSSI]
    """
    parts = [p.strip() for p in payload.split(",")]
    if len(parts) not in (10, 11):
        return None
    return {
        "soldier_id": parts[0],
        "lat": parts[1],
        "lon": parts[2],
        "ax": parts[3],
        "ay": parts[4],
        "az": parts[5],
        "gx": parts[6],
        "gy": parts[7],
        "gz": parts[8],
        "temp_raw": parts[9],
        "rssi": parts[10] if len(parts) == 11 else "-120",
    }


def _to_float(value: str, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def _raw_accel_to_g(raw_value: float) -> float:
    return raw_value / 16384.0


def _raw_gyro_to_dps(raw_value: float) -> float:
    # MPU6050 default gyro sensitivity is 131 LSB/(deg/s) at +/-250 dps.
    return raw_value / 131.0


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approx geodesic distance in meters (good enough for short distances)."""
    r = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def _parse_location(lat_s: str, lon_s: str, soldier_id: str) -> tuple[float, float]:
    if lat_s == "GPS INVALID" or lon_s == "GPS INVALID":
        return lora_last_location.get(soldier_id, (0.0, 0.0))
    try:
        lat = float(lat_s)
        lon = float(lon_s)
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            last = lora_last_location.get(soldier_id)
            if last is not None:
                moved_m = _distance_m(last[0], last[1], lat, lon)
                # Ignore tiny GPS jitter so map markers stay stable.
                if moved_m < LORA_GPS_DEADBAND_M:
                    return last
            lora_last_location[soldier_id] = (lat, lon)
            return lat, lon
    except Exception:
        pass
    return lora_last_location.get(soldier_id, (0.0, 0.0))


async def process_lora_sample(sample: dict[str, str]) -> None:
    """Buffer LoRa raw samples into 128 windows and push through soldier_report."""
    global lora_samples_seen, lora_windows_sent, lora_last_packet_at

    sid = sample["soldier_id"]
    gps_valid = sample["lat"] != "GPS INVALID" and sample["lon"] != "GPS INVALID"
    lat, lon = _parse_location(sample["lat"], sample["lon"], sid)

    ax = _to_float(sample["ax"])
    ay = _to_float(sample["ay"])
    az = _to_float(sample["az"])
    gx = _to_float(sample["gx"])
    gy = _to_float(sample["gy"])
    gz = _to_float(sample["gz"])
    temp_raw = _to_float(sample.get("temp_raw", "0"))
    temp_c = temp_raw / 340.0 + 36.53
    rssi = int(_to_float(sample.get("rssi", "-120"), -120.0))
    lora_latest_telemetry[sid] = {"temperature": temp_c, "rssi": rssi}

    ax_g = _raw_accel_to_g(ax)
    ay_g = _raw_accel_to_g(ay)
    az_g = _raw_accel_to_g(az)
    gx_dps = _raw_gyro_to_dps(gx)
    gy_dps = _raw_gyro_to_dps(gy)
    gz_dps = _raw_gyro_to_dps(gz)

    # Startup auto-calibration per soldier (stand still for initial ~5s).
    cal = lora_calibration[sid]
    if not bool(cal["ready"]):
        raw_mag = math.sqrt(ax_g * ax_g + ay_g * ay_g + az_g * az_g)
        cal["count"] = int(cal["count"]) + 1
        cal["mag_sum"] = float(cal["mag_sum"]) + raw_mag
        cal["gx_sum"] = float(cal["gx_sum"]) + gx_dps
        cal["gy_sum"] = float(cal["gy_sum"]) + gy_dps
        cal["gz_sum"] = float(cal["gz_sum"]) + gz_dps

        if int(cal["count"]) >= LORA_CALIBRATION_SAMPLES:
            n = float(cal["count"])
            mean_mag = float(cal["mag_sum"]) / max(1.0, n)
            cal["scale"] = 1.0 / max(0.2, mean_mag)
            cal["gx_bias"] = float(cal["gx_sum"]) / n
            cal["gy_bias"] = float(cal["gy_sum"]) / n
            cal["gz_bias"] = float(cal["gz_sum"]) / n
            cal["ready"] = True
            print(
                f"[CAL] sid={sid} scale={float(cal['scale']):.3f} "
                f"gyro_bias=({float(cal['gx_bias']):.2f},{float(cal['gy_bias']):.2f},{float(cal['gz_bias']):.2f})"
            )

    # Apply calibration to suppress sensor bias and normalize gravity magnitude near 1g.
    scale = float(cal["scale"])
    ax_g *= scale
    ay_g *= scale
    az_g *= scale
    gx_dps -= float(cal["gx_bias"])
    gy_dps -= float(cal["gy_bias"])
    gz_dps -= float(cal["gz_bias"])

    # Approximate body acceleration by subtracting a running gravity estimate.
    # This keeps the data closer to the phone-derived HAR features the model expects.
    g_prev = lora_gravity_estimate.get(sid, (0.0, 0.0, 0.0))
    gravity_alpha = 0.9
    gravity_x = gravity_alpha * g_prev[0] + (1.0 - gravity_alpha) * ax_g
    gravity_y = gravity_alpha * g_prev[1] + (1.0 - gravity_alpha) * ay_g
    gravity_z = gravity_alpha * g_prev[2] + (1.0 - gravity_alpha) * az_g
    lora_gravity_estimate[sid] = (gravity_x, gravity_y, gravity_z)

    body_acc_x = ax_g - gravity_x
    body_acc_y = ay_g - gravity_y
    body_acc_z = az_g - gravity_z
    total_acc_x = ax_g
    total_acc_y = ay_g
    total_acc_z = az_g

    b = lora_buffers[sid]
    b["body_acc_x"].append(body_acc_x)
    b["body_acc_y"].append(body_acc_y)
    b["body_acc_z"].append(body_acc_z)
    b["body_gyro_x"].append(gx_dps)
    b["body_gyro_y"].append(gy_dps)
    b["body_gyro_z"].append(gz_dps)
    b["total_acc_x"].append(total_acc_x)
    b["total_acc_y"].append(total_acc_y)
    b["total_acc_z"].append(total_acc_z)

    lora_samples_seen += 1
    lora_last_packet_at = datetime.now(timezone.utc).isoformat()
    lora_last_seen[sid] = datetime.now(timezone.utc)
    lora_since_last_post[sid] += 1
    # print(
    #     f"[LoRa RX] sid={sid} lat={sample['lat']} lon={sample['lon']} "
    #     f"ax={sample['ax']} ay={sample['ay']} az={sample['az']} "
    #     f"gx={sample['gx']} gy={sample['gy']} gz={sample['gz']} temp={sample['temp_raw']} "
    #     f"| accel_g=({ax_g:.3f},{ay_g:.3f},{az_g:.3f}) gyro_dps=({gx_dps:.2f},{gy_dps:.2f},{gz_dps:.2f})"
    # )

    # Push immediate live updates so map reflects LoRa packets in near real-time.
    if gps_valid:
        existing = soldier_state.get(sid)
        if existing is not None:
            live_state = existing.model_copy(update={
                "timestamp": datetime.now(timezone.utc),
                "location": GpsCoordinate(latitude=lat, longitude=lon),
                "gps_valid": True,
                "detected": True,
                "temperature": temp_c,
                "rssi": rssi,
            })
        else:
            live_state = TacticalState(
                soldier_id=sid,
                timestamp=datetime.now(timezone.utc),
                location=GpsCoordinate(latitude=lat, longitude=lon),
                gps_valid=True,
                detected=True,
                activity="STATIONARY",
                confidence=0.0,
                all_probs={},
                alert=False,
                alert_message=None,
                temperature=temp_c,
                rssi=rssi,
                load="UNKNOWN",
            )
        soldier_state[sid] = live_state
        asyncio.create_task(
            broadcast({
                "event": "state_update",
                "payload": live_state.model_dump(mode="json"),
            })
        )
    else:
        existing = soldier_state.get(sid)
        if existing is not None:
            hidden_state = existing.model_copy(update={"gps_valid": False, "detected": True, "temperature": temp_c, "rssi": rssi})
            soldier_state[sid] = hidden_state
            asyncio.create_task(
                broadcast({
                    "event": "state_update",
                    "payload": hidden_state.model_dump(mode="json"),
                })
            )
        else:
            hidden_state = TacticalState(
                soldier_id=sid,
                timestamp=datetime.now(timezone.utc),
                location=GpsCoordinate(latitude=lat, longitude=lon),
                gps_valid=False,
                detected=True,
                activity="STATIONARY",
                confidence=0.0,
                all_probs={},
                alert=False,
                alert_message=None,
                temperature=temp_c,
                rssi=rssi,
                load="UNKNOWN",
            )
            soldier_state[sid] = hidden_state
            asyncio.create_task(
                broadcast({
                    "event": "state_update",
                    "payload": hidden_state.model_dump(mode="json"),
                })
            )

    current_len = len(b["body_acc_x"])
    ready = current_len == LORA_WINDOW_SIZE
    can_bootstrap = current_len >= LORA_BOOTSTRAP_MIN_SAMPLES
    should_post = (ready or can_bootstrap) and lora_since_last_post[sid] >= LORA_STRIDE
    if not should_post:
        return

    lora_since_last_post[sid] = 0

    def _pad(values: list[float]) -> list[float]:
        if len(values) >= LORA_WINDOW_SIZE:
            return values[-LORA_WINDOW_SIZE:]
        if not values:
            return [0.0] * LORA_WINDOW_SIZE
        pad_value = values[0]
        return [pad_value] * (LORA_WINDOW_SIZE - len(values)) + values

    body_acc_x = _pad(list(b["body_acc_x"]))
    body_acc_y = _pad(list(b["body_acc_y"]))
    body_acc_z = _pad(list(b["body_acc_z"]))
    body_gyro_x = _pad(list(b["body_gyro_x"]))
    body_gyro_y = _pad(list(b["body_gyro_y"]))
    body_gyro_z = _pad(list(b["body_gyro_z"]))
    total_acc_x = _pad(list(b["total_acc_x"]))
    total_acc_y = _pad(list(b["total_acc_y"]))
    total_acc_z = _pad(list(b["total_acc_z"]))

    window = SensorWindow(
        soldier_id=sid,
        timestamp=datetime.now(timezone.utc),
        location=GpsCoordinate(latitude=lat, longitude=lon),
        body_acc_x=body_acc_x,
        body_acc_y=body_acc_y,
        body_acc_z=body_acc_z,
        body_gyro_x=body_gyro_x,
        body_gyro_y=body_gyro_y,
        body_gyro_z=body_gyro_z,
        total_acc_x=total_acc_x,
        total_acc_y=total_acc_y,
        total_acc_z=total_acc_z,
    )
    await soldier_report(window)
    lora_windows_sent += 1
    print(
        f"[LoRa -> Inference] sid={sid} window_sent={lora_windows_sent} "
        f"buffer={current_len}/{LORA_WINDOW_SIZE} lat={lat:.6f} lon={lon:.6f}"
    )


async def lora_ingest_loop(port: str, baud: int) -> None:
    """Background task: read receiver serial and feed backend pipeline."""
    global lora_last_error
    lora_last_error = None

    try:
        import serial  # type: ignore
    except Exception as e:
        lora_last_error = f"pyserial unavailable: {e}"
        return

    try:
        with serial.Serial(port, baud, timeout=1.0) as ser:
            print(f"[LoRa] Serial ingest started on {port} @ {baud}")
            while lora_should_run:
                raw = await asyncio.to_thread(ser.readline)
                if not raw:
                    continue

                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                if line.startswith("Raw:"):
                    payload = line.replace("Raw:", "", 1).strip()
                    sample = parse_lora_csv_payload(payload)
                    if sample:
                        await process_lora_sample(sample)
                    # else:
                    #     print(f"[LoRa RX] Ignored malformed payload: {payload}")
    except Exception as e:
        lora_last_error = str(e)
        print(f"[LoRa] Ingest error: {lora_last_error}")


async def start_lora_ingest_worker(port: str, baud: int = 9600) -> dict:
    global lora_task, lora_should_run, lora_port, lora_baud, lora_last_error
    if lora_task and not lora_task.done():
        return {                    # else:
                    #     print(f"[LoRa RX] Ignored malformed payload: {payload}")

            "running": True,
            "port": lora_port,
            "baud": lora_baud,
            "message": "LoRa ingest already running",
        }

    lora_should_run = True
    lora_port = port
    lora_baud = baud
    lora_last_error = None
    lora_task = asyncio.create_task(lora_ingest_loop(port, baud))
    print(f"[LoRa] Start requested for {port} @ {baud}")
    return {
        "running": True,
        "port": lora_port,
        "baud": lora_baud,
        "message": "LoRa ingest started",
    }


async def stop_lora_ingest_worker() -> dict:
    global lora_task, lora_should_run
    if not lora_task or lora_task.done():
        lora_should_run = False
        return {"running": False, "message": "LoRa ingest not running"}

    lora_should_run = False
    await asyncio.sleep(0.2)
    if lora_task and not lora_task.done():
        lora_task.cancel()
        try:
            await lora_task
        except BaseException:
            pass
    lora_task = None
    print("[LoRa] Ingest stopped")
    return {"running": False, "message": "LoRa ingest stopped"}


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


@app.get("/api/lora/ingest/status", tags=["LoRa Ingest"])
async def lora_ingest_status():
    running = bool(lora_task and not lora_task.done())
    return {
        "running": running,
        "port": lora_port,
        "baud": lora_baud,
        "samples_seen": lora_samples_seen,
        "windows_sent": lora_windows_sent,
        "last_packet_at": lora_last_packet_at,
        "last_error": lora_last_error,
    }


@app.post("/api/lora/ingest/start", tags=["LoRa Ingest"])
async def lora_ingest_start(port: str = "/dev/ttyACM0", baud: int = 9600):
    return await start_lora_ingest_worker(port, baud)


@app.post("/api/lora/ingest/stop", tags=["LoRa Ingest"])
async def lora_ingest_stop():
    return await stop_lora_ingest_worker()


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
    # Calculate magnitude and pitch from total acceleration for formula-based tactical state.
    # body_acc is gravity-removed and naturally too low for 1g threshold logic.
    import numpy as np
    # Use only recent samples for status so labels react quickly to start/stop movement.
    tail = min(LORA_STATUS_WINDOW, len(window.total_acc_x))
    acc_x = np.array(window.total_acc_x[-tail:])
    acc_y = np.array(window.total_acc_y[-tail:])
    acc_z = np.array(window.total_acc_z[-tail:])
    mag_series = np.sqrt(acc_x**2 + acc_y**2 + acc_z**2)
    mag = np.mean(mag_series)
    mag_std = np.std(mag_series)

    # Frequency-domain gait check: robustly distinguish periodic human gait from random vibration.
    detrended_mag = mag_series - np.mean(mag_series)
    freqs = np.fft.rfftfreq(len(detrended_mag), d=1.0 / LORA_SAMPLE_RATE_HZ)
    fft_amp = np.abs(np.fft.rfft(detrended_mag))
    band_mask = (freqs >= 0.7) & (freqs <= 4.0)
    if np.any(band_mask):
        band_freqs = freqs[band_mask]
        band_amp = fft_amp[band_mask]
        peak_idx = int(np.argmax(band_amp))
        dom_freq = float(band_freqs[peak_idx])
        rhythm_score = float(band_amp[peak_idx] / (np.sum(band_amp) + 1e-6))
    else:
        dom_freq = 0.0
        rhythm_score = 0.0
    sid = window.soldier_id
    prev_state = soldier_state.get(sid)

    # Accelerometer pitch estimate
    acc_pitch_deg = float(np.degrees(np.mean(np.arctan2(-acc_x, np.sqrt(acc_y**2 + acc_z**2)))))

    gyro_x = np.array(window.body_gyro_x[-tail:])
    gyro_y = np.array(window.body_gyro_y[-tail:])
    gyro_z = np.array(window.body_gyro_z[-tail:])
    gyro_rms = np.sqrt(np.mean(gyro_x**2 + gyro_y**2 + gyro_z**2))
    # Remove DC bias so stationary sensor drift does not look like movement.
    gyro_dyn_x = gyro_x - np.mean(gyro_x)
    gyro_dyn_y = gyro_y - np.mean(gyro_y)
    gyro_dyn_z = gyro_z - np.mean(gyro_z)
    gyro_dyn_rms = np.sqrt(np.mean(gyro_dyn_x**2 + gyro_dyn_y**2 + gyro_dyn_z**2))

    # Complementary filter style pitch fusion (gyro + accel).
    last_ts = lora_last_pitch_ts.get(sid)
    dt_s = (window.timestamp - last_ts).total_seconds() if last_ts else (1.0 / LORA_SAMPLE_RATE_HZ)
    dt_s = min(max(dt_s, 1.0 / (LORA_SAMPLE_RATE_HZ * 2.0)), 0.5)
    gyro_pitch_rate_dps = float(np.mean(gyro_y))
    prev_fused = lora_fused_pitch_deg.get(sid, acc_pitch_deg)
    alpha = 0.94
    fused_pitch_deg = alpha * (prev_fused + gyro_pitch_rate_dps * dt_s) + (1.0 - alpha) * acc_pitch_deg
    lora_fused_pitch_deg[sid] = fused_pitch_deg
    lora_last_pitch_ts[sid] = window.timestamp

    # Terrain compensation: adjust pitch baseline using altitude slope when available.
    slope_offset_deg = lora_slope_offset_deg[sid]
    cur_alt = window.location.altitude_m
    if (
        prev_state is not None
        and prev_state.location.altitude_m is not None
        and cur_alt is not None
    ):
        horizontal_m = _distance_m(
            prev_state.location.latitude,
            prev_state.location.longitude,
            window.location.latitude,
            window.location.longitude,
        )
        if horizontal_m > 1.0:
            rise_m = cur_alt - prev_state.location.altitude_m
            slope_deg = math.degrees(math.atan2(rise_m, horizontal_m))
            slope_offset_deg = 0.9 * slope_offset_deg + 0.1 * slope_deg
            lora_slope_offset_deg[sid] = slope_offset_deg

    pitch = fused_pitch_deg - slope_offset_deg

    # Print for debugging
    print(
        f"[DEBUG] mag={mag:.3f} mag_std={mag_std:.3f} "
        f"gyro_rms={gyro_rms:.2f} gyro_dyn={gyro_dyn_rms:.2f} "
        f"f_peak={dom_freq:.2f} rhythm={rhythm_score:.2f} "
        f"pitch_raw={acc_pitch_deg:.1f} pitch_fused={fused_pitch_deg:.1f} "
        f"slope={slope_offset_deg:.1f} pitch={pitch:.1f}"
    )

    # Load estimation: use peak magnitude in window
    peak_mag = np.max(np.sqrt(acc_x**2 + acc_y**2 + acc_z**2))
    if peak_mag < 1.3:
        load = "LIGHT"
    elif peak_mag > 1.6:
        load = "HEAVY"
    else:
        load = "UNKNOWN"

    # Formula thresholds tuned for total_acc in g units.
    if mag >= 1.8:
        activity = "RUNNING"
        confidence = 0.95
        lora_slow_walk_score[sid] = min(lora_slow_walk_score[sid] + 2, 6)
    elif 1.15 <= mag < 1.8:
        activity = "WALKING"
        confidence = 0.9
        lora_slow_walk_score[sid] = min(lora_slow_walk_score[sid] + 2, 6)
    elif 0.95 <= mag < 1.2 and abs(pitch) > 70:
        activity = "CRAWLING"
        confidence = 0.85
        lora_slow_walk_score[sid] = max(lora_slow_walk_score[sid] - 1, 0)
    elif 0.9 <= mag <= 1.1 and abs(pitch) > 75:
        activity = "PRONE_STILL"
        confidence = 0.8
        lora_slow_walk_score[sid] = max(lora_slow_walk_score[sid] - 1, 0)
    elif 0.9 <= mag <= 1.1 and 40 < abs(pitch) <= 70:
        activity = "KNEELING_READY"
        confidence = 0.75
        lora_slow_walk_score[sid] = max(lora_slow_walk_score[sid] - 1, 0)
    elif 0.98 <= mag < 1.15 and abs(pitch) <= 50:
        # Slow walking must show both accel variation and dynamic gyro motion.
        slow_walk_evidence = mag_std >= 0.11 and gyro_dyn_rms >= 3.0
        if slow_walk_evidence:
            lora_slow_walk_score[sid] = min(lora_slow_walk_score[sid] + 2, 6)
        else:
            lora_slow_walk_score[sid] = max(lora_slow_walk_score[sid] - 2, 0)

        if lora_slow_walk_score[sid] >= 2:
            activity = "WALKING"
            confidence = 0.7
        else:
            activity = "STATIONARY"
            confidence = 0.82
    elif mag < 1.15 and abs(pitch) <= 40:
        activity = "STATIONARY"
        confidence = 0.8
        lora_slow_walk_score[sid] = max(lora_slow_walk_score[sid] - 1, 0)
    else:
        activity = "STATIONARY"
        confidence = 0.6
        lora_slow_walk_score[sid] = max(lora_slow_walk_score[sid] - 1, 0)

    # FFT cadence sanity-check for locomotion labels.
    if activity in {"WALKING", "RUNNING"}:
        low_f, high_f = (0.8, 3.0) if activity == "WALKING" else (1.6, 4.2)
        cadence_ok = low_f <= dom_freq <= high_f
        rhythm_ok = rhythm_score >= 0.14
        # Only downgrade if BOTH cadence and rhythm are weak.
        if not cadence_ok and not rhythm_ok:
            activity = "STATIONARY"
            confidence = min(confidence, 0.68)

    # GPS/IMU consistency check (collaborative sanity for low-confidence outliers).
    if prev_state is not None and prev_state.gps_valid and window.location.latitude != 0.0 and window.location.longitude != 0.0:
        dt_s = (window.timestamp - prev_state.timestamp).total_seconds()
        if dt_s > 0.2:
            speed_mps = _distance_m(
                prev_state.location.latitude,
                prev_state.location.longitude,
                window.location.latitude,
                window.location.longitude,
            ) / dt_s
            if activity == "RUNNING" and speed_mps < 1.5:
                activity = "WALKING"
                confidence = min(confidence, 0.75)
            elif activity == "WALKING" and speed_mps < 0.2 and mag_std < 0.12:
                activity = "STATIONARY"
                confidence = min(confidence, 0.74)
            elif activity == "STATIONARY" and speed_mps > 0.45 and abs(pitch) < 60:
                activity = "WALKING"
                confidence = max(confidence, 0.7)

    # Extra rescue path: if IMU says stationary but there is clear displacement in this window,
    # trust kinematics and lift to walking.
    if prev_state is not None and activity == "STATIONARY":
        dt_s = (window.timestamp - prev_state.timestamp).total_seconds()
        if dt_s > 0.2:
            moved_m = _distance_m(
                prev_state.location.latitude,
                prev_state.location.longitude,
                window.location.latitude,
                window.location.longitude,
            )
            if moved_m > 1.2:
                activity = "WALKING"
                confidence = max(confidence, 0.68)

    # Transition matrix style smoothing for implausible jumps.
    if prev_state is not None:
        prev_act = prev_state.activity
        if prev_act == "PRONE_STILL" and activity == "RUNNING":
            activity = "KNEELING_READY"
            confidence = min(confidence, 0.72)
        elif prev_act == "RUNNING" and activity == "PRONE_STILL":
            activity = "WALKING"
            confidence = min(confidence, 0.72)

        if activity != prev_act:
            required = 1
            if {prev_act, activity} in ({"PRONE_STILL", "RUNNING"}, {"CRAWLING", "RUNNING"}):
                required = 2

            if lora_transition_candidate[sid] == activity:
                lora_transition_count[sid] += 1
            else:
                lora_transition_candidate[sid] = activity
                lora_transition_count[sid] = 1

            if lora_transition_count[sid] < required:
                activity = prev_act
                confidence = min(confidence, prev_state.confidence)
        else:
            lora_transition_candidate[sid] = activity
            lora_transition_count[sid] = 0

    all_probs = {activity: confidence}

    # Determine GPS validity from window.location
    lat = getattr(window.location, 'latitude', None)
    lon = getattr(window.location, 'longitude', None)
    gps_valid = (
        lat is not None and lon is not None and
        isinstance(lat, (float, int)) and isinstance(lon, (float, int)) and
        lat != 0.0 and lon != 0.0
    )

    # Extract LoRa telemetry captured during ingestion
    telemetry = lora_latest_telemetry.get(window.soldier_id, {})
    temperature = float(telemetry.get("temperature", 0.0))
    rssi = int(telemetry.get("rssi", -120))

    alert, alert_msg = check_distress(window.soldier_id, activity)

    state = TacticalState(
        soldier_id    = window.soldier_id,
        timestamp     = window.timestamp,
        location      = window.location,
        gps_valid     = gps_valid,
        detected      = True,
        activity      = activity,
        confidence    = confidence,
        all_probs     = all_probs,
        alert         = alert,
        alert_message = alert_msg,
        temperature   = temperature,
        rssi          = rssi,
        load          = load,
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


async def lora_presence_watchdog() -> None:
    """Mark soldiers as not detected if their LoRa packets stop arriving."""
    try:
        while True:
            now = datetime.now(timezone.utc)
            stale_ids = [
                sid for sid, seen_at in lora_last_seen.items()
                if (now - seen_at).total_seconds() > lora_presence_timeout_s
            ]

            for sid in stale_ids:
                current = soldier_state.get(sid)
                if current is None or current.detected is False:
                    continue
                off_state = current.model_copy(update={"detected": False})
                soldier_state[sid] = off_state
                await broadcast({
                    "event": "state_update",
                    "payload": off_state.model_dump(mode="json"),
                })

            await asyncio.sleep(2.0)
    except asyncio.CancelledError:
        return


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
            # Keep-alive: client sends "ping", server responds "pong".
            # Ignore any other message so the socket stays open.
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text(json.dumps({"event": "pong"}))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Commander socket error: {e}")
    finally:
        if ws in commander_connections:
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
