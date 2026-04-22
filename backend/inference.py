"""
Formula-first tactical inference configuration.

The backend now classifies tactical state directly in `main.py` using:
- IMU auto-calibration
- fused pitch / terrain compensation
- FFT cadence checks
- GPS consistency heuristics
- transition smoothing

This module remains only as a small compatibility layer for shared constants.
"""
from __future__ import annotations

# ─── Distress detection ───────────────────────────────────────────────────────
# If a soldier has been PRONE_STILL for this many consecutive windows, raise alert
PRONE_ALERT_WINDOWS = 10     # 10 × 0.64 s ≈ 6.4 seconds of no movement
