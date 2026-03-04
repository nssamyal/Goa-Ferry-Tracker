/* ═══════════════════════════════════════════════════════
   GOA FERRY TRACKER — script.js
═══════════════════════════════════════════════════════ */

"use strict";

const ROUTES = {
  route1: { id:'route1', label:'Durbhat ↔ Rassaim', portA:'Durbhat', portB:'Rassaim', durA2B:20*60*1000, durB2A:20*60*1000 },
  route2: { id:'route2', label:'Adpai ↔ Rassaim',   portA:'Adpai',   portB:'Rassaim', durA2B:10*60*1000, durB2A:10*60*1000 },
};

const ANTI_SPAM_GLOBAL = 3  * 60 * 1000;
const ANTI_SPAM_DEVICE = 10 * 60 * 1000;
const STALE_THRESHOLD  = 20 * 60 * 1000;
const UNCERTAIN_AFTER  = 90 * 60 * 1000;

let currentRoute  = null;
let pendingDepart = null;
let liveData      = {};
let timerInterval = null;
let db, fbRef, fbSet, fbOnValue;

// Poll until Firebase is ready
function tryInit() {
  if (window._db && window._ref && window._set && window._onValue) {
    db = window._db; fbRef = window._ref; fbSet = window._set; fbOnValue = window._onValue;
    console.log('✅ Firebase ready');
    listenRoute('route1');
    listenRoute('route2');
  } else {
    setTimeout(tryInit, 100);
  }
}
tryInit();

function listenRoute(routeId) {
  fbOnValue(fbRef(db, `ferries/${routeId}`), snap => {
    const data = snap.val();
    liveData[routeId] = data;
    updateHomeCard(routeId, data);
    if (currentRoute === routeId) renderRouteStatus(routeId, data);
  });
}

function openRoute(routeId) {
  currentRoute = routeId;
  const route  = ROUTES[routeId];
  document.getElementById('route-title').textContent = route.label + ' Ferry';
  document.getElementById('btn-port-a').textContent  = `Ferry left ${route.portA}`;
  document.getElementById('btn-port-b').textContent  = `Ferry left ${route.portB}`;
  showPage('page-route');
  renderRouteStatus(routeId, liveData[routeId] || null);
  startTimer();
}

function goHome() {
  currentRoute = null;
  clearInterval(timerInterval);
  showPage('page-home');
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function updateHomeCard(routeId, data) {
  const footer = document.getElementById(`footer-${routeId}`);
  const dot    = document.getElementById(`dot-${routeId}`);
  if (!footer || !dot) return;
  if (!data || !data.timestamp) {
    footer.textContent = 'No recent data — tap to update';
    dot.className = 'route-status-dot unknown';
    return;
  }
  const route    = ROUTES[routeId];
  const elapsed  = Date.now() - data.timestamp;
  const duration = data.direction === 'A2B' ? route.durA2B : route.durB2A;
  const toPort   = data.direction === 'A2B' ? route.portB : route.portA;
  if (elapsed > UNCERTAIN_AFTER) {
    footer.textContent = 'Status uncertain – waiting for update';
    dot.className = 'route-status-dot unknown';
  } else if (elapsed >= duration) {
    footer.textContent = `Ferry arrived at ${toPort} · ${timeAgo(elapsed)}`;
    dot.className = elapsed > STALE_THRESHOLD ? 'route-status-dot stale' : 'route-status-dot live';
  } else {
    const rem = Math.ceil((duration - elapsed) / 60000);
    footer.textContent = `🚢 En route to ${toPort} · ~${rem} min remaining`;
    dot.className = 'route-status-dot live';
  }
}

function renderRouteStatus(routeId, data) {
  const route = ROUTES[routeId];
  if (!data || !data.timestamp || (Date.now() - data.timestamp > UNCERTAIN_AFTER)) { showUncertain(); return; }
  showLive();
  const direction = data.direction;
  const fromPort  = direction === 'A2B' ? route.portA : route.portB;
  const toPort    = direction === 'A2B' ? route.portB : route.portA;
  const duration  = direction === 'A2B' ? route.durA2B : route.durB2A;
  const elapsed   = Date.now() - data.timestamp;
  const arrivalTs = data.timestamp + duration;
  document.getElementById('dir-from').textContent         = fromPort;
  document.getElementById('dir-to').textContent           = toPort;
  document.getElementById('prog-label-left').textContent  = fromPort;
  document.getElementById('prog-label-right').textContent = toPort;
  document.getElementById('info-departed').textContent    = formatTime(data.timestamp);
  document.getElementById('info-arrives').textContent     = formatTime(arrivalTs);
  const pct   = Math.round(Math.min(elapsed / duration, 1) * 100);
  const remMs = Math.max(duration - elapsed, 0);
  document.getElementById('info-progress').textContent    = `${pct}%`;
  document.getElementById('info-remaining').textContent   = remMs > 0 ? formatDuration(remMs) : 'Arrived';
  document.getElementById('progress-fill').style.width   = `${pct}%`;
  document.getElementById('ferry-icon').style.left       = `${pct}%`;
  renderReliability(data, elapsed);
}

function showUncertain() {
  document.getElementById('status-uncertain').style.display = '';
  document.getElementById('status-live').style.display      = 'none';
}
function showLive() {
  document.getElementById('status-uncertain').style.display = 'none';
  document.getElementById('status-live').style.display      = '';
}

function renderReliability(data, elapsed) {
  const badge = document.getElementById('reliability-badge');
  const count = data.updateCount || 1;
  let cls, label;
  if (elapsed > STALE_THRESHOLD)   { cls='low';    label='⚠ Low reliability — data is old'; }
  else if (count >= 2)              { cls='high';   label='✓ High reliability'; }
  else                              { cls='medium'; label='~ Medium reliability — single report'; }
  badge.className   = `reliability-badge ${cls}`;
  badge.textContent = label;
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (currentRoute) {
      renderRouteStatus(currentRoute, liveData[currentRoute] || null);
      updateHomeCard('route1', liveData['route1'] || null);
      updateHomeCard('route2', liveData['route2'] || null);
    }
  }, 1000);
}

