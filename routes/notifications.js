const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// nodemailer is optional — app works without email if SMTP not configured
let transporter = null;
try {
  const nodemailer = require('nodemailer');
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    console.log('[Email] SMTP transporter ready');
  } else {
    console.log('[Email] SMTP not configured — email digest disabled');
  }
} catch {
  console.log('[Email] nodemailer not installed — run: npm install nodemailer');
}

// ── GET /api/notifications/preferences ───────────────────────────────────
router.get('/preferences', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const doc = await db.collection('users').doc(uid).get();
    const data = doc.exists ? doc.data() : {};
    res.json({
      emailDigest:        data.emailDigest        || false,
      leaderboardOptIn:   data.leaderboardOptIn   || false,
      browserNotifications: data.browserNotifications || false,
    });
  } catch (err) {
    console.error('[GET /notifications/preferences]', err);
    res.status(500).json({ error: 'Failed to load preferences.' });
  }
});

// ── PATCH /api/notifications/preferences ─────────────────────────────────
router.patch('/preferences', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const { emailDigest, leaderboardOptIn, browserNotifications } = req.body;
  try {
    const updates = {};
    if (emailDigest        !== undefined) updates.emailDigest        = Boolean(emailDigest);
    if (leaderboardOptIn   !== undefined) updates.leaderboardOptIn   = Boolean(leaderboardOptIn);
    if (browserNotifications !== undefined) updates.browserNotifications = Boolean(browserNotifications);

    await db.collection('users').doc(uid).set(updates, { merge: true });
    res.json({ message: 'Preferences saved.', ...updates });
  } catch (err) {
    console.error('[PATCH /notifications/preferences]', err);
    res.status(500).json({ error: 'Failed to save preferences.' });
  }
});

// ── POST /api/notifications/digest ───────────────────────────────────────
// Sends a weekly summary email to the current user.
router.post('/digest', requireAuth, async (req, res) => {
  const uid = req.user.uid;

  if (!transporter) {
    return res.status(503).json({ error: 'Email is not configured on this server. Add SMTP_* variables to .env and install nodemailer.' });
  }

  try {
    // Load user profile
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found.' });
    const { displayName, email } = userDoc.data();

    // Build 7-day summary
    const today = new Date();
    const dates  = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() - i);
      return d.toISOString().split('T')[0];
    }).reverse();
    const startDate = dates[0], endDate = dates[6];

    const [sleepSnap, stressSnap, exerciseSnap, mealsSnap, stepsSnaps] = await Promise.all([
      db.collection('users').doc(uid).collection('sleep').where('date','>=',startDate).where('date','<=',endDate).get(),
      db.collection('users').doc(uid).collection('stress').where('date','>=',startDate).where('date','<=',endDate).get(),
      db.collection('users').doc(uid).collection('exercise').where('date','>=',startDate).where('date','<=',endDate).get(),
      db.collection('users').doc(uid).collection('meals').where('date','>=',startDate).where('date','<=',endDate).get(),
      Promise.all(dates.map(d => db.collection('users').doc(uid).collection('steps').doc(d).get())),
    ]);

    const totalSleep    = sleepSnap.docs.reduce((s,d) => s + (d.data().durationHours||0), 0);
    const avgSleep      = sleepSnap.docs.length ? (totalSleep/sleepSnap.docs.length).toFixed(1) : 0;
    const avgStress     = stressSnap.docs.length
      ? (stressSnap.docs.reduce((s,d) => s + d.data().level, 0) / stressSnap.docs.length).toFixed(0)
      : 'N/A';
    const exerciseDays  = new Set(exerciseSnap.docs.map(d => d.data().date)).size;
    const exCal         = exerciseSnap.docs.reduce((s,d) => s + (d.data().caloriesBurned||0), 0);
    const totalEaten    = mealsSnap.docs.reduce((s,d) => s + (d.data().calories||0), 0);
    const totalSteps    = stepsSnaps.reduce((s,doc) => s + (doc.exists ? (doc.data().stepCount||0) : 0), 0);

    const fmtDate = iso => new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    const weekLabel = `${fmtDate(startDate)} – ${fmtDate(endDate)}`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0E0B08;font-family:'DM Sans',Arial,sans-serif;color:#EDE0D0;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-family:'Cinzel',serif;font-size:1.6rem;font-weight:700;color:#F0A060;letter-spacing:0.08em;">VitalSync</div>
      <div style="font-size:0.85rem;color:#9A8A78;margin-top:4px;">Weekly Health Digest</div>
    </div>

    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(212,128,58,0.25);border-radius:16px;padding:24px;margin-bottom:16px;">
      <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#F0A060;margin-bottom:16px;">
        Your week · ${weekLabel}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${[
          ['🌙', 'Sleep', `${Number(totalSleep).toFixed(1)} hrs total · ${avgSleep} hrs avg`],
          ['🧠', 'Stress', `Avg ${avgStress}/100`],
          ['🏋️', 'Exercise', `${exerciseDays} days · ${exCal.toLocaleString()} kcal burned`],
          ['🍽️', 'Nutrition', `${totalEaten.toLocaleString()} kcal eaten`],
          ['🚶', 'Steps', `${totalSteps.toLocaleString()} total`],
        ].map(([icon, label, value]) => `
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(212,128,58,0.15);border-radius:10px;padding:12px 14px;">
            <div style="font-size:1.2rem;margin-bottom:4px;">${icon}</div>
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#9A8A78;">${label}</div>
            <div style="font-size:0.88rem;font-weight:600;color:#EDE0D0;margin-top:2px;">${value}</div>
          </div>`
        ).join('')}
      </div>
    </div>

    <div style="text-align:center;padding:20px 0;font-size:0.78rem;color:#5A4A38;">
      You're receiving this because you enabled the weekly digest in VitalSync.
    </div>
  </div>
</body>
</html>`;

    await transporter.sendMail({
      from:    `"VitalSync" <${process.env.SMTP_USER}>`,
      to:      email,
      subject: `Your VitalSync Weekly Digest · ${weekLabel}`,
      html,
    });

    res.json({ message: `Weekly digest sent to ${email}.` });
  } catch (err) {
    console.error('[POST /notifications/digest]', err);
    res.status(500).json({ error: 'Failed to send digest: ' + err.message });
  }
});

module.exports = router;
