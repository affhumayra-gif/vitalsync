# VitalSync

**Personal health & wellness tracking web application**

Track nutrition, exercise, sleep, stress, goals, and get AI-powered health coaching — all in one place.

---

## Tech Stack

### Overview

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 18+ LTS |
| Web Framework | Express.js | 4.19.x |
| Database | Google Cloud Firestore | — (serverless) |
| Authentication | Firebase Authentication | SDK 10.x |
| Admin SDK | Firebase Admin SDK | 12.x |
| AI Coach | Open Router | free tier |
| Frontend | HTML5 · CSS3 · Vanilla JS | ES2022 Modules |
| Charts | Chart.js | 4.4.x (CDN) |
| PDF Export | pdfkit | 0.15.x |
| Email | Nodemailer | 6.9.x |
| CSV Parsing | csv-parser | 3.0.x |
| Dev Server | nodemon | 3.1.x |

---

### 1. Runtime — Node.js 18+

Node.js is the JavaScript runtime that powers the entire backend server. Version 18 or higher is required because VitalSync uses the native `fetch` API (introduced in Node 18) for calling the Gemini AI API without any additional HTTP library.

- **Why Node.js:** Non-blocking I/O is ideal for the many parallel Firestore queries that the dashboard and weekly summary endpoints make simultaneously using `Promise.all()`.
- **Minimum version:** 18.0.0 (for native `fetch` and modern ES module support)
- **Entry point:** `server.js`

---

### 2. Web Framework — Express.js 4.19

Express is the HTTP server framework that handles all routing, middleware, and API responses.

```
npm package: express ^4.19.2
```

**How it's used in VitalSync:**

| Component | Role |
|---|---|
| `express()` | Creates the main application instance |
| `express.json()` | Parses incoming JSON request bodies |
| `express.static()` | Serves the entire `public/` folder (HTML, CSS, JS, assets) |
| `app.use('/api/...')` | Mounts each feature route as a sub-router |
| Error handler middleware | Catches unhandled errors and returns structured JSON |

**Route modules mounted in `server.js`:**

| Route prefix | File | Handles |
|---|---|---|
| `/api/auth` | `routes/auth.js` | Register, login, profile CRUD |
| `/api/meals` | `routes/meals.js` | Food search, meal CRUD, daily goal |
| `/api/exercise` | `routes/exercise.js` | Activity search, sessions, steps |
| `/api/dashboard` | `routes/dashboard.js` | Daily summary, calorie deficit, health tip |
| `/api/sleep` | `routes/sleep.js` | Sleep session CRUD |
| `/api/stress` | `routes/stress.js` | Stress readings CRUD |
| `/api/goals` | `routes/goals.js` | Goal CRUD, auto-completion engine |
| `/api/weekly` | `routes/weekly.js` | 7-day aggregated analytics |
| `/api/leaderboard` | `routes/leaderboard.js` | Opt-in weekly rankings |
| `/api/notifications` | `routes/notifications.js` | Preferences, email digest |
| `/api/ai` | `routes/ai.js` | Gemini health coach, Q&A |
| `/api/pdf` | `routes/pdf.js` | Weekly PDF export |
| `/api/reports` | `routes/reports.js` | 6 detailed report data endpoints |

**SPA fallback:** Any non-`/api` route serves `public/index.html`, enabling client-side navigation without 404 errors.

---

### 3. Database — Google Cloud Firestore

Firestore is a serverless, scalable NoSQL document database provided by Google Firebase. All user health data is stored here.

```
npm package: firebase-admin ^12.1.0  (server-side access)
CDN: firebase SDK 10.x               (client-side access)
```

**Why Firestore:**
- No server to manage — scales automatically
- Real-time capable (used for future features)
- Free Spark plan is generous for personal projects
- Per-user data isolation via collection structure

**Firestore data structure:**

```
users/
  {uid}/                          ← One document per user
    displayName, email, weightKg, bmr,
    dailyCalorieGoal, leaderboardOptIn,
    emailDigest, browserNotifications

    meals/          {mealId}      ← Individual meal entries
    exercise/       {sessionId}   ← Exercise sessions
    steps/          {YYYY-MM-DD}  ← One doc per day (upserted)
    sleep/          {sessionId}   ← Sleep sessions
    stress/         {readingId}   ← Stress readings
    goals/          {goalId}      ← Active/inactive goals
    goalCompletions/{YYYY-MM-DD}  ← Daily goal completion map
    bodyMetrics/    {metricId}    ← Weight and BMR history
```

