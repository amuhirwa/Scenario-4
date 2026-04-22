// web_dashboard/app.js
"use strict";

// ─── Configuration ────────────────────────────────────────────────────────────
const PAGE_HOST   = window.location.hostname || "localhost";
const PAGE_PROTO  = window.location.protocol === "https:" ? "https" : "http";
const WS_PROTO    = PAGE_PROTO === "https" ? "wss" : "ws";
const BACKEND_WS  = `${WS_PROTO}://${PAGE_HOST}:8000/ws/commander`;
const BACKEND_HTTP = `${PAGE_PROTO}://${PAGE_HOST}:8000`;
const ORS_API_KEY  = window.localStorage.getItem("ors_api_key") || "";
const ORS_URL      = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";
const OSRM_URL     = "https://router.project-osrm.org/route/v1/foot";

const DEFAULT_CENTRE = [-1.4993, 29.634];
const DEFAULT_ZOOM   = 14;

// ─── Activity metadata ────────────────────────────────────────────────────────
const ACTIVITIES = {
  STATIONARY: { emoji: "🧍", color: "#00e5ff", label: "STATIONARY", bg: "rgba(0,229,255,.08)", border: "rgba(0,229,255,.5)" },
  WALKING:    { emoji: "🚶", color: "#00ff41", label: "WALKING",    bg: "rgba(0,255,65,.08)",  border: "rgba(0,255,65,.5)"  },
  RUNNING:    { emoji: "🏃", color: "#ff8c00", label: "RUNNING",    bg: "rgba(255,140,0,.08)", border: "rgba(255,140,0,.5)" },
};
const UNKNOWN_ACTIVITY = { emoji: "?", color: "#555", label: "UNKNOWN", bg: "rgba(85,85,85,.06)", border: "rgba(85,85,85,.3)" };

function getActivity(name) { return ACTIVITIES[name] || UNKNOWN_ACTIVITY; }

// ─── Soldier profile registry ─────────────────────────────────────────────────
const soldierProfiles = {};

const _NAMES       = ["Alain Muhirwa"];
const _BATTALIONS  = ["1st RDF Infantry Bn","2nd Mechanised Bn","3rd Recce Bn","4th Ranger Bn","5th Special Forces Bn","6th Support Bn","Republican Guard"];
const _COMMANDERS  = ["Lt. Col. Loue Sauveur C.","Maj. Rutaganda A.","Cpt. Habimana E.","Lt. Col. Nkusi J.","Maj. Bizumuremyi P.","Col. Uwera M.","Cpt. Ian Kagame"];
const _RANKS       = ["Cpt."];
const _BLOOD_TYPES = ["A+","A-","B+","B-","AB+","AB-","O+","O-"];

