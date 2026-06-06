require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const csv     = require('csv-parser');

require('./firebase/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── CSV loader ─────────────────────────────────────────────────────────────
function loadCSV(filePath, label) {
  return new Promise((resolve) => {
    const rows = [];
    if (!fs.existsSync(filePath)) {
      console.warn(`[CSV] ${label} not found at ${filePath}`);
      return resolve([]);
    }
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end',  () => { console.log(`[CSV] ${label} — ${rows.length} rows`); resolve(rows); })
      .on('error', err => { console.error(`[CSV] ${label}:`, err.message); resolve([]); });
  });
}

// ── Food: merge all 5 group files ─────────────────────────────────────────
async function loadFoodData() {
  const groups = await Promise.all(
    [1,2,3,4,5].map(n =>
      loadCSV(path.join(__dirname, 'data', `FOOD-DATA-GROUP${n}.csv`), `Food group ${n}`)
    )
  );
  const merged = groups.flat();
  const seen   = new Set();
  const unique = merged.filter(row => {
    const name = (row['food'] || '').trim().toLowerCase();
    if (!name || seen.has(name)) return false;
    seen.add(name); return true;
  });
  console.log(`[CSV] Food data ready — ${unique.length} unique items`);
  return unique;
}

// ── Start ──────────────────────────────────────────────────────────────────
async function startServer() {
  const [foodData, exerciseData] = await Promise.all([
    loadFoodData(),
    loadCSV(path.join(__dirname, 'data', 'exercises.csv'), 'Exercise dataset'),
  ]);

  app.locals.foodData     = foodData;
  app.locals.exerciseData = exerciseData;

  // Firebase client config endpoint
  app.get('/api/firebase-config', (req, res) => {
    res.json({
      apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  });

  // ── All routes — Sprints 1–6 ───────────────────────────────────────────
  // Sprint 1 — Auth
  app.use('/api/auth',          require('./routes/auth'));

  // Sprint 2 — Meals & food search
  app.use('/api/meals',         require('./routes/meals'));

  // Sprint 3 — Exercise, steps, dashboard
  app.use('/api/exercise',      require('./routes/exercise'));
  app.use('/api/dashboard',     require('./routes/dashboard'));

  // Sprint 4 — Sleep, stress, goals, weekly
  app.use('/api/sleep',         require('./routes/sleep'));
  app.use('/api/stress',        require('./routes/stress'));
  app.use('/api/goals',         require('./routes/goals'));
  app.use('/api/weekly',        require('./routes/weekly'));

  // Sprint 5 — Leaderboard, notifications
  app.use('/api/leaderboard',   require('./routes/leaderboard'));
  app.use('/api/notifications', require('./routes/notifications'));

  // Sprint 6 — AI coach (Gemini), PDF export, report data
  app.use('/api/ai',            require('./routes/ai'));       // ✓
  app.use('/api/pdf',           require('./routes/pdf'));      // ✓
  app.use('/api/reports',       require('./routes/reports')); // ✓

  // SPA fallback — serve index.html for any non-API route
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api'))
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    else
      res.status(404).json({ error: 'Route not found.' });
  });

  app.use((err, req, res, next) => {
    console.error('[Unhandled error]', err);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  app.listen(PORT, () => {
    console.log(`\n🔥 VitalSync → http://localhost:${PORT}`);
    console.log(`   Food items    : ${foodData.length}`);
    console.log(`   Exercise rows : ${exerciseData.length}`);
    console.log(`   Sprints active: 1–6\n`);
  });
}

startServer().catch(err => { console.error('[Startup]', err); process.exit(1); });
