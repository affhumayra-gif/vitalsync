import { guardAuth, initNav, apiFetch, toast } from '/js/api.js';
const user = await guardAuth();
initNav('/goals.html');

let todayGoals  = [];
let activeGoals = [];

const PRESETS = [
  { icon:'🚶', type:'steps',          target:10000, unit:'steps'  },
  { icon:'🛌', type:'sleep',          target:8,     unit:'hrs'    },
  { icon:'💧', type:'water',          target:2000,  unit:'ml'     },
  { icon:'🏃', type:'exercise',       target:30,    unit:'min'    },
  { icon:'🍽️', type:'calorie_intake', target:2000,  unit:'kcal'   },
  { icon:'🔥', type:'calorie_burn',   target:500,   unit:'kcal'   },
  { icon:'🧘', type:'meditation',     target:10,    unit:'min'    },
  { icon:'📖', type:'reading',        target:20,    unit:'min'    },
];

// Non-trackable types (require manual check-off)
const MANUAL_TYPES = new Set(['water', 'meditation', 'reading']);

// Preset chips
const chipsEl = document.getElementById('preset-chips');
chipsEl.innerHTML = PRESETS.map(p =>
  `<div class="goal-chip" data-type="${p.type}" data-target="${p.target}" data-unit="${p.unit}">
    ${p.icon} ${p.type.replace(/_/g,' ')}
   </div>`
).join('');
chipsEl.querySelectorAll('.goal-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chipsEl.querySelectorAll('.goal-chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    document.getElementById('goal-type').value   = chip.dataset.type;
    document.getElementById('goal-target').value = chip.dataset.target;
    document.getElementById('goal-unit').value   = chip.dataset.unit;
  });
});

await loadAll();

