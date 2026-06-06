// public/js/meals.js
import { guardAuth, initNav, apiFetch, toast } from '/js/api.js';

const user = await guardAuth();
initNav('/meals.html');

// ── State ────────────────────────────────────────────────────────────────
let todaysMeals  = [];
let dailyGoal    = 2000;
let selectedFood = null;
let editingId    = null;
let isManualMode = false;

const TODAY      = new Date().toISOString().split('T')[0];
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const PORTIONS   = [50, 100, 150, 200, 250];

// ── DOM ───────────────────────────────────────────────────────────────────
const foodInput      = document.getElementById('food-input');
const amountInput    = document.getElementById('amount-input');
const portionBtns    = document.getElementById('portion-btns');
const calPreview     = document.getElementById('cal-preview');
const nutriPanel     = document.getElementById('nutri-panel');
const manualName     = document.getElementById('manual-food-name');
const manualCal      = document.getElementById('manual-calories');
const manualPreview  = document.getElementById('manual-cal-preview');
const logBtn         = document.getElementById('btn-log-meal');
const dropdown       = document.getElementById('autocomplete-dropdown');
const mealsContainer = document.getElementById('meals-container');
const totalCalEl     = document.getElementById('total-cal');
const goalEl         = document.getElementById('goal-display');
const progressBar    = document.getElementById('progress-bar');
const progressPct    = document.getElementById('progress-pct');
const progressStatus = document.getElementById('progress-status');
const goalInput      = document.getElementById('goal-input');
const btnSetGoal     = document.getElementById('btn-set-goal');
const skippedEl      = document.getElementById('skipped-meals');

await loadMeals();

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

  // Reset both panels
  resetSearchForm();
  manualName.value = '';
  manualCal.value  = '';
  manualPreview.textContent = '🔥 — kcal';
  manualPreview.classList.remove('has-value');
  logBtn.disabled = true;
}

// Manual mode: live preview as user types calories
manualCal.addEventListener('input', () => {
  const cal = parseInt(manualCal.value);
  if (cal > 0) {
    manualPreview.textContent = `🔥 ${cal.toLocaleString()} kcal`;
    manualPreview.classList.add('has-value');
    logBtn.disabled = !manualName.value.trim();
  } else {
    manualPreview.textContent = '🔥 — kcal';
    manualPreview.classList.remove('has-value');
    logBtn.disabled = true;
  }
});
manualName.addEventListener('input', () => {
  const cal = parseInt(manualCal.value);
  logBtn.disabled = !(manualName.value.trim() && cal > 0);
});

// ══════════════════════════════════════════════════════════════════════════
//  LOAD MEALS
// ══════════════════════════════════════════════════════════════════════════
async function loadMeals() {
  try {
    const data  = await apiFetch(`/api/meals?date=${TODAY}`);
    todaysMeals = data.meals  || [];
    dailyGoal   = data.dailyGoal || 2000;
    goalInput.value = dailyGoal;
    renderMeals();
    updateSummary();
  } catch (err) { toast(err.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════
//  AUTOCOMPLETE (search mode only)
// ══════════════════════════════════════════════════════════════════════════
let timer = null, activeIdx = -1;

foodInput.addEventListener('input', () => {
  clearTimeout(timer);
  selectedFood = null;
  hideNutriPanel();
  portionBtns.style.display = 'none';
  updateCalPreview();
  const q = foodInput.value.trim();
  if (q.length < 2) { closeDropdown(); return; }
  timer = setTimeout(() => fetchSuggestions(q), 200);
});

foodInput.addEventListener('keydown', e => {
  const items = dropdown.querySelectorAll('.ac-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx+1, items.length-1); highlight(items); }
  else if (e.key === 'ArrowUp')  { e.preventDefault(); activeIdx = Math.max(activeIdx-1, 0); highlight(items); }
  else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); items[activeIdx].click(); }
  else if (e.key === 'Escape') closeDropdown();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.autocomplete-wrap')) closeDropdown();
});

async function fetchSuggestions(q) {
  try {
    const results = await apiFetch(`/api/meals/food/search?q=${encodeURIComponent(q)}`);
    renderDropdown(results);
  } catch { closeDropdown(); }
}

function renderDropdown(results) {
  activeIdx = -1;
  if (!results.length) { closeDropdown(); return; }
  dropdown.innerHTML = results.map(r => `
    <div class="ac-item" data-json='${JSON.stringify(r).replace(/'/g,"&#39;")}'>
      <div>
        <div class="ac-name">${esc(cap(r.name))}</div>
        <div class="ac-macros">P ${r.protein}g · C ${r.carbs}g · F ${r.fat}g per 100g</div>
      </div>
      <span class="ac-cal">${r.caloriesPer100g} kcal/100g</span>
    </div>`
  ).join('');
  dropdown.style.display = 'block';
  dropdown.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedFood = JSON.parse(item.dataset.json);
      foodInput.value = cap(selectedFood.name);
      closeDropdown();
      showNutriPanel(selectedFood);
      showPortionBtns();
      amountInput.focus();
      amountInput.value = '';
      updateCalPreview();
    });
  });
}

