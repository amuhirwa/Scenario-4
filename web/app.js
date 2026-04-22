// web_dashboard/app.js
"use strict";

// ─── Configuration ────────────────────────────────────────────────────────────
const BACKEND_WS = "ws://localhost:8000/ws/commander";
const BACKEND_HTTP = "http://localhost:8000";

// Command Office default fallback (Kigali area)
const DEFAULT_COMMAND_NODE = [-1.9441, 30.0619];
const DEFAULT_ZOOM = 15;
const AUTO_TRACK_ZOOM = 17;
let commandNode = [...DEFAULT_COMMAND_NODE];

// Activity display metadata
const ACTIVITIES = {
  STATIONARY: {
    emoji: '<span class="state-emoji">🧍</span>',
    color: "#a3b8cc",
    label: "STATIONARY",
    bg: "rgba(163,184,204,.15)",
    border: "rgba(163,184,204,.6)",
  },
  WALKING: {
    emoji: '<span class="state-emoji">🚶</span>',
    color: "#00ff88",
    label: "WALKING",
    bg: "rgba(0,255,136,.15)",
    border: "rgba(0,255,136,.6)",
  },
  RUNNING: {
    emoji: '<span class="state-emoji">🏃</span>',
    color: "#00f3ff",
    label: "RUNNING",
    bg: "rgba(0,243,255,.15)",
    border: "rgba(0,243,255,.6)",
  },
  CRAWLING: {
    emoji: '<span class="state-emoji">🪖</span>',
    color: "#ff9800",
    label: "CRAWLING",
    bg: "rgba(255,152,0,.15)",
    border: "rgba(255,152,0,.6)",
  },
  KNEELING_READY: {
    emoji: '<span class="state-emoji">🧎</span>',
    color: "#ffeb3b",
    label: "KNEELING/READY",
    bg: "rgba(255,235,59,.15)",
    border: "rgba(255,235,59,.6)",
  },
  PRONE_STILL: {
    emoji: '<span class="state-emoji">🛌</span>',
    color: "#ff003c",
    label: "PRONE/STILL",
    bg: "rgba(255,0,60,.15)",
    border: "rgba(255,0,60,.6)",
  },
};

const UNKNOWN_ACTIVITY = {
  emoji: '<i class="fa-solid fa-question"></i>',
  color: "#9E9E9E",
  label: "UNKNOWN",
  bg: "rgba(158,158,158,.15)",
  border: "rgba(158,158,158,.4)",
};

function getActivity(name) {
  return ACTIVITIES[name] || UNKNOWN_ACTIVITY;
}

