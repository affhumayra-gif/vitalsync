const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
//  FOOD SEARCH
//
//  Dataset: FOOD-DATA-GROUP1–5.csv merged at startup
//  All values per 100g.
//  Key columns: food | Caloric Value | Fat | Carbohydrates | Protein |
//               Dietary Fiber | Sugars | Sodium | Nutrition Density |
//               Vitamin A/C/D/E/K | Calcium | Iron | Potassium | ...
// ══════════════════════════════════════════════════════════════════════════

// GET /api/meals/food/search?q=chicken
router.get('/food/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json([]);

  const foodData = req.app.locals.foodData || [];
  if (!foodData.length) return res.json([]);

  const startsWith = [];
  const contains   = [];

  for (const row of foodData) {
    const name = (row['food'] || '').toLowerCase().trim();
    if (!name) continue;

    const cal = parseFloat(row['Caloric Value']);
    if (isNaN(cal) || cal < 0) continue;

    const entry = {
      name:             row['food'].trim(),
      caloriesPer100g:  Math.round(cal),
      // Macros
      fat:              parseFloat(row['Fat'])            || 0,
      saturatedFat:     parseFloat(row['Saturated Fats']) || 0,
      carbs:            parseFloat(row['Carbohydrates'])  || 0,
      sugars:           parseFloat(row['Sugars'])         || 0,
      protein:          parseFloat(row['Protein'])        || 0,
      fiber:            parseFloat(row['Dietary Fiber'])  || 0,
      // Micronutrients
      sodium:           parseFloat(row['Sodium'])         || 0,
      cholesterol:      parseFloat(row['Cholesterol'])    || 0,
      vitaminC:         parseFloat(row['Vitamin C'])      || 0,
      vitaminA:         parseFloat(row['Vitamin A'])      || 0,
      vitaminD:         parseFloat(row['Vitamin D'])      || 0,
      calcium:          parseFloat(row['Calcium'])        || 0,
      iron:             parseFloat(row['Iron'])           || 0,
      potassium:        parseFloat(row['Potassium'])      || 0,
      nutritionDensity: parseFloat(row['Nutrition Density']) || 0,
    };

    if (name.startsWith(q))    startsWith.push(entry);
    else if (name.includes(q)) contains.push(entry);

    if (startsWith.length + contains.length >= 60) break;
  }

  res.json([...startsWith, ...contains].slice(0, 8));
});

// ══════════════════════════════════════════════════════════════════════════
//  DAILY CALORIE GOAL
// ══════════════════════════════════════════════════════════════════════════

router.patch('/goal', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const goal = Number(req.body.goal);

  if (!goal || goal < 300 || goal > 15000) {
    return res.status(400).json({ error: 'Goal must be between 300 and 15,000 kcal.' });
  }
  try {
    await db.collection('users').doc(uid).set({ dailyCalorieGoal: goal }, { merge: true });
    res.json({ dailyCalorieGoal: goal });
  } catch (err) {
    console.error('[PATCH /meals/goal]', err);
    res.status(500).json({ error: 'Failed to update goal.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  MEALS CRUD
// ══════════════════════════════════════════════════════════════════════════

// GET /api/meals?date=YYYY-MM-DD
router.get('/', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const date = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const snap = await db
      .collection('users').doc(uid)
      .collection('meals')
      .where('date', '==', date)
      .get();

    const meals = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

    const userDoc   = await db.collection('users').doc(uid).get();
    const dailyGoal = userDoc.exists ? (userDoc.data().dailyCalorieGoal || 2000) : 2000;

    res.json({ meals, dailyGoal, date });
  } catch (err) {
    console.error('[GET /meals]', err);
    res.status(500).json({ error: 'Failed to load meals.' });
  }
});

// POST /api/meals
// Calories are calculated client-side as (caloriesPer100g / 100) * amountG
router.post('/', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const {
    mealType, foodName, amountG, caloriesPer100g, calories,
    date, fat, carbs, protein, fiber, sugars,
    sodium, vitaminC, calcium, iron, potassium, nutritionDensity
  } = req.body;

  if (!mealType || !foodName || calories == null) {
    return res.status(400).json({ error: 'mealType, foodName and calories are required.' });
  }

  const VALID = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  if (!VALID.includes(mealType)) {
    return res.status(400).json({ error: 'mealType must be Breakfast, Lunch, Dinner, or Snack.' });
  }

  // Scale all nutrients to the logged amount
  const scale = Number(amountG) / 100;

  try {
    const entry = {
      mealType,
      foodName:        String(foodName).trim(),
      amountG:         Math.round(Number(amountG)),
      caloriesPer100g: caloriesPer100g ? Math.round(Number(caloriesPer100g)) : null,
      calories:        Math.round(Number(calories)),
      // Macros (scaled to logged amount)
      fat:      fat      != null ? Number((fat      * scale).toFixed(1)) : null,
      carbs:    carbs    != null ? Number((carbs    * scale).toFixed(1)) : null,
      protein:  protein  != null ? Number((protein  * scale).toFixed(1)) : null,
      fiber:    fiber    != null ? Number((fiber    * scale).toFixed(1)) : null,
      sugars:   sugars   != null ? Number((sugars   * scale).toFixed(1)) : null,
      // Micros (scaled)
      sodium:           sodium           != null ? Number((sodium           * scale).toFixed(2)) : null,
      vitaminC:         vitaminC         != null ? Number((vitaminC         * scale).toFixed(2)) : null,
      calcium:          calcium          != null ? Number((calcium          * scale).toFixed(1)) : null,
      iron:             iron             != null ? Number((iron             * scale).toFixed(2)) : null,
      potassium:        potassium        != null ? Number((potassium        * scale).toFixed(1)) : null,
      nutritionDensity: nutritionDensity != null ? Number(nutritionDensity)                       : null,
      date:     date || new Date().toISOString().split('T')[0],
      loggedAt: new Date().toISOString(),
    };

    const ref = await db.collection('users').doc(uid).collection('meals').add(entry);
    res.status(201).json({ id: ref.id, ...entry });
  } catch (err) {
    console.error('[POST /meals]', err);
    res.status(500).json({ error: 'Failed to log meal.' });
  }
});

// PATCH /api/meals/:id — update amount in grams
router.patch('/:id', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { amountG, caloriesPer100g, calories } = req.body;

  if (!amountG || calories == null) {
    return res.status(400).json({ error: 'amountG and calories are required.' });
  }
  try {
    await db.collection('users').doc(uid).collection('meals').doc(req.params.id).update({
      amountG:         Math.round(Number(amountG)),
      caloriesPer100g: caloriesPer100g ? Math.round(Number(caloriesPer100g)) : null,
      calories:        Math.round(Number(calories)),
      updatedAt:       new Date().toISOString(),
    });
    res.json({ id: req.params.id });
  } catch (err) {
    console.error('[PATCH /meals/:id]', err);
    res.status(500).json({ error: 'Failed to update meal.' });
  }
});

// DELETE /api/meals/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    await db.collection('users').doc(uid).collection('meals').doc(req.params.id).delete();
    res.json({ message: 'Meal deleted.' });
  } catch (err) {
    console.error('[DELETE /meals/:id]', err);
    res.status(500).json({ error: 'Failed to delete meal.' });
  }
});

module.exports = router;