function highlight(items) {
  items.forEach((el,i) => { el.classList.toggle('active', i===activeIdx); if (i===activeIdx) el.scrollIntoView({block:'nearest'}); });
}
function closeDropdown() { dropdown.style.display='none'; dropdown.innerHTML=''; activeIdx=-1; }

// ── Portion shortcuts ──
function showPortionBtns() {
  portionBtns.style.display = 'flex';
  portionBtns.innerHTML = PORTIONS.map(g =>
    `<button class="btn-portion" data-g="${g}">${g}g</button>`
  ).join('');
  portionBtns.querySelectorAll('.btn-portion').forEach(btn => {
    btn.addEventListener('click', () => {
      amountInput.value = btn.dataset.g;
      portionBtns.querySelectorAll('.btn-portion').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateCalPreview();
    });
  });
}

// ── Nutrition panel ──
function showNutriPanel(food) {
  nutriPanel.style.display = 'block';
  nutriPanel.innerHTML = `
    <div class="nutri-grid">
      <div class="nutri-item"><span class="nutri-label">Protein</span><span class="nutri-val">${food.protein}g</span></div>
      <div class="nutri-item"><span class="nutri-label">Carbs</span><span class="nutri-val">${food.carbs}g</span></div>
      <div class="nutri-item"><span class="nutri-label">Fat</span><span class="nutri-val">${food.fat}g</span></div>
      <div class="nutri-item"><span class="nutri-label">Fiber</span><span class="nutri-val">${food.fiber}g</span></div>
      <div class="nutri-item"><span class="nutri-label">Sodium</span><span class="nutri-val">${food.sodium}mg</span></div>
    </div>
    <div style="font-size:0.72rem;color:rgba(200,170,130,0.60);margin-top:4px">Per 100g · Nutrition density: ${food.nutritionDensity}</div>`;
}
function hideNutriPanel() { nutriPanel.style.display='none'; nutriPanel.innerHTML=''; }