function getDistanceM(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "N/A";
  if (meters < 1000) return `${meters.toFixed(0)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatTemp(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}°C` : "N/A";
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} m/s` : "0.00 m/s";
}

function formatCoord(value, posSuffix, negSuffix) {
  const suffix = value >= 0 ? posSuffix : negSuffix;
  return `${Math.abs(value).toFixed(4)}°${suffix}`;
}

function getSignalText(state) {
  const quality = state.signal_quality || "POOR";
  const rssi = Number.isFinite(state.rssi) ? `${state.rssi} dBm` : "N/A";
  return `${quality} · ${rssi}`;
}

function hasValidGps(state) {
  return Boolean(
    state &&
      state.gps_valid &&
      state.location &&
      Number.isFinite(state.location.latitude) &&
      Number.isFinite(state.location.longitude) &&
      !(state.location.latitude === 0 && state.location.longitude === 0),
  );
}

// ─── State ────────────────────────────────────────────────────────────────────
let soldiers = {}; // soldierId → SoldierStatus
let markers = {}; // soldierId → Leaflet marker
let ws = null;
let wsAlive = false;
let pingInterval = null;
let selectedSoldierId = null;
let followSelected = false;
let firstSoldierAutoFocused = false;
let routeLine = null;
let commandMarker = null;

// ─── Map setup ────────────────────────────────────────────────────────────────
const map = L.map("map", { zoomControl: true }).setView(
  commandNode,
  DEFAULT_ZOOM,
);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles &copy; Esri &mdash; Source: Esri",
    maxZoom: 19,
  },
).addTo(map);

// Add Command Node Marker
const cmdIcon = L.divIcon({
  html: '<div style="font-size: 28px; color: #00f3ff;"><i class="fa-solid fa-tower-broadcast"></i></div>',
  className: "",
  iconAnchor: [14, 28],
});
commandMarker = L.marker(commandNode, { icon: cmdIcon })
  .addTo(map)
  .bindPopup(
    '<div class="popup-title" style="color:var(--primary)">COMMAND OFFICE</div>',
  );

// ─── Legend ───────────────────────────────────────────────────────────────────
function buildLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "<h4>TACTICAL STATES</h4>";
  Object.values(ACTIVITIES).forEach((a) => {
    el.innerHTML += `
      <div class="legend-item">
        <div class="legend-dot" style="background:${a.color}; color:${a.color}"></div>
        <span style="width:20px;text-align:center">${a.emoji}</span>
        <span style="color:${a.color};font-weight:700">${a.label}</span>
      </div>`;
  });
}
buildLegend();

function refreshSelectedPopup() {
  if (
    selectedSoldierId &&
    markers[selectedSoldierId] &&
    markers[selectedSoldierId].isPopupOpen()
  ) {
    markers[selectedSoldierId].setPopupContent(
      buildPopupContent(soldiers[selectedSoldierId]),
    );
  }
}

function setCommandOfficePosition(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  commandNode = [latitude, longitude];

  if (commandMarker) {
    commandMarker.setLatLng(commandNode);
    commandMarker.setPopupContent(
      '<div class="popup-title" style="color:var(--primary)">COMMAND OFFICE</div>',
    );
  }

  if (selectedSoldierId) {
    drawRouteToSoldier(selectedSoldierId);
  }

  refreshSelectedPopup();
  renderSoldierList();
  updateTrackingStatus();
}

function syncCommandOfficeToBrowser() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setCommandOfficePosition(
        position.coords.latitude,
        position.coords.longitude,
      );
    },
    () => {},
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    },
  );
}

// ─── Tracking UI ──────────────────────────────────────────────────────────────
function updateTrackingStatus() {
  const toolsEl = document.getElementById("map-tools");
  const statusEl = document.getElementById("tracking-status");
  const followBtn = document.getElementById("toggle-follow");
  if (!statusEl || !followBtn || !toolsEl) return;

  followBtn.textContent = `FOLLOW: ${followSelected ? "ON" : "OFF"}`;
  followBtn.classList.toggle("active", followSelected);

  if (!selectedSoldierId || !soldiers[selectedSoldierId]) {
    toolsEl.classList.add("is-hidden");
    statusEl.textContent = "Click a soldier on the map to open tracking.";
    statusEl.classList.remove("active");
    return;
  }

  toolsEl.classList.remove("is-hidden");

  const s = soldiers[selectedSoldierId];
  const distance = hasValidGps(s)
    ? formatDistance(
        getDistanceM(
          commandNode[0],
          commandNode[1],
          s.location.latitude,
          s.location.longitude,
        ),
      )
    : "GPS unavailable";

  statusEl.textContent = `Tracking ${selectedSoldierId} · direct route from command office · ${distance}${followSelected ? " · auto-follow active" : ""}`;
  statusEl.classList.add("active");
}

function clearRoute() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  selectedSoldierId = null;
  followSelected = false;
  updateTrackingStatus();
  renderSoldierList();
  refreshMarkers();
}

function bindMapTools() {
  const followBtn = document.getElementById("toggle-follow");
  const clearBtn = document.getElementById("clear-route");

  if (followBtn) {
    followBtn.addEventListener("click", () => {
      if (!selectedSoldierId || !soldiers[selectedSoldierId]) {
        followSelected = false;
        updateTrackingStatus();
        return;
      }
      followSelected = !followSelected;
      updateTrackingStatus();
      if (followSelected) {
        panToSoldier(selectedSoldierId, {
          openPopup: true,
          zoom: AUTO_TRACK_ZOOM,
          select: true,
        });
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => clearRoute());
  }

  updateTrackingStatus();
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function setConnectionStatus(state) {
  const pill = document.getElementById("conn-status");
  pill.className = `status-pill ${state}`;
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
      break;
  }
}

// ─── Update soldier state ─────────────────────────────────────────────────────
function updateSoldier(state) {
  soldiers[state.soldier_id] = state;
  upsertMarker(state);

  if (!firstSoldierAutoFocused && hasValidGps(state)) {
    firstSoldierAutoFocused = true;
    map.flyTo([state.location.latitude, state.location.longitude], AUTO_TRACK_ZOOM, {
      animate: true,
      duration: 0.6,
    });
  }

  if (selectedSoldierId === state.soldier_id) {
    drawRouteToSoldier(state.soldier_id);
    if (followSelected && hasValidGps(state)) {
      map.panTo([state.location.latitude, state.location.longitude], {
        animate: true,
      });
    }
  }

  renderSoldierList();
  renderAlerts();
  updateCountBadge();
  updateTrackingStatus();
}

// ─── Map markers ─────────────────────────────────────────────────────────────
function buildMarkerIcon(state) {
  const act = getActivity(state.activity);
  const isSelected = selectedSoldierId === state.soldier_id;
  const alertClass = state.alert ? "marker-alert" : "";
  const borderColor = state.alert
    ? "#ff003c"
    : isSelected
      ? "#ffffff"
      : act.color;

  const html = `
    <div class="soldier-marker">
      <div class="marker-icon ${alertClass}" style="color:${act.color}; border-color:${borderColor}">
        ${act.emoji}
      </div>
      <div class="marker-label" style="color:${act.color}; border-color:${borderColor}">${state.soldier_id}</div>
    </div>`;

  return L.divIcon({ html, className: "", iconAnchor: [24, 60] });
}

function refreshMarkers() {
  Object.values(soldiers).forEach((state) => {
    if (markers[state.soldier_id]) {
      markers[state.soldier_id].setIcon(buildMarkerIcon(state));
    }
  });
}

function upsertMarker(state) {
  if (!hasValidGps(state)) return;

  const latlng = [state.location.latitude, state.location.longitude];

  if (markers[state.soldier_id]) {
    markers[state.soldier_id].setLatLng(latlng);
    markers[state.soldier_id].setIcon(buildMarkerIcon(state));
    if (markers[state.soldier_id].isPopupOpen()) {
      markers[state.soldier_id].setPopupContent(
        buildPopupContent(soldiers[state.soldier_id]),
      );
    }
  } else {
    const m = L.marker(latlng, { icon: buildMarkerIcon(state) }).addTo(map);
    m.bindPopup(() => buildPopupContent(soldiers[state.soldier_id]));
    m.on("click", () => {
      selectedSoldierId = state.soldier_id;
      drawRouteToSoldier(state.soldier_id);
      m.getPopup().setContent(buildPopupContent(soldiers[state.soldier_id]));
      updateTrackingStatus();
      renderSoldierList();
      refreshMarkers();
    });
    markers[state.soldier_id] = m;
  }
}

function drawRouteToSoldier(id) {
  const s = soldiers[id];
  if (!s || !hasValidGps(s)) {
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    updateTrackingStatus();
    return;
  }

  const points = [
    [commandNode[0], commandNode[1]],
    [s.location.latitude, s.location.longitude],
  ];

  if (routeLine) {
    routeLine.setLatLngs(points);
  } else {
    routeLine = L.polyline(points, {
      color: "#00f3ff",
      weight: 4,
      opacity: 0.85,
      dashArray: "10 8",
      className: "route-line",
    }).addTo(map);
  }
  routeLine.bringToFront();
  updateTrackingStatus();
}

function buildPopupMetric(label, value, extraClass = "") {
  return `
    <div class="popup-metric ${extraClass}">
      <div class="popup-metric__label">${label}</div>
      <div class="popup-metric__value">${value}</div>
    </div>`;
}

function buildPopupContent(state) {
  const act = getActivity(state.activity);
  const time = new Date(state.timestamp).toLocaleTimeString();
  const conf = ((state.confidence || 0) * 100).toFixed(0);
  const dist = hasValidGps(state)
    ? getDistanceM(
        commandNode[0],
        commandNode[1],
        state.location.latitude,
        state.location.longitude,
      )
    : NaN;
  const smallMoveText = state.small_movement ? "YES" : "NO";
  const coords = hasValidGps(state)
    ? `${formatCoord(state.location.latitude, "N", "S")} · ${formatCoord(state.location.longitude, "E", "W")}`
    : "GPS LOCK PENDING";

  return `
    <div>
      <div class="popup-title">${state.soldier_id}</div>
      <div class="popup-activity" style="color:${act.color}">
        ${act.emoji} ${act.label} &nbsp;·&nbsp; ${conf}% confidence
      </div>
      ${state.alert ? `<div style="color:#F44336;font-size:.75rem;margin-bottom:6px">⚠️ ${state.alert_message || "DISTRESS DETECTED"}</div>` : ""}
      <div class="popup-coords">${coords}</div>
      <div class="popup-time">Last seen: ${time}</div>
      <div class="popup-grid">
        ${buildPopupMetric("DIST TO OFFICE", formatDistance(dist))}
        ${buildPopupMetric("SIGNAL", getSignalText(state))}
        ${buildPopupMetric("TEMP", formatTemp(state.temperature))}
        ${buildPopupMetric("LOAD", state.load || "UNKNOWN")}
        ${buildPopupMetric("SPEED", formatSpeed(state.speed_mps || 0))}
        ${buildPopupMetric("MOVE", formatDistance(state.movement_m || 0))}
        ${buildPopupMetric("MICRO MOVE", smallMoveText)}
        ${buildPopupMetric("CALIBRATED", state.calibrated ? "READY" : "PENDING")}
      </div>
    </div>`;
}

// ─── Sidebar: soldier list ────────────────────────────────────────────────────
function renderSoldierList() {
  const container = document.getElementById("soldier-list");
  const sorted = Object.values(soldiers).sort((a, b) => {
    if (a.alert !== b.alert) return a.alert ? -1 : 1;
    return a.soldier_id.localeCompare(b.soldier_id);
  });

  if (!sorted.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-spinner fa-spin"></i><br />
        Awaiting telemetry data…
      </div>`;
    return;
  }

  container.innerHTML = sorted
    .map((s) => {
      const act = getActivity(s.activity);
      const time = new Date(s.timestamp).toLocaleTimeString();
      const conf = ((s.confidence || 0) * 100).toFixed(0);
      const dist = hasValidGps(s)
        ? getDistanceM(
            commandNode[0],
            commandNode[1],
            s.location.latitude,
            s.location.longitude,
          )
        : NaN;
      const isSelected = selectedSoldierId === s.soldier_id;
      const alertBorder = s.alert
        ? "border-left: 3px solid #ff003c; background: rgba(255,0,60,0.15);"
        : "";
      const selectedBorder = isSelected
        ? "box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5), 0 0 12px rgba(0,243,255,0.18);"
        : "";
      const coords = hasValidGps(s)
        ? `${formatCoord(s.location.latitude, "N", "S")} ${formatCoord(s.location.longitude, "E", "W")}`
        : "GPS PENDING";

      return `
      <div class="soldier-card" style="${alertBorder}${selectedBorder}" onclick="panToSoldier('${s.soldier_id}', { select: false })">
        <div class="card-icon" style="color:${act.color}; border-color:${act.color}; background:rgba(0,0,0,0.5);">
          ${act.emoji}
        </div>
        <div class="card-body">
          <div class="card-id">${s.soldier_id} <span style="float:right; font-size:0.7rem; color:var(--text-muted);">${formatDistance(dist)} from Command Office</span></div>
          <div style="margin:4px 0; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="activity-chip" style="color:${act.color}; border-color:${act.color}; background:${act.bg}">
              ${act.label}
            </span>
            ${s.load && s.load !== "UNKNOWN" ? `<span class="load-chip ${s.load}">${s.load} LOAD</span>` : ""}
          </div>
          <div class="card-location">
            ${coords} &nbsp;///&nbsp; ${time}
          </div>
          <div class="card-metrics">
            <span class="metric-chip">${formatTemp(s.temperature)}</span>
            <span class="signal-chip ${s.signal_quality || "POOR"}">${getSignalText(s)}</span>
            <span class="metric-chip">${formatSpeed(s.speed_mps || 0)}</span>
            <span class="metric-chip">${formatDistance(s.movement_m || 0)} moved</span>
            ${s.small_movement ? '<span class="movement-chip active">SMALL MOVE</span>' : ""}
            <span class="cal-chip ${s.calibrated ? "ready" : "pending"}">${s.calibrated ? "CAL READY" : "CAL PENDING"}</span>
          </div>
        </div>
        <div class="conf-bar" style="color:${act.color}">${conf}%<br><span style="font-size:0.55rem;color:var(--text-muted)">CONF</span></div>
      </div>`;
    })
    .join("");
}

