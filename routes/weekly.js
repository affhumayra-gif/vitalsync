const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// GET /api/weekly
router.get('/', requireAuth, async (req, res) => {
  const uid = req.user.uid;

  // Last 7 days (inclusive of today)
  const today  = new Date();
  const dates  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d.toISOString().split('T')[0];
  }).reverse(); // oldest first

  const startDate = dates[0];
  const endDate   = dates[6];

  try {
    // All queries in parallel
    const [sleepSnap, stressSnap, exerciseSnap, mealsSnap,
           stepsSnaps, goalsSnap, completionSnaps] = await Promise.all([

      // Sleep sessions in range
      db.collection('users').doc(uid).collection('sleep')
        .where('date', '>=', startDate).where('date', '<=', endDate).get(),

      // Stress readings in range
      db.collection('users').doc(uid).collection('stress')
        .where('date', '>=', startDate).where('date', '<=', endDate).get(),

      // Exercise sessions in range
      db.collection('users').doc(uid).collection('exercise')
        .where('date', '>=', startDate).where('date', '<=', endDate).get(),

      // Meals in range
      db.collection('users').doc(uid).collection('meals')
        .where('date', '>=', startDate).where('date', '<=', endDate).get(),

      // Steps (one doc per day — fetch all 7)
      Promise.all(dates.map(d =>
        db.collection('users').doc(uid).collection('steps').doc(d).get()
      )),

      // Active goals count
      db.collection('users').doc(uid).collection('goals')
        .where('isActive', '==', true).get(),

      // Goal completions for each day
      Promise.all(dates.map(d =>
        db.collection('users').doc(uid).collection('goalCompletions').doc(d).get()
      )),
    ]);

    // ── Sleep ─────────────────────────────────────────────────────────
    const sleepByDate = {};
    sleepSnap.docs.forEach(d => {
      const s = d.data();
      sleepByDate[s.date] = (sleepByDate[s.date] || 0) + s.durationHours;
    });
    const sleepValues   = Object.values(sleepByDate);
    const totalSleep    = sleepValues.reduce((a, b) => a + b, 0);
    const avgSleep      = sleepValues.length ? totalSleep / sleepValues.length : 0;
    const daysUnder7    = sleepValues.filter(h => h < 7).length;
    const daysOver8     = sleepValues.filter(h => h >= 8).length;
    // Per-day series for chart
    const sleepSeries   = dates.map(d => Number((sleepByDate[d] || 0).toFixed(2)));

    // ── Stress ────────────────────────────────────────────────────────
    const stressByDate = {};
    stressSnap.docs.forEach(d => {
      const s = d.data();
      if (!stressByDate[s.date]) stressByDate[s.date] = [];
      stressByDate[s.date].push(s.level);
    });
    const stressAvgs    = Object.values(stressByDate).map(arr => arr.reduce((a,b)=>a+b,0)/arr.length);
    const avgStress     = stressAvgs.length ? stressAvgs.reduce((a,b)=>a+b,0)/stressAvgs.length : 0;
    const peakStress    = stressSnap.docs.reduce((max, d) => Math.max(max, d.data().level), 0);
    const stressSeries  = dates.map(d => {
      const arr = stressByDate[d];
      return arr ? Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)) : null;
    });

    // ── Exercise ──────────────────────────────────────────────────────
    const exByDate = {};
    exerciseSnap.docs.forEach(d => {
      const s = d.data();
      if (!exByDate[s.date]) exByDate[s.date] = { cal: 0, min: 0 };
      exByDate[s.date].cal += s.caloriesBurned || 0;
      exByDate[s.date].min += s.durationMinutes || 0;
    });
    const exerciseDays    = Object.keys(exByDate).length;
    const totalExCal      = Object.values(exByDate).reduce((s, v) => s + v.cal, 0);
    const totalExMin      = Object.values(exByDate).reduce((s, v) => s + v.min, 0);
    const burnSeries      = dates.map(d => Math.round(exByDate[d]?.cal || 0));

    // ── Meals ─────────────────────────────────────────────────────────
    const mealsByDate = {};
    mealsSnap.docs.forEach(d => {
      const m = d.data();
      mealsByDate[m.date] = (mealsByDate[m.date] || 0) + (m.calories || 0);
    });
    const totalEaten  = Object.values(mealsByDate).reduce((a,b)=>a+b,0);
    const avgEaten    = Object.keys(mealsByDate).length
      ? totalEaten / Object.keys(mealsByDate).length : 0;
    const eatSeries   = dates.map(d => Math.round(mealsByDate[d] || 0));

    // ── Steps ─────────────────────────────────────────────────────────
    const stepsMap    = {};
    stepsSnaps.forEach((snap, i) => {
      if (snap.exists) stepsMap[dates[i]] = snap.data().stepCount || 0;
    });
    const totalSteps  = Object.values(stepsMap).reduce((a,b)=>a+b,0);
    const stepsSeries = dates.map(d => stepsMap[d] || 0);

    // ── Goals completion ──────────────────────────────────────────────
    const totalGoals = goalsSnap.size;
    let completedCount = 0, totalPossible = 0;
    completionSnaps.forEach(snap => {
      if (!snap.exists || !totalGoals) return;
      const data = snap.data();
      totalPossible += totalGoals;
      Object.values(data).forEach(v => {
        if (typeof v === 'object' && v.isCompleted) completedCount++;
      });
    });
    const goalCompletionRate = totalPossible
      ? Number(((completedCount / totalPossible) * 100).toFixed(1)) : 0;

    res.json({
      dates,
      startDate,
      endDate,
      sleep: {
        total:      Number(totalSleep.toFixed(2)),
        avg:        Number(avgSleep.toFixed(2)),
        daysUnder7,
        daysOver8,
        series:     sleepSeries,
      },
      stress: {
        avg:        Number(avgStress.toFixed(1)),
        peak:       peakStress,
        series:     stressSeries,
      },
      exercise: {
        days:       exerciseDays,
        totalCal:   Math.round(totalExCal),
        totalMin:   Math.round(totalExMin),
        series:     burnSeries,
      },
      meals: {
        totalEaten: Math.round(totalEaten),
        avgPerDay:  Math.round(avgEaten),
        series:     eatSeries,
      },
      steps: {
        total:      totalSteps,
        avg:        totalSteps ? Math.round(totalSteps / 7) : 0,
        series:     stepsSeries,
      },
      goals: {
        active:         totalGoals,
        completionRate: goalCompletionRate,
      },
    });

  } catch (err) {
    console.error('[GET /weekly]', err);
    res.status(500).json({ error: 'Failed to load weekly summary.' });
  }
});

module.exports = router;