// ── Live calorie preview (search mode) ──
amountInput.addEventListener('input', updateCalPreview);
function updateCalPreview() {
  const g = parseFloat(amountInput.value);
  if (selectedFood && g > 0) {
    const cal = Math.round((selectedFood.caloriesPer100g / 100) * g);
    calPreview.textContent = `🔥 ${cal} kcal`;
    calPreview.classList.add('has-value');
    logBtn.disabled = false;
  } else {
    calPreview.textContent = '🔥 — kcal';
    calPreview.classList.remove('has-value');
    logBtn.disabled = true;
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  LOG MEAL
// ══════════════════════════════════════════════════════════════════════════
logBtn.addEventListener('click', async () => {
  const mealTypeEl = document.querySelector('input[name="meal-type"]:checked');
  if (!mealTypeEl) { toast('Select a meal type.', 'error'); return; }

  let payload;

  if (isManualMode) {
    // ── Manual entry ──
    const name = manualName.value.trim();
    const cal  = parseInt(manualCal.value);
    if (!name) { toast('Enter a food name.', 'error'); return; }
    if (!cal || cal <= 0) { toast('Enter the calories.', 'error'); return; }
    payload = {
      mealType:  mealTypeEl.value,
      foodName:  name,
      amountG:   null,
      caloriesPer100g: null,
      calories:  cal,
      isManual:  true,
      date:      TODAY,
    };
  } else {
    // ── Search / auto-calc entry ──
    if (!selectedFood) { toast('Select a food from the list first.', 'error'); return; }
    const g = parseFloat(amountInput.value);
    if (!g || g <= 0) { toast('Enter amount in grams.', 'error'); return; }
    const cal = Math.round((selectedFood.caloriesPer100g / 100) * g);
    payload = {
      mealType:        mealTypeEl.value,
      foodName:        cap(selectedFood.name),
      amountG:         g,
      caloriesPer100g: selectedFood.caloriesPer100g,
      calories:        cal,
      isManual:        false,
      date:            TODAY,
      fat:      selectedFood.fat,
      carbs:    selectedFood.carbs,
      protein:  selectedFood.protein,
      fiber:    selectedFood.fiber,
      sugars:   selectedFood.sugars,
      sodium:   selectedFood.sodium,
      vitaminC: selectedFood.vitaminC,
      calcium:  selectedFood.calcium,
      iron:     selectedFood.iron,
      potassium:        selectedFood.potassium,
      nutritionDensity: selectedFood.nutritionDensity,
    };
  }

  logBtn.disabled  = true;
  logBtn.innerHTML = '<span class="spinner"></span> Logging…';

  try {
    if (editingId) {
      const updated = await apiFetch(`/api/meals/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ amountG: payload.amountG, caloriesPer100g: payload.caloriesPer100g, calories: payload.calories }),
      });
      todaysMeals = todaysMeals.map(m => m.id === editingId ? { ...m, ...updated } : m);
      toast('Meal updated.', 'success');
      cancelEdit();
    } else {
      const meal = await apiFetch('/api/meals', { method:'POST', body: JSON.stringify(payload) });
      todaysMeals.push(meal);
      toast('Meal logged!', 'success');
    }
  } catch (err) { toast(err.message, 'error'); }

  resetForm();
  renderMeals();
  updateSummary();
  logBtn.disabled  = false;
  logBtn.innerHTML = '<i class="fa fa-plus"></i> Log Meal';
});

// ══════════════════════════════════════════════════════════════════════════
//  RENDER MEALS
// ══════════════════════════════════════════════════════════════════════════
function renderMeals() {
  if (!todaysMeals.length) {
    mealsContainer.innerHTML = `<div class="empty-state"><i class="fa fa-bowl-food" style="font-size:2rem;margin-bottom:0.8rem"></i><p>No meals logged yet today.</p></div>`;
    return;
  }
  const grouped = {};
  MEAL_TYPES.forEach(t => { grouped[t] = []; });
  todaysMeals.forEach(m => { if (grouped[m.mealType]) grouped[m.mealType].push(m); });

  mealsContainer.innerHTML = MEAL_TYPES
    .filter(t => grouped[t].length > 0)
    .map(type => {
      const items     = grouped[type];
      const typeTotal = items.reduce((s,m) => s+m.calories, 0);
      return `
        <div class="meal-group">
          <div class="meal-group-header">
            <span class="meal-group-name">${type}</span>
            <span class="meal-group-total">${typeTotal} kcal</span>
          </div>
          <table>
            <thead><tr><th>Food</th><th>Amount</th><th>Macros</th><th>Calories</th><th></th></tr></thead>
            <tbody>
              ${items.map(m => `
                <tr>
                  <td style="font-weight:500">
                    ${esc(m.foodName)}
                    ${m.isManual ? '<span class="manual-tag">manual</span>' : ''}
                  </td>
                  <td style="color:rgba(200,170,130,0.80)">${m.amountG ? m.amountG+'g' : '—'}</td>
                  <td style="font-size:0.75rem;color:rgba(200,170,130,0.70)">
                    ${m.protein != null ? `P ${m.protein}g C ${m.carbs}g F ${m.fat}g` : '—'}
                  </td>
                  <td><span class="cal-badge">${m.calories} kcal</span></td>
                  <td>
                    <div style="display:flex;gap:6px">
                      <button class="btn-icon" onclick="startEdit('${m.id}')"><i class="fa fa-pen"></i></button>
                      <button class="btn-icon danger" onclick="deleteMeal('${m.id}')"><i class="fa fa-trash"></i></button>
                    </div>
                  </td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════════════════════════
//  EDIT / DELETE
// ══════════════════════════════════════════════════════════════════════════
window.startEdit = function(id) {
  const meal = todaysMeals.find(m => m.id === id);
  if (!meal) return;
  editingId = id;

  if (meal.isManual) {
    setMode(true);
    manualName.value = meal.foodName;
    manualCal.value  = meal.calories;
    manualPreview.textContent = `🔥 ${meal.calories} kcal`;
    manualPreview.classList.add('has-value');
  } else {
    setMode(false);
    selectedFood  = { name: meal.foodName, caloriesPer100g: meal.caloriesPer100g };
    foodInput.value   = meal.foodName;
    amountInput.value = meal.amountG;
    updateCalPreview();
  }

  const typeInput = document.querySelector(`input[name="meal-type"][value="${meal.mealType}"]`);
  if (typeInput) typeInput.checked = true;

  logBtn.disabled  = false;
  logBtn.innerHTML = '<i class="fa fa-check"></i> Save Changes';
  document.getElementById('cancel-meal').style.display = 'inline-flex';
  document.getElementById('form-title').textContent = 'Edit Meal';
  document.getElementById('log-section').scrollIntoView({ behavior:'smooth' });
};

window.deleteMeal = async function(id) {
  if (!confirm('Remove this meal entry?')) return;
  try {
    await apiFetch(`/api/meals/${id}`, { method:'DELETE' });
    todaysMeals = todaysMeals.filter(m => m.id !== id);
    renderMeals(); updateSummary(); toast('Meal removed.', 'info');
  } catch (err) { toast(err.message, 'error'); }
};

function cancelEdit() {
  editingId = null;
  document.getElementById('cancel-meal').style.display = 'none';
  document.getElementById('form-title').textContent = 'Log a Meal';
  logBtn.innerHTML = '<i class="fa fa-plus"></i> Log Meal';
  resetForm();
}
document.getElementById('cancel-meal')?.addEventListener('click', cancelEdit);

// ══════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════════
function updateSummary() {
  const total = todaysMeals.reduce((s,m) => s+m.calories, 0);
  const pct   = Math.min(Math.round((total/dailyGoal)*100), 100);
  const over  = total > dailyGoal;
  totalCalEl.textContent  = total.toLocaleString();
  goalEl.textContent      = dailyGoal.toLocaleString();
  progressBar.style.width = pct+'%';
  progressBar.style.background = over ? 'linear-gradient(90deg,#D4803A,#F06060)' : 'linear-gradient(90deg,#D4803A,#F0A060)';
  progressPct.textContent    = pct+'%';
  progressStatus.textContent = over ? `⚠️ ${(total-dailyGoal).toLocaleString()} kcal over goal` : `${(dailyGoal-total).toLocaleString()} kcal remaining`;
  progressStatus.style.color = over ? 'var(--danger)' : 'rgba(200,170,130,0.80)';
  const eaten   = new Set(todaysMeals.map(m => m.mealType));
  const skipped = MEAL_TYPES.filter(t => !eaten.has(t));
  skippedEl.textContent = skipped.length ? `Skipped today: ${skipped.join(', ')}` : '✅ All meal types logged today';
}

// ══════════════════════════════════════════════════════════════════════════
//  GOAL
// ══════════════════════════════════════════════════════════════════════════
btnSetGoal.addEventListener('click', async () => {
  const val = parseInt(goalInput.value);
  if (!val || val < 300) { toast('Enter a valid goal (min 300 kcal).', 'error'); return; }
  btnSetGoal.disabled = true; btnSetGoal.innerHTML = '<span class="spinner"></span>';
  try {
    await apiFetch('/api/meals/goal', { method:'PATCH', body: JSON.stringify({ goal: val }) });
    dailyGoal = val; updateSummary(); toast(`Goal set to ${val.toLocaleString()} kcal.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
  btnSetGoal.disabled = false; btnSetGoal.innerHTML = '<i class="fa fa-check"></i> Set';
});

// ══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════
function resetForm() {
  resetSearchForm();
  manualName.value = ''; manualCal.value = '';
  manualPreview.textContent = '🔥 — kcal'; manualPreview.classList.remove('has-value');
  logBtn.disabled = true;
}
function resetSearchForm() {
  foodInput.value = ''; amountInput.value = ''; selectedFood = null;
  calPreview.textContent = '🔥 — kcal'; calPreview.classList.remove('has-value');
  portionBtns.style.display = 'none'; portionBtns.innerHTML = '';
  hideNutriPanel(); closeDropdown();
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cap(s) { return String(s).replace(/\b\w/g, c => c.toUpperCase()); }
