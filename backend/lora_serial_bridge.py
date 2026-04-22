"""
LoRa receiver -> backend bridge.

Reads parsed packet lines from the Arduino LoRa receiver serial monitor,
buffers raw MPU samples into 128-sample windows, and POSTs directly to:
  /api/soldier/report

This replaces the phone ingestion path.

Run:
  python lora_serial_bridge.py --port /dev/ttyACM0 --base-url http://localhost:8000
"""
from __future__ import annotations

import argparse
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any

import httpx
import serial


def parse_csv_payload(payload: str) -> dict[str, str] | None:
    """
    Expected CSV payload:
    SOLDIER_ID,LAT,LON,AX,AY,AZ,GX,GY,GZ,TEMP_RAW
    """
    parts = [p.strip() for p in payload.split(",")]
    if len(parts) != 10:
        return None
    return {
        "ID": parts[0],
        "Lat": parts[1],
        "Lon": parts[2],
        "Accel X": parts[3],
        "Accel Y": parts[4],
        "Accel Z": parts[5],
        "Gyro X": parts[6],
        "Gyro Y": parts[7],
        "Gyro Z": parts[8],
        "Temp Raw": parts[9],
    }


def parse_line_kv(line: str) -> tuple[str, str] | None:
    if ":" not in line:
        return None
    k, v = line.split(":", 1)
    return k.strip(), v.strip()


def to_float(value: str, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def is_valid_location(lat_str: str, lon_str: str) -> bool:
    if lat_str == "GPS INVALID" or lon_str == "GPS INVALID":
        return False
    try:
        lat = float(lat_str)
        lon = float(lon_str)
        return -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0
    except Exception:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Bridge LoRa receiver serial data to backend")
    parser.add_argument("--port", required=True, help="Serial port of receiver Arduino (example: /dev/ttyACM0)")
    parser.add_argument("--baud", type=int, default=9600, help="Serial baud rate")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    parser.add_argument("--window-size", type=int, default=128, help="Samples per inference window")
    parser.add_argument("--stride", type=int, default=64, help="Samples between posts once window is full")
    parser.add_argument("--timeout", type=float, default=1.0, help="Serial read timeout")
    args = parser.parse_args()

    # Per-soldier rolling buffers for model channels.
    channels = [
        "body_acc_x", "body_acc_y", "body_acc_z",
        "body_gyro_x", "body_gyro_y", "body_gyro_z",
        "total_acc_x", "total_acc_y", "total_acc_z",
    ]
    buffers: dict[str, dict[str, deque[float]]] = defaultdict(
        lambda: {ch: deque(maxlen=args.window_size) for ch in channels}
    )
    # Track last valid GPS by soldier.
    last_location: dict[str, tuple[float, float]] = {}
    # Track downsampling stride per soldier.
    since_last_post: dict[str, int] = defaultdict(int)

    current: dict[str, str] = {}

    with serial.Serial(args.port, args.baud, timeout=args.timeout) as ser, httpx.Client(base_url=args.base_url, timeout=20) as client:
        print(f"[Bridge] Listening on {args.port} @ {args.baud}")
        print(f"[Bridge] Posting windows to {args.base_url}/api/soldier/report")

        while True:
            raw = ser.readline()
            if not raw:
                continue

            line = raw.decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            # Accept either parsed blocks (ID: ..., Accel X: ...) or raw CSV lines.
            if line.startswith("Raw:"):
                payload = line.replace("Raw:", "", 1).strip()
                parsed = parse_csv_payload(payload)
                if parsed:
                    current = parsed

            kv = parse_line_kv(line)
            if kv:
                key, val = kv
                if key in {"ID", "Lat", "Lon", "Accel X", "Accel Y", "Accel Z", "Gyro X", "Gyro Y", "Gyro Z", "Temp Raw"}:
                    current[key] = val

            # Packet boundary: publish when separator appears and we have a full sample.
            if line.startswith("-------------------"):
                required = {"ID", "Lat", "Lon", "Accel X", "Accel Y", "Accel Z", "Gyro X", "Gyro Y", "Gyro Z"}
                if not required.issubset(current.keys()):
                    current = {}
                    continue

                sid = current["ID"]
                ax = to_float(current["Accel X"])
                ay = to_float(current["Accel Y"])
                az = to_float(current["Accel Z"])
                gx = to_float(current["Gyro X"])
                gy = to_float(current["Gyro Y"])
                gz = to_float(current["Gyro Z"])

                if is_valid_location(current["Lat"], current["Lon"]):
                    lat = float(current["Lat"])
                    lon = float(current["Lon"])
                    last_location[sid] = (lat, lon)
                else:
                    lat, lon = last_location.get(sid, (0.0, 0.0))

                b = buffers[sid]
                b["body_acc_x"].append(ax)
                b["body_acc_y"].append(ay)
                b["body_acc_z"].append(az)
                b["body_gyro_x"].append(gx)
                b["body_gyro_y"].append(gy)
                b["body_gyro_z"].append(gz)
                # total_acc is fed with same raw accel channels from LoRa packet.
                b["total_acc_x"].append(ax)
                b["total_acc_y"].append(ay)
                b["total_acc_z"].append(az)

                since_last_post[sid] += 1
                ready = len(b["body_acc_x"]) == args.window_size
                should_post = ready and since_last_post[sid] >= args.stride

                if should_post:
                    since_last_post[sid] = 0
                    body: dict[str, Any] = {
                        "soldier_id": sid,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "location": {
                            "latitude": lat,
                            "longitude": lon,
                            "altitude_m": None,
                            "accuracy_m": None,
                        },
                        "body_acc_x": list(b["body_acc_x"]),
                        "body_acc_y": list(b["body_acc_y"]),
                        "body_acc_z": list(b["body_acc_z"]),
                        "body_gyro_x": list(b["body_gyro_x"]),
                        "body_gyro_y": list(b["body_gyro_y"]),
                        "body_gyro_z": list(b["body_gyro_z"]),
                        "total_acc_x": list(b["total_acc_x"]),
                        "total_acc_y": list(b["total_acc_y"]),
                        "total_acc_z": list(b["total_acc_z"]),
                    }

                    try:
                        resp = client.post("/api/soldier/report", json=body)
                        if resp.status_code == 200:
                            state = resp.json()
                            print(
                                f"[Bridge] {sid} -> {state.get('activity', 'UNKNOWN')} "
                                f"({state.get('confidence', 0.0):.2f})"
                            )
                        else:
                            print(f"[Bridge] POST failed {resp.status_code}: {resp.text}")
                    except Exception as exc:
                        print(f"[Bridge] POST error: {exc}")
                else:
                    print(f"[Bridge] Sample buffered for {sid}: {len(b['body_acc_x'])}/{args.window_size}")

                current = {}


if __name__ == "__main__":
    main()
