const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ── Helpers ───────────────────────────────────────────────────────────────
function calcDuration(startTime, endTime) {
  const diff = new Date(endTime) - new Date(startTime);
  return diff > 0 ? Number((diff / (1000 * 60 * 60)).toFixed(2)) : 0;
}

function sleepQuality(hours) {
  if (hours < 5)        return { label: 'Poor',      color: 'danger'  };
  if (hours < 7)        return { label: 'Fair',       color: 'warning' };
  if (hours <= 9)       return { label: 'Good',       color: 'success' };
  return                       { label: 'Long',       color: 'info'    };
}

// GET /api/sleep?limit=20
router.get('/', requireAuth, async (req, res) => {
  const uid   = req.user.uid;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  try {
    const snap = await db
      .collection('users').doc(uid)
      .collection('sleep')
      .orderBy('startTime', 'desc')
      .limit(limit)
      .get();

    const sessions = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, quality: sleepQuality(data.durationHours) };
    });

    res.json({ sessions });
  } catch (err) {
    console.error('[GET /sleep]', err);
    res.status(500).json({ error: 'Failed to load sleep sessions.' });
  }
});

// POST /api/sleep
router.post('/', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { startTime, endTime, wakeCount } = req.body;

  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'startTime and endTime are required.' });
  }

  const durationHours = calcDuration(startTime, endTime);
  if (durationHours <= 0) {
    return res.status(400).json({ error: 'endTime must be after startTime.' });
  }
  if (durationHours > 24) {
    return res.status(400).json({ error: 'Sleep session cannot exceed 24 hours.' });
  }

  try {
    const entry = {
      startTime,
      endTime,
      durationHours,
      wakeCount:  Number(wakeCount) || 0,
      date:       startTime.split('T')[0],
      loggedAt:   new Date().toISOString(),
    };
    const ref = await db.collection('users').doc(uid).collection('sleep').add(entry);
    res.status(201).json({ id: ref.id, ...entry, quality: sleepQuality(durationHours) });
  } catch (err) {
    console.error('[POST /sleep]', err);
    res.status(500).json({ error: 'Failed to log sleep session.' });
  }
});

// PATCH /api/sleep/:id
router.patch('/:id', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { startTime, endTime, wakeCount } = req.body;

  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'startTime and endTime are required.' });
  }

  const durationHours = calcDuration(startTime, endTime);
  if (durationHours <= 0) {
    return res.status(400).json({ error: 'endTime must be after startTime.' });
  }

  try {
    const updates = {
      startTime, endTime,
      durationHours,
      wakeCount:  Number(wakeCount) || 0,
      date:       startTime.split('T')[0],
      updatedAt:  new Date().toISOString(),
    };
    await db.collection('users').doc(uid).collection('sleep').doc(req.params.id).update(updates);
    res.json({ id: req.params.id, ...updates, quality: sleepQuality(durationHours) });
  } catch (err) {
    console.error('[PATCH /sleep/:id]', err);
    res.status(500).json({ error: 'Failed to update sleep session.' });
  }
});

// DELETE /api/sleep/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    await db.collection('users').doc(uid).collection('sleep').doc(req.params.id).delete();
    res.json({ message: 'Session deleted.' });
  } catch (err) {
    console.error('[DELETE /sleep/:id]', err);
    res.status(500).json({ error: 'Failed to delete sleep session.' });
  }
});

module.exports = router;