function getSoldierProfile(soldier_id) {
  if (soldierProfiles[soldier_id]) return soldierProfiles[soldier_id];
  const h = Math.abs([...soldier_id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0));
  const h2 = (h * 1000003) >>> 0;
  const h3 = (h * 999983)  >>> 0;
  soldierProfiles[soldier_id] = {
    name:          _NAMES[(h) % _NAMES.length],
    rank:          _RANKS[(h * 3) % _RANKS.length],
    age:           20 + (h % 16),
    blood_type:    _BLOOD_TYPES[(h * 5) % _BLOOD_TYPES.length],
    height_cm:     165 + (h % 26),
    weight_kg:     62 + (h % 30),
    battalion:     _BATTALIONS[(h) % _BATTALIONS.length],
    commander:     _COMMANDERS[(h * 7) % _COMMANDERS.length],
    service_years: 1 + (h % 10),
    phone:         `+250 7${String(20 + (h % 80)).padStart(2,"0")} ${String(h2 % 1000).padStart(3,"0")} ${String(h3 % 1000).padStart(3,"0")}`,
    national_id:   `1${2000 + (h % 25)}${(h % 7) + 1}${String(h2 % 10000000).padStart(7,"0")}${h3 % 10}${String(h % 100).padStart(2,"0")}`,
    military_id:   `RDF-${String(h % 100000).padStart(5,"0")}`,
  };
  return soldierProfiles[soldier_id];
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function buildSVGAvatar(soldier_id, color = "#00ff41", size = 64) {
  const initials = soldier_id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "??";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <defs>
      <radialGradient id="ag${size}" cx="50%" cy="30%" r="60%">
        <stop offset="0%" stop-color="${color}" stop-opacity=".08"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="64" height="64" rx="3" fill="#060d0a"/>
    <rect width="64" height="64" rx="3" fill="url(#ag${size})"/>
    <rect width="64" height="64" rx="3" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity=".35"/>
    <path d="M20 27 Q20 10 32 9 Q44 10 44 27" fill="none" stroke="${color}" stroke-width="2" stroke-opacity=".6" stroke-linecap="round"/>
    <line x1="18" y1="27" x2="46" y2="27" stroke="${color}" stroke-width="1.5" stroke-opacity=".4"/>
    <circle cx="32" cy="33" r="9" fill="#060d0a" stroke="${color}" stroke-width="1.5" stroke-opacity=".55"/>
    <path d="M18 58 L18 46 Q18 40 32 39 Q46 40 46 46 L46 58" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity=".45" stroke-linecap="round"/>
    <text x="32" y="37" text-anchor="middle" dominant-baseline="middle"
      font-family="Rajdhani,Arial,sans-serif" font-size="10" font-weight="700"
      fill="${color}" opacity=".9">${initials}</text>
  </svg>`;
}

const PROFILE_PHOTO = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTS-RwjJuPscWrFDP8mghWXGWdwP59oFqu64Q&s";

function buildAvatar(soldier_id, color = "#00ff41", size = 64) {
  const svgUri = "data:image/svg+xml," + encodeURIComponent(buildSVGAvatar(soldier_id, color, size));
  return `<img src="gh.png"
    width="${size}" height="${size}"
    style="display:block;width:${size}px;height:${size}px;object-fit:cover;object-position:center top;"
    onerror="this.src='${svgUri}';this.onerror=null"/>`;
}

function isMovingActivity(a) { return a === "WALKING" || a === "RUNNING"; }

// ─── Runtime state ────────────────────────────────────────────────────────────
let soldiers        = {};
let markers         = {};
let ws              = null;
let wsAlive         = false;
let pingInterval    = null;
let selectedId      = null;
let trackedId       = null;
let routeLayer      = null;
let lastRouteSig    = "";
let autoFocusDone   = false;
let userMovedMap    = false;
let suppressMapFlag = false;
let layerMode       = "sat";  // "map" | "sat"

// Movement trails  soldier_id -> [[lat,lon], ...] (capped at 500 pts)
const soldierTrails = {};
// Live trail polylines on map  soldier_id -> L.polyline
const trailLayers   = {};

// Dashboard (main node) location
let mainLoc = { latitude: DEFAULT_CENTRE[0], longitude: DEFAULT_CENTRE[1] };
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      mainLoc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      renderSoldierList(); renderSelectedSoldier(); refreshRoute(true);
    },
    async () => {
      try {
        const r = await fetch("https://ipapi.co/json/");
        const d = await r.json();
        if (typeof d.latitude === "number") {
          mainLoc = { latitude: d.latitude, longitude: d.longitude };
          renderSoldierList(); renderSelectedSoldier(); refreshRoute(true);
        }
      } catch (_) {}
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLon/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distToMain(soldier) {
  if (!mainLoc) return null;
  return haversine(mainLoc.latitude, mainLoc.longitude, soldier.location.latitude, soldier.location.longitude);
}


// ─── Map setup ────────────────────────────────────────────────────────────────
const map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTRE, DEFAULT_ZOOM);

map.on("dragstart", () => { if (!suppressMapFlag) userMovedMap = true; });
map.on("zoomstart", () => { if (!suppressMapFlag) userMovedMap = true; });

function runMapMove(fn) {
  suppressMapFlag = true;
  try { fn(); } finally { setTimeout(() => { suppressMapFlag = false; }, 600); }
}

const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors", maxZoom: 19,
});
const satLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "© Esri — Esri, i-cubed, USDA, AEX, GeoEye, GeoEye-1, USGS", maxZoom: 19 }
);
const satLabelLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19, opacity: 0.7 }
);
// Default: satellite on load
satLayer.addTo(map);
satLabelLayer.addTo(map);

function toggleMapLayer() {
  const btn = document.getElementById("layer-toggle-btn");
  if (layerMode === "map") {
    map.removeLayer(osmLayer);
    satLayer.addTo(map);
    satLabelLayer.addTo(map);
    layerMode = "sat";
    btn.textContent = "MAP VIEW";
    btn.classList.add("active");
  } else {
    map.removeLayer(satLayer);
    map.removeLayer(satLabelLayer);
    osmLayer.addTo(map);
    layerMode = "map";
    btn.textContent = "SAT VIEW";
    btn.classList.remove("active");
  }
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function buildLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "<h4>TACTICAL STATES</h4>";
  Object.values(ACTIVITIES).forEach(a => {
    el.innerHTML += `<div class="legend-item">
      <div class="legend-dot" style="background:${a.color};border-color:${a.border};box-shadow:0 0 5px ${a.border}"></div>
      <span style="color:${a.color};letter-spacing:1.5px;text-shadow:0 0 6px ${a.border}">${a.emoji} ${a.label}</span>
    </div>`;
  });
}
buildLegend();

// ─── WebSocket ────────────────────────────────────────────────────────────────
function setConnStatus(state) {
  const pill = document.getElementById("conn-status");
  pill.className = `status-pill ${state}`;
  pill.querySelector(".conn-text").textContent = { connected:"LIVE", connecting:"CONNECTING…", error:"DISCONNECTED" }[state] || state;
}

function connectWS() {
  setConnStatus("connecting");
  ws = new WebSocket(BACKEND_WS);
  ws.onopen  = () => { wsAlive = true; setConnStatus("connected"); pingInterval = setInterval(() => ws.readyState === 1 && ws.send("ping"), 20000); };
  ws.onclose = () => { wsAlive = false; clearInterval(pingInterval); setConnStatus("error"); setTimeout(connectWS, 4000); };
  ws.onerror = () => ws.close();
  ws.onmessage = evt => {
    const msg = JSON.parse(evt.data);
    if (msg.event === "state_update" || msg.event === "alert") updateSoldier(msg.payload);
    else if (msg.event === "force_picture") (msg.payload.soldiers || []).forEach(updateSoldier);
  };
}

// ─── Soldier state updates ────────────────────────────────────────────────────
function updateSoldier(state) {
  soldiers[state.soldier_id] = state;
  addToTrail(state);
  upsertMarker(state);
  if (trackedId === state.soldier_id) refreshRoute(false);
  renderSoldierList();
  renderAlerts();
  updateCountBadge();
  if (selectedId === state.soldier_id) renderSelectedSoldier();
}

// ─── Routing ──────────────────────────────────────────────────────────────────
function clearRoute() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  lastRouteSig = "";
}

async function fetchORSRoute(from, to) {
  if (!ORS_API_KEY) return null;
  try {
    const res = await fetch(ORS_URL, {
      method: "POST",
      headers: { Authorization: ORS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]] }),
    });
    if (!res.ok) return null;
    const coords = (await res.json())?.features?.[0]?.geometry?.coordinates;
    return Array.isArray(coords) && coords.length ? coords.map(c => [c[1], c[0]]) : null;
  } catch (_) { return null; }
}

async function fetchOSRMRoute(from, to) {
  try {
    const url = `${OSRM_URL}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const coords = (await res.json())?.routes?.[0]?.geometry?.coordinates;
    return Array.isArray(coords) && coords.length ? coords.map(c => [c[1], c[0]]) : null;
  } catch (_) { return null; }
}

