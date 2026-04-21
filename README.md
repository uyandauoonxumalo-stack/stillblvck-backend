# StillBlvck Elite Bot — V3 Production System

> Created at **StillBlvck.Agency** by **Uyanda Nxumalo**

---

## System Architecture

```
┌──────────────────────────────────────────────────────┐
│             StillBlvck Elite v3.1.0                  │
├──────────────────┬──────────────────┬────────────────┤
│   Netlify        │   Render          │  MongoDB Atlas │
│   (Frontend)     │   (Backend)       │  (Database)    │
│                  │                   │                │
│  index.html      │  server.js        │  trades        │
│  6 tabs:         │  ├ config/        │  patterns      │
│  • Signal        │  ├ utils/logger   │  dayStats      │
│  • Dashboard     │  ├ middleware/    │                │
│  • Journal       │  ├ services/      │                │
│  • Analytics     │  │  ├ analysis    │                │
│  • Risk          │  │  ├ dataPipeline│                │
│  • Settings      │  │  ├ signalEngine│                │
│                  │  │  ├ aiLearning  │                │
│                  │  │  ├ riskManager │                │
│                  │  │  ├ wsManager   │                │
│                  │  │  └ alertService│                │
│                  │  └ routes/        │                │
└──────────────────┴──────────────────┴────────────────┘
     WebSocket (wss://)    REST API (/api/*)
```

---

## Features

### Signal Engine
- **12 pairs**: XAUUSD, EURUSD, GBPUSD, USDJPY, BTCUSD + 7 more
- **5 timeframes**: 1M, 5M, 15M, 1H, 4H aligned
- **SMC concepts**: BOS, CHoCH, Order Blocks, FVG, Liquidity Sweeps
- **Po3 phases**: Accumulation, Manipulation, Distribution, Expansion
- **Score 0–100** before firing
- **Risk validation** on every signal

### AI Learning
- Activates after 10+ closed trades
- Weighted confidence boost (-15 to +15) from historical patterns
- Caution mode after 3 consecutive losses (raises threshold)
- Overconfidence penalty at 90%+ confidence

### Risk Manager
- Max concurrent open trades
- Daily trade count limit
- Daily drawdown % limit (blocks all trades when hit)
- Min R:R 1.5 required
- Weekend market closed detection

### Trade Journal
- Full CRUD on trades
- Filter by: status, pair, setupType, session, direction
- Pagination (15 per page)
- Close trades with WIN/LOSS/BE
- Notes, emotion, grade fields

### Analytics
- Win rate, total R, profit factor
- Streak tracking
- Best/worst pair, session, setup
- 4 Chart.js charts (pie, direction, weekly PnL, pair bar)
- Per-pair win rate breakdown

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | System health |
| GET | `/api/health` | Uptime ping |
| GET | `/api/signals` | Scan + return signals |
| POST | `/api/signals/scan` | Force fresh scan |
| GET | `/api/signals/:pair` | Single pair signal |
| GET | `/api/stats` | Full stats + analytics |
| GET | `/api/stats/analytics` | Deep analytics |
| GET | `/api/stats/risk` | Risk dashboard |
| GET | `/api/trades` | Trade list |
| POST | `/api/trades` | Create trade |
| PATCH | `/api/trades/:id` | Update journal |
| PATCH | `/api/trades/:id/close` | Close trade |
| DELETE | `/api/trades/:id` | Cancel trade |
| GET | `/api/candles` | OHLCV candles |

**WebSocket**: `wss://your-backend.onrender.com/ws`

---

## File Structure

```
backend/src/
  config/index.js         ← All environment constants
  utils/logger.js         ← Structured JSON logging
  middleware/
    errorHandler.js       ← Global error handler + asyncWrap
    rateLimiter.js        ← Per-IP rate limiting
  models/Trade.js         ← MongoDB schema + analytics
  services/
    database.js           ← MongoDB connection + AI patterns
    dataPipeline.js       ← Finnhub → TwelveData → synthetic
    analysis.js           ← EMA, RSI, ATR, BOS, CHoCH, FVG, Po3
    signalEngine.js       ← Scores 12 pairs, risk validates
    aiLearning.js         ← Confidence boost, caution mode
    riskManager.js        ← Daily limits, drawdown, duplicate
    executionService.js   ← SIMULATION mode (safe)
    wsManager.js          ← WebSocket + heartbeat
    alertService.js       ← WhatsApp + Telegram + dedup
  routes/
    signals.js            ← /api/signals
    stats.js              ← /api/stats
    trades.js             ← /api/trades
    candles.js            ← /api/candles
  server.js               ← Entry point
```

---

*Not financial advice — educational and personal research only*
