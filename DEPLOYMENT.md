# StillBlvck Elite Bot v3 — Deployment Guide
## Complete Step-by-Step

---

## STEP 1 — MongoDB Atlas (Database)

1. Go to **https://cloud.mongodb.com** → Create free account
2. **Build a Database** → M0 Free → any region → Create
3. **Connect** → **Drivers** → copy the connection string
4. Replace `<password>` with your actual password

```
mongodb+srv://user:password@cluster.mongodb.net/stillblvck?retryWrites=true&w=majority
```

5. **Network Access** → Add IP → `0.0.0.0/0` (allow all — required for Render)

---

## STEP 2 — Free API Keys

**Finnhub** (primary market data):
1. https://finnhub.io → Sign up free → Dashboard → API Key

**TwelveData** (fallback):
1. https://twelvedata.com → Sign up free → Account → API Keys

---

## STEP 3 — GitHub Repository

1. Create new repo at **https://github.com** → name: `stillblvck-backend`
2. Upload the `backend/` folder contents (NOT the outer folder)
3. **NEVER commit `.env`** — it's in `.gitignore`

Files to upload:
```
package.json
.env.example
.gitignore
src/
  server.js
  config/index.js
  utils/logger.js
  middleware/ (2 files)
  models/Trade.js
  services/ (9 files)
  routes/ (4 files)
```

---

## STEP 4 — Deploy Backend on Render

1. **https://render.com** → Sign in with GitHub
2. **New +** → **Web Service** → connect `stillblvck-backend`
3. Configure:
   - **Name**: `stillblvck-backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

4. **Environment Variables** → Add each:

| Key | Value |
|-----|-------|
| `PORT` | `10000` |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Your Atlas connection string |
| `FINNHUB_API_KEY` | Your Finnhub key |
| `TWELVEDATA_API_KEY` | Your TwelveData key |
| `USER_WHATSAPP_NUMBER` | `27674752818` |
| `CALLMEBOT_KEY` | Your key (Step 6) |
| `TELEGRAM_BOT_TOKEN` | Optional |
| `TELEGRAM_CHAT_ID` | Optional |
| `MIN_CONFIDENCE` | `75` |
| `MAX_OPEN_TRADES` | `3` |
| `MAX_TRADES_PER_DAY` | `10` |
| `DAILY_DRAWDOWN_LIMIT` | `5` |
| `EXECUTION_MODE` | `SIMULATION` |
| `FRONTEND_URL` | Your Netlify URL (set after Step 5) |

5. **Create Web Service** → wait ~3 minutes

6. **Test**: Open `https://stillblvck-backend.onrender.com/api/status`
   → Should return `{"ok":true,"status":"running",...}`

---

## STEP 5 — Deploy Frontend on Netlify

**Option A — Drag & Drop (Instant):**
1. https://app.netlify.com → Sites
2. Drag `frontend/index.html` (or `STILLBLVCK-frontend-final.html`) onto the page
3. Live in ~20 seconds

**Option B — GitHub:**
1. Create separate repo with just `frontend/`
2. New Site → Import from Git → set publish dir: `/`

---

## STEP 6 — WhatsApp Alerts (FREE)

1. Save **+34 644 31 32 26** in your phone contacts as "CallMeBot"
2. Send WhatsApp to that number: `I allow callmebot to send me messages`
3. You'll receive your API key within 2 minutes
4. Add it to Render env vars as `CALLMEBOT_KEY`

---

## STEP 7 — Connect Frontend to Backend

1. Open your Netlify site
2. Tap **⚙️ Settings** (bottom nav)
3. **Backend URL** → paste your Render URL: `https://stillblvck-backend.onrender.com`
4. **SAVE & RECONNECT**
5. Status dots turn green within 10 seconds

---

## STEP 8 — Keep Backend Alive (Free Tier)

Render free tier sleeps after 15 minutes inactivity.

**UptimeRobot (free)**:
1. https://uptimerobot.com → Create account
2. **New Monitor** → HTTPS
3. URL: `https://stillblvck-backend.onrender.com/api/health`
4. Interval: **5 minutes**

---

## STEP 9 — Test the System

1. Open Netlify site → status dots should be green
2. Press **⚡ GENERATE SIGNAL** → wait 30–60s
3. Signals appear on Dashboard
4. Open **📒 Journal** → trades appear as signals fire
5. Open **📈 Analytics** → charts populate after 5+ closed trades
6. Open **🛡️ Risk** → live daily limits and market status

**Test API directly:**
```
GET /api/status   → system health
GET /api/signals  → trigger scan
GET /api/stats    → full analytics
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Backend URL red | Wait 30s — Render is waking up |
| Signals not showing | Press Generate Signal once to trigger |
| WS dot red | Check Settings → backend URL must start with `https://` |
| Risk blocked trades | Check Risk tab — may have hit daily limit |
| No WhatsApp alerts | Verify `CALLMEBOT_KEY` in Render env vars |
| Charts empty | Need closed trades — use Journal to close signals |

---

## Failure Simulation Results

| Scenario | Frontend behavior |
|----------|------------------|
| Backend offline | Banner shown, button disabled, UI stable |
| API error | Toast notification, retry attempted, no crash |
| Empty trade data | Fallback "—" displayed, no crash |
| WS disconnect | Yellow reconnecting indicator, auto-reconnects |
| Invalid JSON | Caught, error logged, UI continues |

---

*Created at StillBlvck.Agency by Uyanda Nxumalo — Not financial advice*
