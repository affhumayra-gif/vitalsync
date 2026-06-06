const express      = require('express');
const router       = express.Router();
const { db, auth } = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ── GET /api/auth/profile ─────────────────────────────────────────────────
// Returns the current user's Firestore profile + latest body metrics.
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const uid      = req.user.uid;
    const userSnap = await db.collection('users').doc(uid).get();

    if (!userSnap.exists) {
      // First login — create profile document automatically
      const profileData = {
        displayName: req.user.name,
        email:       req.user.email,
        createdAt:   new Date().toISOString(),
      };
      await db.collection('users').doc(uid).set(profileData);
      return res.json({ profile: profileData, latestMetrics: null, metricsHistory: [] });
    }

    // Latest body metrics
    const metricsSnap = await db
      .collection('users').doc(uid)
      .collection('bodyMetrics')
      .orderBy('recordedAt', 'desc')
      .limit(1)
      .get();

    const latestMetrics = metricsSnap.empty
      ? null
      : { id: metricsSnap.docs[0].id, ...metricsSnap.docs[0].data() };

    // Last 6 metrics entries for the table
    const histSnap = await db
      .collection('users').doc(uid)
      .collection('bodyMetrics')
      .orderBy('recordedAt', 'desc')
      .limit(6)
      .get();

    const metricsHistory = histSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({
      profile:        { uid, ...userSnap.data() },
      latestMetrics,
      metricsHistory,
    });
  } catch (err) {
    console.error('[GET /profile]', err);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

// ── PATCH /api/auth/profile ───────────────────────────────────────────────
// Update display name and/or email.
router.patch('/profile', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { displayName, email } = req.body;

  if (!displayName || !email) {
    return res.status(400).json({ error: 'displayName and email are required.' });
  }
  if (displayName.trim().length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  }

  try {
    // Update Firebase Auth record
    await auth.updateUser(uid, {
      displayName: displayName.trim(),
      email:       email.trim(),
    });
    // Update Firestore profile
    await db.collection('users').doc(uid).update({
      displayName: displayName.trim(),
      email:       email.trim(),
      updatedAt:   new Date().toISOString(),
    });
    res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    console.error('[PATCH /profile]', err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'That email is already in use by another account.' });
    }
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ── POST /api/auth/metrics ────────────────────────────────────────────────
// Log a new body metrics entry (weight + BMR).
router.post('/metrics', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { weightKg, bmr } = req.body;

  if (!weightKg || isNaN(Number(weightKg))) {
    return res.status(400).json({ error: 'A valid weight (kg) is required.' });
  }

  try {
    const entry = {
      weightKg:   Number(Number(weightKg).toFixed(1)),
      bmr:        bmr ? Number(Number(bmr).toFixed(0)) : null,
      recordedAt: new Date().toISOString(),
    };
    const ref = await db
      .collection('users').doc(uid)
      .collection('bodyMetrics')
      .add(entry);

    res.status(201).json({ message: 'Metrics logged.', id: ref.id, ...entry });
  } catch (err) {
    console.error('[POST /metrics]', err);
    res.status(500).json({ error: 'Failed to save metrics.' });
  }
});

// ── DELETE /api/auth/account ──────────────────────────────────────────────
// Permanently delete the user's Firestore data and Firebase Auth account.
router.delete('/account', requireAuth, async (req, res) => {
  const uid = req.user.uid;

  try {
    // Delete all sub-collections (Firestore does not cascade automatically)
    const subcollections = [
      'meals', 'exercise', 'sleep', 'stress',
      'bodyMetrics', 'goals', 'dailyGoals', 'steps',
    ];

    for (const col of subcollections) {
      const snap = await db.collection('users').doc(uid).collection(col).get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      if (!snap.empty) await batch.commit();
    }

    // Delete the user document itself
    await db.collection('users').doc(uid).delete();

    // Delete Firebase Auth account
    await auth.deleteUser(uid);

    res.json({ message: 'Account permanently deleted.' });
  } catch (err) {
    console.error('[DELETE /account]', err);
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

module.exports = router;
