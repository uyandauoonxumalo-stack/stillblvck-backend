'use strict';
// ── StillBlvck Elite — Database Service ───────────────────────────

const mongoose = require('mongoose');
const cfg      = require('../config');
const logger   = require('../utils/logger');

let _connected  = false;
let _retryTimer = null;
let _safeMode   = false;

async function connect() {
  const uri = cfg.db.uri;
  if (!uri) {
    logger.warn('DB', 'No MONGODB_URI set — safe mode (no persistence)');
    _safeMode = true;
    return;
  }
  if (_connected) return;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: cfg.db.serverSelectionMs,
      socketTimeoutMS:          cfg.db.socketTimeoutMs,
      maxPoolSize:              cfg.db.maxPoolSize,
    });
    _connected = true;
    _safeMode  = false;
    logger.info('DB', 'Connected to MongoDB Atlas');
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  } catch (err) {
    logger.error('DB', 'Connection failed', err);
    _safeMode = true;
    _scheduleRetry();
  }
}

function _scheduleRetry() {
  if (!_retryTimer) {
    _retryTimer = setTimeout(() => { _retryTimer = null; connect(); }, cfg.db.retryDelayMs);
  }
}

mongoose.connection.on('disconnected', () => {
  _connected = false;
  logger.warn('DB', 'Disconnected — scheduling retry');
  _scheduleRetry();
});
mongoose.connection.on('reconnected', () => {
  _connected = true;
  _safeMode  = false;
  logger.info('DB', 'Reconnected');
});
mongoose.connection.on('error', err => logger.error('DB', 'Mongoose error', err));

// ── AI Pattern schema ─────────────────────────────────────────────
const PatternSchema = new mongoose.Schema({
  key:         { type:String, unique:true, required:true, index:true },
  wins:        { type:Number, default:0 },
  losses:      { type:Number, default:0 },
  total:       { type:Number, default:0 },
  winRate:     { type:Number, default:0.5 },
  boost:       { type:Number, default:0 },
  decayFactor: { type:Number, default:1.0 },
  lastUpdated: { type:Date,   default:Date.now },
});
const Pattern = mongoose.models.Pattern || mongoose.model('Pattern', PatternSchema);

// ── Day Stats schema ──────────────────────────────────────────────
const DayStatsSchema = new mongoose.Schema({
  date:     { type:String, unique:true, required:true, index:true },
  trades:   { type:Number, default:0 },
  wins:     { type:Number, default:0 },
  losses:   { type:Number, default:0 },
  pnlR:     { type:Number, default:0 },
  drawdown: { type:Number, default:0 },
});
const DayStats = mongoose.models.DayStats || mongoose.model('DayStats', DayStatsSchema);

async function updatePattern(pair, direction, won) {
  if (!_connected) return;
  const keys = [`${pair}_${direction}`, `${pair}_ALL`, `ALL_${direction}`];
  for (const key of keys) {
    try {
      const p = await Pattern.findOneAndUpdate(
        { key },
        { $inc:{ total:1, wins:won?1:0, losses:won?0:1 }, $set:{ lastUpdated:new Date() } },
        { upsert:true, new:true }
      );
      // Weighted win rate with decay
      const wr    = p.total > 0 ? p.wins / p.total : 0.5;
      const boost = parseFloat(Math.max(-15, Math.min(15, (wr - 0.5) * 30)).toFixed(1));
      await Pattern.updateOne({ key }, { $set:{ winRate:parseFloat(wr.toFixed(3)), boost } });
    } catch (err) { logger.warn('DB', `updatePattern ${key}`, err); }
  }
}

async function getBoost(pair, direction) {
  if (!_connected) return 0;
  try {
    const p = await Pattern.findOne({ key:`${pair}_${direction}` });
    return p?.boost || 0;
  } catch { return 0; }
}

async function updateDayStats(dateStr, won, pnlR) {
  if (!_connected) return;
  try {
    await DayStats.findOneAndUpdate(
      { date:dateStr },
      { $inc:{ trades:1, wins:won?1:0, losses:won?0:1, pnlR:pnlR||0 } },
      { upsert:true }
    );
  } catch (err) { logger.warn('DB', 'updateDayStats', err); }
}

async function getDayStats(dateStr) {
  if (!_connected) return null;
  try { return DayStats.findOne({ date:dateStr }).lean(); }
  catch { return null; }
}

module.exports = {
  connect,
  isConnected: () => _connected,
  isSafeMode:  () => _safeMode,
  updatePattern, getBoost,
  updateDayStats, getDayStats,
};
