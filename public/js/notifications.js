// public/js/notifications.js
// Browser notification system + timed reminders.
// Import this on any page where you want reminders active.

const WATER_INTERVAL_MS    = 60  * 60 * 1000; // 60 min
const MOVEMENT_INTERVAL_MS = 90  * 60 * 1000; // 90 min
const STORAGE_KEY_WATER    = 'vs_last_water_notif';
const STORAGE_KEY_MOVE     = 'vs_last_move_notif';

// ── Permission ────────────────────────────────────────────────────────────

/**
 * Request browser notification permission.
 * Returns 'granted' | 'denied' | 'default'
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied')  return 'denied';
  const result = await Notification.requestPermission();
  return result;
}

export function hasNotificationPermission() {
  return 'Notification' in window && Notification.permission === 'granted';
}

// ── Show a browser notification ───────────────────────────────────────────

export function showNotification(title, body, options = {}) {
  if (!hasNotificationPermission()) return;
  try {
    new Notification(title, {
      body,
      icon: '/assets/logo.png',
      badge: '/assets/logo.png',
      silent: false,
      ...options,
    });
  } catch (err) {
    console.warn('[Notifications]', err.message);
  }
}

// ── Timed reminders ───────────────────────────────────────────────────────

let waterTimer    = null;
let movementTimer = null;

export function startReminders() {
  if (!hasNotificationPermission()) return;

  // Fire immediately if overdue, then on interval
  checkAndNotifyWater();
  checkAndNotifyMovement();

  waterTimer    = setInterval(checkAndNotifyWater,    WATER_INTERVAL_MS);
  movementTimer = setInterval(checkAndNotifyMovement, MOVEMENT_INTERVAL_MS);

  console.log('[Notifications] Reminders started');
}

export function stopReminders() {
  if (waterTimer)    clearInterval(waterTimer);
  if (movementTimer) clearInterval(movementTimer);
  waterTimer = movementTimer = null;
}

function checkAndNotifyWater() {
  const last = parseInt(localStorage.getItem(STORAGE_KEY_WATER) || '0');
  const now  = Date.now();
  if (now - last >= WATER_INTERVAL_MS) {
    showNotification('💧 Hydration Reminder', 'Time to drink a glass of water!');
    localStorage.setItem(STORAGE_KEY_WATER, String(now));
  }
}

function checkAndNotifyMovement() {
  const last = parseInt(localStorage.getItem(STORAGE_KEY_MOVE) || '0');
  const now  = Date.now();
  if (now - last >= MOVEMENT_INTERVAL_MS) {
    showNotification('🚶 Move Reminder', 'You\'ve been sitting a while. Take a 5-minute walk!');
    localStorage.setItem(STORAGE_KEY_MOVE, String(now));
  }
}

// ── In-app dashboard alerts ───────────────────────────────────────────────
// These are visible banner alerts rendered directly in the page DOM.
// Call renderDashboardAlerts(summaryData) from dashboard.js.

const DISMISSED_KEY = 'vs_dismissed_alerts';

function getDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { return []; }
}
function dismiss(id) {
  const list = getDismissed();
  if (!list.includes(id)) { list.push(id); localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.slice(-20))); }
}

/**
 * Build alert objects from dashboard summary data.
 * Each alert: { id, type, icon, message }
 */
export function buildAlerts(data) {
  const alerts  = [];
  const today   = new Date().toISOString().split('T')[0];
  const dismissed = getDismissed();

  const push = (id, type, icon, message) => {
    if (!dismissed.includes(id + '_' + today)) {
      alerts.push({ id: id + '_' + today, type, icon, message });
    }
  };

  // Sleep alerts
  if (data.sleep !== null) {
    if (data.sleep < 6)
      push('sleep_poor', 'danger', '😴',
        `Only ${data.sleep} hrs sleep last night. Poor sleep raises cortisol and cravings — try an earlier bedtime tonight.`);
    else if (data.sleep < 7)
      push('sleep_low', 'warning', '🌙',
        `${data.sleep} hrs sleep — slightly under the recommended 7–9 hrs. A consistent bedtime helps.`);
    else if (data.sleep >= 8)
      push('sleep_great', 'success', '🌙',
        `${data.sleep} hrs sleep — great night's rest! Sleep supports muscle recovery and mood.`);
  }

  // Stress alerts
  if (data.stress !== null) {
    if (data.stress > 70)
      push('stress_high', 'danger', '🧠',
        `Stress level ${data.stress}/100. Try box breathing: inhale 4s → hold 4s → exhale 4s → hold 4s. Repeat 4×.`);
    else if (data.stress > 50)
      push('stress_moderate', 'warning', '😐',
        `Stress level ${data.stress}/100. A short walk or 10 minutes of stretching can help lower it.`);
  }

  // Calorie surplus
  if (data.deficit !== null && data.deficit < -300)
    push('cal_surplus', 'warning', '🍽️',
      `${Math.abs(data.deficit).toLocaleString()} kcal over your goal today. A light dinner and short walk can help balance it.`);

  // Step milestones
  if (data.steps >= 10000)
    push('steps_10k', 'success', '🏆',
      `${data.steps.toLocaleString()} steps today — daily 10,000 step goal reached! Excellent work.`);
  else if (data.steps >= 7500)
    push('steps_close', 'info', '🚶',
      `${data.steps.toLocaleString()} steps — you're ${(10000 - data.steps).toLocaleString()} steps away from 10,000!`);
  else if (data.steps === 0 && new Date().getHours() >= 14)
    push('steps_none', 'info', '👟',
      `No steps logged today. Even a 10-minute walk counts — get outside if you can!`);

  return alerts;
}

/**
 * Render alert banners into the given container element.
 * Each alert has a dismiss (×) button.
 */
export function renderAlerts(container, alerts) {
  if (!container || alerts.length === 0) { container.style.display = 'none'; return; }

  const colorMap = {
    success: { bg:'rgba(82,201,148,0.10)', border:'rgba(82,201,148,0.35)', text:'#8DEBB8' },
    warning: { bg:'rgba(240,176,64,0.10)', border:'rgba(240,176,64,0.35)', text:'#F8D880' },
    danger:  { bg:'rgba(240,96,96,0.12)',  border:'rgba(240,96,96,0.40)',  text:'#F8A8A8' },
    info:    { bg:'rgba(90,158,224,0.10)', border:'rgba(90,158,224,0.35)', text:'#A8D8FF' },
  };

  container.style.display = 'flex';
  container.innerHTML = alerts.map(a => {
    const c = colorMap[a.type] || colorMap.info;
    return `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;
                  background:${c.bg};border:1px solid ${c.border};border-radius:12px;
                  animation:alert-in 0.3s ease;"
           id="alert-${a.id}">
        <span style="font-size:1.1rem;flex-shrink:0;margin-top:1px">${a.icon}</span>
        <span style="font-size:0.86rem;color:${c.text};line-height:1.5;flex:1">${a.message}</span>
        <button onclick="dismissAlert('${a.id}')"
                style="background:none;border:none;color:${c.text};cursor:pointer;
                       font-size:1rem;opacity:0.6;padding:0;flex-shrink:0;line-height:1">×</button>
      </div>`;
  }).join('');

  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '8px';
  container.style.marginBottom = '1rem';
}

// Dismiss handler — needs to be global for inline onclick
window.dismissAlert = function(id) {
  dismiss(id);
  const el = document.getElementById('alert-' + id);
  if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.2s'; setTimeout(() => el.remove(), 200); }
};