async function loadAll() {
  try {
    const [todayData, goalsData] = await Promise.all([
      apiFetch('/api/goals/today'),
      apiFetch('/api/goals'),
    ]);
    todayGoals  = todayData.goals  || [];
    activeGoals = goalsData.goals  || [];
    renderToday();
    renderActive();
  } catch (err) { toast(err.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════
//  TODAY'S GOALS — with progress bars and auto-completion
// ══════════════════════════════════════════════════════════════════════════
function renderToday() {
  const total     = todayGoals.length;
  const completed = todayGoals.filter(g => g.isCompleted).length;
  const pct       = total ? Math.round((completed / total) * 100) : 0;

  document.getElementById('comp-bar').style.width = pct + '%';
  document.getElementById('comp-pct').textContent = pct + '%';
  document.getElementById('comp-label').textContent = total
    ? `${completed} of ${total} goals completed today`
    : 'No active goals yet — add one below';

  const container = document.getElementById('today-goals');
  if (!total) {
    container.innerHTML = '<p class="muted" style="text-align:center;padding:1rem 0">Add goals below to track your daily progress.</p>';
    return;
  }

  container.innerHTML = todayGoals.map(g => {
    const isManual    = !g.trackable;
    const progress    = g.progress ?? 0;
    const barWidth    = Math.min(progress, 100);

    // Progress bar colour
    const barColor = g.isCompleted
      ? 'linear-gradient(90deg,#52C990,#8DEBB8)'
      : progress >= 75
      ? 'linear-gradient(90deg,#D4803A,#F0A060)'
      : 'linear-gradient(90deg,var(--copper-dark),var(--copper))';

    // Actual value display
    let progressText = '';
    if (g.trackable && g.actualValue !== null) {
      const actual = g.type === 'sleep'
        ? `${g.actualValue} hrs`
        : g.actualValue.toLocaleString() + (g.unit ? ` ${g.unit}` : '');
      const target = g.type === 'sleep'
        ? `${g.targetValue} hrs`
        : g.targetValue.toLocaleString() + (g.unit ? ` ${g.unit}` : '');

      progressText = g.type === 'calorie_intake'
        ? `${actual} eaten · goal: under ${target}`
        : `${actual} · goal: ${target}`;
    }

    // Status tag
    let statusTag = '';
    if (g.isCompleted && g.autoCompleted) {
      statusTag = `<span class="auto-badge">⚡ Auto-completed</span>`;
    } else if (g.isCompleted) {
      statusTag = `<span class="manual-done-badge">✓ Done</span>`;
    } else if (isManual) {
      statusTag = `<span class="tap-badge">Tap to complete</span>`;
    }

    return `
      <div class="completion-card ${g.isCompleted ? 'done' : ''}" id="card-${g.id}">
        <div style="display:flex;align-items:flex-start;gap:12px;width:100%">

          <!-- Checkbox (only interactive for manual goals) -->
          <div class="goal-check ${g.isCompleted ? 'checked' : ''} ${!isManual ? 'auto-check' : ''}"
               id="chk-${g.id}"
               ${isManual ? `onclick="toggleGoal('${g.id}')"` : ''}
               title="${isManual ? 'Click to mark complete' : 'Auto-tracked from your logged data'}">
            <i class="fa fa-check"></i>
          </div>

          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px">
              <h4 class="goal-title ${g.isCompleted ? 'done-text' : ''}">${cap(g.type.replace(/_/g,' '))}</h4>
              ${statusTag}
            </div>

            <!-- Progress bar (only for trackable) -->
            ${g.trackable ? `
              <div class="goal-progress-wrap">
                <div class="goal-progress-bar" style="width:${barWidth}%;background:${barColor}"></div>
              </div>
              <div class="goal-progress-text">${progressText || `Target: ${g.targetValue.toLocaleString()} ${g.unit}`}</div>
            ` : `
              <div class="goal-progress-text">Target: ${g.targetValue.toLocaleString()} ${g.unit} · Manual tracking</div>
            `}
          </div>

        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════
//  MANUAL TOGGLE (only for non-trackable goals)
// ══════════════════════════════════════════════════════════════════════════
window.toggleGoal = async function(id) {
  const goal = todayGoals.find(g => g.id === id);
  if (!goal) return;
  if (!goal.trackable === false) return; // shouldn't happen but guard it

  const chk  = document.getElementById(`chk-${id}`);
  const card = document.getElementById(`card-${id}`);
  chk.classList.toggle('checked');
  card.classList.toggle('done');

  try {
    const result = await apiFetch(`/api/goals/${id}/toggle`, { method:'POST' });
    todayGoals = todayGoals.map(g => g.id === id ? { ...g, isCompleted: result.isCompleted } : g);
    renderToday();
    if (result.isCompleted) {
      const done = todayGoals.filter(g => g.isCompleted).length;
      toast(`Goal completed! ${done}/${todayGoals.length} done today.`, 'success');
    }
  } catch (err) {
    chk.classList.toggle('checked');
    card.classList.toggle('done');
    toast(err.message, 'error');
  }
};

// ══════════════════════════════════════════════════════════════════════════
//  ACTIVE GOALS LIST
// ══════════════════════════════════════════════════════════════════════════
function renderActive() {
  const el = document.getElementById('active-goals');
  if (!activeGoals.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa fa-bullseye" style="font-size:2rem;color:var(--text-muted);margin-bottom:0.8rem"></i><p>No active goals. Add one above.</p></div>';
    return;
  }
  el.innerHTML = activeGoals.map(g => {
    const isTracked = !MANUAL_TYPES.has(g.type);
    return `
      <div class="active-goal-row">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:600;color:var(--text)">${cap(g.type.replace(/_/g,' '))}</span>
            ${isTracked
              ? `<span style="font-size:0.7rem;padding:1px 7px;background:rgba(82,201,148,0.12);border:1px solid rgba(82,201,148,0.3);border-radius:999px;color:#8DEBB8;font-weight:600">⚡ Auto-tracked</span>`
              : `<span style="font-size:0.7rem;padding:1px 7px;background:var(--copper-glow);border:1px solid var(--border);border-radius:999px;color:var(--copper-light);font-weight:600">Manual</span>`
            }
          </div>
          <div style="font-size:0.78rem;color:var(--text-secondary)">
            ${g.targetValue.toLocaleString()} ${g.unit} / day
            ${g.type === 'calorie_intake' ? ' (stay under)' : ''}
          </div>
        </div>
        <button class="btn-icon danger" onclick="removeGoal('${g.id}')" title="Remove goal">
          <i class="fa fa-xmark"></i>
        </button>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════
//  ADD GOAL
// ══════════════════════════════════════════════════════════════════════════
document.getElementById('btn-add-goal').addEventListener('click', async () => {
  const type   = document.getElementById('goal-type').value.trim();
  const target = parseFloat(document.getElementById('goal-target').value);
  const unit   = document.getElementById('goal-unit').value.trim();

  if (!type)              { toast('Enter a goal type.', 'error');         return; }
  if (!target || target <= 0) { toast('Enter a valid target value.', 'error'); return; }

  const btn = document.getElementById('btn-add-goal');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  try {
    const goal = await apiFetch('/api/goals', {
      method: 'POST',
      body: JSON.stringify({ type, targetValue: target, unit }),
    });
    activeGoals.push(goal);
    todayGoals.push({ ...goal, isCompleted: false, trackable: !MANUAL_TYPES.has(type), progress: 0, actualValue: null });
    document.getElementById('goal-type').value   = '';
    document.getElementById('goal-target').value = '';
    document.getElementById('goal-unit').value   = '';
    document.querySelectorAll('.goal-chip').forEach(c => c.classList.remove('selected'));

    // Reload today to get actual values for new goal
    const todayData = await apiFetch('/api/goals/today');
    todayGoals = todayData.goals || [];
    renderToday();
    renderActive();
    toast(`"${cap(type.replace(/_/g,' '))}" goal added!`, 'success');
  } catch (err) { toast(err.message, 'error'); }

  btn.disabled = false; btn.innerHTML = '<i class="fa fa-plus"></i> Add Goal';
});

// ══════════════════════════════════════════════════════════════════════════
//  REMOVE GOAL
// ══════════════════════════════════════════════════════════════════════════
window.removeGoal = async function(id) {
  if (!confirm('Remove this goal?')) return;
  try {
    await apiFetch(`/api/goals/${id}`, { method:'DELETE' });
    activeGoals = activeGoals.filter(g => g.id !== id);
    todayGoals  = todayGoals.filter(g => g.id !== id);
    renderToday();
    renderActive();
    toast('Goal removed.', 'info');
  } catch (err) { toast(err.message, 'error'); }
};

function cap(s) { return String(s).replace(/\b\w/g, c => c.toUpperCase()); }