**Key query patterns:**
- `where('date', '>=', startDate).where('date', '<=', endDate)` — 7-day range queries
- `Promise.all([...])` — all sub-collection queries run in parallel
- `.set({ field: value }, { merge: true })` — upsert without overwriting other fields

**Firestore Security Rules** must restrict each user to their own documents:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

### 4. Authentication — Firebase Authentication

Firebase Authentication manages all user identity. Passwords are never stored in the application — Firebase handles hashing, session tokens, and OAuth flows.

```
Server: firebase-admin ^12.1.0  (token verification)
Client: firebase SDK 10.x       (loaded from CDN)
```

**Supported sign-in methods:**
- Email and password
- Google OAuth 2.0 (one-click sign-in)

**How the auth flow works:**

```
Browser                    Express Server             Firebase
  │                              │                        │
  ├─── signInWithEmailAndPassword ──────────────────────► │
  │◄── Firebase ID Token (JWT) ─────────────────────────  │
  │                              │                        │
  ├─── POST /api/meals ──────────►                        │
  │    Authorization: Bearer <token>                      │
  │                              ├─ auth.verifyIdToken() ─►
  │                              │◄─ decoded user (uid) ──
  │                              │                        │
  │◄── 200 OK ───────────────────┤                        │
```

**`middleware/auth.js`** — runs on every protected route:
```javascript
const decoded = await auth.verifyIdToken(token);
req.user = decoded;  // { uid, email, name, ... }
next();
```

**Token lifecycle:** Firebase ID tokens expire after 1 hour. The Firebase Client SDK automatically refreshes them using a refresh token stored in the browser — no manual handling needed.

**`firebase/admin.js`** — initialises the Admin SDK once at server startup:
```javascript
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  })
});
```

---

### 5. Frontend — HTML5, CSS3, Vanilla JavaScript (ES Modules)

VitalSync's frontend is a **Single-Page Application (SPA)** built with plain HTML, CSS, and JavaScript — no framework like React or Vue. This was a deliberate choice to keep the project lightweight and avoid build tooling.

**Why no framework:** All pages are static HTML files served by Express. JavaScript runs as ES Modules (`type="module"`) directly in the browser. No bundler (Webpack/Vite) is needed.

#### HTML5
- 15 HTML pages in `public/`
- Semantic elements: `<nav>`, `<header>`, `<main>`, `<section>`
- All pages import shared JS modules using `<script type="module">`

#### CSS3 (`public/css/styles.css`)

The design system uses CSS custom properties (variables) for a consistent dark copper/amber theme:

```css
:root {
  /* Colour palette */
  --copper:        #D4803A;   /* Primary brand copper */
  --copper-light:  #F0A060;   /* Hover/accent */
  --copper-pale:   #FFF4E8;   /* High-emphasis text */
  --copper-glow:   rgba(212,128,58,0.12);  /* Subtle fill */
  --copper-glow-md:rgba(212,128,58,0.20);  /* Active state */

  /* Backgrounds */
  --glass: rgba(15,9,4,0.72); /* Glass card background */

  /* Text */
  --text:           #EDE0D0;  /* Primary text */
  --text-secondary: #C8A880;  /* Secondary text */

  /* Borders */
  --border:         rgba(255,200,150,0.12);
  --border-hover:   rgba(255,200,150,0.30);

  /* Semantic */
  --danger:         #F06060;
  --success:        #52C990;

  /* Border radii */
  --radius-sm:  8px;
  --radius-md: 12px;
  --radius-lg: 16px;
}
```

Key CSS techniques used:
- `backdrop-filter: blur(24px)` — glass morphism cards
- CSS Grid and Flexbox — all layouts
- `@keyframes` — alert banner entrance animations, spinner
- CSS custom properties — theme-wide consistency
- `@media` queries — responsive at 700px and 600px breakpoints

**Typography (Google Fonts CDN):**

| Font | Use |
|---|---|
| Cinzel | Brand name and logo text |
| Outfit | Page titles, metric numbers, chart values |
| DM Sans | All body text, navigation, buttons, forms |

#### JavaScript (ES2022 Modules)

All client JS uses native ES Modules (`import`/`export`). No bundler or transpiler.

**`public/js/firebase-config.js`** — initialises Firebase on the client:
- Fetches config from `GET /api/firebase-config` (keeps API keys off the HTML)
- Calls `initializeApp()` and exports `auth` and `db` instances

