// public/js/exercise.js
import { guardAuth, initNav, apiFetch, toast } from '/js/api.js';

const user = await guardAuth();
initNav('/exercise.html');

// ── State ────────────────────────────────────────────────────────────────
let sessions     = [];
let userWeightKg = 70;
let selectedEx   = null;
let editingId    = null;
let isManualMode = false;

const TODAY     = new Date().toISOString().split('T')[0];
const DURATIONS = [15, 30, 45, 60, 90];

// ── DOM ───────────────────────────────────────────────────────────────────
const exInput        = document.getElementById('ex-input');
const durInput       = document.getElementById('dur-input');
const durBtns        = document.getElementById('dur-btns');
const burnPreview    = document.getElementById('burn-preview');
const manualExName   = document.getElementById('manual-ex-name');
const manualDur      = document.getElementById('manual-dur');
const manualBurn     = document.getElementById('manual-burn');
const manualBurnPrev = document.getElementById('manual-burn-preview');
const logBtn         = document.getElementById('btn-log-ex');
const dropdown       = document.getElementById('ex-dropdown');
const sessionsList   = document.getElementById('sessions-list');
const totalBurnEl    = document.getElementById('total-burn-today');
const weightDisplay  = document.getElementById('weight-display');
const stepsInput     = document.getElementById('steps-input');
const btnLogSteps    = document.getElementById('btn-log-steps');
const stepsBurnEl    = document.getElementById('steps-burn');
const stepsCalEl     = document.getElementById('steps-cal');

await loadData();
renderDurBtns();

