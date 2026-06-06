const express      = require('express');
const router       = express.Router();
const { db }       = require('../firebase/admin');
const { requireAuth } = require('../middleware/auth');

// ── Shared helpers ────────────────────────────────────────────────────────
function stressStatus(level) {
  if (level <= 50) return '😌 Good';
  if (level <= 70) return '😐 OK';
  return '😰 High';
}
function workoutMood(cal) {
  if (cal >= 500) return '🔥 Beast Mode';
  if (cal >= 300) return '💪 On Track';
  if (cal >= 1)   return '😌 Light Day';
  return '🛏️ Resting';
}
function calorieTip(cal) {
  if (cal < 1200)                    return '🍽️ Eat More';
  if (cal >= 1200 && cal <= 1600)    return '✅ Good';
  return '⚠️ Eat Less';
}
function calorieVibe(cal) {
  if (cal >= 400) return '⚠️ Danger Zone!';
  if (cal >= 250) return '🍔 Heavy Hitter';
  if (cal >= 100) return '😋 Moderate';
  return '🥦 Light & Lovely';
}

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/reports/weight
// ══════════════════════════════════════════════════════════════════════════
router.get('/weight', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const snap = await db.collection('users').doc(uid)
      .collection('bodyMetrics').orderBy('recordedAt', 'asc').get();

    const metrics = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!metrics.length) return res.json({ metrics:[], stats:{}, drops:[], avg7Day:null });

    const weights = metrics.map(m => m.weightKg).filter(Boolean);
    const maxW    = Math.max(...weights);
    const minW    = Math.min(...weights);

    // 7-day average around the most recent entry
    const sorted  = [...metrics].sort((a,b) => b.recordedAt.localeCompare(a.recordedAt));
    const last7   = sorted.slice(0,7).map(m => m.weightKg).filter(Boolean);
    const avg7Day = last7.length ? (last7.reduce((s,v)=>s+v,0)/last7.length).toFixed(2) : null;

    // Significant drops (> 0.5 kg between consecutive days)
    const drops = [];
    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i-1], prev = sorted[i];
      const drop = (prev.weightKg || 0) - (curr.weightKg || 0);
      if (drop > 0.5) drops.push({
        date:      curr.recordedAt?.split('T')[0] || curr.recordedAt,
        prevDate:  prev.recordedAt?.split('T')[0] || prev.recordedAt,
        currWeight: curr.weightKg,
        prevWeight: prev.weightKg,
        drop:       Number(drop.toFixed(2)),
      });
    }

    res.json({ metrics, stats: { maxWeight: maxW, minWeight: minW }, avg7Day, drops });
  } catch (err) {
    console.error('[GET /reports/weight]', err);
    res.status(500).json({ error: 'Failed to load weight report.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/reports/sleep
// ══════════════════════════════════════════════════════════════════════════
router.get('/sleep', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const snap = await db.collection('users').doc(uid)
      .collection('sleep').orderBy('startTime', 'asc').get();

    const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!sessions.length) return res.json({ sessions:[], byDay:[], stats:{} });

    // Group by date and sum hours
    const byDateMap = {};
    sessions.forEach(s => {
      byDateMap[s.date] = (byDateMap[s.date] || 0) + s.durationHours;
    });
    const byDay = Object.entries(byDateMap)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours: Number(hours.toFixed(2)) }));

    const allHours = byDay.map(d => d.hours);
    const daysOver8  = allHours.filter(h => h > 8).length;
    const daysUnder7 = allHours.filter(h => h < 7).length;
    const avgPerDay  = allHours.length ? (allHours.reduce((s,h)=>s+h,0)/allHours.length).toFixed(2) : 0;
    const avgSession = sessions.length ? (sessions.reduce((s,x)=>s+x.durationHours,0)/sessions.length).toFixed(2) : 0;
    const bestDay    = byDay.reduce((a,b) => a.hours > b.hours ? a : b, { hours: 0 });

    // Wakeups > 1
    const wakeups = sessions.filter(s => (s.wakeCount||0) > 1).map(s => ({
      date: s.date, wakeCount: s.wakeCount,
    }));

    res.json({ sessions, byDay, stats: { daysOver8, daysUnder7, avgPerDay, avgSession, bestDay }, wakeups });
  } catch (err) {
    console.error('[GET /reports/sleep]', err);
    res.status(500).json({ error: 'Failed to load sleep report.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/reports/stress
// ══════════════════════════════════════════════════════════════════════════
router.get('/stress', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const snap = await db.collection('users').doc(uid)
      .collection('stress').orderBy('recordedAt', 'asc').get();

    const readings = snap.docs.map(d => ({
      id: d.id, ...d.data(), status: stressStatus(d.data().level)
    }));
    if (!readings.length) return res.json({ readings:[], stats:{}, spikes:[], byHour:[], byWeekday:[] });

    const levels     = readings.map(r => r.level);
    const avg        = (levels.reduce((s,v)=>s+v,0)/levels.length).toFixed(1);
    const peak       = Math.max(...levels);
    const highReadings = readings.filter(r => r.level > 70);

    // Stress spikes: level jumped >= 30 within 2 hours
    const spikes = [];
    for (let i = 1; i < readings.length; i++) {
      const cur  = readings[i], prev = readings[i-1];
      const diff = cur.level - prev.level;
      const tDiff = (new Date(cur.recordedAt) - new Date(prev.recordedAt)) / (1000*60*60);
      if (diff >= 30 && tDiff <= 2) spikes.push({
        currentTime:  cur.recordedAt,
        previousTime: prev.recordedAt,
        currentLevel: cur.level,
        previousLevel:prev.level,
        jump: diff,
      });
    }

    // Hourly average
    const hourBuckets = {};
    readings.forEach(r => {
      const h = new Date(r.recordedAt).getHours();
      const label = `${String(h).padStart(2,'0')}:00`;
      if (!hourBuckets[label]) hourBuckets[label] = [];
      hourBuckets[label].push(r.level);
    });
    const byHour = Object.entries(hourBuckets)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([hour, vals]) => ({ hour, avg: Number((vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(1)) }));

    // Weekday average
    const wdBuckets = {};
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    readings.forEach(r => {
      const wd = days[new Date(r.recordedAt).getDay()];
      if (!wdBuckets[wd]) wdBuckets[wd] = [];
      wdBuckets[wd].push(r.level);
    });
    const byWeekday = Object.entries(wdBuckets)
      .map(([day, vals]) => ({ day, avg: Number((vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(1)) }))
      .sort((a,b) => b.avg - a.avg);

    res.json({ readings, stats:{ avg, peak, highCount: highReadings.length }, highReadings, spikes, byHour, byWeekday });
  } catch (err) {
    console.error('[GET /reports/stress]', err);
    res.status(500).json({ error: 'Failed to load stress report.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/reports/exercise
// ══════════════════════════════════════════════════════════════════════════
router.get('/exercise', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const snap = await db.collection('users').doc(uid)
      .collection('exercise').orderBy('date', 'asc').get();

    const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!sessions.length) return res.json({ sessions:[], byDay:[], byType:[], stats:{} });

    // Daily totals with mood
    const dayMap = {};
    sessions.forEach(s => {
      if (!dayMap[s.date]) dayMap[s.date] = { calories:0, minutes:0 };
      dayMap[s.date].calories += s.caloriesBurned || 0;
      dayMap[s.date].minutes  += s.durationMinutes || 0;
    });
    const byDay = Object.entries(dayMap)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, totalCalories: v.calories, totalMinutes: v.minutes, mood: workoutMood(v.calories) }));

    // Average per exercise type
    const typeMap = {};
    sessions.filter(s => s.exerciseName).forEach(s => {
      const k = s.exerciseName;
      if (!typeMap[k]) typeMap[k] = { cal:[], min:[] };
      if (s.caloriesBurned)   typeMap[k].cal.push(s.caloriesBurned);
      if (s.durationMinutes)  typeMap[k].min.push(s.durationMinutes);
    });
    const byType = Object.entries(typeMap).map(([type, v]) => ({
      type,
      avgCalories: v.cal.length ? Number((v.cal.reduce((s,x)=>s+x,0)/v.cal.length).toFixed(1)) : 0,
      avgMinutes:  v.min.length ? Number((v.min.reduce((s,x)=>s+x,0)/v.min.length).toFixed(1)) : 0,
    })).sort((a,b) => b.avgCalories - a.avgCalories);

    const stats = {
      totalCal:    sessions.reduce((s,x) => s+(x.caloriesBurned||0), 0),
      totalMin:    sessions.reduce((s,x) => s+(x.durationMinutes||0), 0),
      activeDays:  Object.keys(dayMap).length,
    };

    res.json({ sessions, byDay, byType, stats });
  } catch (err) {
    console.error('[GET /reports/exercise]', err);
    res.status(500).json({ error: 'Failed to load exercise report.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/reports/meals
// ══════════════════════════════════════════════════════════════════════════
router.get('/meals', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const snap = await db.collection('users').doc(uid)
      .collection('meals').orderBy('date', 'asc').get();

    const meals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!meals.length) return res.json({ byDay:[], skipped:[], foodRanking:[], stats:{} });

    const TYPES = ['Breakfast','Lunch','Dinner','Snack'];

    // Daily pivot by meal type
    const dayMap = {};
    meals.forEach(m => {
      if (!dayMap[m.date]) dayMap[m.date] = { Breakfast:0, Lunch:0, Dinner:0, Snack:0, total:0, types:new Set() };
      dayMap[m.date][m.mealType] = (dayMap[m.date][m.mealType]||0) + m.calories;
      dayMap[m.date].total += m.calories;
      dayMap[m.date].types.add(m.mealType);
    });

    const byDay = Object.entries(dayMap)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        breakfast: v.Breakfast, lunch: v.Lunch, dinner: v.Dinner, snack: v.Snack,
        total: v.total,
        tip:   calorieTip(v.total),
        skippedTypes: TYPES.filter(t => !v.types.has(t)),
        skippedDinner: !v.types.has('Dinner'),
      }));

    // Skipped meals list
    const skipped = [];
    byDay.forEach(d => {
      d.skippedTypes.forEach(t => skipped.push({ date: d.date, skippedMeal: t }));
    });

    // Food calorie ranking (unique foods, highest calories first)
    const foodMap = {};
    meals.forEach(m => {
      if (!foodMap[m.foodName] || m.calories > foodMap[m.foodName]) {
        foodMap[m.foodName] = m.calories;
      }
    });
    const foodRanking = Object.entries(foodMap)
      .sort(([,a],[,b]) => b - a)
      .map(([name, calories]) => ({ name, calories, vibe: calorieVibe(calories) }));

    const totalEaten = meals.reduce((s,m) => s+m.calories, 0);
    const mealDays   = Object.keys(dayMap).length;

    res.json({
      byDay,
      skipped,
      foodRanking,
      stats: { totalEaten, avgPerDay: mealDays ? Math.round(totalEaten/mealDays) : 0, daysLogged: mealDays },
    });
  } catch (err) {
    console.error('[GET /reports/meals]', err);
    res.status(500).json({ error: 'Failed to load meals report.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/reports/goals
// ══════════════════════════════════════════════════════════════════════════
router.get('/goals', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const [goalsSnap, completionSnaps] = await Promise.all([
      db.collection('users').doc(uid).collection('goals').get(),
      db.collection('users').doc(uid).collection('goalCompletions').orderBy('date','asc').get(),
    ]);

    const allGoals = goalsSnap.docs.reduce((map, d) => {
      map[d.id] = d.data().type || d.id;
      return map;
    }, {});

    const completions = completionSnaps.docs.map(d => ({ date: d.id, ...d.data() }));
    if (!completions.length) return res.json({ byDay:[], overall:{}, byType:{}, streaks:{} });

    // Daily summary
    const byDay = completions.map(c => {
      const entries = Object.entries(c).filter(([k,v]) => k !== 'date' && k !== 'updatedAt' && typeof v === 'object');
      const total   = entries.length;
      const done    = entries.filter(([,v]) => v?.isCompleted).length;
      return { date: c.date, total, done, rate: total ? Math.round((done/total)*100) : 0 };
    });

    // Overall
    const totalGoals = byDay.reduce((s,d) => s+d.total, 0);
    const totalDone  = byDay.reduce((s,d) => s+d.done, 0);
    const overallRate = totalGoals ? Number(((totalDone/totalGoals)*100).toFixed(2)) : 0;

    // Per goal-type stats
    const byType = {};
    completions.forEach(c => {
      Object.entries(c).forEach(([goalId, v]) => {
        if (typeof v !== 'object' || !v || !allGoals[goalId]) return;
        const type = allGoals[goalId];
        if (!byType[type]) byType[type] = { total:0, done:0 };
        byType[type].total++;
        if (v.isCompleted) byType[type].done++;
      });
    });
    const byTypeArray = Object.entries(byType).map(([type, v]) => ({
      type,
      total: v.total,
      done:  v.done,
      rate:  Number(((v.done/v.total)*100).toFixed(1)),
    })).sort((a,b) => a.rate - b.rate);

    // Longest streak per goal type
    const streaks = {};
    Object.keys(byType).forEach(type => {
      const goalId = Object.entries(allGoals).find(([,t]) => t === type)?.[0];
      if (!goalId) return;
      let maxStreak = 0, cur = 0;
      [...completions].sort((a,b) => a.date.localeCompare(b.date)).forEach(c => {
        const v = c[goalId];
        if (v?.isCompleted) { cur++; maxStreak = Math.max(maxStreak, cur); } else cur = 0;
      });
      streaks[type] = maxStreak;
    });

    res.json({ byDay, overall:{ total: totalGoals, done: totalDone, rate: overallRate }, byType: byTypeArray, streaks });
  } catch (err) {
    console.error('[GET /reports/goals]', err);
    res.status(500).json({ error: 'Failed to load goals report.' });
  }
});

module.exports = router;
