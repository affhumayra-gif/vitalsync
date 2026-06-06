import { guardAuth, initNav, apiFetch, toast } from '/js/api.js';
const user = await guardAuth();
initNav('/weekly.html');

const CHART_OPTS = (color) => ({
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color:'#9A8A78', font:{size:11} }, grid: { color:'rgba(255,200,150,0.05)' } },
    y: { ticks: { color:'#9A8A78', font:{size:11} }, grid: { color:'rgba(255,200,150,0.05)' }, beginAtZero: true },
  },
});

try {
  const d = await apiFetch('/api/weekly');

  // Date range label
  const fmt = iso => new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  document.getElementById('date-label').innerHTML =
    `<strong>${fmt(d.startDate)}</strong> — <strong>${fmt(d.endDate)}</strong>`;

  // ── Metric cards ────────────────────────────────────────────────────
  const grid = document.getElementById('week-grid');
  grid.innerHTML = `
    <div class="week-card wc-sleep">
      <span class="wc-icon">🌙</span>
      <div class="wc-title">Sleep</div>
      <div class="wc-main">${d.sleep.avg} <span style="font-size:1rem;color:var(--text-secondary)">hrs avg</span></div>
      <div class="wc-sub">Total: ${d.sleep.total} hrs over 7 days</div>
      <div class="wc-detail">
        ✅ ${d.sleep.daysOver8} nights ≥ 8 hrs &nbsp;·&nbsp;
        ⚠️ ${d.sleep.daysUnder7} nights under 7 hrs
      </div>
    </div>

    <div class="week-card wc-stress">
      <span class="wc-icon">🧠</span>
      <div class="wc-title">Stress</div>
      <div class="wc-main">${d.stress.avg} <span style="font-size:1rem;color:var(--text-secondary)">avg</span></div>
      <div class="wc-sub">Peak: ${d.stress.peak} / 100</div>
      <div class="wc-detail">
        ${d.stress.avg <= 50 ? '😌 Well managed this week' : d.stress.avg <= 70 ? '😐 Moderate stress levels' : '😰 High stress — consider rest'}
      </div>
    </div>

    <div class="week-card wc-exercise">
      <span class="wc-icon">🏋️</span>
      <div class="wc-title">Exercise</div>
      <div class="wc-main">${d.exercise.days} <span style="font-size:1rem;color:var(--text-secondary)">days active</span></div>
      <div class="wc-sub">${d.exercise.totalCal.toLocaleString()} kcal burned · ${d.exercise.totalMin} min total</div>
      <div class="wc-detail">
        ${d.exercise.days >= 5 ? '🔥 Excellent week!' : d.exercise.days >= 3 ? '💪 Good effort' : '🛌 Try for 3+ days next week'}
      </div>
    </div>

    <div class="week-card wc-meals">
      <span class="wc-icon">🍽️</span>
      <div class="wc-title">Nutrition</div>
      <div class="wc-main">${d.meals.avgPerDay.toLocaleString()} <span style="font-size:1rem;color:var(--text-secondary)">kcal/day</span></div>
      <div class="wc-sub">Total eaten: ${d.meals.totalEaten.toLocaleString()} kcal</div>
      <div class="wc-detail">
        ${d.meals.avgPerDay < 1200 ? '⚠️ Eating too little' : d.meals.avgPerDay <= 2200 ? '✅ Good calorie range' : '⚠️ Consider reducing intake'}
      </div>
    </div>

    <div class="week-card wc-steps">
      <span class="wc-icon">🚶</span>
      <div class="wc-title">Steps</div>
      <div class="wc-main">${d.steps.avg.toLocaleString()} <span style="font-size:1rem;color:var(--text-secondary)">/day avg</span></div>
      <div class="wc-sub">Total: ${d.steps.total.toLocaleString()} steps</div>
      <div class="wc-detail">
        ${d.steps.avg >= 10000 ? '🏆 Hit 10k goal daily!' : d.steps.avg >= 7000 ? '👟 Good activity level' : '👟 Aim for 7,000+ steps/day'}
      </div>
    </div>

    <div class="week-card wc-goals">
      <span class="wc-icon">🎯</span>
      <div class="wc-title">Goal Completion</div>
      <div class="wc-main">${d.goals.completionRate}<span style="font-size:1rem;color:var(--text-secondary)">%</span></div>
      <div class="wc-sub">${d.goals.active} active goals tracked</div>
      <div class="wc-detail">
        ${d.goals.completionRate >= 80 ? '🏅 Outstanding consistency!' : d.goals.completionRate >= 50 ? '📈 Solid progress' : '💡 Keep logging daily to build streaks'}
      </div>
    </div>
  `;

  // ── Short day labels ─────────────────────────────────────────────────
  const dayLabels = d.dates.map(iso =>
    new Date(iso).toLocaleDateString('en-GB', { weekday:'short', day:'numeric' })
  );

  const baseDataset = (data, color, fill) => ({
    data,
    borderColor:     color,
    backgroundColor: fill,
    borderWidth: 2,
    fill: true,
    tension: 0.35,
    pointBackgroundColor: color,
    pointRadius: 4,
  });

  // Sleep chart
  new Chart(document.getElementById('chart-sleep').getContext('2d'), {
    type: 'bar',
    data: { labels: dayLabels, datasets: [{ ...baseDataset(d.sleep.series, '#52C990', 'rgba(82,201,148,0.2)'), borderRadius: 6 }] },
    options: { ...CHART_OPTS('#52C990'), plugins: { legend:{display:false} } },
  });

  // Stress chart
  new Chart(document.getElementById('chart-stress').getContext('2d'), {
    type: 'line',
    data: { labels: dayLabels, datasets: [baseDataset(d.stress.series, '#D4803A', 'rgba(212,128,58,0.12)')] },
    options: { ...CHART_OPTS('#D4803A'), scales: { ...CHART_OPTS().scales, y: { min:0, max:100, ticks:{color:'#9A8A78'}, grid:{color:'rgba(255,200,150,0.05)'} } } },
  });

  // Burn chart
  new Chart(document.getElementById('chart-burn').getContext('2d'), {
    type: 'bar',
    data: { labels: dayLabels, datasets: [{ ...baseDataset(d.exercise.series, '#F0A060', 'rgba(240,160,96,0.2)'), borderRadius: 6 }] },
    options: { ...CHART_OPTS('#F0A060') },
  });

  // Eaten chart
  new Chart(document.getElementById('chart-eat').getContext('2d'), {
    type: 'line',
    data: { labels: dayLabels, datasets: [baseDataset(d.meals.series, '#5A9EE0', 'rgba(90,158,224,0.12)')] },
    options: { ...CHART_OPTS('#5A9EE0') },
  });

} catch (err) {
  toast(err.message, 'error');
  document.getElementById('date-label').textContent = 'Could not load weekly data.';
}