async function loadData() {
  try {
    const data = await apiFetch(`/api/exercise?date=${TODAY}`);
    sessions     = data.sessions   || [];
    userWeightKg = data.weightKg   || 70;

    const wt = weightDisplay.querySelector('span');
    if (wt) wt.textContent = userWeightKg
      ? `Calculations use your weight: ${userWeightKg} kg`
      : 'Set your weight in Profile for accurate estimates';

    const stepsData = await apiFetch(`/api/exercise/steps?date=${TODAY}`);
    if (stepsData.stepCount) {
      stepsInput.value  = stepsData.stepCount;
      stepsBurnEl.textContent = `🦶 ${stepsData.stepCount.toLocaleString()} steps`;
      stepsCalEl.textContent  = `≈ ${stepsData.caloriesFromSteps} kcal burned`;
    }
    renderSessions();
    updateTotalBurn();
  } catch (err) { toast(err.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════
//  MODE TOGGLE
// ══════════════════════════════════════════════════════════════════════════
document.getElementById('btn-mode-search').addEventListener('click', () => setMode(false));
document.getElementById('btn-mode-manual').addEventListener('click', () => setMode(true));

function setMode(manual) {
  isManualMode = manual;
  document.getElementById('search-mode').style.display = manual ? 'none' : 'block';
  document.getElementById('manual-mode').style.display = manual ? 'block' : 'none';
  document.getElementById('btn-mode-search').classList.toggle('active', !manual);
  document.getElementById('btn-mode-manual').classList.toggle('active', manual);
  resetExForm();
  manualExName.value = ''; manualDur.value = ''; manualBurn.value = '';
  manualBurnPrev.textContent = '🔥 — kcal'; manualBurnPrev.classList.remove('has-value');
  logBtn.disabled = true;
}

// Manual: live preview
manualBurn.addEventListener('input', () => {
  const cal = parseInt(manualBurn.value);
  if (cal > 0) {
    manualBurnPrev.textContent = `🔥 ${cal.toLocaleString()} kcal`;
    manualBurnPrev.classList.add('has-value');
    logBtn.disabled = !manualExName.value.trim();
  } else {
    manualBurnPrev.textContent = '🔥 — kcal';
    manualBurnPrev.classList.remove('has-value');
    logBtn.disabled = true;
  }
});
manualExName.addEventListener('input', () => {
  const cal = parseInt(manualBurn.value);
  logBtn.disabled = !(manualExName.value.trim() && cal > 0);
});

// ══════════════════════════════════════════════════════════════════════════
//  DURATION BUTTONS
// ══════════════════════════════════════════════════════════════════════════
function renderDurBtns() {
  durBtns.innerHTML = DURATIONS.map(d =>
    `<button class="btn-dur" data-min="${d}">${d} min</button>`
  ).join('');
  durBtns.querySelectorAll('.btn-dur').forEach(btn => {
    btn.addEventListener('click', () => {
      durInput.value = btn.dataset.min;
      durBtns.querySelectorAll('.btn-dur').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateBurnPreview();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  AUTOCOMPLETE (search mode)
// ══════════════════════════════════════════════════════════════════════════
let timer = null, activeIdx = -1;

exInput.addEventListener('input', () => {
  clearTimeout(timer);
  selectedEx = null;
  updateBurnPreview();
  const q = exInput.value.trim();
  if (q.length < 2) { closeDropdown(); return; }
  timer = setTimeout(() => fetchSuggestions(q), 200);
});

exInput.addEventListener('keydown', e => {
  const items = dropdown.querySelectorAll('.ac-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx+1, items.length-1); highlight(items); }
  else if (e.key === 'ArrowUp')  { e.preventDefault(); activeIdx = Math.max(activeIdx-1, 0); highlight(items); }
  else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); items[activeIdx].click(); }
  else if (e.key === 'Escape') closeDropdown();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.ex-autocomplete-wrap')) closeDropdown();
});

async function fetchSuggestions(q) {
  try {
    const results = await apiFetch(`/api/exercise/search?q=${encodeURIComponent(q)}`);
    renderDropdown(results);
  } catch { closeDropdown(); }
}

function renderDropdown(results) {
  activeIdx = -1;
  if (!results.length) { closeDropdown(); return; }
  dropdown.innerHTML = results.map(r => {
    const est30 = Math.round(r.calPerKg * userWeightKg * 0.5);
    return `<div class="ac-item" data-name="${esc(r.name)}" data-cal-per-kg="${r.calPerKg}">
      <span class="ac-name">${cap(esc(r.name))}</span>
      <span class="ac-cal">~${est30} kcal / 30 min</span>
    </div>`;
  }).join('');
  dropdown.style.display = 'block';
  dropdown.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedEx = { name: item.dataset.name, calPerKg: Number(item.dataset.calPerKg) };
      exInput.value = cap(selectedEx.name);
      closeDropdown();
      durInput.focus();
      updateBurnPreview();
    });
  });
}

function highlight(items) {
  items.forEach((el,i) => { el.classList.toggle('active', i===activeIdx); if(i===activeIdx) el.scrollIntoView({block:'nearest'}); });
}
function closeDropdown() { dropdown.style.display='none'; dropdown.innerHTML=''; activeIdx=-1; }

durInput.addEventListener('input', updateBurnPreview);

function updateBurnPreview() {
  const mins = parseFloat(durInput.value);
  if (selectedEx && mins > 0) {
    const cal = Math.round(selectedEx.calPerKg * userWeightKg * (mins / 60));
    burnPreview.textContent = `🔥 ${cal} kcal`;
    burnPreview.classList.add('has-value');
    logBtn.disabled = false;
  } else {
    burnPreview.textContent = '🔥 — kcal';
    burnPreview.classList.remove('has-value');
    logBtn.disabled = true;
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  LOG EXERCISE
// ══════════════════════════════════════════════════════════════════════════
logBtn.addEventListener('click', async () => {
  let payload;

  if (isManualMode) {
    const name = manualExName.value.trim();
    const cal  = parseInt(manualBurn.value);
    const dur  = parseInt(manualDur.value) || 0;
    if (!name) { toast('Enter an exercise name.', 'error'); return; }
    if (!cal || cal <= 0) { toast('Enter calories burned.', 'error'); return; }
    payload = {
      exerciseName:    name,
      durationMinutes: dur,
      calPerKg:        null,
      userWeightKg:    null,
      caloriesBurned:  cal,
      isManual:        true,
      date:            TODAY,
    };
  } else {
    if (!selectedEx) { toast('Select an exercise from the list.', 'error'); return; }
    const mins = parseFloat(durInput.value);
    if (!mins || mins <= 0) { toast('Enter duration in minutes.', 'error'); return; }
    const cal = Math.round(selectedEx.calPerKg * userWeightKg * (mins / 60));
    payload = {
      exerciseName:    cap(selectedEx.name),
      durationMinutes: mins,
      calPerKg:        selectedEx.calPerKg,
      userWeightKg,
      caloriesBurned:  cal,
      isManual:        false,
      date:            TODAY,
    };
  }

  logBtn.disabled  = true;
  logBtn.innerHTML = '<span class="spinner"></span> Logging…';

  try {
    if (editingId) {
      await apiFetch(`/api/exercise/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ durationMinutes: payload.durationMinutes, caloriesBurned: payload.caloriesBurned }),
      });
      sessions = sessions.map(s => s.id === editingId ? { ...s, ...payload } : s);
      toast('Session updated.', 'success');
      cancelEdit();
    } else {
      const session = await apiFetch('/api/exercise', { method:'POST', body: JSON.stringify(payload) });
      sessions.push(session);
      toast('Exercise logged!', 'success');
    }
  } catch (err) { toast(err.message, 'error'); }

  resetExForm();
  renderSessions();
  updateTotalBurn();
  logBtn.disabled  = false;
  logBtn.innerHTML = '<i class="fa fa-plus"></i> Log Exercise';
});

// ══════════════════════════════════════════════════════════════════════════
//  RENDER SESSIONS
// ══════════════════════════════════════════════════════════════════════════
function renderSessions() {
  if (!sessions.length) {
    sessionsList.innerHTML = `<div class="empty-state"><i class="fa fa-dumbbell" style="font-size:2rem;margin-bottom:0.8rem"></i><p>No exercise logged today.</p></div>`;
    return;
  }
  sessionsList.innerHTML = `
    <table>
      <thead><tr><th>Exercise</th><th>Duration</th><th>Calories</th><th></th></tr></thead>
      <tbody>
        ${sessions.map(s => `
          <tr>
            <td style="font-weight:500">
              ${esc(s.exerciseName)}
              ${s.isManual ? '<span class="manual-tag">manual</span>' : ''}
            </td>
            <td style="color:rgba(200,170,130,0.80)">${s.durationMinutes ? s.durationMinutes+' min' : '—'}</td>
            <td><span class="cal-badge">🔥 ${s.caloriesBurned} kcal</span></td>
            <td>
              <div style="display:flex;gap:6px">
                <button class="btn-icon" onclick="startEditEx('${s.id}')"><i class="fa fa-pen"></i></button>
                <button class="btn-icon danger" onclick="deleteEx('${s.id}')"><i class="fa fa-trash"></i></button>
              </div>
            </td>
          </tr>`
        ).join('')}
      </tbody>
    </table>`;
}

function updateTotalBurn() {
  const total = sessions.reduce((s, ex) => s + ex.caloriesBurned, 0);
  totalBurnEl.textContent = `${total} kcal`;
}

// ══════════════════════════════════════════════════════════════════════════
//  EDIT / DELETE
// ══════════════════════════════════════════════════════════════════════════
window.startEditEx = function(id) {
  const s = sessions.find(x => x.id === id); if (!s) return;
  editingId = id;
  if (s.isManual) {
    setMode(true);
    manualExName.value = s.exerciseName;
    manualDur.value    = s.durationMinutes || '';
    manualBurn.value   = s.caloriesBurned;
    manualBurnPrev.textContent = `🔥 ${s.caloriesBurned} kcal`;
    manualBurnPrev.classList.add('has-value');
    logBtn.disabled = false;
  } else {
    setMode(false);
    selectedEx    = { name: s.exerciseName, calPerKg: s.calPerKg };
    exInput.value = s.exerciseName;
    durInput.value= s.durationMinutes;
    updateBurnPreview();
  }
  logBtn.innerHTML = '<i class="fa fa-check"></i> Save Changes';
  document.getElementById('cancel-ex').style.display = 'inline-flex';
  document.getElementById('ex-form-title').textContent = 'Edit Session';
  document.getElementById('ex-log-section').scrollIntoView({ behavior:'smooth' });
};

window.deleteEx = async function(id) {
  if (!confirm('Remove this session?')) return;
  try {
    await apiFetch(`/api/exercise/${id}`, { method:'DELETE' });
    sessions = sessions.filter(s => s.id !== id);
    renderSessions(); updateTotalBurn(); toast('Session removed.', 'info');
  } catch (err) { toast(err.message, 'error'); }
};

function cancelEdit() {
  editingId = null;
  document.getElementById('cancel-ex').style.display = 'none';
  document.getElementById('ex-form-title').textContent = 'Log Exercise';
  logBtn.innerHTML = '<i class="fa fa-plus"></i> Log Exercise';
  setMode(false);
}
document.getElementById('cancel-ex')?.addEventListener('click', cancelEdit);

// ══════════════════════════════════════════════════════════════════════════
//  STEPS
// ══════════════════════════════════════════════════════════════════════════
btnLogSteps.addEventListener('click', async () => {
  const steps = parseInt(stepsInput.value);
  if (!steps || steps < 0) { toast('Enter a valid step count.', 'error'); return; }
  btnLogSteps.disabled  = true; btnLogSteps.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await apiFetch('/api/exercise/steps', {
      method:'POST', body: JSON.stringify({ stepCount: steps, date: TODAY }),
    });
    stepsBurnEl.textContent = `🦶 ${data.stepCount.toLocaleString()} steps`;
    stepsCalEl.textContent  = `≈ ${data.caloriesFromSteps} kcal burned`;
    toast(`${steps.toLocaleString()} steps saved — ${data.caloriesFromSteps} kcal.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
  btnLogSteps.disabled  = false; btnLogSteps.innerHTML = '<i class="fa fa-check"></i> Save Steps';
});

// ══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════
function resetExForm() {
  exInput.value = ''; durInput.value = ''; selectedEx = null;
  burnPreview.textContent = '🔥 — kcal'; burnPreview.classList.remove('has-value');
  durBtns.querySelectorAll('.btn-dur').forEach(b => b.classList.remove('active'));
  closeDropdown();
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cap(s) { return String(s).replace(/\b\w/g, c => c.toUpperCase()); }
