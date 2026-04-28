'use strict';
// ── StillBlvck Elite — Centralised Config v3 ──────────────────────
// All constants here. No hardcoded values anywhere else.

const config = {
  server: {
    port:        parseInt(process.env.PORT) || 10000,
    nodeEnv:     process.env.NODE_ENV || 'development',
    frontendUrl: process.env.FRONTEND_URL || '*',
  },
  db: {
    uri:                process.env.MONGODB_URI || '',
    serverSelectionMs:  8000,
    socketTimeoutMs:    45000,
    maxPoolSize:        10,
    retryDelayMs:       15000,
    reconnectDelayMs:   10000,
  },
  apis: {
    finnhubKey:              process.env.FINNHUB_API_KEY      || process.env.FINNHUB_KEY || '',
    twelveDataKey:           process.env.TWELVEDATA_API_KEY   || process.env.TWELVE_DATA_KEY || '',
    requestTimeoutMs:        8000,
    retries:                 2,
    retryDelayMs:            600,
    circuitBreakerThreshold: 3,
    circuitBreakerResetMs:   60000,
  },
  signals: {
    minConfidence:       parseInt(process.env.MIN_CONFIDENCE) || 75,
    cooldownMinutes:     parseInt(process.env.SIGNAL_COOLDOWN_MINUTES) || 5,
    cacheMaxAgeMs:       25000,
    aiMinTrades:         10,
  },
  risk: {
    maxOpenTrades:    parseInt(process.env.MAX_OPEN_TRADES)      || 3,
    maxTradesPerDay:  parseInt(process.env.MAX_TRADES_PER_DAY)   || 10,
    dailyDrawdownPct: parseFloat(process.env.DAILY_DRAWDOWN_LIMIT) || 5,
    riskPerTradePct:  parseFloat(process.env.RISK_PER_TRADE)     || 1,
    minRR:            1.5,
  },
  execution: {
    mode: (process.env.EXECUTION_MODE || 'SIMULATION').toUpperCase(),
  },
  alerts: {
    whatsappPhone:  process.env.USER_WHATSAPP_NUMBER   || process.env.WHATSAPP_PHONE    || '',
    callmebotKey:   process.env.CALLMEBOT_KEY          || '',
    twilioSid:      process.env.TWILIO_ACCOUNT_SID     || '',
    twilioToken:    process.env.TWILIO_AUTH_TOKEN      || '',
    twilioFrom:     process.env.TWILIO_WHATSAPP_FROM   || '',
    telegramToken:  process.env.TELEGRAM_BOT_TOKEN     || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID       || '',
    dedupWindowMs:  4 * 60 * 60 * 1000,
  },
  ws: {
    heartbeatMs: 25000,
  },
  rateLimit: {
    windowMs: 60000,
    max:      150,
  },
  cache: {
    candleTTL: 60,
    priceTTL:  10,
  },
  internalApiKey: process.env.INTERNAL_API_KEY || '',
};

module.exports = config;
