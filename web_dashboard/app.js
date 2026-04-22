// web_dashboard/app.js
"use strict";

// ─── Configuration ────────────────────────────────────────────────────────────
const PAGE_HOST = window.location.hostname || "localhost";
const PAGE_PROTO = window.location.protocol === "https:" ? "https" : "http";
const WS_PROTO = PAGE_PROTO === "https" ? "wss" : "ws";
const BACKEND_WS = `${WS_PROTO}://${PAGE_HOST}:8000/ws/commander`;
const BACKEND_HTTP = `${PAGE_PROTO}://${PAGE_HOST}:8000`;
const ORS_API_KEY = window.localStorage.getItem("ors_api_key") || "";
const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";

// Northern Province, Rwanda (Musanze area)
const DEFAULT_CENTRE = [-1.4993, 29.634];
const DEFAULT_ZOOM = 14;

// Activity display metadata
const ACTIVITIES = {
  STATIONARY: {
    emoji: "🧍",
    color: "#26A69A",
    label: "STATIONARY",
    bg: "rgba(38,166,154,.15)",
    border: "rgba(38,166,154,.6)",
  },
  WALKING: {
    emoji: "🚶",
    color: "#4CAF50",
    label: "WALKING",
    bg: "rgba(76,175,80,.15)",
    border: "rgba(76,175,80,.6)",
  },
  RUNNING: {
    emoji: "🏃",
    color: "#2196F3",
    label: "RUNNING",
    bg: "rgba(33,150,243,.15)",
    border: "rgba(33,150,243,.6)",
  },
  CRAWLING: {
    emoji: "🪖",
    color: "#FF9800",
    label: "CRAWLING",
    bg: "rgba(255,152,0,.15)",
    border: "rgba(255,152,0,.6)",
  },
  KNEELING_READY: {
    emoji: "🎯",
    color: "#FFEB3B",
    label: "KNEELING",
    bg: "rgba(255,235,59,.15)",
    border: "rgba(255,235,59,.6)",
  },
  PRONE_STILL: {
    emoji: "⚠️",
    color: "#F44336",
    label: "PRONE",
    bg: "rgba(244,67,54,.15)",
    border: "rgba(244,67,54,.6)",
  },
};
const UNKNOWN_ACTIVITY = {
  emoji: "❓",
  color: "#9E9E9E",
  label: "UNKNOWN",
  bg: "rgba(158,158,158,.15)",
  border: "rgba(158,158,158,.4)",
};

function getActivity(name) {
  return ACTIVITIES[name] || UNKNOWN_ACTIVITY;
}

function isMovingActivity(activity) {
  // Treat these as non-moving postures for map position updates.
  return activity === "WALKING" || activity === "RUNNING" || activity === "CRAWLING";
}

// ─── State ────────────────────────────────────────────────────────────────────
let soldiers = {}; // soldierId → SoldierStatus
let markers = {}; // soldierId → Leaflet marker
let ws = null;
let wsAlive = false;
let pingInterval = null;
let selectedSoldierId = null;
let trackedSoldierId = null;
let routeLayer = null;
let lastRouteSignature = "";
let hasAutoFocusedFirstSoldier = false;
let userMovedMap = false;
let suppressMapInteractionFlag = false;

