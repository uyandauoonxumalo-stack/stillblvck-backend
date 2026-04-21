'use strict';
// ── StillBlvck Elite — AI Learning Engine ─────────────────────────

const Trade  = require('../models/Trade');
const db     = require('./database');
const cfg    = require('../config');
const logger = require('../utils/logger');

// In-memory state
let lossStreak   = 0;
let winStreak    = 0;
let cautionMode  = false;
let totalTrades  = 0;
const memStats   = { wins:0, losses:0, total:0, open:0 };

function detectSetupType(factors) {
  if (!factors || !factors.length) return 'UNKNOWN';
  const f = factors.join(' ').toUpperCase();
  if (f.includes('CHOCH'))     return 'CHOCH';
  if (f.includes('BOS'))       return 'BOS';
  if (f.includes('FVG'))       return 'FVG';
  if (f.includes('OB'))        return 'OB';
  if (f.includes('LIQ'))       return 'LIQUIDITY';
  return factors.length > 1 ? 'MIXED' : 'UNKNOWN';
}

async function recordSignal(signal) {
  if (!db.isConnected()) {
    memStats.open++;
    memStats.total++;
    logger.warn('AI', 'DB not connected — signal not persisted');
    return null;
  }
  try {
    const trade = await Trade.create({
      pair:        signal.sym,
      label:       signal.lbl || signal.sym,
      direction:   signal.direction,
      entry:       signal.entry,
      sl:          signal.sl,
      tp1:         signal.tp1,
      tp2:         signal.tp2,
      confidence:  signal.confidence,
      confluence:  signal.factors?.length || 0,
      rrRatio:     signal.rr1 || 0,
      plannedRR:   signal.rr1 || 0,
      rawScore:    signal.rawScore || signal.confidence || 0,
      session:     signal.session,
      mtfBias:     signal.mtfBias,
      marketPhase: signal.marketPhase || 'UNKNOWN',
      factors:     signal.factors || [],
      reason:      signal.reason || '',
      setupType:   detectSetupType(signal.factors),
      status:      'OPEN',
      lifecycle:   'OPEN',
      outcome:     'OPEN',
      source:      'ENGINE',
      simulated:   cfg.execution.mode === 'SIMULATION',
    });
    logger.info('AI', `Recorded: ${trade._id} ${signal.sym} ${signal.direction} ${signal.confidence}%`);
    return trade;
  } catch (err) {
    logger.error('AI', 'recordSignal failed', err);
    return null;
  }
}

async function closeTrade(tradeId, closePrice, status, extraNotes) {
  const won = status === 'WIN';
  if (won) { winStreak++; lossStreak = 0; }
  else     { lossStreak++; winStreak = 0; }

  // Loss streak protection — caution mode after 3+ consecutive losses
  cautionMode = lossStreak >= 3;
  if (cautionMode) logger.warn('AI', `CAUTION MODE — ${lossStreak} consecutive losses`);

  if (!db.isConnected()) {
    if (won) memStats.wins++; else memStats.losses++;
    return;
  }
  try {
    const trade = await Trade.findById(tradeId);
    if (!trade) throw new Error(`Trade ${tradeId} not found`);

    const slDist  = Math.abs(trade.entry - trade.sl);
    const pnlPips = closePrice != null
      ? parseFloat((trade.direction==='BUY' ? closePrice-trade.entry : trade.entry-closePrice).toFixed(5))
      : 0;
    const pnlR = slDist > 0 ? parseFloat((pnlPips / slDist).toFixed(2)) : 0;

    const updates = {
      status, outcome:status,
      closePrice, pnlPips, pnlR,
      closedAt:   new Date(),
      lifecycle:  'ANALYZED',
      analyzedAt: new Date(),
      hitSL:  !won && status === 'LOSS',
      hitTP1: won,
    };
    if (extraNotes) updates.notes = extraNotes;

    await Trade.findByIdAndUpdate(tradeId, updates);
    await db.updatePattern(trade.pair, trade.direction, won);

    const date = new Date().toISOString().slice(0, 10);
    await db.updateDayStats(date, won, pnlR);

    totalTrades++;
    logger.info('AI', `Closed: ${tradeId} ${status} pips:${pnlPips.toFixed(4)} R:${pnlR}`);
  } catch (err) {
    logger.error('AI', 'closeTrade failed', err);
  }
}

async function getConfidenceBoost(signal) {
  if (!db.isConnected() || totalTrades < cfg.signals.aiMinTrades) return 0;
  try {
    const boost = await db.getBoost(signal.sym, signal.direction);
    // Overconfidence penalty — diminish boost if already high confidence
    if ((signal.confidence || 0) >= 90 && boost > 5) return Math.floor(boost * 0.3);
    // Caution mode — reduce positive boost
    if (cautionMode && boost > 0) return Math.floor(boost * 0.5);
    return boost;
  } catch { return 0; }
}

function getEffectiveMinConf() {
  const base = cfg.signals.minConfidence;
  return cautionMode ? Math.min(base + 10, 92) : base;
}

async function getAIStats() {
  if (!db.isConnected()) {
    return { ...memStats, winRate:0, cautionMode, lossStreak, winStreak, aiActive:false, source:'memory' };
  }
  try {
    const stats = await Trade.getStats();
    totalTrades = stats.total;
    return { ...stats, cautionMode, lossStreak, winStreak, aiActive: totalTrades >= cfg.signals.aiMinTrades, source:'mongodb' };
  } catch {
    return { cautionMode, lossStreak, winStreak, aiActive:false, source:'error' };
  }
}

async function getRecentTrades(limit = 20) {
  if (!db.isConnected()) return [];
  try { return Trade.find().sort({ openedAt:-1 }).limit(limit).lean(); }
  catch { return []; }
}

module.exports = {
  recordSignal, closeTrade,
  getConfidenceBoost, getEffectiveMinConf,
  getAIStats, getRecentTrades,
  detectSetupType,
  isCautionMode:  () => cautionMode,
  getLossStreak:  () => lossStreak,
  getWinStreak:   () => winStreak,
  isAIActive:     () => totalTrades >= cfg.signals.aiMinTrades,
};
