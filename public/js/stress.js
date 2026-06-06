import { guardAuth, initNav, apiFetch, toast } from '/js/api.js';
const user = await guardAuth();
initNav('/stress.html');

let readings = [];
let chart    = null;

const slider  = document.getElementById('stress-slider');
const display = document.getElementById('stress-display');
const label   = document.getElementById('stress-label');
const logBtn  = document.getElementById('btn-log-stress');
const listEl  = document.getElementById('stress-list');

await loadReadings();

// Live slider
slider.addEventListener('input', updateSliderUI);
updateSliderUI();

function updateSliderUI() {
  const val = parseInt(slider.value);
  display.textContent = val;
  const s = stressStatus(val);
  display.style.color = s.hex;
  label.textContent   = s.label;
  label.style.color   = s.hex;
}

async function loadReadings() {
  try {
    const data = await apiFetch('/api/stress?limit=30');
    readings = data.readings || [];
    renderList();
    renderChart();
  } catch (err) { toast(err.message, 'error'); }
}

logBtn.addEventListener('click', async () => {
  const level = parseInt(slider.value);
  logBtn.disabled = true; logBtn.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await apiFetch('/api/stress', { method:'POST', body: JSON.stringify({ level }) });
    readings.unshift(r);
    if (readings.length > 30) readings.pop();
    renderList(); renderChart();
    toast(`Stress level ${level} logged.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
  logBtn.disabled = false; logBtn.innerHTML = '<i class="fa fa-wave-square"></i> Log Reading';
});

function renderList() {
  if (!readings.length) {
    listEl.innerHTML = '<div class="empty-state"><i class="fa fa-brain" style="font-size:2rem;color:var(--text-muted);margin-bottom:0.8rem"></i><p>No readings yet.</p></div>';
    return;
  }
  listEl.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Time</th><th>Level</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${readings.map(r => {
          const s = r.status || stressStatus(r.level);
          return `<tr>
            <td>${new Date(r.recordedAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</td>
            <td style="color:var(--text-secondary)">${new Date(r.recordedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td>
            <td><strong>${r.level}</strong></td>
            <td><span class="status-badge s-${s.color}">${s.label}</span></td>
            <td><button class="btn-icon danger" onclick="deleteReading('${r.id}')"><i class="fa fa-trash"></i></button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderChart() {
  const ctx = document.getElementById('stress-chart').getContext('2d');
  const sorted = [...readings].reverse().slice(-20);
  const labels = sorted.map(r => new Date(r.recordedAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}));
  const values = sorted.map(r => r.level);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Stress Level',
        data: values,
        borderColor: '#D4803A',
        backgroundColor: 'rgba(212,128,58,0.1)',
        fill: true, tension: 0.35, pointBackgroundColor: values.map(v =>
          v > 70 ? '#F8A8A8' : v > 50 ? '#F8D880' : '#8DEBB8'
        ), pointRadius: 5,
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color:'#9A8A78' }, grid: { color:'rgba(255,200,150,0.06)' } },
        y: { min: 0, max: 100, ticks: { color:'#9A8A78' }, grid: { color:'rgba(255,200,150,0.06)' } },
      },
      plugins: { legend: { labels: { color:'#EDE0D0' } } },
    }
  });
}

window.deleteReading = async function(id) {
  if (!confirm('Delete this reading?')) return;
  try {
    await apiFetch(`/api/stress/${id}`, { method:'DELETE' });
    readings = readings.filter(r => r.id !== id);
    renderList(); renderChart(); toast('Deleted.', 'info');
  } catch (err) { toast(err.message, 'error'); }
};

function stressStatus(level) {
  if (level <= 50) return { label:'😌 Good', color:'success', hex:'#8DEBB8' };
  if (level <= 70) return { label:'😐 OK',   color:'warning', hex:'#F8D880' };
  return                  { label:'😰 High', color:'danger',  hex:'#F8A8A8' };
}