// Main node (dashboard) location
let mainNodeLocation = { latitude: DEFAULT_CENTRE[0], longitude: DEFAULT_CENTRE[1] };
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      mainNodeLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      renderSoldierList();
      renderSelectedSoldier();
      refreshTrackedRoute(true);
    },
    async () => {
      // Fallback to IP-based location if browser GPS permission is denied.
      try {
        const r = await fetch("https://ipapi.co/json/");
        if (!r.ok) return;
        const d = await r.json();
        if (typeof d.latitude === "number" && typeof d.longitude === "number") {
          mainNodeLocation = { latitude: d.latitude, longitude: d.longitude };
          renderSoldierList();
          renderSelectedSoldier();
          refreshTrackedRoute(true);
        }
      } catch (_) {
        // Keep map-center fallback when IP lookup is unavailable.
      }
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getDistanceToMainNode(soldier) {
  if (!mainNodeLocation) return null;
  const lat1 = mainNodeLocation.latitude;
  const lon1 = mainNodeLocation.longitude;
  const lat2 = soldier.location.latitude;
  const lon2 = soldier.location.longitude;
  return haversine(lat1, lon1, lat2, lon2);
}

function rssiToPercent(rssi) {
  // Map RSSI (-120 to -30) to 0-100%
  const v = Math.max(-120, Math.min(-30, rssi));
  return Math.round(((v + 120) / 90) * 100);
}

// ─── Map setup ────────────────────────────────────────────────────────────────
const map = L.map("map", { zoomControl: true }).setView(
  DEFAULT_CENTRE,
  DEFAULT_ZOOM,
);

function runProgrammaticMapMove(fn) {
  suppressMapInteractionFlag = true;
  try {
    fn();
  } finally {
    setTimeout(() => {
      suppressMapInteractionFlag = false;
    }, 600);
  }
}

map.on("dragstart", () => {
  if (!suppressMapInteractionFlag) userMovedMap = true;
});
map.on("zoomstart", () => {
  if (!suppressMapInteractionFlag) userMovedMap = true;
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

// ─── Legend ───────────────────────────────────────────────────────────────────
function buildLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "<h4>TACTICAL STATES</h4>";
  Object.values(ACTIVITIES).forEach((a) => {
    el.innerHTML += `
      <div class="legend-item">
        <div class="legend-dot" style="background:${a.color}"></div>
        <span>${a.emoji}</span>
        <span style="color:${a.color};font-weight:700">${a.label}</span>
      </div>`;
  });
}
buildLegend();

// ─── WebSocket ────────────────────────────────────────────────────────────────
function setConnectionStatus(state) {
  const pill = document.getElementById("conn-status");
  pill.className = `status-pill ${state}`;
  const dot = pill.querySelector(".dot");
  const txt = pill.querySelector(".conn-text");
  const states = {
    connected: "LIVE",
    connecting: "CONNECTING…",
    error: "DISCONNECTED",
  };
  txt.textContent = states[state] || state;
}

function connectWS() {
  setConnectionStatus("connecting");
  ws = new WebSocket(BACKEND_WS);

  ws.onopen = () => {
    wsAlive = true;
    setConnectionStatus("connected");
    pingInterval = setInterval(
      () => ws.readyState === 1 && ws.send("ping"),
      20000,
    );
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    wsAlive = false;
    clearInterval(pingInterval);
    setConnectionStatus("error");
    setTimeout(connectWS, 4000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleMessage(msg) {
  switch (msg.event) {
    case "state_update":
    case "alert":
      updateSoldier(msg.payload);
      break;

    case "force_picture":
      (msg.payload.soldiers || []).forEach((s) => updateSoldier(s));
      break;

    case "pong":
      break; // keep-alive ack
  }
}

// ─── Update soldier state ─────────────────────────────────────────────────────
function updateSoldier(state) {
  soldiers[state.soldier_id] = state;
  upsertMarker(state);
  if (trackedSoldierId === state.soldier_id) {
    refreshTrackedRoute(false);
  }
  renderSoldierList();
  renderAlerts();
  updateCountBadge();
  if (selectedSoldierId === state.soldier_id) {
    renderSelectedSoldier();
  }
}

function clearTrackedRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  lastRouteSignature = "";
}

async function fetchORSRoute(from, to) {
  if (!ORS_API_KEY) return null;
  try {
    const res = await fetch(ORS_DIRECTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || !coords.length) return null;
    return coords.map((c) => [c[1], c[0]]);
  } catch (_) {
    return null;
  }
}

async function refreshTrackedRoute(force) {
  if (!trackedSoldierId) {
    clearTrackedRoute();
    return;
  }

  const s = soldiers[trackedSoldierId];
  if (!s || s.detected === false || s.gps_valid === false || !mainNodeLocation) {
    clearTrackedRoute();
    return;
  }

  const from = {
    latitude: mainNodeLocation.latitude,
    longitude: mainNodeLocation.longitude,
  };
  const to = {
    latitude: s.location.latitude,
    longitude: s.location.longitude,
  };

  const signature = `${trackedSoldierId}:${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}->${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
  if (!force && signature === lastRouteSignature) return;
  lastRouteSignature = signature;

  const routeLatLngs = (await fetchORSRoute(from, to)) || [
    [from.latitude, from.longitude],
    [to.latitude, to.longitude],
  ];

  if (routeLayer) {
    map.removeLayer(routeLayer);
  }

  const usingFallbackLine = routeLatLngs.length === 2;
  routeLayer = L.polyline(routeLatLngs, {
    color: usingFallbackLine ? "#94a3b8" : "#38bdf8",
    weight: 4,
    opacity: 0.9,
    dashArray: usingFallbackLine ? "8 6" : null,
  }).addTo(map);

  // Optional auto-zoom while tracking, unless user has manually moved map.
  if (force && !userMovedMap && routeLayer) {
    runProgrammaticMapMove(() => {
      map.fitBounds(routeLayer.getBounds(), { padding: [30, 30], maxZoom: 17, animate: true });
    });
  }
}

function toggleTrackSelected() {
  if (!selectedSoldierId) return;

  if (trackedSoldierId === selectedSoldierId) {
    trackedSoldierId = null;
    clearTrackedRoute();
    renderSelectedSoldier();
    return;
  }

  trackedSoldierId = selectedSoldierId;
  refreshTrackedRoute(true);
  renderSelectedSoldier();
}

// ─── Map markers ─────────────────────────────────────────────────────────────
function buildMarkerIcon(state) {
  const act = getActivity(state.activity);
  const alertClass = state.alert ? "marker-alert" : "";
  const borderColor = state.alert ? "#F44336" : act.color;

  const html = `
    <div class="soldier-marker">
      <div class="marker-icon ${alertClass}"
           style="background:${act.bg};border-color:${borderColor}">
        ${act.emoji}
      </div>
      <div class="marker-label" style="color:${act.color}">${state.soldier_id}</div>
    </div>`;

  return L.divIcon({ html, className: "", iconAnchor: [22, 54] });
}

function upsertMarker(state) {
  if (state.gps_valid === false || state.detected === false) {
    if (markers[state.soldier_id]) {
      map.removeLayer(markers[state.soldier_id]);
      delete markers[state.soldier_id];
    }
    return;
  }

  const latlng = [state.location.latitude, state.location.longitude];

  if (markers[state.soldier_id]) {
    // Avoid GPS drift jitter, but still move if displacement is clearly real.
    const cur = markers[state.soldier_id].getLatLng();
    const movedMeters = haversine(cur.lat, cur.lng, latlng[0], latlng[1]);
    const forceMoveOnLargeDisplacement = movedMeters >= 8.0;
    if (isMovingActivity(state.activity) || forceMoveOnLargeDisplacement) {
      markers[state.soldier_id].setLatLng(latlng);
    }
    markers[state.soldier_id].setIcon(buildMarkerIcon(state));
  } else {
    const m = L.marker(latlng, { icon: buildMarkerIcon(state) }).addTo(map);
    m.bindPopup(() => buildPopupContent(soldiers[state.soldier_id]));
    m.on("click", () => {
      selectSoldier(state.soldier_id, true);
      m.getPopup().setContent(buildPopupContent(soldiers[state.soldier_id]));
    });
    markers[state.soldier_id] = m;

    if (!hasAutoFocusedFirstSoldier) {
      hasAutoFocusedFirstSoldier = true;
      if (!selectedSoldierId) {
        selectedSoldierId = state.soldier_id;
        renderSelectedSoldier();
      }
      runProgrammaticMapMove(() => {
        map.setView(latlng, DEFAULT_ZOOM, { animate: true });
      });
    }
  }
}

function buildPopupContent(state) {
  const act = getActivity(state.activity);
  const time = new Date(state.timestamp).toLocaleTimeString();
  const conf = (state.confidence * 100).toFixed(0);
  return `
    <div>
      <div class="popup-title">${state.soldier_id}</div>
      ${state.detected === false ? `<div style="color:#f59e0b;font-size:.75rem;margin-bottom:6px">📡 LORA OFF - marker hidden</div>` : ""}
      ${state.gps_valid === false ? `<div style="color:#f59e0b;font-size:.75rem;margin-bottom:6px">📡 GPS OFF - marker hidden</div>` : ""}
      <div class="popup-activity" style="color:${act.color}">
        ${act.emoji} ${act.label} &nbsp;·&nbsp; ${conf}% confidence
      </div>
      ${state.alert ? `<div style="color:#F44336;font-size:.75rem;margin-bottom:6px">⚠️ ${state.alert_message || "DISTRESS DETECTED"}</div>` : ""}
      <div class="popup-coords">
        ${state.location.latitude.toFixed(5)}°N &nbsp;
        ${state.location.longitude.toFixed(5)}°E &nbsp;
        ${(state.location.altitude_m || 0).toFixed(0)}m
      </div>
      <div class="popup-time">Last seen: ${time}</div>
    </div>`;
}

// ─── Sidebar: soldier list ────────────────────────────────────────────────────
function renderSoldierList() {
  const container = document.getElementById("soldier-list");
  const sorted = Object.values(soldiers).sort((a, b) => {
    if (a.alert !== b.alert) return a.alert ? -1 : 1;
    return a.soldier_id.localeCompare(b.soldier_id);
  });

  container.innerHTML = sorted
    .map((s) => {
      const act = getActivity(s.activity);
      const time = new Date(s.timestamp).toLocaleTimeString();
      const conf = (s.confidence * 100).toFixed(0);
      const alertBorder = s.alert ? "border-left:3px solid #F44336;" : "";
      const selectedBorder = selectedSoldierId === s.soldier_id ? "box-shadow:0 0 0 1px #7dd3fc inset;" : "";
      const offlineStyle = s.detected === false ? "opacity:.6;filter:grayscale(25%);" : "";
      const reachability = s.detected === false
        ? '<span style="margin-left:8px;color:#f59e0b;font-size:.68rem;font-weight:700;letter-spacing:.04em">OFF / CAN\'T REACH</span>'
        : '<span style="margin-left:8px;color:#22c55e;font-size:.68rem;font-weight:700;letter-spacing:.04em">ONLINE</span>';
      const temp = typeof s.temperature === "number" ? `${s.temperature.toFixed(1)}°C` : "N/A";
      const load = s.load || "UNKNOWN";
      const rssi = typeof s.rssi === "number" ? rssiToPercent(s.rssi) : 0;
      const dist = getDistanceToMainNode(s);
      const distStr = dist != null ? `${(dist/1000).toFixed(2)} km` : "-";
      return `
      <div class="soldier-card" style="${alertBorder}${selectedBorder}${offlineStyle}" onclick="selectSoldier('${s.soldier_id}', true)">
        <div class="card-icon" style="color:${act.color};border-color:${act.border};background:${act.bg}">
          ${act.emoji}
        </div>
        <div class="card-body">
          <div class="card-id">${s.soldier_id}${reachability}</div>
          <div style="margin:3px 0">
            <span class="activity-chip" style="color:${act.color};border-color:${act.border};background:${act.bg}">
              ${act.label}
            </span>
          </div>
          <div class="card-location">
            ${s.location.latitude.toFixed(4)}°N &nbsp;${s.location.longitude.toFixed(4)}°E
            &nbsp;·&nbsp; ${time}
          </div>
          <div style="font-size:.75rem;margin-top:2px">
            <b>Temp:</b> ${temp} &nbsp; <b>Load:</b> ${load} &nbsp; <b>Dist:</b> ${distStr}
          </div>
          <div style="font-size:.75rem;margin-top:2px">
            <b>Signal:</b> <span style="display:inline-block;width:40px;height:8px;background:#eee;border-radius:4px;vertical-align:middle;overflow:hidden"><span style="display:inline-block;height:8px;background:#22c55e;width:${rssi/2}px"></span></span> ${rssi}%
          </div>
        </div>
        <div class="conf-bar" style="color:${act.color}">${conf}%</div>
      </div>`;
    })
    .join("");
}

function panToSoldier(id) {
  const s = soldiers[id];
  if (!s) return;
  map.panTo([s.location.latitude, s.location.longitude], { animate: true });
  if (markers[id]) markers[id].openPopup();
}

function selectSoldier(id, openPopup = false) {
  selectedSoldierId = id;
  renderSelectedSoldier();
  renderSoldierList();
  if (openPopup) {
    panToSoldier(id);
  }
}

function renderSelectedSoldier() {
  const container = document.getElementById("selected-soldier");
  const s = soldiers[selectedSoldierId];

  if (!s) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#8b949e;font-size:0.78rem;">Click a soldier marker or card to view details.</div>';
    return;
  }

  const act = getActivity(s.activity);
  const time = new Date(s.timestamp).toLocaleTimeString();
  const conf = (s.confidence * 100).toFixed(0);
  const alt = s.location.altitude_m ?? 0;
  const accuracy = s.location.accuracy_m ?? "N/A";
  const detectedLine = s.detected === false ? '<div style="color:#f59e0b"><b>LoRa:</b> OFF</div>' : '<div style="color:#22c55e"><b>LoRa:</b> ON</div>';
  const gpsLine = s.gps_valid === false ? '<div style="color:#f59e0b"><b>GPS:</b> OFF / hidden from map</div>' : '<div style="color:#22c55e"><b>GPS:</b> ON</div>';
  const temp = typeof s.temperature === "number" ? `${s.temperature.toFixed(1)}°C` : "N/A";
  const load = s.load || "UNKNOWN";
  const rssi = typeof s.rssi === "number" ? rssiToPercent(s.rssi) : 0;
  const dist = getDistanceToMainNode(s);
  const distStr = dist != null ? `${(dist/1000).toFixed(2)} km` : "-";
  const trackOn = trackedSoldierId === s.soldier_id;
  const probs = s.all_probs && Object.keys(s.all_probs).length
    ? Object.entries(s.all_probs)
        .map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:.72rem;margin-top:4px"><span>${k}</span><span>${(v * 100).toFixed(0)}%</span></div>`)
        .join("")
    : '<div style="font-size:.72rem;color:#8b949e;margin-top:6px">No model probabilities yet.</div>';

  container.innerHTML = `
    <div style="padding:14px 16px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
        <div style="font-weight:800;font-size:1rem">${s.soldier_id}</div>
        <div class="activity-chip" style="color:${act.color};border-color:${act.border};background:${act.bg}">${act.label}</div>
      </div>
      <div style="font-size:.82rem;margin-bottom:8px;color:#c9d1d9">
        ${act.emoji} Confidence: <b>${conf}%</b>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button onclick="toggleTrackSelected()" style="background:${trackOn ? "#0ea5e9" : "#1f2937"};color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 10px;font-size:.72rem;font-weight:700;cursor:pointer">
          ${trackOn ? "TRACK: ON" : "TRACK: OFF"}
        </button>
      </div>
      ${s.alert ? `<div style="color:#F44336;font-size:.78rem;margin-bottom:8px">⚠️ ${s.alert_message || "DISTRESS DETECTED"}</div>` : ""}
      <div style="font-size:.76rem;line-height:1.55;color:#9fb3c8">
        ${detectedLine}
        ${gpsLine}
        <div><b>Latitude:</b> ${Number(s.location.latitude).toFixed(6)}</div>
        <div><b>Longitude:</b> ${Number(s.location.longitude).toFixed(6)}</div>
        <div><b>Altitude:</b> ${Number(alt).toFixed(0)} m</div>
        <div><b>Accuracy:</b> ${accuracy}</div>
        <div><b>Temp:</b> ${temp}</div>
        <div><b>Load:</b> ${load}</div>
        <div><b>Signal:</b> <span style="display:inline-block;width:40px;height:8px;background:#eee;border-radius:4px;vertical-align:middle;overflow:hidden"><span style="display:inline-block;height:8px;background:#22c55e;width:${rssi/2}px"></span></span> ${rssi}%</div>
        <div><b>Distance to Main Node:</b> ${distStr}</div>
        <div><b>Last seen:</b> ${time}</div>
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)">
        <div style="font-size:.72rem;font-weight:700;letter-spacing:.08em;color:#8b949e;margin-bottom:4px">MODEL PROBABILITIES</div>
        ${probs}
      </div>
    </div>`;
}

// ─── Sidebar: alerts ──────────────────────────────────────────────────────────
function renderAlerts() {
  const container = document.getElementById("alerts-container");
  const active = Object.values(soldiers).filter((s) => s.alert);

  if (!active.length) {
    container.innerHTML = '<div id="no-alerts">No active alerts</div>';
    return;
  }

  container.innerHTML = active
    .map((s) => {
      const time = new Date(s.timestamp).toLocaleTimeString();
      return `
      <div class="alert-item" onclick="panToSoldier('${s.soldier_id}')">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="alert-soldier">⚠️ ${s.soldier_id}</span>
          <span class="alert-time">${time}</span>
        </div>
        <div class="alert-msg">${s.alert_message || "Possible distress — PRONE_STILL prolonged"}</div>
      </div>`;
    })
    .join("");
}

// ─── Header badge ─────────────────────────────────────────────────────────────
function updateCountBadge() {
  const n = Object.keys(soldiers).length;
  document.getElementById("soldier-count").textContent =
    `${n} SOLDIER${n !== 1 ? "S" : ""} TRACKED`;
}

// ─── Poll REST on load (catch up before WS connects) ──────────────────────────
async function fetchInitialState() {
  try {
    const r = await fetch(`${BACKEND_HTTP}/api/force/status`);
    if (!r.ok) return;
    const data = await r.json();
    (data.soldiers || []).forEach((s) => updateSoldier(s));
  } catch (_) {
    // Backend not yet reachable — WebSocket reconnect will catch it
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
fetchInitialState();
connectWS();
renderSoldierList();
renderAlerts();
updateCountBadge();
