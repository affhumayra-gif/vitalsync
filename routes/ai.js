const express = require('express');
const router = express.Router();
const { db } = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ── OpenRouter API (free tier, no billing required) ──────────────────────
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callOpenRouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set in .env. Get a free key at https://openrouter.ai/');

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'VitalSync'
    },
    body: JSON.stringify({
      model: 'openrouter/free',  // Free model
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenRouter API error ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'No response from AI.';
}

// ── Date helpers ── (same as before)
function getWeekDates() {
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - i);
    return d.toISOString().split('T')[0];
  }).reverse();
  return { dates, start: dates[0], end: dates[6] };
}

// ── POST /api/ai/coach ──
router.post('/coach', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { dates, start, end } = getWeekDates();

  try {
    // [Keep all your existing data gathering code here - it's the same]
    const [sleepSnap, stressSnap, exerciseSnap, mealsSnap,
          stepsSnaps, goalsSnap, completionSnaps, userDoc] = await Promise.all([
      db.collection('users').doc(uid).collection('sleep')
        .where('date', '>=', start).where('date', '<=', end).get(),
      db.collection('users').doc(uid).collection('stress')
        .where('date', '>=', start).where('date', '<=', end).get(),
      db.collection('users').doc(uid).collection('exercise')
        .where('date', '>=', start).where('date', '<=', end).get(),
      db.collection('users').doc(uid).collection('meals')
        .where('date', '>=', start).where('date', '<=', end).get(),
      Promise.all(dates.map(d =>
        db.collection('users').doc(uid).collection('steps').doc(d).get()
      )),
      db.collection('users').doc(uid).collection('goals').where('isActive','==',true).get(),
      Promise.all(dates.map(d =>
        db.collection('users').doc(uid).collection('goalCompletions').doc(d).get()
      )),
      db.collection('users').doc(uid).get(),
    ]);

    // Aggregate data (same as your existing code)
    const sleepDocs = sleepSnap.docs.map(d => d.data());
    const totalSleep = sleepDocs.reduce((s,x) => s + x.durationHours, 0);
    const avgSleep = sleepDocs.length ? totalSleep / sleepDocs.length : 0;
    const goodNights = sleepDocs.filter(x => x.durationHours >= 7).length;

    const stressVals = stressSnap.docs.map(d => d.data().level);
    const avgStress = stressVals.length ? stressVals.reduce((a,b)=>a+b,0)/stressVals.length : 0;
    const peakStress = stressVals.length ? Math.max(...stressVals) : 0;
    const highCount = stressVals.filter(v => v > 70).length;

    const exDocs = exerciseSnap.docs.map(d => d.data());
    const exDays = new Set(exDocs.map(x => x.date)).size;
    const exCal = exDocs.reduce((s,x) => s+(x.caloriesBurned||0), 0);
    const exMin = exDocs.reduce((s,x) => s+(x.durationMinutes||0), 0);

    const totalEaten = mealsSnap.docs.reduce((s,d) => s+(d.data().calories||0), 0);
    const mealDays = new Set(mealsSnap.docs.map(d => d.data().date)).size;
    const avgEaten = mealDays ? totalEaten / mealDays : 0;

    const totalSteps = stepsSnaps.reduce((s,d) => s+(d.exists ? d.data().stepCount : 0), 0);

    const totalGoals = goalsSnap.size;
    let goalDone = 0, goalPossible = 0;
    completionSnaps.forEach(snap => {
      if (!snap.exists || !totalGoals) return;
      goalPossible += totalGoals;
      Object.values(snap.data()).forEach(v => {
        if (typeof v === 'object' && v?.isCompleted) goalDone++;
      });
    });
    const goalRate = goalPossible ? ((goalDone / goalPossible) * 100).toFixed(1) : 0;

    const userName = userDoc.exists ? (userDoc.data().displayName || 'the user') : 'the user';
    const fmt = iso => new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });

    const prompt = `You are VitalSync's AI Health Coach. Analyse the following 7-day health data for ${userName} (${fmt(start)} – ${fmt(end)}) and provide a personalised coaching report.

HEALTH DATA SUMMARY:
- Sleep: ${totalSleep.toFixed(1)} hrs total | ${avgSleep.toFixed(1)} hrs average/night | ${goodNights} of ${sleepDocs.length} logged nights ≥ 7 hrs
- Stress: Average ${avgStress.toFixed(0)}/100 | Peak ${peakStress}/100 | ${highCount} high-stress readings (>70)
- Exercise: ${exDays} active days | ${exCal} kcal burned | ${exMin} minutes total
- Nutrition: ${totalEaten.toLocaleString()} kcal consumed over the week | Average ${avgEaten.toFixed(0)} kcal/day (${mealDays} days logged)
- Steps: ${totalSteps.toLocaleString()} total | Average ${Math.round(totalSteps/7).toLocaleString()} steps/day
- Goals: ${goalRate}% weekly completion rate (${goalDone} of ${goalPossible} possible completions)

Your response must follow this exact format with these section headers:

## Overall Assessment
(2-3 sentences summarising the week's health performance)

## Sleep
(Specific observation + one recommendation)

## Stress
(Specific observation + one recommendation)

## Nutrition
(Specific observation + one recommendation)

## Exercise & Steps
(Specific observation + one recommendation)

## Goals
(Specific observation + one recommendation)

## Top 3 Priorities for Next Week
1. (Most important action)
2. (Second priority)
3. (Third priority)

## Motivational Close
(One warm, encouraging sentence)

Be specific, evidence-based, and warm. Use the actual numbers in your observations. Keep each section to 2-3 sentences maximum.`;

    const analysis = await callOpenRouter(prompt);

    res.json({
      analysis,
      data: {
        weekRange: { start, end },
        sleep: { total: totalSleep.toFixed(1), avg: avgSleep.toFixed(1), goodNights },
        stress: { avg: avgStress.toFixed(0), peak: peakStress, highCount },
        exercise: { days: exDays, calories: exCal, minutes: exMin },
        nutrition: { total: totalEaten, avg: avgEaten.toFixed(0), daysLogged: mealDays },
        steps: { total: totalSteps, avg: Math.round(totalSteps / 7) },
        goals: { rate: goalRate, done: goalDone, possible: goalPossible },
      }
    });

  } catch (err) {
    console.error('[POST /ai/coach]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ai/ask ──
router.post('/ask', requireAuth, async (req, res) => {
  const { question } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'question is required.' });
  if (question.length > 500) return res.status(400).json({ error: 'Question too long (max 500 chars).' });

  try {
    const prompt = `You are VitalSync's AI Health Coach — a knowledgeable, warm, evidence-based health advisor. A user is asking you the following health-related question. Answer concisely (3-5 sentences), using clear language suitable for a general audience. Do not provide specific medical diagnoses or replace professional medical advice — include a brief note to consult a professional for medical concerns.

User's question: ${question}`;

    const answer = await callOpenRouter(prompt);
    res.json({ answer });
  } catch (err) {
    console.error('[POST /ai/ask]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;