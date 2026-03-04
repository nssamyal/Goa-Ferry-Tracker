/* ═══════════════════════════════════════════════════════
   GOA FERRY TRACKER — script.js 
═══════════════════════════════════════════════════════ */

"use strict";

const ROUTES = {
  route1: { id:'route1', label:'Durbhat ↔ Rassaim', portA:'Durbhat', portB:'Rassaim', durA2B:20*60*1000, durB2A:20*60*1000 },
  route2: { id:'route2', label:'Adpai ↔ Rassaim',   portA:'Adpai',   portB:'Rassaim', durA2B:10*60*1000, durB2A:10*60*1000 },
};

const ADMIN_PASSWORD   = 'ferry@goa2026'; // Please do not misuse it!
const VOTES_NEEDED     = 3;
const BOARDING_TIME    = 5 * 60 * 1000;
const ANTI_SPAM_DEVICE = 5 * 60 * 1000;
const STALE_THRESHOLD  = 20 * 60 * 1000;
const UNCERTAIN_AFTER  = 6 * 60 * 60 * 1000;

let currentRoute  = null;
let pendingDepart = null;
let liveData      = {};
let timerInterval = null;
let isAdmin       = false;
let db, fbRef, fbSet, fbOnValue;

// ── Firebase init ─────────────────────────────────────
function tryInit() {
  if (window._db && window._ref && window._set && window._onValue) {
    db = window._db; fbRef = window._ref; fbSet = window._set; fbOnValue = window._onValue;
    console.log('✅ Firebase ready');
    isAdmin = localStorage.getItem('ferry_admin') === 'true';
    updateAdminUI();
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
    // Save last confirmed separately so timer keeps running during pending votes
    if (data && data.confirmed) {
      liveData[routeId + '_lastConfirmed'] = data;
    }
    updateHomeCard(routeId, data);
    if (currentRoute === routeId) renderRouteStatus(routeId, data);
  });
}

// ════════════════════════════════════════════════════════
// CYCLING LOGIC
// ════════════════════════════════════════════════════════

function getCycleState(data, route, now) {
  if (!data || !data.confirmed || !data.timestamp) return null;

  const travelAB  = route.durA2B;
  const travelBA  = route.durB2A;
  const boarding  = BOARDING_TIME;
  const cycleTime = travelAB + boarding + travelBA + boarding;

  const elapsed    = now - data.timestamp;
  const isStale    = elapsed > UNCERTAIN_AFTER;
  const posInCycle = elapsed % cycleTime;

  const p1 = travelAB;
  const p2 = travelAB + boarding;
  const p3 = travelAB + boarding + travelBA;

  const portA = route.portA;
  const portB = route.portB;

  let adjPos = posInCycle;
  if (data.direction === 'B2A') {
    adjPos = (posInCycle + travelBA + boarding) % cycleTime;
  }

  let phase, fromPort, toPort, phaseElapsed, phaseDuration;

  if (adjPos < p1) {
    phase = 'travelling'; fromPort = portA; toPort = portB;
    phaseElapsed = adjPos; phaseDuration = travelAB;
  } else if (adjPos < p2) {
    phase = 'boarding'; fromPort = portB; toPort = portA;
    phaseElapsed = adjPos - p1; phaseDuration = boarding;
  } else if (adjPos < p3) {
    phase = 'travelling'; fromPort = portB; toPort = portA;
    phaseElapsed = adjPos - p2; phaseDuration = travelBA;
  } else {
    phase = 'boarding'; fromPort = portA; toPort = portB;
    phaseElapsed = adjPos - p3; phaseDuration = boarding;
  }

  const pct       = Math.round(Math.min(phaseElapsed / phaseDuration, 1) * 100);
  const remaining = Math.max(phaseDuration - phaseElapsed, 0);

  return { phase, fromPort, toPort, pct, remaining, isStale, elapsed, phaseElapsed };
}

// ════════════════════════════════════════════════════════
// PAGE NAVIGATION
// ════════════════════════════════════════════════════════

