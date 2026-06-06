const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ── Date helpers ──────────────────────────────────────────────────────────
function getWeekDates() {
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d.toISOString().split('T')[0];
  });
  return { dates, startDate: dates[6], endDate: dates[0] };
}

// Mask name for privacy: "Afifa Humayra" → "Afifa H."
function maskName(displayName) {
  if (!displayName) return 'Anonymous';
  const parts = displayName.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/leaderboard
//  Returns ranked lists for steps, sleep consistency, and goal streaks.
//  Only includes users who have opted in (leaderboardOptIn === true).
// ══════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { dates, startDate, endDate } = getWeekDates();

  try {
    // Load all opted-in users (+ current user even if not opted in, for rank display)
    const [optedInSnap, currentUserDoc] = await Promise.all([
      db.collection('users').where('leaderboardOptIn', '==', true).get(),
      db.collection('users').doc(uid).get(),
    ]);

    const myOptIn = currentUserDoc.exists
      ? (currentUserDoc.data().leaderboardOptIn || false)
      : false;

    // Build user list — include current user even if not opted in (to show their rank)
    const userDocs = [...optedInSnap.docs];
    const alreadyIncluded = optedInSnap.docs.some(d => d.id === uid);
    if (!alreadyIncluded && currentUserDoc.exists) {
      userDocs.push(currentUserDoc);
    }

    if (userDocs.length === 0) {
      return res.json({ steps: [], sleep: [], goals: [], myOptIn, myRanks: {} });
    }

    // Aggregate weekly data for each user in parallel
    const userStats = await Promise.all(userDocs.map(async userDoc => {
      const userId      = userDoc.id;
      const displayName = userDoc.data()?.displayName || 'Anonymous';
      const isMe        = userId === uid;
      const name        = isMe ? displayName : maskName(displayName);

      // ── Steps: sum all 7 days ──────────────────────────────────────
      const stepsDocs = await Promise.all(
        dates.map(d => db.collection('users').doc(userId).collection('steps').doc(d).get())
      );
      const totalSteps = stepsDocs.reduce((s, doc) =>
        s + (doc.exists ? (doc.data().stepCount || 0) : 0), 0
      );

      // ── Sleep consistency: % of logged nights with ≥ 7 hrs ────────
      const sleepSnap = await db.collection('users').doc(userId)
        .collection('sleep')
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();

      // Group by date, sum hours per night
      const sleepByDate = {};
      sleepSnap.docs.forEach(d => {
        const s = d.data();
        sleepByDate[s.date] = (sleepByDate[s.date] || 0) + s.durationHours;
      });
      const loggedNights    = Object.keys(sleepByDate).length;
      const goodNights      = Object.values(sleepByDate).filter(h => h >= 7).length;
      const sleepConsistency = loggedNights > 0
        ? Math.round((goodNights / loggedNights) * 100)
        : 0;

      // ── Goal streak: consecutive days with 100% completion ─────────
      let streak = 0;
      for (const date of dates) { // dates is newest→oldest
        const doc = await db.collection('users').doc(userId)
          .collection('goalCompletions').doc(date).get();
        if (!doc.exists) break;
        const data       = doc.data();
        const entries    = Object.values(data).filter(v => typeof v === 'object' && v !== null);
        if (entries.length === 0) break;
        const allDone    = entries.every(v => v.isCompleted);
        if (!allDone) break;
        streak++;
      }

      return { userId, name, isMe, totalSteps, sleepConsistency, sleepLoggedNights: loggedNights, streak };
    }));

    // ── Build ranked lists ────────────────────────────────────────────
    const rank = (arr, key, desc = true) => {
      const sorted = [...arr].sort((a, b) => desc ? b[key] - a[key] : a[key] - b[key]);
      return sorted.map((u, i) => ({ rank: i + 1, ...u }));
    };

    const stepsRanked = rank(userStats, 'totalSteps');
    const sleepRanked = rank(userStats, 'sleepConsistency');
    const goalsRanked = rank(userStats, 'streak');

    const myRanks = {
      steps: stepsRanked.find(u => u.isMe)?.rank || null,
      sleep: sleepRanked.find(u => u.isMe)?.rank || null,
      goals: goalsRanked.find(u => u.isMe)?.rank || null,
    };

    res.json({
      steps: stepsRanked.map(u => ({
        rank:   u.rank,
        name:   u.name,
        isMe:   u.isMe,
        value:  u.totalSteps,
        label:  u.totalSteps.toLocaleString() + ' steps',
      })),
      sleep: sleepRanked.map(u => ({
        rank:   u.rank,
        name:   u.name,
        isMe:   u.isMe,
        value:  u.sleepConsistency,
        label:  u.sleepConsistency + '% (' + u.sleepLoggedNights + ' nights logged)',
      })),
      goals: goalsRanked.map(u => ({
        rank:   u.rank,
        name:   u.name,
        isMe:   u.isMe,
        value:  u.streak,
        label:  u.streak + (u.streak === 1 ? ' day' : ' days'),
      })),
      myOptIn,
      myRanks,
      weekRange: { startDate, endDate },
    });

  } catch (err) {
    console.error('[GET /leaderboard]', err);
    res.status(500).json({ error: 'Failed to load leaderboard.' });
  }
});

// ── PATCH /api/leaderboard/optin  — toggle leaderboard opt-in ────────────
router.patch('/optin', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const optIn = Boolean(req.body.optIn);
  try {
    await db.collection('users').doc(uid).set({ leaderboardOptIn: optIn }, { merge: true });
    res.json({ leaderboardOptIn: optIn });
  } catch (err) {
    console.error('[PATCH /leaderboard/optin]', err);
    res.status(500).json({ error: 'Failed to update preference.' });
  }
});

module.exports = router;
