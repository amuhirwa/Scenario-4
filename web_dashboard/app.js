// web_dashboard/app.js
"use strict";

// ─── Configuration ────────────────────────────────────────────────────────────
const BACKEND_WS = "ws://localhost:8000/ws/commander";
const BACKEND_HTTP = "http://localhost:8000";

// Northern Province, Rwanda (Musanze area)
const DEFAULT_CENTRE = [-1.4993, 29.634];
const DEFAULT_ZOOM = 14;

// Activity display metadata
const ACTIVITIES = {
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

// ─── State ────────────────────────────────────────────────────────────────────
let soldiers = {}; // soldierId → SoldierStatus
let markers = {}; // soldierId → Leaflet marker
let ws = null;
let wsAlive = false;
let pingInterval = null;

// ─── Map setup ────────────────────────────────────────────────────────────────
const map = L.map("map", { zoomControl: true }).setView(
  DEFAULT_CENTRE,
  DEFAULT_ZOOM,
);

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
  renderSoldierList();
  renderAlerts();
  updateCountBadge();
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
  const latlng = [state.location.latitude, state.location.longitude];

  if (markers[state.soldier_id]) {
    markers[state.soldier_id].setLatLng(latlng);
    markers[state.soldier_id].setIcon(buildMarkerIcon(state));
  } else {
    const m = L.marker(latlng, { icon: buildMarkerIcon(state) }).addTo(map);
    m.bindPopup(() => buildPopupContent(state));
    m.on("click", () => {
      m.getPopup().setContent(buildPopupContent(soldiers[state.soldier_id]));
    });
    markers[state.soldier_id] = m;
  }
}

function buildPopupContent(state) {
  const act = getActivity(state.activity);
  const time = new Date(state.timestamp).toLocaleTimeString();
  const conf = (state.confidence * 100).toFixed(0);
  return `
    <div>
      <div class="popup-title">${state.soldier_id}</div>
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
      return `
      <div class="soldier-card" style="${alertBorder}" onclick="panToSoldier('${s.soldier_id}')">
        <div class="card-icon" style="color:${act.color};border-color:${act.border};background:${act.bg}">
          ${act.emoji}
        </div>
        <div class="card-body">
          <div class="card-id">${s.soldier_id}</div>
          <div style="margin:3px 0">
            <span class="activity-chip" style="color:${act.color};border-color:${act.border};background:${act.bg}">
              ${act.label}
            </span>
          </div>
          <div class="card-location">
            ${s.location.latitude.toFixed(4)}°N &nbsp;${s.location.longitude.toFixed(4)}°E
            &nbsp;·&nbsp; ${time}
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
