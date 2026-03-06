# Dismounted Commander's Associate
## Rwanda Defence Force (RDF) — Tactical Edge Intelligence Prototype v0.1

---

### System Overview

Augments GPS tracking with **real-time tactical activity recognition** using accelerometer and gyroscope data from the soldier's Android tablet. The entire activity classification pipeline runs **on-device** (no network required for inference).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Soldier's Android Tablet]                                             │
│   ┌──────────────────────────────────────┐                             │
│   │  Sensors (50 Hz)                     │                             │
│   │  Accelerometer + Gyroscope           │                             │
│   │         │                            │                             │
│   │         ▼                            │                             │
│   │  SensorService                       │                             │
│   │  (128-sample sliding window)         │                             │
│   │         │                            │                             │
│   │         ▼                            │                             │
│   │  InferenceService (TFLite)           │  ◄── EDGE INFERENCE        │
│   │  tactical_lstm_quantised.tflite      │      No network needed     │
│   │         │                            │                             │
│   │         ▼                            │                             │
│   │  Predicted Activity + Confidence     │                             │
│   │  + GPS Location                      │                             │
│   └──────────┬───────────────────────────┘                             │
│              │  POST /api/soldier/report  (HTTP, ~0.64s intervals)     │
│              ▼                                                          │
│  [FastAPI Backend]                                                      │
│   ┌──────────────────────────────────────┐                             │
│   │  Receives sensor window              │                             │
│   │  Runs server-side inference          │                             │
│   │  Detects distress (PRONE_STILL > 6s) │                             │
│   │  Broadcasts via WebSocket            │                             │
│   └──────────┬───────────────────────────┘                             │
│              │  WS /ws/commander                                        │
│      ┌───────┴───────────┐                                             │
│      ▼                   ▼                                              │
│  [Flutter Commander App] [Web Dashboard]                                │
│   Map + real-time        Map + force picture                            │
│   soldier positions      alerts sidebar                                 │
│   activity icons         (Leaflet.js)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Tactical States

| State | Emoji | Description | UCI HAR Mapping |
|---|---|---|---|
| `WALKING` | 🚶 | Ground movement | WALKING + WALKING_UPSTAIRS + WALKING_DOWNSTAIRS |
| `KNEELING_READY` | 🎯 | Stationary, alert | SITTING + STANDING |
| `PRONE_STILL` | ⚠️ | Prone cover / possible distress | LAYING |
| `RUNNING` | 🏃 | Fast movement | _(requires real exercise data)_ |
| `CRAWLING` | 🪖 | Low-profile infiltration | _(requires real exercise data)_ |

> **Prototype limitation:** RUNNING and CRAWLING are not in the UCI HAR dataset. The current model classifies 3 states. Collecting labelled RDF exercise data is the top priority for the next sprint.

---

### Repository Structure

```
Scenario 4/
├── UCI HAR Dataset/          # Source dataset
├── ml/
│   ├── tactical_activity_recognition.ipynb   # Full ML pipeline (12 sections)
│   └── models/
│       ├── random_forest.pkl
│       ├── lstm_final.keras
│       ├── scaler.pkl
│       ├── label_encoder.pkl
│       └── tflite/
│           ├── tactical_lstm_quantised.tflite   ◄── deployed to Flutter
│           └── model_metadata.json
├── backend/
│   ├── main.py               # FastAPI app (REST + WebSocket)
│   ├── inference.py          # TFLite inference engine
│   ├── models.py             # Pydantic data models
│   ├── test_backend.py       # Smoke test
│   └── requirements.txt
├── flutter_app/
│   ├── lib/
│   │   ├── main.dart
│   │   ├── models/
│   │   ├── services/         # Sensor, Inference, API services
│   │   ├── providers/        # Riverpod state management
│   │   ├── screens/          # Role select, Soldier home, Commander map
│   │   └── widgets/          # Activity badge, Force status drawer
│   ├── assets/models/        # ← copy TFLite + metadata here
│   └── pubspec.yaml
└── web_dashboard/
    ├── index.html            # Commander web map
    ├── app.js                # WebSocket client + Leaflet.js map
    └── style.css
```

---

### Quick Start

#### 1. Train the model (run once)
```bash
cd ml
pip install jupyter pandas numpy scikit-learn imbalanced-learn tensorflow matplotlib seaborn joblib
jupyter notebook tactical_activity_recognition.ipynb
# Run all cells — model exports to ml/models/tflite/
```

#### 2. Copy TFLite assets to Flutter
```bash
copy ml\models\tflite\tactical_lstm_quantised.tflite flutter_app\assets\models\
copy ml\models\tflite\model_metadata.json            flutter_app\assets\models\
```

#### 3. Start the backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

#### 4. Open the web dashboard
```
Open web_dashboard/index.html in a browser (or serve with any static server)
```

#### 5. Build and run the Flutter app
```bash
cd flutter_app
flutter pub get
flutter run
# Select SOLDIER role on each soldier device
# Select COMMANDER role on the commander's device
```

---

### API Reference

| Method | Path | Description |
|---|---|---|
| `GET`  | `/health` | Service health |
| `POST` | `/api/soldier/register` | Register a soldier |
| `POST` | `/api/soldier/report` | Submit sensor window + get back classified state |
| `GET`  | `/api/force/status` | Snapshot of all active soldiers |
| `GET`  | `/api/soldier/{id}/history` | Last N predictions for one soldier |
| `WS`   | `/ws/commander` | Real-time state stream → commander dashboard |
| `WS`   | `/ws/soldier/{id}` | Alternative WebSocket ingestion from soldier device |

---

### Distress Detection

If a soldier's activity stays `PRONE_STILL` for **≥ 10 consecutive inference windows** (~6.4 seconds), the backend sets `alert = true` and broadcasts an alert message. The commander map highlights the soldier in red with a pulsing animation.

---

### Next Steps (Post-Prototype)

1. **Collect real military exercise data** — label RUNNING and CRAWLING with soldiers during training exercises
2. **Improve PRONE_STILL specificity** — add heart-rate or breath-rate signal from wearable to distinguish cover vs. casualty
3. **Mesh networking** — implement Meshtastic / LoRa off-mesh relay for the valleys with no bandwidth
4. **Authentication** — add JWT-based soldier identity verification
5. **Offline tile caching** — pre-cache OpenStreetMap tiles for Northern Province at zoom 13–18
6. **End-to-end encryption** — all sensor data must be encrypted in transit (TLS) for operational security
