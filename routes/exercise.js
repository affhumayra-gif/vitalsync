const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
//  EXERCISE SEARCH
//  CSV column: "Activity, Exercise or Sport (1 hour)" | "Calories per kg"
//  Burn formula: calories_per_kg × user_weight_kg × (duration_minutes / 60)
// ══════════════════════════════════════════════════════════════════════════

const EXERCISE_COL = 'Activity, Exercise or Sport (1 hour)';
const CAL_PER_KG   = 'Calories per kg';

// GET /api/exercise/search?q=cycling
router.get('/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json([]);

  const data = req.app.locals.exerciseData || [];
  if (!data.length) return res.json([]);

  const startsWith = [];
  const contains   = [];

  for (const row of data) {
    const name = (row[EXERCISE_COL] || '').toLowerCase().trim();
    if (!name) continue;

    const calPerKg = parseFloat(row[CAL_PER_KG]);
    if (isNaN(calPerKg) || calPerKg <= 0) continue;

    const entry = {
      name:       row[EXERCISE_COL].trim(),
      calPerKg:   Number(calPerKg.toFixed(4)),
      // Convenience: cal/hr at common weights
      cal130lb:   parseInt(row['130 lb']) || null,
      cal155lb:   parseInt(row['155 lb']) || null,
      cal180lb:   parseInt(row['180 lb']) || null,
    };

    if (name.startsWith(q))    startsWith.push(entry);
    else if (name.includes(q)) contains.push(entry);
    if (startsWith.length + contains.length >= 60) break;
  }

  res.json([...startsWith, ...contains].slice(0, 8));
});

// ══════════════════════════════════════════════════════════════════════════
//  EXERCISE SESSIONS CRUD
// ══════════════════════════════════════════════════════════════════════════

// GET /api/exercise?date=YYYY-MM-DD
router.get('/', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const date = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const snap = await db
      .collection('users').doc(uid)
      .collection('exercise')
      .where('date', '==', date)
      .get();

    const sessions = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

    // Also return user's weight so client can show what weight was used
    const userDoc    = await db.collection('users').doc(uid).get();
    const metricsSnap = await db
      .collection('users').doc(uid)
      .collection('bodyMetrics')
      .orderBy('recordedAt', 'desc')
      .limit(1)
      .get();

    const weightKg = metricsSnap.empty ? null : metricsSnap.docs[0].data().weightKg;

    res.json({ sessions, weightKg, date });
  } catch (err) {
    console.error('[GET /exercise]', err);
    res.status(500).json({ error: 'Failed to load exercise sessions.' });
  }
});

// POST /api/exercise
// Body: { exerciseName, durationMinutes, calPerKg, userWeightKg, caloriesBurned, date }
router.post('/', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { exerciseName, durationMinutes, calPerKg, userWeightKg, caloriesBurned, date } = req.body;

  if (!exerciseName || !caloriesBurned) {
    return res.status(400).json({ error: 'exerciseName and caloriesBurned are required.' });
  }

  try {
    const entry = {
      exerciseName:   String(exerciseName).trim(),
      durationMinutes: Math.round(Number(durationMinutes)),
      calPerKg:       calPerKg       ? Number(Number(calPerKg).toFixed(4))   : null,
      userWeightKg:   userWeightKg   ? Number(Number(userWeightKg).toFixed(1)) : null,
      caloriesBurned: Math.round(Number(caloriesBurned)),
      date:           date || new Date().toISOString().split('T')[0],
      loggedAt:       new Date().toISOString(),
    };

    const ref = await db
      .collection('users').doc(uid)
      .collection('exercise')
      .add(entry);

    res.status(201).json({ id: ref.id, ...entry });
  } catch (err) {
    console.error('[POST /exercise]', err);
    res.status(500).json({ error: 'Failed to log exercise session.' });
  }
});

// PATCH /api/exercise/:id — update duration, recalculate burn
router.patch('/:id', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { durationMinutes, caloriesBurned } = req.body;

  if (!durationMinutes || caloriesBurned == null) {
    return res.status(400).json({ error: 'durationMinutes and caloriesBurned are required.' });
  }
  try {
    await db
      .collection('users').doc(uid)
      .collection('exercise').doc(req.params.id)
      .update({
        durationMinutes: Math.round(Number(durationMinutes)),
        caloriesBurned:  Math.round(Number(caloriesBurned)),
        updatedAt:       new Date().toISOString(),
      });
    res.json({ id: req.params.id });
  } catch (err) {
    console.error('[PATCH /exercise/:id]', err);
    res.status(500).json({ error: 'Failed to update session.' });
  }
});

// DELETE /api/exercise/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    await db
      .collection('users').doc(uid)
      .collection('exercise').doc(req.params.id)
      .delete();
    res.json({ message: 'Session deleted.' });
  } catch (err) {
    console.error('[DELETE /exercise/:id]', err);
    res.status(500).json({ error: 'Failed to delete session.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  STEP COUNT  (one document per day, upserted)
//  Calorie estimate: steps × 0.04 kcal  (≈ 10,000 steps = 400 kcal)
// ══════════════════════════════════════════════════════════════════════════

// GET /api/exercise/steps?date=YYYY-MM-DD
router.get('/steps', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const doc = await db
      .collection('users').doc(uid)
      .collection('steps').doc(date)
      .get();

    if (!doc.exists) return res.json({ stepCount: 0, caloriesFromSteps: 0, date });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('[GET /exercise/steps]', err);
    res.status(500).json({ error: 'Failed to load steps.' });
  }
});

// POST /api/exercise/steps — upsert today's steps
router.post('/steps', requireAuth, async (req, res) => {
  const uid       = req.user.uid;
  const stepCount = parseInt(req.body.stepCount);
  const date      = req.body.date || new Date().toISOString().split('T')[0];

  if (!stepCount || stepCount < 0) {
    return res.status(400).json({ error: 'A valid stepCount is required.' });
  }

  const caloriesFromSteps = Math.round(stepCount * 0.04);

  try {
    // Use date as document ID so there's always exactly one entry per day
    await db
      .collection('users').doc(uid)
      .collection('steps').doc(date)
      .set({ stepCount, caloriesFromSteps, date, updatedAt: new Date().toISOString() });

    res.json({ stepCount, caloriesFromSteps, date });
  } catch (err) {
    console.error('[POST /exercise/steps]', err);
    res.status(500).json({ error: 'Failed to save steps.' });
  }
});

module.exports = router;
