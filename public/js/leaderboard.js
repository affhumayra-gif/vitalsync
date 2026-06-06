// public/js/leaderboard.js
import { guardAuth, initNav, apiFetch, toast } from '/js/api.js';
import { requestNotificationPermission, startReminders, stopReminders } from '/js/notifications.js';

const user = await guardAuth();
initNav('/leaderboard.html');

let leaderboardData = null;
let currentTab      = 'steps';

// ── Load leaderboard + preferences ───────────────────────────────────────
async function loadAll() {
  try {
    const [lb, prefs] = await Promise.all([
      apiFetch('/api/leaderboard'),
      apiFetch('/api/notifications/preferences'),
    ]);
    leaderboardData = lb;

    // Populate toggles
    document.getElementById('toggle-leaderboard').checked = prefs.leaderboardOptIn   || false;
    document.getElementById('toggle-digest').checked      = prefs.emailDigest         || false;
    document.getElementById('toggle-browser').checked     = prefs.browserNotifications || false;

    if (prefs.browserNotifications) startReminders();

    renderLeaderboard(lb);
  } catch (err) {
    toast(err.message, 'error');
    document.getElementById('leaderboard-loading').innerHTML =
      '<p style="color:rgba(200,170,130,0.70)">Could not load leaderboard.</p>';
  }
}

await loadAll();

// ── Render leaderboard ────────────────────────────────────────────────────
function renderLeaderboard(lb) {
  document.getElementById('leaderboard-loading').style.display  = 'none';
  document.getElementById('leaderboard-content').style.display  = 'block';

  // My ranks
  if (lb.myRanks && (lb.myRanks.steps || lb.myRanks.sleep || lb.myRanks.goals)) {
    document.getElementById('my-rank-strip').style.display = 'flex';
    document.getElementById('my-steps-rank').textContent = lb.myRanks.steps ? `#${lb.myRanks.steps}` : '—';
    document.getElementById('my-sleep-rank').textContent  = lb.myRanks.sleep ? `#${lb.myRanks.sleep}` : '—';
    document.getElementById('my-goals-rank').textContent  = lb.myRanks.goals ? `#${lb.myRanks.goals}` : '—';
  }

  // Render each tab panel
  renderTab('steps', lb.steps,  'steps',      '🚶', 'Total steps this week');
  renderTab('sleep', lb.sleep,  'sleep',      '🌙', 'Nights with ≥7 hrs sleep this week');
  renderTab('goals', lb.goals,  'goal streak','🎯', 'Consecutive days with 100% goal completion');

  // Week range label
  if (lb.weekRange) {
    const fmt = iso => new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    document.querySelectorAll('.section-label').forEach(el => {
      if (el.textContent === 'Settings & Notifications') return;
    });
  }
}

function renderTab(tabId, rows, metricName, icon, description) {
  const el = document.getElementById(`tab-${tabId}`);
  if (!el) return;

  if (!rows || rows.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <span style="font-size:2.5rem">${icon}</span>
        <div style="font-weight:600;color:var(--text)">No data yet</div>
        <div>Enable "Join the Leaderboard" below and log your ${metricName} to appear here.</div>
      </div>`;
    return;
  }

  const medalEmoji = ['🥇', '🥈', '🥉'];

  el.innerHTML = `
    <p style="font-size:0.8rem;color:rgba(200,170,130,0.70);margin-bottom:1rem">${description}</p>
    ${rows.map(r => `
      <div class="rank-row rank-${r.rank} ${r.isMe ? 'me' : ''}">
        <div class="rank-num">${r.rank <= 3 ? medalEmoji[r.rank-1] : r.rank}</div>
        <div class="rank-name">
          ${esc(r.name)}
          ${r.isMe ? '<span class="rank-me-tag">you</span>' : ''}
        </div>
        <div class="rank-value">${r.label}</div>
      </div>`
    ).join('')}`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.style.display = p.id === `tab-${currentTab}` ? 'block' : 'none';
    });
  });
});

// ── Settings toggles ──────────────────────────────────────────────────────
async function savePreferences(updates) {
  try {
    await apiFetch('/api/notifications/preferences', { method:'PATCH', body: JSON.stringify(updates) });
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('toggle-leaderboard').addEventListener('change', async e => {
  await savePreferences({ leaderboardOptIn: e.target.checked });
  toast(e.target.checked ? 'You\'re on the leaderboard!' : 'Removed from leaderboard.', e.target.checked ? 'success' : 'info');
  // Reload to reflect change
  try { leaderboardData = await apiFetch('/api/leaderboard'); renderLeaderboard(leaderboardData); } catch {}
});

document.getElementById('toggle-digest').addEventListener('change', async e => {
  await savePreferences({ emailDigest: e.target.checked });
  toast(e.target.checked ? 'Weekly email digest enabled.' : 'Email digest disabled.', 'info');
});

document.getElementById('toggle-browser').addEventListener('change', async e => {
  if (e.target.checked) {
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') {
      e.target.checked = false;
      toast('Browser notifications were blocked. Please allow them in your browser settings.', 'warning');
      return;
    }
    startReminders();
    toast('Reminders enabled! You\'ll be nudged to drink water and move.', 'success');
  } else {
    stopReminders();
    toast('Reminders disabled.', 'info');
  }
  await savePreferences({ browserNotifications: e.target.checked });
});

// ── Send digest ───────────────────────────────────────────────────────────
document.getElementById('btn-send-digest').addEventListener('click', async () => {
  const btn = document.getElementById('btn-send-digest');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    const res = await apiFetch('/api/notifications/digest', { method:'POST' });
    toast(res.message, 'success');
  } catch (err) { toast(err.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '<i class="fa fa-envelope"></i> Send Weekly Digest Now';
});

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
