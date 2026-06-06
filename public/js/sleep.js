import { guardAuth, initNav, apiFetch, toast } from '/js/api.js';
const user = await guardAuth();
initNav('/sleep.html');

let sessions  = [];
let editingId = null;

const startInput = document.getElementById('sleep-start');
const endInput   = document.getElementById('sleep-end');
const wakeInput  = document.getElementById('wake-count');
const durPreview = document.getElementById('dur-preview');
const qualPrev   = document.getElementById('quality-preview');
const logBtn     = document.getElementById('btn-log-sleep');
const sleepList  = document.getElementById('sleep-list');
const statsRow   = document.getElementById('sleep-stats');

// Default end to now, start to 8hrs ago
const now = new Date();
const ago = new Date(now - 8 * 3600000);
endInput.value   = toLocalISO(now);
startInput.value = toLocalISO(ago);

await loadSessions();

[startInput, endInput].forEach(el => el.addEventListener('change', updatePreview));
updatePreview();

async function loadSessions() {
  try {
    const data = await apiFetch('/api/sleep?limit=20');
    sessions = data.sessions || [];
    renderList();
    renderStats();
  } catch (err) { toast(err.message, 'error'); }
}

function updatePreview() {
  const start = startInput.value, end = endInput.value;
  if (!start || !end) { durPreview.textContent = '🌙 — hrs'; durPreview.classList.remove('has-value'); qualPrev.textContent = ''; return; }
  const hrs = (new Date(end) - new Date(start)) / 3600000;
  if (hrs <= 0) { durPreview.textContent = '⚠️ Invalid'; durPreview.classList.remove('has-value'); qualPrev.textContent = ''; return; }
  durPreview.textContent = `🌙 ${hrs.toFixed(2)} hrs`;
  durPreview.classList.add('has-value');
  const q = quality(hrs);
  qualPrev.textContent  = q.label;
  qualPrev.style.color  = `var(--${q.color === 'success' ? 'success' : q.color === 'warning' ? 'warning' : q.color === 'danger' ? 'danger' : 'info-text'})`;
}

logBtn.addEventListener('click', async () => {
  const start = startInput.value, end = endInput.value, wake = parseInt(wakeInput.value) || 0;
  if (!start || !end) { toast('Enter both bedtime and wake-up time.', 'error'); return; }
  logBtn.disabled = true; logBtn.innerHTML = '<span class="spinner"></span>';
  try {
    if (editingId) {
      const updated = await apiFetch(`/api/sleep/${editingId}`, { method:'PATCH', body: JSON.stringify({ startTime: start, endTime: end, wakeCount: wake }) });
      sessions = sessions.map(s => s.id === editingId ? { ...s, ...updated } : s);
      toast('Session updated.', 'success'); cancelEdit();
    } else {
      const session = await apiFetch('/api/sleep', { method:'POST', body: JSON.stringify({ startTime: start, endTime: end, wakeCount: wake }) });
      sessions.unshift(session);
      toast('Sleep logged!', 'success');
    }
  } catch (err) { toast(err.message, 'error'); }
  renderList(); renderStats();
  logBtn.disabled = false; logBtn.innerHTML = '<i class="fa fa-moon"></i> Log Sleep';
});

function renderList() {
  if (!sessions.length) { sleepList.innerHTML = '<div class="empty-state"><i class="fa fa-bed" style="font-size:2rem;color:var(--text-muted);margin-bottom:0.8rem"></i><p>No sleep sessions yet.</p></div>'; return; }
  sleepList.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Bedtime</th><th>Wake up</th><th>Duration</th><th>Wakes</th><th>Quality</th><th></th></tr></thead>
      <tbody>
        ${sessions.map(s => {
          const q = s.quality || quality(s.durationHours);
          return `<tr>
            <td style="font-weight:500">${fmtDate(s.startTime)}</td>
            <td style="color:var(--text-secondary)">${fmtTime(s.startTime)}</td>
            <td style="color:var(--text-secondary)">${fmtTime(s.endTime)}</td>
            <td><strong>${s.durationHours} hrs</strong></td>
            <td style="color:var(--text-muted)">${s.wakeCount}</td>
            <td><span class="quality-badge q-${q.color}">${q.label}</span></td>
            <td><div style="display:flex;gap:6px">
              <button class="btn-icon" onclick="editSleep('${s.id}')"><i class="fa fa-pen"></i></button>
              <button class="btn-icon danger" onclick="deleteSleep('${s.id}')"><i class="fa fa-trash"></i></button>
            </div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderStats() {
  if (!sessions.length) { statsRow.innerHTML = ''; return; }
  const total   = sessions.reduce((s,x)=>s+x.durationHours,0);
  const avg     = total / sessions.length;
  const best    = Math.max(...sessions.map(s=>s.durationHours));
  const under7  = sessions.filter(s=>s.durationHours<7).length;
  statsRow.innerHTML = `
    <div class="sleep-stat"><div class="sleep-stat-val">${avg.toFixed(1)} hrs</div><div class="sleep-stat-label">Avg per session</div></div>
    <div class="sleep-stat"><div class="sleep-stat-val">${best} hrs</div><div class="sleep-stat-label">Best session</div></div>
    <div class="sleep-stat"><div class="sleep-stat-val">${sessions.length - under7}</div><div class="sleep-stat-label">Nights ≥ 7 hrs</div></div>
    <div class="sleep-stat"><div class="sleep-stat-val">${under7}</div><div class="sleep-stat-label">Nights under 7 hrs</div></div>`;
}

window.editSleep = function(id) {
  const s = sessions.find(x => x.id === id); if (!s) return;
  editingId = id;
  startInput.value = toLocalISO(new Date(s.startTime));
  endInput.value   = toLocalISO(new Date(s.endTime));
  wakeInput.value  = s.wakeCount;
  updatePreview();
  logBtn.innerHTML = '<i class="fa fa-check"></i> Save';
  document.getElementById('cancel-sleep').style.display = 'inline-flex';
  document.getElementById('sleep-form-title').textContent = 'Edit Session';
  document.getElementById('sleep-form-card').scrollIntoView({ behavior:'smooth' });
};

window.deleteSleep = async function(id) {
  if (!confirm('Delete this sleep session?')) return;
  try {
    await apiFetch(`/api/sleep/${id}`, { method:'DELETE' });
    sessions = sessions.filter(s => s.id !== id);
    renderList(); renderStats(); toast('Deleted.', 'info');
  } catch (err) { toast(err.message, 'error'); }
};

function cancelEdit() {
  editingId = null;
  document.getElementById('cancel-sleep').style.display = 'none';
  document.getElementById('sleep-form-title').textContent = 'Log Sleep Session';
  logBtn.innerHTML = '<i class="fa fa-moon"></i> Log Sleep';
  const now = new Date(), ago = new Date(now - 8*3600000);
  endInput.value = toLocalISO(now); startInput.value = toLocalISO(ago);
  updatePreview();
}
document.getElementById('cancel-sleep')?.addEventListener('click', cancelEdit);

// Helpers
function quality(h) {
  if (h < 5) return { label:'Poor', color:'danger' };
  if (h < 7) return { label:'Fair', color:'warning' };
  if (h <= 9) return { label:'Good', color:'success' };
  return { label:'Long', color:'info' };
}
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }
function toLocalISO(d) { const off = d.getTimezoneOffset()*60000; return new Date(d-off).toISOString().slice(0,16); }
