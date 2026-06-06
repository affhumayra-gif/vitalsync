const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');
const PDFDocument  = require('pdfkit');

// ── Helpers ───────────────────────────────────────────────────────────────
function getWeekDates() {
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - i);
    return d.toISOString().split('T')[0];
  }).reverse();
  return { dates, start: dates[0], end: dates[6] };
}

function fmt(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
}

// ── GET /api/pdf/weekly ───────────────────────────────────────────────────
// Streams a PDF of the user's 7-day health summary directly to the browser.
router.get('/weekly', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { dates, start, end } = getWeekDates();

  try {
    // Gather data
    const [sleepSnap, stressSnap, exSnap, mealsSnap, stepsSnaps,
           goalsSnap, completionSnaps, userDoc] = await Promise.all([
      db.collection('users').doc(uid).collection('sleep').where('date','>=',start).where('date','<=',end).get(),
      db.collection('users').doc(uid).collection('stress').where('date','>=',start).where('date','<=',end).get(),
      db.collection('users').doc(uid).collection('exercise').where('date','>=',start).where('date','<=',end).get(),
      db.collection('users').doc(uid).collection('meals').where('date','>=',start).where('date','<=',end).get(),
      Promise.all(dates.map(d => db.collection('users').doc(uid).collection('steps').doc(d).get())),
      db.collection('users').doc(uid).collection('goals').where('isActive','==',true).get(),
      Promise.all(dates.map(d => db.collection('users').doc(uid).collection('goalCompletions').doc(d).get())),
      db.collection('users').doc(uid).get(),
    ]);

    const userName    = userDoc.exists ? (userDoc.data().displayName || 'User') : 'User';
    const sleepDocs   = sleepSnap.docs.map(d => d.data());
    const totalSleep  = sleepDocs.reduce((s,x)=>s+x.durationHours,0);
    const avgSleep    = sleepDocs.length ? (totalSleep/sleepDocs.length).toFixed(1) : 0;
    const goodNights  = sleepDocs.filter(x=>x.durationHours>=7).length;

    const stressVals  = stressSnap.docs.map(d => d.data().level);
    const avgStress   = stressVals.length ? (stressVals.reduce((a,b)=>a+b,0)/stressVals.length).toFixed(0) : 'N/A';
    const peakStress  = stressVals.length ? Math.max(...stressVals) : 'N/A';

    const exDocs      = exSnap.docs.map(d => d.data());
    const exDays      = new Set(exDocs.map(x=>x.date)).size;
    const exCal       = exDocs.reduce((s,x)=>s+(x.caloriesBurned||0),0);
    const exMin       = exDocs.reduce((s,x)=>s+(x.durationMinutes||0),0);

    const totalEaten  = mealsSnap.docs.reduce((s,d)=>s+(d.data().calories||0),0);
    const mealDays    = new Set(mealsSnap.docs.map(d=>d.data().date)).size;
    const avgEaten    = mealDays ? Math.round(totalEaten/mealDays) : 0;

    const totalSteps  = stepsSnaps.reduce((s,d)=>s+(d.exists?d.data().stepCount:0),0);

    const totalGoals  = goalsSnap.size;
    let done=0, possible=0;
    completionSnaps.forEach(snap => {
      if (!snap.exists||!totalGoals) return;
      possible += totalGoals;
      Object.values(snap.data()).forEach(v=>{ if(typeof v==='object'&&v?.isCompleted) done++; });
    });
    const goalRate = possible ? ((done/possible)*100).toFixed(1) : 0;

    // Sleep by day for mini table
    const sleepByDay = {};
    sleepDocs.forEach(s => { sleepByDay[s.date] = (sleepByDay[s.date]||0)+s.durationHours; });
    const stressByDay = {};
    stressSnap.docs.forEach(d => {
      const s = d.data();
      if (!stressByDay[s.date]) stressByDay[s.date] = [];
      stressByDay[s.date].push(s.level);
    });

    // ── Build PDF ─────────────────────────────────────────────────────────
    const doc = new PDFDocument({ size:'A4', margin:50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="VitalSync_Weekly_${start}_${end}.pdf"`);
    doc.pipe(res);

    const W = 595 - 100; // content width (A4 width 595 - 2*50 margin)
    const COPPER  = '#C65911';
    const NAVY    = '#1F3864';
    const LGRAY   = '#F5F5F5';
    const MGRAY   = '#CCCCCC';
    const DKTEXT  = '#222222';

    // ── Header ──────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 80).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#FFFFFF')
       .text('VitalSync', 50, 22);
    doc.font('Helvetica').fontSize(11).fillColor('#DDDDDD')
       .text('Weekly Health Summary Report', 50, 50);
    doc.font('Helvetica').fontSize(10).fillColor('#AAAAAA')
       .text(`${fmt(start)}  –  ${fmt(end)}`, 595-250, 50, { width:200, align:'right' });

    doc.moveDown(4);

    // ── Greeting ──────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COPPER)
       .text(`Hello, ${userName}!`, 50, 95);
    doc.font('Helvetica').fontSize(10).fillColor(DKTEXT)
       .text(`Here is your complete health summary for the week of ${fmt(start)} to ${fmt(end)}.`, 50, 115);

    // ── Section helper ─────────────────────────────────────────────────
    let y = 145;
    const section = (title, icon) => {
      doc.rect(50, y, W, 22).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
         .text(`${icon}  ${title}`, 58, y+5);
      y += 30;
    };
    const row = (label, value, shade=false) => {
      if (shade) doc.rect(50, y, W, 18).fill(LGRAY);
      doc.rect(50, y, W, 18).stroke(MGRAY);
      doc.font('Helvetica').fontSize(9).fillColor(DKTEXT).text(label, 58, y+4, { width:200 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(DKTEXT).text(String(value), 300, y+4, { width:240, align:'right' });
      y += 18;
    };

    // ── Sleep section ──────────────────────────────────────────────────
    section('Sleep', '🌙');
    row('Total sleep hours (7 days)', `${totalSleep.toFixed(1)} hrs`);
    row('Average per night', `${avgSleep} hrs`, true);
    row('Nights with ≥ 7 hrs', `${goodNights} of ${sleepDocs.length} logged nights`);
    row('Nights under 7 hrs', `${sleepDocs.length - goodNights}`, true);
    y += 6;

    // ── Stress section ─────────────────────────────────────────────────
    section('Stress', '🧠');
    row('Average stress level', `${avgStress} / 100`);
    row('Peak stress level', `${peakStress} / 100`, true);
    row('High-stress readings (> 70)', `${stressVals.filter(v=>v>70).length}`);
    y += 6;

    // ── Exercise section ───────────────────────────────────────────────
    section('Exercise & Steps', '🏋️');
    row('Active exercise days', `${exDays} of 7 days`);
    row('Total calories burned (exercise)', `${exCal.toLocaleString()} kcal`, true);
    row('Total exercise duration', `${exMin} minutes`);
    row('Total steps (7 days)', `${totalSteps.toLocaleString()}`, true);
    row('Daily average steps', `${Math.round(totalSteps/7).toLocaleString()}`);
    y += 6;

    // ── Nutrition section ──────────────────────────────────────────────
    section('Nutrition', '🍽️');
    row('Total calories consumed', `${totalEaten.toLocaleString()} kcal`);
    row('Daily average calories', `${avgEaten.toLocaleString()} kcal`, true);
    row('Days with meals logged', `${mealDays} of 7 days`);
    y += 6;

    // ── Goals section ──────────────────────────────────────────────────
    section('Goals', '🎯');
    row('Active goals', `${totalGoals}`);
    row('Weekly completion rate', `${goalRate}%`, true);
    row('Completions achieved', `${done} of ${possible} possible`);
    y += 10;

    // ── Daily snapshot table ───────────────────────────────────────────
    if (y > 600) { doc.addPage(); y = 50; }
    section('Daily Snapshot', '📅');
    // Header row
    doc.rect(50, y, W, 18).fill(COPPER);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
    doc.text('Date', 58, y+4, { width:100 });
    doc.text('Sleep (hrs)', 158, y+4, { width:80, align:'center' });
    doc.text('Avg Stress', 238, y+4, { width:80, align:'center' });
    doc.text('Steps', 318, y+4, { width:80, align:'center' });
    doc.text('Meals (kcal)', 398, y+4, { width:95, align:'center' });
    y += 18;

    const mealsByDay = {};
    mealsSnap.docs.forEach(d => {
      const m = d.data();
      mealsByDay[m.date] = (mealsByDay[m.date]||0) + m.calories;
    });
    const stepsByDay = {};
    stepsSnaps.forEach((snap,i) => { stepsByDay[dates[i]] = snap.exists ? snap.data().stepCount : 0; });

    dates.forEach((date, i) => {
      const shade = i % 2 === 0;
      if (shade) doc.rect(50, y, W, 16).fill(LGRAY);
      doc.rect(50, y, W, 16).stroke(MGRAY);
      const sleepH  = sleepByDay[date] ? sleepByDay[date].toFixed(1) : '—';
      const avgStr  = stressByDay[date] ? Math.round(stressByDay[date].reduce((a,b)=>a+b,0)/stressByDay[date].length) : '—';
      const steps   = stepsByDay[date] ? stepsByDay[date].toLocaleString() : '—';
      const mealCal = mealsByDay[date]  ? mealsByDay[date].toLocaleString() : '—';
      const label   = new Date(date).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'});
      doc.font('Helvetica').fontSize(8).fillColor(DKTEXT);
      doc.text(label, 58, y+3, { width:100 });
      doc.text(String(sleepH), 158, y+3, { width:80, align:'center' });
      doc.text(String(avgStr), 238, y+3, { width:80, align:'center' });
      doc.text(String(steps),  318, y+3, { width:80, align:'center' });
      doc.text(String(mealCal),398, y+3, { width:95, align:'center' });
      y += 16;
    });

    y += 16;

    // ── Footer ─────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#999999')
       .text('Generated by VitalSync  |  Health & Wellness Tracking Application',
         50, 780, { align:'center', width: W });

    doc.end();

  } catch (err) {
    console.error('[GET /pdf/weekly]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

module.exports = router;
