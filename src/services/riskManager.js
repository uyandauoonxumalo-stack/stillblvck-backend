'use strict';
// ── StillBlvck Elite — Risk Manager ───────────────────────────────

const Trade  = require('../models/Trade');
const db     = require('./database');
const cfg    = require('../config');
const logger = require('../utils/logger');
const { isMarketOpen } = require('./analysis');

// Daily counters reset at midnight
let daily = { date:'', trades:0, pnlR:0, drawdown:0 };

function getTodayStr() { return new Date().toISOString().slice(0,10); }
function ensureReset() {
  const today = getTodayStr();
  if (daily.date !== today) daily = { date:today, trades:0, pnlR:0, drawdown:0 };
}

async function validateTrade(signal) {
  ensureReset();

  // Market closed
  if (!isMarketOpen()) return { ok:false, reason:'Market closed (weekend)' };

  // Min R:R
  const rr = signal.rr1 || signal.rrRatio || 0;
  if (rr < cfg.risk.minRR && signal.sym !== 'BTCUSD') {
    return { ok:false, reason:`R:R ${rr.toFixed(2)} below minimum ${cfg.risk.minRR}` };
  }

  // Daily trade limit
  if (daily.trades >= cfg.risk.maxTradesPerDay) {
    return { ok:false, reason:`Daily trade limit reached (${cfg.risk.maxTradesPerDay})` };
  }

  // Daily drawdown
  if (daily.drawdown <= -cfg.risk.dailyDrawdownPct) {
    return { ok:false, reason:`Daily drawdown limit hit (${daily.drawdown.toFixed(2)}%)` };
  }

  if (db.isConnected()) {
    // Max concurrent open trades
    const openCount = await Trade.countDocuments({ status:'OPEN' });
    if (openCount >= cfg.risk.maxOpenTrades) {
      return { ok:false, reason:`Max open trades reached (${openCount}/${cfg.risk.maxOpenTrades})` };
    }

    // Duplicate prevention
    const cooldownMs = cfg.signals.cooldownMinutes * 60 * 1000;
    const recent = await Trade.findOne({
      pair:      signal.sym,
      direction: signal.direction,
      status:    'OPEN',
      openedAt:  { $gte:new Date(Date.now() - cooldownMs) },
    });
    if (recent) return { ok:false, reason:`Duplicate: ${signal.sym} ${signal.direction} already open` };
  }

  return { ok:true };
}

function calculatePositionSize(accountBalance, riskPct, slPips, pipValue = 10) {
  if (!accountBalance || !riskPct || !slPips || slPips <= 0) return 0;
  const riskAmt = accountBalance * (riskPct / 100);
  const lots    = riskAmt / (slPips * pipValue);
  return parseFloat(Math.min(lots, 10).toFixed(2));
}

function recordOutcome(pnlR) {
  ensureReset();
  daily.trades++;
  daily.pnlR += pnlR;
  if (pnlR < 0) daily.drawdown = parseFloat((daily.drawdown + pnlR).toFixed(2));
  logger.info('Risk', `Daily: trades=${daily.trades} pnlR=${daily.pnlR.toFixed(2)} drawdown=${daily.drawdown}%`);
}

async function getRiskStatus() {
  ensureReset();
  let openCount = 0;
  if (db.isConnected()) {
    try { openCount = await Trade.countDocuments({ status:'OPEN' }); } catch {}
  }
  return {
    dailyTrades:    daily.trades,
    maxDailyTrades: cfg.risk.maxTradesPerDay,
    dailyDrawdown:  daily.drawdown,
    drawdownLimit:  -cfg.risk.dailyDrawdownPct,
    openTrades:     openCount,
    maxOpenTrades:  cfg.risk.maxOpenTrades,
    riskPerTrade:   cfg.risk.riskPerTradePct,
    marketOpen:     isMarketOpen(),
    execMode:       cfg.execution.mode,
    date:           daily.date,
  };
}

module.exports = {
  validateTrade, calculatePositionSize, recordOutcome, getRiskStatus,
  isMarketOpen,
};