async function refreshRoute(force) {
  if (!trackedId) { clearRoute(); return; }
  const s = soldiers[trackedId];
  if (!s || s.detected === false || s.gps_valid === false || !mainLoc) { clearRoute(); return; }

  const from = { latitude: mainLoc.latitude, longitude: mainLoc.longitude };
  const to   = { latitude: s.location.latitude, longitude: s.location.longitude };
  const sig  = `${trackedId}:${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}->${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
  if (!force && sig === lastRouteSig) return;
  lastRouteSig = sig;

  // Try ORS (requires API key) → OSRM (free) → straight-line fallback
  const routePts = (await fetchORSRoute(from, to))
                || (await fetchOSRMRoute(from, to))
                || [[from.latitude, from.longitude], [to.latitude, to.longitude]];

  if (routeLayer) map.removeLayer(routeLayer);
  const isStraight = routePts.length === 2;
  routeLayer = L.polyline(routePts, {
    color:     "#00ff41",
    weight:    isStraight ? 2 : 3,
    opacity:   isStraight ? 0.5 : 0.85,
    dashArray: isStraight ? "6 5" : null,
  }).addTo(map);

  if (force && !userMovedMap) {
    runMapMove(() => map.fitBounds(routeLayer.getBounds(), { padding: [40, 40], maxZoom: 17, animate: true }));
  }
}

function toggleTrackSelected() {
  if (!selectedId) return;
  if (trackedId === selectedId) { trackedId = null; clearRoute(); renderSelectedSoldier(); return; }
  trackedId = selectedId;
  refreshRoute(true);
  renderSelectedSoldier();
}

// ─── Movement trail ───────────────────────────────────────────────────────────
function addToTrail(state) {
  if (state.gps_valid === false || state.detected === false) return;
  const lat = state.location.latitude;
  const lon = state.location.longitude;
  if (!soldierTrails[state.soldier_id]) soldierTrails[state.soldier_id] = [];
  const trail = soldierTrails[state.soldier_id];
  // Only record if moved ≥1 m or first point
  if (trail.length === 0 || haversine(trail[trail.length-1][0], trail[trail.length-1][1], lat, lon) >= 1) {
    trail.push([lat, lon]);
    if (trail.length > 500) trail.shift();
    renderTrail(state.soldier_id);
  }
}

function renderTrail(soldier_id) {
  const trail = soldierTrails[soldier_id];
  if (!trail || trail.length < 2) return;
  const act = getActivity(soldiers[soldier_id]?.activity || "UNKNOWN");
  if (trailLayers[soldier_id]) map.removeLayer(trailLayers[soldier_id]);
  trailLayers[soldier_id] = L.polyline(trail, {
    color:     act.color,
    weight:    2,
    opacity:   0.55,
    dashArray: "3 5",
  }).addTo(map);
  trailLayers[soldier_id].bringToBack();
}

function trailDistance(soldier_id) {
  const trail = soldierTrails[soldier_id];
  if (!trail || trail.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < trail.length; i++)
    d += haversine(trail[i-1][0], trail[i-1][1], trail[i][0], trail[i][1]);
  return d;
}

// ─── Map markers ─────────────────────────────────────────────────────────────
function buildMarkerIcon(state) {
  const act = getActivity(state.activity);
  const alertPulse = state.alert ? "marker-alert" : "";
  const borderColor = state.alert ? "var(--red)" : act.color;
  const html = `
    <div class="soldier-marker">
      <div class="marker-icon ${alertPulse}" style="background:${act.bg};border-color:${borderColor};box-shadow:0 0 10px ${act.border}">
        ${act.emoji}
      </div>
      <div class="marker-label" style="color:${act.color}">${state.soldier_id}</div>
    </div>`;
  return L.divIcon({ html, className: "", iconAnchor: [23, 60] });
}

function upsertMarker(state) {
  if (state.gps_valid === false || state.detected === false) {
    if (markers[state.soldier_id]) { map.removeLayer(markers[state.soldier_id]); delete markers[state.soldier_id]; }
    return;
  }
  const latlng = [state.location.latitude, state.location.longitude];
  if (markers[state.soldier_id]) {
    const cur = markers[state.soldier_id].getLatLng();
    if (isMovingActivity(state.activity) || haversine(cur.lat, cur.lng, latlng[0], latlng[1]) >= 1.2)
      markers[state.soldier_id].setLatLng(latlng);
    markers[state.soldier_id].setIcon(buildMarkerIcon(state));
  } else {
    const m = L.marker(latlng, { icon: buildMarkerIcon(state) }).addTo(map);
    m.bindPopup(() => buildPopupContent(soldiers[state.soldier_id]), { maxWidth: 360, autoPan: true });
    m.on("click", () => {
      selectedId = state.soldier_id;
      renderSelectedSoldier();
      renderSoldierList();
      // Zoom in if not already close enough
      if (map.getZoom() < 17)
        runMapMove(() => map.flyTo(latlng, 17, { animate: true, duration: 0.8 }));
    });
    markers[state.soldier_id] = m;
    if (!autoFocusDone) {
      autoFocusDone = true;
      if (!selectedId) { selectedId = state.soldier_id; renderSelectedSoldier(); }
      runMapMove(() => map.setView(latlng, DEFAULT_ZOOM, { animate: true }));
    }
  }
}

// ─── Popup card ───────────────────────────────────────────────────────────────
function buildPopupContent(state) {
  const act  = getActivity(state.activity);
  const prof = getSoldierProfile(state.soldier_id);
  const time = new Date(state.timestamp).toLocaleTimeString("en-GB");
  const conf = (state.confidence * 100).toFixed(0);
  const alt  = (state.location.altitude_m || 0).toFixed(0);
  const avatar = buildAvatar(state.soldier_id, act.color, 80);

  const warns = [
    state.detected === false && `<div class="popup-banner warn">[!] LORA OFFLINE</div>`,
    state.gps_valid === false && `<div class="popup-banner warn">[!] GPS INVALID</div>`,
    state.alert && `<div class="popup-banner alert">[ALERT] ${state.alert_message || "POSSIBLE DISTRESS"}</div>`,
  ].filter(Boolean).join("");

  return `
  <div class="popup-card">

    <!-- ── Top bar ── -->
    <div class="popup-top-bar" style="border-bottom:2px solid ${act.color}">
      <span class="popup-callsign" style="color:${act.color};text-shadow:0 0 12px ${act.border}">${state.soldier_id}</span>
      <span class="popup-act-chip" style="color:${act.color};border-color:${act.border};background:${act.bg}">${act.emoji}&nbsp;${act.label}&nbsp;·&nbsp;${conf}%</span>
    </div>

    ${warns}

    <!-- ── Identity ── -->
    <div class="popup-identity">
      <div class="popup-avatar-wrap" style="border-color:${act.color};box-shadow:0 0 16px ${act.border}">${avatar}</div>
      <div class="popup-id-text">
        <div class="popup-rank-name">${prof.rank}&nbsp;${prof.name}</div>
        <div class="popup-sub">${prof.battalion}</div>
        <div class="popup-sub" style="color:var(--text-muted)">CDR: ${prof.commander}</div>
      </div>
    </div>

    <!-- ── Two-column data grid ── -->
    <div class="popup-grid">

      <div class="popup-col" style="border-right:1px solid var(--border)">
        <div class="popup-col-title">PERSONNEL</div>
        <div class="popup-row"><span>MIL.ID</span><span style="color:var(--cyan)">${prof.military_id}</span></div>
        <div class="popup-row"><span>NAT.ID</span><span>${prof.national_id}</span></div>
        <div class="popup-row"><span>PHONE</span><span>${prof.phone}</span></div>
        <div class="popup-row"><span>AGE</span><span>${prof.age} yrs</span></div>
        <div class="popup-row"><span>BLOOD</span><span class="popup-val-hi" style="color:var(--red)">${prof.blood_type}</span></div>
        <div class="popup-row"><span>HEIGHT</span><span>${prof.height_cm} cm</span></div>
        <div class="popup-row"><span>WEIGHT</span><span>${prof.weight_kg} kg</span></div>
        <div class="popup-row"><span>SERVICE</span><span>${prof.service_years} yr${prof.service_years > 1 ? "s" : ""}</span></div>
      </div>

      <div class="popup-col">
        <div class="popup-col-title">TELEMETRY</div>
        <div class="popup-row"><span>LAT</span><span>${state.location.latitude.toFixed(5)}°N</span></div>
        <div class="popup-row"><span>LON</span><span>${state.location.longitude.toFixed(5)}°E</span></div>
        <div class="popup-row"><span>ALT</span><span>${alt} m</span></div>
        <div class="popup-row"><span>SEEN</span><span>${time}</span></div>
      </div>

    </div>
  </div>`;
}

// ─── Sidebar: force list ──────────────────────────────────────────────────────
function renderSoldierList() {
  const container = document.getElementById("soldier-list");
  const sorted = Object.values(soldiers).sort((a, b) => a.alert !== b.alert ? (a.alert ? -1 : 1) : a.soldier_id.localeCompare(b.soldier_id));

  if (!sorted.length) {
    container.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-dim);font-size:.7rem;letter-spacing:1px;">AWAITING SENSOR DATA</div>`;
    return;
  }

  container.innerHTML = sorted.map(s => {
    const act    = getActivity(s.activity);
    const time   = new Date(s.timestamp).toLocaleTimeString("en-GB");
    const conf   = (s.confidence * 100).toFixed(0);
    const dist   = distToMain(s);
    const distStr = dist != null ? `${(dist/1000).toFixed(2)}km` : "—";
    const alertL  = s.alert ? "border-left:2px solid var(--red);" : "border-left:2px solid transparent;";
    const selL    = selectedId === s.soldier_id ? "background:var(--bg-hover);box-shadow:inset 0 0 0 1px rgba(0,255,65,.2);" : "";
    const fadeL   = s.detected === false ? "opacity:.45;filter:grayscale(60%);" : "";
    const status  = s.detected === false
      ? `<span class="status-tag offline">OFFLINE</span>`
      : `<span class="status-tag online">LIVE</span>`;

    return `
    <div class="soldier-card" style="${alertL}${selL}${fadeL}" onclick="selectSoldier('${s.soldier_id}',true)">
      <div class="card-icon" style="color:${act.color};border-color:${act.border};background:${act.bg}">${act.emoji}</div>
      <div class="card-body">
        <div class="card-id">${s.soldier_id}${status}</div>
        <div style="margin:2px 0"><span class="activity-chip" style="color:${act.color};border-color:${act.border};background:${act.bg}">${act.label}</span></div>
        <div class="card-location">${s.location.latitude.toFixed(4)}°N &nbsp;${s.location.longitude.toFixed(4)}°E &nbsp;·&nbsp; ${time}</div>
        <div class="card-meta">DIST:${distStr} &nbsp; TEMP:${typeof s.temperature==="number"?s.temperature.toFixed(1)+"°C":"—"} &nbsp; LOAD:${s.load||"—"}</div>
      </div>
      <div class="conf-bar" style="color:${act.color}">${conf}%</div>
    </div>`;
  }).join("");
}