**`public/js/api.js`** — shared utilities imported by every page:

| Export | Purpose |
|---|---|
| `guardAuth()` | Checks `onAuthStateChanged`, redirects to login if no user |
| `initNav(activePath)` | Sets username in nav, wires logout button |
| `apiFetch(url, options)` | Wraps `fetch` — attaches Bearer token automatically |
| `toast(message, type)` | Shows dismissible toast notification (success/error/info/warning) |

**`public/js/notifications.js`** — browser notification system:
- `requestNotificationPermission()` — requests browser permission
- `startReminders()` / `stopReminders()` — sets `setInterval` for hydration (60 min) and movement (90 min) reminders
- `buildAlerts(data)` — generates smart alert objects from dashboard summary data
- `renderAlerts(container, alerts)` — renders dismissible alert banners into DOM

---

### 6. Charts — Chart.js 4.4 (CDN)

Chart.js renders all data visualisations. Loaded from CDN (`cdn.jsdelivr.net`), not installed via npm.

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

**Charts used across VitalSync:**

| Page | Chart type | Data |
|---|---|---|
| Stress tracker | Line | Last 20 stress readings with colour-coded points |
| Weekly summary | Bar | Daily sleep hours (green = ≥7hrs, red = under) |
| Weekly summary | Line | Daily stress average |
| Weekly summary | Bar | Daily exercise calories burned |
| Weekly summary | Line | Daily calories eaten |
| Sleep report | Bar | Daily sleep hours (all time) |
| Stress report | Line | Last 30 readings trend |
| Stress report | Bar | Average stress by hour of day |
| Stress report | Bar | Average stress by weekday |
| Exercise report | Bar | Daily calories burned |
| Meals report | Line | Daily calorie intake trend |
| Goals report | Bar | Daily completion rate % |

All charts use the same dark theme config — white/amber tick labels, transparent grid lines — to match the application's colour palette.

---

### 7. AI Coach — Google Gemini 2.0 Flash

The AI health coach uses Google's Gemini 2.0 Flash model via the Generative Language REST API. **No npm package is used** — calls are made with the native `fetch` API built into Node.js 18+.

```
API endpoint: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
Auth: ?key=GOOGLE_AI_KEY (query parameter)
Cost: Free tier — 15 requests/minute, 1,000,000 tokens/day
```

**How the AI coach works (`routes/ai.js`):**

1. `POST /api/ai/coach` — on request, fetches 7 days of data from 7 Firestore sub-collections in parallel via `Promise.all()`
2. Aggregates: total/average sleep, average/peak stress, exercise days and calories, nutrition totals, step counts, goal completion rate
3. Builds a structured prompt with `## section` headers, instructing Gemini to produce one insight per health category plus top 3 priorities
4. Sends the prompt to Gemini and returns the raw text response
5. Client parses `## Heading` lines into styled section headings

**`POST /api/ai/ask`** — free-form Q&A:
- User types any health question (max 500 chars)
- Prompt wraps the question with a "health coach" system context
- Gemini responds in 3–5 sentences with a medical disclaimer note

---

### 8. CSV Data Processing — csv-parser 3.0

Two CSV datasets are loaded into server memory at startup. All food and exercise searches run against these in-memory arrays — no database round-trip needed, making searches respond in under 100ms.

```
npm package: csv-parser ^3.0.0
```

**Food dataset (FOOD-DATA-GROUP1–5.csv):**
- 5 CSV files merged at startup
- Deduplicated by lowercase food name → **2,395 unique items**
- Fields: `food`, `Caloric Value`, `Fat`, `Protein`, `Carbohydrates`, `Sugars`, `Dietary Fiber`, `Sodium`, `Cholesterol`, 12 vitamins, 9 minerals, `Nutrition Density`
- All values are **per 100g**
- Calorie formula: `(caloriesPer100g / 100) × amountInGrams`

**Exercise dataset (exercises.csv):**
- **248 unique activities**
- Key column: `Activity, Exercise or Sport (1 hour)` (name) and `Calories per kg`
- Burn formula: `cal_per_kg × userWeightKg × (durationMinutes / 60)`

**Search algorithm (`GET /api/meals/food/search?q=`):**
1. Starts-with matches ranked first (e.g. "chi" → "chicken" before "zucchini")
2. Contains matches ranked second
3. Returns top 8 results

