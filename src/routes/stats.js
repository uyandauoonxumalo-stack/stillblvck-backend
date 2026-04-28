'use strict';
const express    = require('express');
const router     = express.Router();
const { asyncWrap } = require('../middleware/errorHandler');
const Trade      = require('../models/Trade');
const ai         = require('../services/aiLearning');
const risk       = require('../services/riskManager');
const exec       = require('../services/executionService');
const db         = require('../services/database');
const ws         = require('../services/wsManager');
const dp         = require('../services/dataPipeline');
const { getSession } = require('../services/analysis');

// GET /api/stats
router.get('/', asyncWrap(async (req, res) => {
  const [aiStats, recentTrades, analytics, riskStatus] = await Promise.all([
    ai.getAIStats(),
    ai.getRecentTrades(10),
    db.isConnected() ? Trade.getAnalytics().catch(() => null) : Promise.resolve(null),
    risk.getRiskStatus(),
  ]);
  res.json({
    ok:true, stats:aiStats, analytics, recentTrades, riskStatus,
    execution:  exec.getExecutionStatus(),
    providers:  dp.getProviderStatus(),
    system: {
      dbConnected:  db.isConnected(),
      dbSafeMode:   db.isSafeMode(),
      wsClients:    ws.getClientCount(),
      session:      getSession(),
      marketOpen:   risk.isMarketOpen(),
      cautionMode:  ai.isCautionMode(),
      aiActive:     ai.isAIActive(),
      uptime:       Math.round(process.uptime()),
      memory:       Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      nodeVersion:  process.version,
    },
    timestamp: Date.now(),
  });
}));

// GET /api/stats/analytics
router.get('/analytics', asyncWrap(async (req, res) => {
  if (!db.isConnected()) return res.json({ ok:true, analytics:null, reason:'DB not connected' });
  const analytics = await Trade.getAnalytics();
  res.json({ ok:true, analytics });
}));

// GET /api/stats/by-pair
router.get('/by-pair', asyncWrap(async (req, res) => {
  if (!db.isConnected()) return res.json({ ok:true, pairs:[] });
  const a = await Trade.getAnalytics();
  res.json({ ok:true, pairs: a?.pairStats || [] });
}));

// GET /api/stats/risk
router.get('/risk', asyncWrap(async (req, res) => {
  const riskStatus = await risk.getRiskStatus();
  res.json({ ok:true, riskStatus });
}));

module.exports = router;
