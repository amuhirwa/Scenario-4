"""
Quick smoke test for the backend without needing the TFLite model.
Run: python test_backend.py
"""
import asyncio
import json
import random
from datetime import datetime, timezone

import httpx

BASE = "http://localhost:8000"


def make_fake_window(soldier_id: str, activity_hint: str = "walking") -> dict:
    """Generate a fake 128-sample IMU window for testing."""
    def channel(amplitude: float = 0.3) -> list[float]:
        return [round(random.gauss(0, amplitude), 4) for _ in range(128)]

    return {
        "soldier_id": soldier_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "location": {
            "latitude":  -1.9441 + random.uniform(-0.001, 0.001),
            "longitude": 30.0619 + random.uniform(-0.001, 0.001),
            "altitude_m": 1600.0,
        },
        "body_acc_x":  channel(0.5), "body_acc_y":  channel(0.3), "body_acc_z":  channel(0.4),
        "body_gyro_x": channel(0.1), "body_gyro_y": channel(0.1), "body_gyro_z": channel(0.1),
        "total_acc_x": channel(0.5), "total_acc_y": channel(0.3), "total_acc_z": channel(1.0),
    }


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        # Health check
        r = await client.get("/health")
        print("Health:", r.json())

        # Register soldiers
        soldiers = [
            {"soldier_id": "S001", "call_sign": "HAWK-1", "unit": "1 Platoon"},
            {"soldier_id": "S002", "call_sign": "HAWK-2", "unit": "1 Platoon"},
            {"soldier_id": "S003", "call_sign": "HAWK-3", "unit": "1 Platoon"},
        ]
        for s in soldiers:
            r = await client.post("/api/soldier/register", json=s)
            print("Registered:", r.json())

        # Send a few sensor windows
        for i in range(5):
            for sid in ["S001", "S002", "S003"]:
                body = make_fake_window(sid)
                r = await client.post("/api/soldier/report", json=body)
                if r.status_code == 200:
                    state = r.json()
                    print(f"  [{sid}] → {state['activity']} ({state['confidence']:.2f})"
                          + (" ⚠️  ALERT" if state.get("alert") else ""))
                else:
                    print(f"  [{sid}] ERROR {r.status_code}: {r.text}")

        # Get force status
        r = await client.get("/api/force/status")
        status_data = r.json()
        print(f"\nForce status ({len(status_data['soldiers'])} soldiers):")
        for s in status_data["soldiers"]:
            print(f"  {s['soldier_id']}: {s['activity']}  lat={s['location']['latitude']:.4f}")


if __name__ == "__main__":
    asyncio.run(main())
