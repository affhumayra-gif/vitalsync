const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
//  AUTO-COMPLETION ENGINE
//
//  Trackable goal types and how to check them:
//    steps          → steps/{date}.stepCount           >= target
//    sleep          → sum sleep sessions (today + yesterday) >= target (hrs)
//    calorie_burn   → sum exercise caloriesBurned today  >= target
//    calorie_intake → sum meal calories today            <= target (under budget)
//    exercise       → sum exercise durationMinutes today >= target
//
//  Non-trackable (manual only): water, meditation, reading, custom
// ══════════════════════════════════════════════════════════════════════════
async function getActualValues(uid, date) {
  // Yesterday's date string (for sleep sessions that started yesterday)
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const [stepsDoc, sleepToday, sleepYest, exerciseSnap, mealsSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('steps').doc(date).get(),

    db.collection('users').doc(uid).collection('sleep')
      .where('date', '==', date).get(),

    // Also check yesterday so overnight sleep counts (e.g. slept 11pm→7am)
    db.collection('users').doc(uid).collection('sleep')
      .where('date', '==', yesterdayStr).get(),

    db.collection('users').doc(uid).collection('exercise')
      .where('date', '==', date).get(),

    db.collection('users').doc(uid).collection('meals')
      .where('date', '==', date).get(),
  ]);

  // Sleep: combine today + yesterday sessions, deduplicate by id
  const sleepDocs = [...sleepToday.docs, ...sleepYest.docs];
  const sleepHours = sleepDocs.reduce((s, d) => s + (d.data().durationHours || 0), 0);

  return {
    steps:          stepsDoc.exists ? (stepsDoc.data().stepCount || 0) : 0,
    sleep:          Number(sleepHours.toFixed(2)),
    calorie_burn:   exerciseSnap.docs.reduce((s, d) => s + (d.data().caloriesBurned || 0), 0),
    calorie_intake: mealsSnap.docs.reduce((s, d) => s + (d.data().calories || 0), 0),
    exercise:       exerciseSnap.docs.reduce((s, d) => s + (d.data().durationMinutes || 0), 0),
  };
}

function isGoalMet(goalType, actual, target) {
  if (actual == null) return false;
  // Calorie intake is a "stay under" goal
  if (goalType === 'calorie_intake') return actual > 0 && actual <= target;
  return actual >= target;
}

// ══════════════════════════════════════════════════════════════════════════
//  ACTIVE GOALS
// ══════════════════════════════════════════════════════════════════════════

router.get('/', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const snap = await db.collection('users').doc(uid).collection('goals')
      .where('isActive', '==', true).get();

    const goals = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    res.json({ goals });
  } catch (err) {
    console.error('[GET /goals]', err);
    res.status(500).json({ error: 'Failed to load goals.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { type, targetValue, unit } = req.body;

  if (!type || targetValue == null) {
    return res.status(400).json({ error: 'type and targetValue are required.' });
  }
  try {
    const entry = {
      type:        String(type).trim(),
      targetValue: Number(targetValue),
      unit:        String(unit || '').trim(),
      isActive:    true,
      createdAt:   new Date().toISOString(),
    };
    const ref = await db.collection('users').doc(uid).collection('goals').add(entry);
    res.status(201).json({ id: ref.id, ...entry });
  } catch (err) {
    console.error('[POST /goals]', err);
    res.status(500).json({ error: 'Failed to create goal.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    await db.collection('users').doc(uid).collection('goals').doc(req.params.id)
      .update({ isActive: false, deactivatedAt: new Date().toISOString() });
    res.json({ message: 'Goal deactivated.' });
  } catch (err) {
    console.error('[DELETE /goals/:id]', err);
    res.status(500).json({ error: 'Failed to deactivate goal.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  TODAY — with auto-completion
// ══════════════════════════════════════════════════════════════════════════

router.get('/today', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const date = new Date().toISOString().split('T')[0];

  try {
    const [goalsSnap, completionDoc, actualValues] = await Promise.all([
      db.collection('users').doc(uid).collection('goals').where('isActive','==',true).get(),
      db.collection('users').doc(uid).collection('goalCompletions').doc(date).get(),
      getActualValues(uid, date),
    ]);

    const existing     = completionDoc.exists ? completionDoc.data() : {};
    const docRef       = db.collection('users').doc(uid).collection('goalCompletions').doc(date);
    const batchUpdates = { ...existing, date, updatedAt: new Date().toISOString() };
    let   needsSave    = false;

    const goals = goalsSnap.docs.map(d => {
      const goal        = { id: d.id, ...d.data() };
      const comp        = existing[d.id] || {};
      const actual      = actualValues[goal.type]; // undefined for non-trackable
      const trackable   = actual !== undefined;
      const metByData   = trackable && isGoalMet(goal.type, actual, goal.targetValue);

      let isCompleted   = comp.isCompleted || false;
      let autoCompleted = comp.autoCompleted || false;

      // Auto-complete if target is newly met and not already marked
      if (trackable && metByData && !isCompleted) {
        isCompleted   = true;
        autoCompleted = true;
        batchUpdates[d.id] = {
          isCompleted:   true,
          autoCompleted: true,
          completedAt:   new Date().toISOString(),
        };
        needsSave = true;
      }

      // Auto-un-complete if data dropped below target (e.g. user deleted a step entry)
      if (trackable && !metByData && isCompleted && autoCompleted) {
        isCompleted   = false;
        autoCompleted = false;
        batchUpdates[d.id] = { isCompleted: false, autoCompleted: false, completedAt: null };
        needsSave = true;
      }

      return {
        ...goal,
        isCompleted,
        autoCompleted,
        completedAt:  comp.completedAt || null,
        trackable,
        actualValue:  trackable ? actual : null,
        // Progress percentage (capped at 100 for display)
        progress:     trackable
          ? goal.type === 'calorie_intake'
            ? actual > 0 ? Math.min(Math.round((actual / goal.targetValue) * 100), 100) : 0
            : Math.min(Math.round((actual / goal.targetValue) * 100), 100)
          : null,
      };
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Write auto-completions back to Firestore
    if (needsSave) await docRef.set(batchUpdates);

    const total     = goals.length;
    const completed = goals.filter(g => g.isCompleted).length;

    res.json({ goals, date, total, completed });
  } catch (err) {
    console.error('[GET /goals/today]', err);
    res.status(500).json({ error: 'Failed to load today\'s goals.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  MANUAL TOGGLE (for non-trackable goals)
// ══════════════════════════════════════════════════════════════════════════

router.post('/:id/toggle', requireAuth, async (req, res) => {
  const uid    = req.user.uid;
  const goalId = req.params.id;
  const date   = new Date().toISOString().split('T')[0];

  try {
    const docRef   = db.collection('users').doc(uid).collection('goalCompletions').doc(date);
    const docSnap  = await docRef.get();
    const existing = docSnap.exists ? docSnap.data() : {};
    const was      = existing[goalId]?.isCompleted || false;
    const now      = !was;

    await docRef.set({
      ...existing,
      [goalId]: { isCompleted: now, autoCompleted: false, completedAt: now ? new Date().toISOString() : null },
      date,
      updatedAt: new Date().toISOString(),
    });

    res.json({ goalId, isCompleted: now, autoCompleted: false, date });
  } catch (err) {
    console.error('[POST /goals/:id/toggle]', err);
    res.status(500).json({ error: 'Failed to toggle goal.' });
  }
});

module.exports = router;
