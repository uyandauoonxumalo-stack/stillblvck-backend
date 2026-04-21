'use strict';
require('dotenv').config();

const http    = require('http');
const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');

const cfg     = require('./config');
const logger  = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');

const db      = require('./services/database');
const ws      = require('./services/wsManager');
const ai      = require('./services/aiLearning');
const risk    = require('./services/riskManager');
const exec    = require('./services/executionService');
const { broadcastStatus, broadcastScan, getClientCount } = require('./services/wsManager');
const { scanAll }      = require('./services/signalEngine');
const { alertSignal }  = require('./services/alertService');
const { getLivePrice } = require('./services/dataPipeline');
const { getSession }   = require('./services/analysis');

const signalsRouter = require('./routes/signals');
const statsRouter   = require('./routes/stats');
const tradesRouter  = require('./routes/trades');
const candlesRouter = require('./routes/candles');

// ── Express app ───────────────────────────────────────────────────
logger.info('Server', 'Starting StillBlvck Elite v3...');

const app = express();
app.set('trust proxy', 1);

app.use(cors({
  origin:      cfg.server.frontendUrl,
  methods:     ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json({ limit:'1mb' }));
app.use(rateLimiter); // Rate limiting before all routes

// ── Routes ────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    ok:          true,
    status:      'running',
    version:     '3.1.0',
    uptime:      Math.round(process.uptime()),
    session:     getSession(),
    marketOpen:  risk.isMarketOpen(),
    dbConnected: db.isConnected(),
    dbSafeMode:  db.isSafeMode(),
    wsClients:   getClientCount(),
    cautionMode: ai.isCautionMode(),
    aiActive:    ai.isAIActive(),
    execution:   exec.getExecutionStatus(),
    memory:      Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    timestamp:   Date.now(),
  });
});

app.get('/api/health', (_req, res) => res.json({ ok:true, ts:Date.now() }));

app.use('/api/signals', signalsRouter);
app.use('/api/stats',   statsRouter);
app.use('/api/trades',  tradesRouter);
app.use('/api/candles', candlesRouter);

// ── 404 + Error handlers (must be last) ───────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── HTTP + WebSocket server ───────────────────────────────────────
const server = http.createServer(app);
ws.init(server);

// ── Boot sequence ─────────────────────────────────────────────────
db.connect().catch(err => logger.error('Boot', 'DB connect failed', err));
exec.startSimMonitor(getLivePrice);

// ── Cron: auto-scan every 5 min Mon–Fri 07–22 UTC ────────────────
let scanning = false;
async function scheduledScan() {
  if (scanning) return;
  scanning = true;
  try {
    logger.info('Cron', 'Scheduled scan starting');
    const result = await scanAll();
    broadcastScan(result);
    for (const sig of result.signals) {
      alertSignal(sig).catch(() => {});
      exec.execute(sig).catch(() => {});
    }
    broadcastStatus({
      session:      result.session,
      marketOpen:   risk.isMarketOpen(),
      pairsScanned: result.pairsScanned,
      signalsFound: result.signals.length,
      dbConnected:  db.isConnected(),
      cautionMode:  ai.isCautionMode(),
      wsClients:    getClientCount(),
    });
    logger.info('Cron', `Scan done: ${result.signals.length} signals | ${result.session}`);
  } catch (err) {
    logger.error('Cron', 'Scan failed', err);
  } finally {
    scanning = false;
  }
}

cron.schedule('*/5 7-22 * * 1-5', scheduledScan);

// Status broadcast every 15 min always
cron.schedule('*/15 * * * *', () => {
  broadcastStatus({
    session:     getSession(),
    marketOpen:  risk.isMarketOpen(),
    dbConnected: db.isConnected(),
    wsClients:   getClientCount(),
    uptime:      Math.round(process.uptime()),
  });
});

// Hourly memory log
cron.schedule('0 * * * *', () => {
  if (global.gc) global.gc();
  logger.info('System', `Hourly | uptime:${Math.round(process.uptime()/3600)}h | mem:${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB | ws:${getClientCount()}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────
function shutdown(sig) {
  logger.info('Server', `${sig} received — shutting down gracefully`);
  server.close(() => { logger.info('Server', 'HTTP closed'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',   err => logger.error('CRITICAL', 'Uncaught exception', err));
process.on('unhandledRejection',  r   => logger.error('CRITICAL', 'Unhandled rejection', r instanceof Error ? r : new Error(String(r))));

// ── Listen ────────────────────────────────────────────────────────
server.listen(cfg.server.port, () => {
  logger.info('Server', `StillBlvck Elite v3.1.0 | port:${cfg.server.port} | mode:${cfg.execution.mode}`);
});

module.exports = { app, server };