function panToSoldier(id, options = {}) {
  const s = soldiers[id];
  if (!s) return;

  const { openPopup = true, zoom = AUTO_TRACK_ZOOM, select = true } = options;

  if (select) {
    selectedSoldierId = id;
    drawRouteToSoldier(id);
    renderSoldierList();
    refreshMarkers();
  }

  if (hasValidGps(s)) {
    map.flyTo([s.location.latitude, s.location.longitude], zoom, {
      animate: true,
      duration: 0.6,
    });
    if (markers[id] && openPopup) markers[id].openPopup();
  }

  updateTrackingStatus();
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
      <div class="alert-item" onclick="panToSoldier('${s.soldier_id}', { select: false })" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="alert-soldier"><i class="fa-solid fa-triangle-exclamation"></i> ${s.soldier_id}</span>
          <span class="alert-time">${time}</span>
        </div>
        <div class="alert-msg">${s.alert_message || "CRITICAL DISTRESS — PRONE_STILL EXCEEDS THRESHOLD"}</div>
      </div>`;
    })
    .join("");
}

// ─── Header badge ─────────────────────────────────────────────────────────────
function updateCountBadge() {
  const n = Object.keys(soldiers).length;
  document.getElementById("soldier-count").textContent =
    `${n} ACTIVE SQUAD MEMBER${n !== 1 ? "S" : ""}`;
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
bindMapTools();
syncCommandOfficeToBrowser();
fetchInitialState();
connectWS();
renderSoldierList();
renderAlerts();
updateCountBadge();