// ─── Sidebar: selected soldier ────────────────────────────────────────────────
function panToSoldier(id) {
  const s = soldiers[id];
  if (!s) return;
  const targetZoom = Math.max(map.getZoom(), 17);
  runMapMove(() => map.flyTo([s.location.latitude, s.location.longitude], targetZoom, { animate: true, duration: 0.8 }));
  // Open popup after fly animation settles
  setTimeout(() => { if (markers[id]) markers[id].openPopup(); }, 850);
}

function selectSoldier(id, openPopup = false) {
  selectedId = id;
  renderSelectedSoldier();
  renderSoldierList();
  if (openPopup) panToSoldier(id);
}

function renderSelectedSoldier() {
  const container = document.getElementById("selected-soldier");
  const s = soldiers[selectedId];
  if (!s) {
    container.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-dim);font-size:.68rem;letter-spacing:1px;">SELECT A UNIT TO VIEW DETAILS</div>`;
    return;
  }

  const act   = getActivity(s.activity);
  const prof  = getSoldierProfile(s.soldier_id);
  const time  = new Date(s.timestamp).toLocaleTimeString("en-GB");
  const conf  = (s.confidence * 100).toFixed(0);
  const alt   = s.location.altitude_m ?? 0;
  const dist  = distToMain(s);
  const trackOn = trackedId === s.soldier_id;
  const moved = trailDistance(s.soldier_id);
  const movedStr = moved < 1000 ? `${moved.toFixed(0)} m` : `${(moved/1000).toFixed(2)} km`;
  const probs = s.all_probs && Object.keys(s.all_probs).length
    ? Object.entries(s.all_probs).map(([k, v]) =>
        `<div class="prob-row"><span>${k}</span><span style="color:var(--accent)">${(v*100).toFixed(0)}%</span></div>`
      ).join("")
    : `<div class="prob-row"><span style="color:var(--text-dim)">NO MODEL DATA YET</span></div>`;

  container.innerHTML = `
    <!-- Profile header -->
    <div class="soldier-profile-card">
      <div class="soldier-avatar" style="border-color:${act.color};box-shadow:0 0 14px ${act.border}">${buildAvatar(s.soldier_id, act.color)}</div>
      <div class="soldier-profile-info">
        <div class="soldier-callsign" style="color:${act.color};text-shadow:0 0 12px ${act.border}">${s.soldier_id}</div>
        <div class="soldier-unit">${prof.rank} ${prof.name}</div>
        <div class="soldier-unit" style="color:var(--text-dim)">${prof.battalion}</div>
        <div class="soldier-status-row">
          <span class="activity-chip" style="color:${act.color};border-color:${act.border};background:${act.bg}">${act.emoji}&nbsp;${act.label}</span>
          <span style="font-size:.65rem;color:${act.color}">${conf}%</span>
        </div>
      </div>
    </div>

    <!-- Track button + alert -->
    <div style="padding:8px 14px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
      <button onclick="toggleTrackSelected()" class="track-btn ${trackOn ? 'active' : ''}">${trackOn ? "◉ TRACKING ON" : "◎ TRACK UNIT"}</button>
      ${s.alert ? `<span style="color:var(--red);font-size:.68rem;letter-spacing:1px;text-shadow:0 0 8px var(--red-glow)">[!] ${s.alert_message || "DISTRESS"}</span>` : ""}
    </div>

    <!-- Telemetry grid -->
    <div class="detail-grid">
      <div class="detail-col">
        <div class="detail-title">PERSONNEL</div>
        <div class="detail-row"><span>MIL.ID</span><span style="color:var(--cyan)">${prof.military_id}</span></div>
        <div class="detail-row"><span>NAT.ID</span><span style="font-size:.58rem">${prof.national_id}</span></div>
        <div class="detail-row"><span>PHONE</span><span>${prof.phone}</span></div>
        <div class="detail-row"><span>AGE</span><span>${prof.age} yrs</span></div>
        <div class="detail-row"><span>BLOOD</span><span style="color:var(--red)">${prof.blood_type}</span></div>
        <div class="detail-row"><span>HEIGHT</span><span>${prof.height_cm} cm</span></div>
        <div class="detail-row"><span>WEIGHT</span><span>${prof.weight_kg} kg</span></div>
        <div class="detail-row"><span>SERVICE</span><span>${prof.service_years} yr${prof.service_years > 1 ? "s" : ""}</span></div>
        <div class="detail-row"><span>COMMANDER</span><span>${prof.commander}</span></div>
      </div>
      <div class="detail-col">
        <div class="detail-title">TELEMETRY</div>
        <div class="detail-row"><span>LORA</span><span style="color:${s.detected===false?"#ff8c00":"var(--accent)"}">${s.detected===false?"OFFLINE":"LIVE"}</span></div>
        <div class="detail-row"><span>GPS</span><span style="color:${s.gps_valid===false?"#ff8c00":"var(--accent)"}">${s.gps_valid===false?"INVALID":"LOCKED"}</span></div>
        <div class="detail-row"><span>LAT</span><span>${s.location.latitude.toFixed(6)}</span></div>
        <div class="detail-row"><span>LON</span><span>${s.location.longitude.toFixed(6)}</span></div>
        <div class="detail-row"><span>ALT</span><span>${Number(alt).toFixed(0)} m</span></div>
        <div class="detail-row"><span>DIST</span><span>${dist != null ? (dist/1000).toFixed(2)+"km" : "—"}</span></div>
        <div class="detail-row"><span>MOVED</span><span style="color:var(--cyan)">${movedStr}</span></div>
        <div class="detail-row"><span>TEMP</span><span>${typeof s.temperature==="number" ? s.temperature.toFixed(1)+"°C" : "—"}</span></div>
        <div class="detail-row"><span>LOAD</span><span>${s.load||"—"}</span></div>
        <div class="detail-row"><span>LAST SEEN</span><span>${time}</span></div>
      </div>
    </div>

    <!-- Model probabilities -->
    <div style="padding:8px 14px 12px;border-top:1px solid var(--border)">
      <div style="font-size:.58rem;letter-spacing:2px;color:var(--text-dim);margin-bottom:5px">MODEL PROBABILITIES</div>
      ${probs}
    </div>`;
}

