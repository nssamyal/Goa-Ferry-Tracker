/* ═══════════════════════════════════════════════════════
   GOA FERRY TRACKER — script.js
═══════════════════════════════════════════════════════ */

"use strict";

const ROUTES = {
  route1: { id:'route1', label:'Durbhat ↔ Rassaim', portA:'Durbhat', portB:'Rassaim', durA2B:20*60*1000, durB2A:20*60*1000 },
  route2: { id:'route2', label:'Adpai ↔ Rassaim',   portA:'Adpai',   portB:'Rassaim', durA2B:10*60*1000, durB2A:10*60*1000 },
};

const ADMIN_PASSWORD    = 'ferry@goa2026';  // Please do not misuse it
const VOTES_NEEDED      = 3;                // Commuter votes needed to confirm
const ANTI_SPAM_DEVICE  = 5 * 60 * 1000;   // 5 min per device per route
const STALE_THRESHOLD   = 20 * 60 * 1000;
const UNCERTAIN_AFTER   = 90 * 60 * 1000;

let currentRoute  = null;
let pendingDepart = null;
let liveData      = {};
let timerInterval = null;
let isAdmin       = false;
let db, fbRef, fbSet, fbOnValue, fbGet;

// ── Firebase init polling ─────────────────────────────
function tryInit() {
  if (window._db && window._ref && window._set && window._onValue && window._get) {
    db = window._db; fbRef = window._ref; fbSet = window._set;
    fbOnValue = window._onValue; fbGet = window._get;
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

// ── Firebase listeners ────────────────────────────────
function listenRoute(routeId) {
  fbOnValue(fbRef(db, `ferries/${routeId}`), snap => {
    const data = snap.val();
    liveData[routeId] = data;
    updateHomeCard(routeId, data);
    if (currentRoute === routeId) renderRouteStatus(routeId, data);
  });
}

// PAGE NAVIGATION

function openRoute(routeId) {
  currentRoute = routeId;
  const route  = ROUTES[routeId];
  document.getElementById('route-title').textContent = route.label + ' Ferry';
  document.getElementById('btn-port-a').textContent  = `Ferry left ${route.portA}`;
  document.getElementById('btn-port-b').textContent  = `Ferry left ${route.portB}`;
  showPage('page-route');
  renderRouteStatus(routeId, liveData[routeId] || null);
  renderVoteSection(routeId, liveData[routeId] || null);
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


// ADMIN


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
  const adminBtn = document.getElementById('admin-btn');
  const adminBadge = document.getElementById('admin-badge');
  const reporterLabel = document.getElementById('reporter-label');
  if (!adminBtn) return;

  if (isAdmin) {
    adminBtn.textContent = '🔓 Admin: ON — Tap to logout';
    adminBtn.classList.add('admin-active');
    if (adminBadge) adminBadge.style.display = '';
    if (reporterLabel) reporterLabel.textContent = 'Admin: Record departure';
  } else {
    adminBtn.textContent = '🔐 Admin login';
    adminBtn.classList.remove('admin-active');
    if (adminBadge) adminBadge.style.display = 'none';
    if (reporterLabel) reporterLabel.textContent = 'Report a departure';
  }
}


// HOME CARD SUMMARIES

function updateHomeCard(routeId, data) {
  const footer = document.getElementById(`footer-${routeId}`);
  const dot    = document.getElementById(`dot-${routeId}`);
  if (!footer || !dot) return;

  if (!data || !data.timestamp) {
    footer.textContent = 'No recent data — tap to update';
    dot.className = 'route-status-dot unknown';
    return;
  }

  // Pending votes — not yet confirmed
  if (data.pending && !data.confirmed) {
    const count = data.votes ? Object.keys(data.votes).length : 0;
    footer.textContent = `🗳 ${count}/${VOTES_NEEDED} commuters reported — needs more votes`;
    dot.className = 'route-status-dot stale';
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

// ROUTE STATUS RENDERING

function renderRouteStatus(routeId, data) {
  const route = ROUTES[routeId];

  // Show vote progress if pending
  if (data && data.pending && !data.confirmed) {
    renderVoteSection(routeId, data);
    showUncertain();
    return;
  }

  if (!data || !data.timestamp || (Date.now() - data.timestamp > UNCERTAIN_AFTER)) {
    showUncertain();
    renderVoteSection(routeId, data);
    return;
  }

  showLive();
  renderVoteSection(routeId, data);

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

function renderVoteSection(routeId, data) {
  const voteBox = document.getElementById('vote-status-box');
  if (!voteBox) return;

  if (!data || !data.pending || data.confirmed) {
    voteBox.style.display = 'none';
    return;
  }

  const voteCount = data.votes ? Object.keys(data.votes).length : 0;
  const direction = data.pendingDirection;
  const route     = ROUTES[routeId];
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
      <p class="vote-hint">Timer starts when ${VOTES_NEEDED} people report the same departure</p>
    </div>
  `;
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
  let cls, label;
  if (data.byAdmin)             { cls='high';   label='✓ Admin confirmed'; }
  else if (elapsed > STALE_THRESHOLD) { cls='low'; label='⚠ Low reliability — data is old'; }
  else if (data.updateCount >= 3)     { cls='high'; label='✓ High reliability — 3+ reports'; }
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

// DEPARTURE REPORTING

function reportDeparture(port) {
  // Check device anti-spam (skip for admin)
  if (!isAdmin) {
    const key        = `last_vote_${currentRoute}_${port}`;
    const lastVote   = parseInt(localStorage.getItem(key) || '0', 10);
    const now        = Date.now();
    if (now - lastVote < ANTI_SPAM_DEVICE) {
      const waitMin = Math.ceil((ANTI_SPAM_DEVICE - (now - lastVote)) / 60000);
      alert(`You already reported recently. Please wait ${waitMin} more minute${waitMin !== 1 ? 's' : ''}.`);
      return;
    }
  }

  pendingDepart = port;
  const route    = ROUTES[currentRoute];
  const portName = port === 'A' ? route.portA : route.portB;
  const modeText = isAdmin ? 'As admin, confirm ferry departure from' : 'Did the ferry just leave';
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
    // Admin → instant confirmed departure
    const payload = {
      direction,
      timestamp:   now,
      confirmed:   true,
      byAdmin:     true,
      updateCount: 1,
      pending:     false,
    };
    writeConfirmed(savedRoute, payload);
  } else {
    // Commuter vote
    castVote(savedRoute, direction, now, deviceId);
  }
}

function castVote(routeId, direction, now, deviceId) {
  const existing = liveData[routeId] || {};

  // If there's a pending vote in same direction, add to it
  // If different direction or no pending, start fresh
  const samePending = existing.pending && existing.pendingDirection === direction;

  const votesRef  = fbRef(db, `ferries/${routeId}/votes`);
  const routeRef  = fbRef(db, `ferries/${routeId}`);

  if (samePending) {
    // Add this vote
    const newVotes = { ...(existing.votes || {}), [deviceId]: now };
    const voteCount = Object.keys(newVotes).length;

    if (voteCount >= VOTES_NEEDED) {
      // Enough votes — calculate average timestamp and confirm
      const timestamps  = Object.values(newVotes);
      const avgTs       = Math.round(timestamps.reduce((a, b) => a + b, 0) / timestamps.length);
      const payload = {
        direction,
        timestamp:   avgTs,
        confirmed:   true,
        byAdmin:     false,
        updateCount: voteCount,
        pending:     false,
        votes:       newVotes,
      };
      writeConfirmed(routeId, payload);
    } else {
      // Not enough yet — update vote count
      fbSet(fbRef(db, `ferries/${routeId}`), {
        ...existing,
        votes: newVotes,
        pending: true,
        pendingDirection: direction,
      }).then(() => {
        saveDeviceVote(routeId, direction === 'A2B' ? 'A' : 'B');
        console.log(`🗳 Vote recorded: ${voteCount}/${VOTES_NEEDED}`);
      }).catch(err => alert('Could not save vote: ' + err.message));
    }
  } else {
    // Fresh vote — start new pending
    fbSet(routeRef, {
      pending: true,
      confirmed: false,
      pendingDirection: direction,
      votes: { [deviceId]: now },
      timestamp: null,
    }).then(() => {
      saveDeviceVote(routeId, direction === 'A2B' ? 'A' : 'B');
      console.log('🗳 First vote cast, waiting for more...');
    }).catch(err => alert('Could not save vote: ' + err.message));
  }
}

function writeConfirmed(routeId, payload) {
  fbSet(fbRef(db, `ferries/${routeId}`), payload)
    .then(() => {
      console.log('✅ Departure confirmed!');
      if (!isAdmin) saveDeviceVote(routeId, payload.direction === 'A2B' ? 'A' : 'B');
      liveData[routeId] = payload;
      currentRoute = routeId;
      renderRouteStatus(routeId, payload);
      startTimer();
    })
    .catch(err => {
      console.error('❌ Write failed:', err);
      alert('Write failed: ' + err.message);
    });
}

function saveDeviceVote(routeId, port) {
  const key = `last_vote_${routeId}_${port}`;
  localStorage.setItem(key, String(Date.now()));
}

// UTILITIES

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

// ── Expose globals ────────────────────────────────────
window.openRoute        = openRoute;
window.goHome           = goHome;
window.reportDeparture  = reportDeparture;
window.closePopup       = closePopup;
window.confirmDeparture = confirmDeparture;
window.toggleAdmin      = toggleAdmin;