function reportDeparture(port) {
  const key        = `last_report_${currentRoute}`;
  const lastReport = parseInt(localStorage.getItem(key) || '0', 10);
  const now        = Date.now();
  if (now - lastReport < ANTI_SPAM_DEVICE) {
    const waitMin = Math.ceil((ANTI_SPAM_DEVICE - (now - lastReport)) / 60000);
    alert(`You can report again in about ${waitMin} minute${waitMin !== 1 ? 's' : ''}. Thank you!`);
    return;
  }
  const existing = liveData[currentRoute];
  if (existing && existing.timestamp && (now - existing.timestamp) < ANTI_SPAM_GLOBAL) {
    const waitSec = Math.ceil((ANTI_SPAM_GLOBAL - (now - existing.timestamp)) / 1000);
    alert(`A recent update was just recorded. Please wait ${waitSec}s.`);
    return;
  }
  pendingDepart = port;
  const portName = port === 'A' ? ROUTES[currentRoute].portA : ROUTES[currentRoute].portB;
  document.getElementById('popup-sub').textContent = `You're about to confirm the ferry just departed from ${portName}.`;
  document.getElementById('popup-overlay').style.display = 'flex';
}

function closePopup() {
  document.getElementById('popup-overlay').style.display = 'none';
  pendingDepart = null;
}

function confirmDeparture() {
  // ⚠️ Save BEFORE closePopup() resets pendingDepart to null
  const savedDepart = pendingDepart;
  const savedRoute  = currentRoute;

  closePopup();

  console.log('confirmDeparture → db:', !!db, 'route:', savedRoute, 'port:', savedDepart);

  if (!savedDepart || !savedRoute || !db) {
    alert('Something went wrong. Please try again.');
    return;
  }

  const direction   = savedDepart === 'A' ? 'A2B' : 'B2A';
  const now         = Date.now();
  const existing    = liveData[savedRoute] || {};
  const updateCount = existing.direction === direction ? (existing.updateCount || 1) + 1 : 1;
  const payload     = { direction, timestamp: now, updateCount, reportedBy: getDeviceId() };

  fbSet(fbRef(db, `ferries/${savedRoute}`), payload)
    .then(() => {
      console.log('✅ Write success');
      localStorage.setItem(`last_report_${savedRoute}`, String(now));
      liveData[savedRoute] = payload;
      currentRoute = savedRoute;
      renderRouteStatus(savedRoute, payload);
      startTimer();
    })
    .catch(err => {
      console.error('❌ Write failed:', err);
      alert('Write failed: ' + err.message);
    });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
}
function formatDuration(ms) {
  const s = Math.floor(ms/1000), m = Math.floor(s/60);
  return m > 0 ? `${m}m ${String(s%60).padStart(2,'0')}s` : `${s}s`;
}
function timeAgo(ms) {
  const m = Math.floor(ms/60000);
  if (m < 1) return 'just now';
  if (m === 1) return '1 min ago';
  if (m < 60) return `${m} mins ago`;
  return `${Math.floor(m/60)}h ago`;
}
function getDeviceId() {
  let id = localStorage.getItem('ferry_device_id');
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('ferry_device_id', id); }
  return id;
}

window.openRoute        = openRoute;
window.goHome           = goHome;
window.reportDeparture  = reportDeparture;
window.closePopup       = closePopup;
window.confirmDeparture = confirmDeparture;