function openRoute(routeId) {
  currentRoute = routeId;
  const route  = ROUTES[routeId];
  document.getElementById('route-title').textContent = route.label + ' Ferry';
  document.getElementById('btn-port-a').textContent  = `Ferry left ${route.portA}`;
  document.getElementById('btn-port-b').textContent  = `Ferry left ${route.portB}`;
  showPage('page-route');
  renderRouteStatus(routeId, liveData[routeId] || null);
  updateAdminUI();
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

// ════════════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════════════

function toggleAdmin() {
  if (isAdmin) {
    isAdmin = false;
    localStorage.removeItem('ferry_admin');
    updateAdminUI();
    alert('Logged out of admin.');
    return;
  }
  const pwd = prompt('Enter admin password:');
  if (pwd === ADMIN_PASSWORD) {
    isAdmin = true;
    localStorage.setItem('ferry_admin', 'true');
    updateAdminUI();
    alert('✅ Admin access granted!');
  } else if (pwd !== null) {
    alert('❌ Wrong password.');
  }
}

function updateAdminUI() {
  const adminBtn      = document.getElementById('admin-btn');
  const adminBadge    = document.getElementById('admin-badge');
  const reporterLabel = document.getElementById('reporter-label');
  const reporterHint  = document.getElementById('reporter-hint');
  if (!adminBtn) return;
  if (isAdmin) {
    adminBtn.textContent = '🔓 Admin ON — tap to logout';
    adminBtn.classList.add('admin-active');
    if (adminBadge)    adminBadge.style.display  = '';
    if (reporterLabel) reporterLabel.textContent = 'Admin: Record departure';
    if (reporterHint)  reporterHint.textContent  = 'Admin vote confirms instantly';
  } else {
    adminBtn.textContent = '🔐 Admin login';
    adminBtn.classList.remove('admin-active');
    if (adminBadge)    adminBadge.style.display  = 'none';
    if (reporterLabel) reporterLabel.textContent = 'Report a departure';
    if (reporterHint)  reporterHint.textContent  = '3 commuter reports needed to confirm · updates shared in real time';
  }
}

// ════════════════════════════════════════════════════════
// HOME CARD SUMMARIES
// ════════════════════════════════════════════════════════

function updateHomeCard(routeId, data) {
  const footer = document.getElementById(`footer-${routeId}`);
  const dot    = document.getElementById(`dot-${routeId}`);
  if (!footer || !dot) return;

  if (!data || (!data.timestamp && !data.pending)) {
    footer.textContent = 'No recent data — tap to update';
    dot.className = 'route-status-dot unknown';
    return;
  }

  if (data.pending && !data.confirmed) {
    const count = data.votes ? Object.keys(data.votes).length : 0;
    footer.textContent = `🗳 ${count}/${VOTES_NEEDED} commuters reported`;
    dot.className = 'route-status-dot stale';
    return;
  }

  const route = ROUTES[routeId];
  const state = getCycleState(data, route, Date.now());
  if (!state) {
    footer.textContent = 'Status uncertain';
    dot.className = 'route-status-dot unknown';
    return;
  }

  if (state.phase === 'boarding') {
    const remMin = Math.ceil(state.remaining / 60000);
    footer.textContent = `⚓ Boarding at ${state.fromPort} — departs in ${remMin} min`;
    dot.className = 'route-status-dot live';
  } else {
    const remMin = Math.ceil(state.remaining / 60000);
    footer.textContent = `🚢 En route to ${state.toPort} · ~${remMin} min remaining`;
    dot.className = state.isStale ? 'route-status-dot stale' : 'route-status-dot live';
  }
}

// ════════════════════════════════════════════════════════
// ROUTE STATUS RENDERING
// Timer keeps running even during pending votes
// ════════════════════════════════════════════════════════

function renderRouteStatus(routeId, data) {
  const route = ROUTES[routeId];

  // Show vote box if pending — but keep timer running underneath
  if (data && data.pending && !data.confirmed) {
    renderVoteBox(routeId, data);
  } else {
    hideVoteBox();
  }

  // Use last confirmed data to keep timer running during pending votes
  const confirmedData = (data && data.confirmed)
    ? data
    : (liveData[routeId + '_lastConfirmed'] || null);

  if (!confirmedData || !confirmedData.confirmed) {
    showUncertain();
    return;
  }

  const now   = Date.now();
  const state = getCycleState(confirmedData, route, now);
  if (!state) { showUncertain(); return; }

  showLive();

  document.getElementById('dir-from').textContent         = state.fromPort;
  document.getElementById('dir-to').textContent           = state.toPort;
  document.getElementById('prog-label-left').textContent  = state.fromPort;
  document.getElementById('prog-label-right').textContent = state.toPort;
  document.getElementById('progress-fill').style.width   = `${state.pct}%`;
  document.getElementById('ferry-icon').style.left       = `${state.pct}%`;
  document.getElementById('info-progress').textContent   = `${state.pct}%`;

  if (state.phase === 'boarding') {
    const remMin = Math.ceil(state.remaining / 60000);
    const remSec = Math.ceil(state.remaining / 1000) % 60;
    document.getElementById('info-remaining').textContent = `${remMin}m ${String(remSec).padStart(2,'0')}s`;
    document.getElementById('info-departed').textContent  = '—';
    document.getElementById('info-arrives').textContent   = '—';
    document.getElementById('dir-from').textContent = '⚓';
    document.getElementById('dir-to').textContent   = '';
    const boardMsg = document.getElementById('boarding-msg');
    if (boardMsg) {
      boardMsg.style.display = '';
      boardMsg.textContent   = `Ferry boarding at ${state.fromPort} — departs in ${remMin}m ${String(remSec).padStart(2,'0')}s`;
    }
  } else {
    const arrivesAt = Date.now() + state.remaining;
    document.getElementById('info-departed').textContent  = formatTime(confirmedData.timestamp);
    document.getElementById('info-arrives').textContent   = formatTime(arrivesAt);
    document.getElementById('info-remaining').textContent = formatDuration(state.remaining);
    const boardMsg = document.getElementById('boarding-msg');
    if (boardMsg) boardMsg.style.display = 'none';
  }

  const staleMsg = document.getElementById('stale-msg');
  if (staleMsg) {
    if (state.isStale) {
      const h = Math.floor(state.elapsed / 3600000);
      const m = Math.floor((state.elapsed % 3600000) / 60000);
      staleMsg.style.display = '';
      staleMsg.textContent   = `⚠ Based on last update ${h > 0 ? h + 'h ' : ''}${m}m ago — may be inaccurate`;
    } else {
      staleMsg.style.display = 'none';
    }
  }

  renderReliability(confirmedData, state.elapsed);
}

function renderVoteBox(routeId, data) {
  const voteBox = document.getElementById('vote-status-box');
  if (!voteBox) return;
  const voteCount = data.votes ? Object.keys(data.votes).length : 0;
  const route     = ROUTES[routeId];
  const direction = data.pendingDirection;
  const fromPort  = direction === 'A2B' ? route.portA : route.portB;
  const toPort    = direction === 'A2B' ? route.portB : route.portA;
  voteBox.style.display = '';
  voteBox.innerHTML = `
    <div class="vote-box">
      <p class="vote-title">🗳 Commuters voting…</p>
      <p class="vote-direction">${fromPort} → ${toPort}</p>
      <div class="vote-bar-wrap">
        ${[1,2,3].map(i => `<div class="vote-pip ${i <= voteCount ? 'filled' : ''}"></div>`).join('')}
      </div>
      <p class="vote-count">${voteCount} of ${VOTES_NEEDED} commuters confirmed</p>
      <p class="vote-hint">Timer restarts when ${VOTES_NEEDED} people confirm the same departure</p>
    </div>`;
}

function hideVoteBox() {
  const voteBox = document.getElementById('vote-status-box');
  if (voteBox) voteBox.style.display = 'none';
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
  if (!badge) return;
  let cls, label;
  if (data.byAdmin)                   { cls='high';   label='✓ Admin confirmed'; }
  else if (elapsed > STALE_THRESHOLD) { cls='low';    label='⚠ Low reliability — based on old data'; }
  else if (data.updateCount >= 3)     { cls='high';   label='✓ High reliability — 3+ reports'; }
  else                                { cls='medium'; label='~ Medium reliability'; }
  badge.className   = `reliability-badge ${cls}`;
  badge.textContent = label;
}

// ════════════════════════════════════════════════════════
// LIVE TIMER
// ════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════
// DEPARTURE REPORTING
// ════════════════════════════════════════════════════════

function reportDeparture(port) {
  if (!isAdmin) {
    const key      = `last_vote_${currentRoute}_${port}`;
    const lastVote = parseInt(localStorage.getItem(key) || '0', 10);
    const now      = Date.now();
    if (now - lastVote < ANTI_SPAM_DEVICE) {
      const waitMin = Math.ceil((ANTI_SPAM_DEVICE - (now - lastVote)) / 60000);
      alert(`You already reported recently. Please wait ${waitMin} more minute${waitMin !== 1 ? 's' : ''}.`);
      return;
    }
  }
  pendingDepart = port;
  const route    = ROUTES[currentRoute];
  const portName = port === 'A' ? route.portA : route.portB;
  const modeText = isAdmin ? 'Admin: confirm ferry departure from' : 'Did the ferry just leave';
  document.getElementById('popup-sub').textContent = `${modeText} ${portName}?`;
  document.getElementById('popup-overlay').style.display = 'flex';
}

function closePopup() {
  document.getElementById('popup-overlay').style.display = 'none';
  pendingDepart = null;
}

function confirmDeparture() {
  const savedDepart = pendingDepart;
  const savedRoute  = currentRoute;
  closePopup();

  if (!savedDepart || !savedRoute || !db) {
    alert('Something went wrong. Please try again.');
    return;
  }

  const direction = savedDepart === 'A' ? 'A2B' : 'B2A';
  const now       = Date.now();
  const deviceId  = getDeviceId();

  if (isAdmin) {
    const payload = {
      direction, timestamp: now,
      confirmed: true, byAdmin: true,
      updateCount: 1, pending: false,
    };
    writeToFirebase(savedRoute, payload);
  } else {
    castVote(savedRoute, direction, now, deviceId);
  }
}

function castVote(routeId, direction, now, deviceId) {
  const existing    = liveData[routeId] || {};
  const samePending = existing.pending && !existing.confirmed && existing.pendingDirection === direction;

  if (samePending) {
    const newVotes  = { ...(existing.votes || {}), [deviceId]: now };
    const voteCount = Object.keys(newVotes).length;

    if (voteCount >= VOTES_NEEDED) {
      const timestamps = Object.values(newVotes);
      const avgTs      = Math.round(timestamps.reduce((a, b) => a + b, 0) / timestamps.length);
      const payload    = {
        direction, timestamp: avgTs,
        confirmed: true, byAdmin: false,
        updateCount: voteCount, pending: false,
        votes: newVotes,
      };
      writeToFirebase(routeId, payload);
      saveDeviceVote(routeId, direction === 'A2B' ? 'A' : 'B');
    } else {
      writeToFirebase(routeId, {
        ...existing,
        votes: newVotes,
        pending: true,
        confirmed: false,
        pendingDirection: direction,
      });
      saveDeviceVote(routeId, direction === 'A2B' ? 'A' : 'B');
    }
  } else {
    writeToFirebase(routeId, {
      pending: true,
      confirmed: false,
      pendingDirection: direction,
      votes: { [deviceId]: now },
      timestamp: null,
      direction: null,
    });
    saveDeviceVote(routeId, direction === 'A2B' ? 'A' : 'B');
  }
}

function writeToFirebase(routeId, payload) {
  fbSet(fbRef(db, `ferries/${routeId}`), payload)
    .then(() => {
      console.log('✅ Firebase write success');
      liveData[routeId] = payload;
      if (payload.confirmed) liveData[routeId + '_lastConfirmed'] = payload;
      if (currentRoute === routeId) {
        renderRouteStatus(routeId, payload);
        startTimer();
      }
    })
    .catch(err => {
      console.error('❌ Write failed:', err);
      alert('Could not save: ' + err.message);
    });
}

function saveDeviceVote(routeId, port) {
  localStorage.setItem(`last_vote_${routeId}_${port}`, String(Date.now()));
}

// ════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════

function formatTime(ts) {
  if (!ts) return '—';
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
window.toggleAdmin      = toggleAdmin;