// ─── Sidebar: alerts ──────────────────────────────────────────────────────────
function renderAlerts() {
  const container = document.getElementById("alerts-container");
  const active = Object.values(soldiers).filter(s => s.alert);
  if (!active.length) {
    container.innerHTML = `<div id="no-alerts">NO ACTIVE ALERTS</div>`;
    return;
  }
  container.innerHTML = active.map(s => {
    const time = new Date(s.timestamp).toLocaleTimeString("en-GB");
    return `
    <div class="alert-item" onclick="panToSoldier('${s.soldier_id}')">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="alert-soldier">[!] ${s.soldier_id}</span>
        <span class="alert-time">${time}</span>
      </div>
      <div class="alert-msg">${s.alert_message || "POSSIBLE DISTRESS — STATIONARY prolonged"}</div>
    </div>`;
  }).join("");
}

// ─── Header counter ───────────────────────────────────────────────────────────
function updateCountBadge() {
  const n = Object.keys(soldiers).length;
  document.getElementById("soldier-count").textContent = `${n} SOLDIER${n !== 1 ? "S" : ""} TRACKED`;
}

// ─── Initial REST fetch ───────────────────────────────────────────────────────
async function fetchInitialState() {
  try {
    const r = await fetch(`${BACKEND_HTTP}/api/force/status`);
    if (!r.ok) return;
    (await r.json()).soldiers?.forEach(updateSoldier);
  } catch (_) {}
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
fetchInitialState();
connectWS();
renderSoldierList();
renderAlerts();
updateCountBadge();