---

### 9. PDF Generation — pdfkit 0.15

pdfkit generates the weekly health summary PDF entirely server-side and streams it directly to the browser as a file download. No temporary files are written to disk.

```
npm package: pdfkit ^0.15.0
```

**`GET /api/pdf/weekly`** — how the PDF is built:
1. Sets response headers: `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="VitalSync_Weekly_...pdf"`
2. Pipes the pdfkit `PDFDocument` stream directly into `res` (the Express response object)
3. Draws a navy header block, then section tables for Sleep, Stress, Exercise, Nutrition, and Goals
4. Renders a 7-row daily snapshot table with per-day: sleep hours, average stress, steps, and calories eaten
5. Adds a branded footer on every page

The PDF uses only embedded standard fonts (Helvetica, Helvetica-Bold) to avoid font-embedding complexity.

---

### 10. Email — Nodemailer 6.9 + SMTP

Nodemailer sends the weekly HTML health digest email. It works with any standard SMTP provider.

```
npm package: nodemailer ^6.9.14
```

**`POST /api/notifications/digest`:**
- Aggregates the same 7-day data as the PDF export
- Builds a styled HTML email with an inline CSS dark theme matching the app
- Sends via the configured SMTP transporter
- **Graceful degradation:** if `SMTP_HOST` is not set in `.env`, the server logs a warning at startup and the digest endpoint returns a 503 with a helpful error message — the rest of the app continues working normally

**Recommended SMTP provider:** Gmail with an App Password (free, no extra service needed).

---

### 11. Development Tooling

#### nodemon 3.1 (dev dependency)
Watches all `.js` files and automatically restarts the server on save. Used via `npm run dev`.

```
npm package: nodemon ^3.1.3  (devDependency)
```

#### dotenv 16.4
Loads environment variables from `.env` into `process.env` at server startup. The `.env` file is excluded from Git via `.gitignore`.

```
npm package: dotenv ^16.4.5
```

#### cors 2.8
Allows the browser to make cross-origin requests to the API during local development. In production this is not strictly necessary since the frontend and backend share the same Railway domain.

```
npm package: cors ^2.8.5
```

---

### 12. Deployment — Railway

The recommended deployment platform for VitalSync is Railway.app.

| Component | Details |
|---|---|
| Platform | Railway.app (Node.js auto-detection) |
| Start command | `npm start` (runs `node server.js`) |
| Free tier | $5 credit/month — sufficient for personal use |
| URL | Free `.railway.app` subdomain, or custom domain |
| HTTPS | Auto-provisioned SSL certificate |
| Environment | All `.env` variables set in Railway dashboard |
| Firestore/Auth | Already cloud-hosted by Google — no migration needed |

---

### 13. External Services Summary

| Service | Provider | Free tier | Purpose |
|---|---|---|---|
| Firestore | Google Firebase | 1 GB storage, 50K reads/day | All health data storage |
| Authentication | Google Firebase | Unlimited users | User login and token management |
| Gemini 2.0 Flash | Google AI Studio | 15 RPM, 1M tokens/day | AI health coach and Q&A |
| Google Fonts | Google CDN | Free | Cinzel, Outfit, DM Sans typefaces |
| Font Awesome | cdnjs CDN | Free | Icons throughout the UI |
| Chart.js | jsDelivr CDN | Free | All charts and data visualisations |
| Railway | Railway.app | $5 credit/month | Server hosting and deployment |
| SMTP | Gmail (or any) | Free (App Password) | Weekly email digest |

---

### Full `package.json` Dependencies

```json
{
  "dependencies": {
    "cors":           "^2.8.5",
    "csv-parser":     "^3.0.0",
    "dotenv":         "^16.4.5",
    "express":        "^4.19.2",
    "firebase-admin": "^12.1.0",
    "nodemailer":     "^6.9.14",
    "pdfkit":         "^0.15.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.3"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## Local Setup

### 1. Prerequisites

- Node.js 18+ → https://nodejs.org
- A Firebase project (free) → https://console.firebase.google.com
- A Google AI Studio key (free) → https://aistudio.google.com

### 2. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/vitalsync.git
cd vitalsync
npm install
```

### 3. Firebase setup

