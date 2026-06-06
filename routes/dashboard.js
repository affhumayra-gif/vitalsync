const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
//  HEALTH TIP ENGINE
//  Returns a personalised single-sentence tip based on the day's numbers.
// ══════════════════════════════════════════════════════════════════════════
function getHealthTip({ deficit, bmr, exerciseBurn, caloriesEaten, sleep, stress }) {
  // Priority order: most urgent condition first
  if (sleep !== null && sleep < 5)
    return { tip: 'You slept under 5 hours. Prioritise rest tonight — poor sleep raises cortisol and increases cravings.', type: 'warning' };

  if (stress !== null && stress > 70)
    return { tip: 'Your stress is high. Try a 5-minute breathing exercise or a short walk before your next meal.', type: 'warning' };

  if (caloriesEaten === 0)
    return { tip: 'No meals logged yet today. Log your first meal to track your calorie balance.', type: 'info' };

  if (deficit > 600)
    return { tip: `Strong deficit of ${deficit} kcal. Make sure you're eating enough protein to preserve muscle.`, type: 'success' };

  if (deficit >= 200 && deficit <= 600)
    return { tip: `Solid deficit of ${deficit} kcal. You're on track for gradual, sustainable fat loss.`, type: 'success' };

  if (deficit >= 0 && deficit < 200)
    return { tip: `Nearly balanced at ${deficit} kcal deficit. A 15-minute walk would push you into a healthy deficit.`, type: 'info' };

  if (deficit < 0 && deficit > -300)
    return { tip: `Slight surplus of ${Math.abs(deficit)} kcal. Swap one snack for fruit or vegetables tomorrow.`, type: 'warning' };

  if (deficit <= -300)
    return { tip: `Surplus of ${Math.abs(deficit)} kcal today. Consider a lighter dinner and 30 minutes of activity.`, type: 'danger' };

  return { tip: 'Keep logging your meals and exercise to see your calorie balance here.', type: 'info' };
}

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/dashboard/summary
// ══════════════════════════════════════════════════════════════════════════
router.get('/summary', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const date = new Date().toISOString().split('T')[0];

  try {
    // Run all Firestore reads in parallel for speed
    const [metricsSnap, exerciseSnap, stepsDoc, mealsSnap, sleepSnap, stressSnap] =
      await Promise.all([
        // Latest body metrics (BMR + weight)
        db.collection('users').doc(uid)
          .collection('bodyMetrics')
          .orderBy('recordedAt', 'desc').limit(1).get(),

        // Today's exercise sessions
        db.collection('users').doc(uid)
          .collection('exercise')
          .where('date', '==', date).get(),

        // Today's steps
        db.collection('users').doc(uid)
          .collection('steps').doc(date).get(),

        // Today's meals
        db.collection('users').doc(uid)
          .collection('meals')
          .where('date', '==', date).get(),

        // Latest 3 sleep sessions (Sprint 4 fills these in — graceful if empty)
        db.collection('users').doc(uid)
          .collection('sleep')
          .orderBy('endTime', 'desc').limit(3).get()
          .catch(() => ({ empty: true, docs: [] })),

        // Latest stress reading
        db.collection('users').doc(uid)
          .collection('stress')
          .orderBy('recordedAt', 'desc').limit(1).get()
          .catch(() => ({ empty: true, docs: [] })),
      ]);

    // ── BMR + weight ───────────────────────────────────────────────────
    let bmr = 0, weightKg = null;
    if (!metricsSnap.empty) {
      const m  = metricsSnap.docs[0].data();
      bmr      = m.bmr      || 0;
      weightKg = m.weightKg || null;
    }

    // ── Exercise burn ──────────────────────────────────────────────────
    const exerciseBurn = exerciseSnap.docs.reduce(
      (s, d) => s + (d.data().caloriesBurned || 0), 0
    );

    // ── Steps burn ─────────────────────────────────────────────────────
    const stepCount  = stepsDoc.exists ? (stepsDoc.data().stepCount  || 0) : 0;
    const stepsBurn  = stepsDoc.exists ? (stepsDoc.data().caloriesFromSteps || 0) : 0;

    // ── Total burn ─────────────────────────────────────────────────────
    const totalBurn = Math.round(bmr + exerciseBurn + stepsBurn);

    // ── Calories eaten ─────────────────────────────────────────────────
    const caloriesEaten = mealsSnap.docs.reduce(
      (s, d) => s + (d.data().calories || 0), 0
    );

    // ── Deficit (+) / Surplus (-) ──────────────────────────────────────
    const deficit = Math.round(totalBurn - caloriesEaten);

    // ── Sleep (avg of last 3 sessions) ────────────────────────────────
    let sleep = null;
    if (!sleepSnap.empty && sleepSnap.docs.length > 0) {
      const hrs = sleepSnap.docs.map(d => {
        const s    = d.data();
        const diff = new Date(s.endTime) - new Date(s.startTime);
        return diff / (1000 * 60 * 60);
      }).filter(h => h > 0 && h < 24);
      if (hrs.length) sleep = Number((hrs.reduce((a, b) => a + b, 0) / hrs.length).toFixed(1));
    }

    // ── Stress (latest reading) ────────────────────────────────────────
    let stress = null;
    if (!stressSnap.empty && stressSnap.docs.length > 0) {
      stress = stressSnap.docs[0].data().level || null;
    }

    // ── Health tip ─────────────────────────────────────────────────────
    const healthTip = getHealthTip({ deficit, bmr, exerciseBurn, caloriesEaten, sleep, stress });

    res.json({
      date,
      // Circles
      sleep,
      stress,
      steps:        stepCount,
      deficit,
      // Breakdown (for tooltip / detail view)
      bmr:          Math.round(bmr),
      exerciseBurn: Math.round(exerciseBurn),
      stepsBurn,
      totalBurn,
      caloriesEaten,
      weightKg,
      // Health insight
      healthTip,
    });

  } catch (err) {
    console.error('[GET /dashboard/summary]', err);
    res.status(500).json({ error: 'Failed to load dashboard summary.' });
  }
});

module.exports = router;
