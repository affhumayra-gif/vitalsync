const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

function stressStatus(level) {
  if (level <= 50) return { label: '😌 Good',  color: 'success' };
  if (level <= 70) return { label: '😐 OK',    color: 'warning' };
  return                  { label: '😰 High',  color: 'danger'  };
}

// GET /api/stress?limit=30
router.get('/', requireAuth, async (req, res) => {
  const uid   = req.user.uid;
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);

  try {
    const snap = await db
      .collection('users').doc(uid)
      .collection('stress')
      .orderBy('recordedAt', 'desc')
      .limit(limit)
      .get();

    const readings = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, status: stressStatus(data.level) };
    });

    res.json({ readings });
  } catch (err) {
    console.error('[GET /stress]', err);
    res.status(500).json({ error: 'Failed to load stress readings.' });
  }
});

// POST /api/stress
router.post('/', requireAuth, async (req, res) => {
  const uid   = req.user.uid;
  const level = Number(req.body.level);

  if (isNaN(level) || level < 0 || level > 100) {
    return res.status(400).json({ error: 'level must be 0–100.' });
  }

  try {
    const now   = new Date().toISOString();
    const entry = {
      level,
      recordedAt: now,
      date:       now.split('T')[0],
    };
    const ref = await db.collection('users').doc(uid).collection('stress').add(entry);
    res.status(201).json({ id: ref.id, ...entry, status: stressStatus(level) });
  } catch (err) {
    console.error('[POST /stress]', err);
    res.status(500).json({ error: 'Failed to log stress reading.' });
  }
});

// DELETE /api/stress/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    await db.collection('users').doc(uid).collection('stress').doc(req.params.id).delete();
    res.json({ message: 'Reading deleted.' });
  } catch (err) {
    console.error('[DELETE /stress/:id]', err);
    res.status(500).json({ error: 'Failed to delete reading.' });
  }
});

module.exports = router;