1. Go to [Firebase Console](https://console.firebase.google.com) → Create a project
2. **Authentication** → Sign-in method → Enable **Email/Password** and **Google**
3. **Firestore Database** → Create database → Start in production mode → choose a region
4. **Project Settings** → Service Accounts → **Generate new private key** → save the JSON
5. **Project Settings** → Your apps → Add web app → copy the config

### 4. Environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:
- Firebase Admin credentials (from the service account JSON)
- Firebase client credentials (from the web app config)
- `GOOGLE_AI_KEY` from Google AI Studio
- SMTP credentials (optional — for email digest)

### 5. Add your datasets

Place these files in the `data/` folder:
```
data/
  FOOD-DATA-GROUP1.csv
  FOOD-DATA-GROUP2.csv
  FOOD-DATA-GROUP3.csv
  FOOD-DATA-GROUP4.csv
  FOOD-DATA-GROUP5.csv
  exercises.csv
```

### 6. Run

```bash
npm run dev      # Development (auto-restarts on file change)
npm start        # Production
```

Open **http://localhost:3000**

---

## Project Structure

```
vitalsync/
├── server.js                  Main Express server + CSV loader
├── firebase/
│   └── admin.js               Firebase Admin SDK init
├── middleware/
│   └── auth.js                requireAuth middleware (token verification)
├── routes/
│   ├── auth.js                Registration, login, profile CRUD
│   ├── meals.js               Food search + meal CRUD
│   ├── exercise.js            Exercise search + sessions + steps
│   ├── dashboard.js           Daily summary + health tip
│   ├── sleep.js               Sleep session CRUD
│   ├── stress.js              Stress readings CRUD
│   ├── goals.js               Goals + auto-completion engine
│   ├── weekly.js              7-day aggregated summary
│   ├── leaderboard.js         Opt-in rankings
│   ├── notifications.js       Browser prefs + email digest
│   ├── ai.js                  Gemini health coach + Q&A
│   ├── pdf.js                 Weekly summary PDF export
│   └── reports.js             6 report data endpoints
├── data/                      CSV datasets (not in Git)
├── public/
│   ├── index.html             Login page
│   ├── register.html          Register page
│   ├── dashboard.html         Main dashboard
│   ├── meals.html             Meal tracker
│   ├── exercise.html          Exercise tracker
│   ├── sleep.html             Sleep tracker
│   ├── stress.html            Stress tracker
│   ├── goals.html             Goals page
│   ├── weekly.html            Weekly summary
│   ├── leaderboard.html       Leaderboard + settings
│   ├── compare.html           Compare with other users
│   ├── profile.html           Profile & body metrics
│   ├── ai.html                AI Health Coach
│   ├── reports/
│   │   ├── weight.html
│   │   ├── sleep.html
│   │   ├── stress.html
│   │   ├── exercise.html
│   │   ├── meals.html
│   │   └── goals.html
│   ├── css/
│   │   └── styles.css         Design system + CSS variables
│   └── js/
│       ├── api.js             apiFetch, guardAuth, initNav, toast
│       ├── firebase-config.js Firebase client init
│       ├── meals.js
│       ├── exercise.js
│       ├── sleep.js
│       ├── stress.js
│       ├── goals.js
│       ├── weekly.js
│       ├── leaderboard.js
│       └── notifications.js   Browser notifications + smart alerts
└── .env.example
```

---

## Deploying to Railway (Free)

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/vitalsync.git
git push -u origin main
```

### Step 2 — Deploy

1. Go to **https://railway.app** → Login with GitHub
2. **New Project** → **Deploy from GitHub repo** → select `vitalsync`
3. Railway auto-detects Node.js and runs `npm start`

### Step 3 — Environment variables

In Railway → your service → **Variables** → paste your `.env` contents.

### Step 4 — Get your URL

**Settings** → **Domains** → **Generate Domain** → your app is live.

### Step 5 — Authorise domain in Firebase

Firebase Console → **Authentication** → **Settings** → **Authorised domains** → add your Railway URL. Required for Google Sign-In to work on the live URL.

---

## Firestore Indexes

Firebase auto-prompts index creation on first query. Click the console link in your server logs — indexes build in ~30 seconds. Common ones needed:

- `sleep` collection: `date` ascending
- `exercise` collection: `date` ascending
- `meals` collection: `date` ascending
- `stress` collection: `recordedAt` descending

---

## Gmail SMTP Setup

1. Enable 2-Step Verification on your Google account
2. **Google Account** → **Security** → **App Passwords** → create one named "VitalSync"
3. Use the 16-character App Password as `SMTP_PASS` in `.env`

---
