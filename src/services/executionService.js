'use strict';
// ── StillBlvck Elite — Execution Service ──────────────────────────
// SIMULATION mode by default — no real broker connection

const Trade  = require('../models/Trade');
const ai     = require('./aiLearning');
const cfg    = require('../config');
const logger = require('../utils/logger');

const MODES   = { SIMULATION:'SIMULATION', MANUAL:'MANUAL', AUTO:'AUTO' };
const mode    = () => cfg.execution.mode;
const simFills= new Map();
const pending = new Map(); // Manual confirmations

async function execute(signal) {
  switch (mode()) {
    case MODES.SIMULATION: return _simulateFill(signal);
    case MODES.MANUAL:     return _queueManual(signal);
    case MODES.AUTO:
      logger.warn('Execution', 'AUTO mode disabled for safety — falling back to SIMULATION');
      return _simulateFill(signal);
    default:
      return _simulateFill(signal);
  }
}

async function _simulateFill(signal) {
  try {
    const trade = await ai.recordSignal({ ...signal, simulated:true });
    if (!trade) return { ok:false, reason:'Failed to persist trade' };
    simFills.set(trade._id.toString(), {
      tradeId:   trade._id.toString(),
      sym:       signal.sym,
      direction: signal.direction,
      entry:     signal.entry,
      sl:        signal.sl,
      tp1:       signal.tp1,
      filledAt:  Date.now(),
      mode:      'SIMULATION',
    });
    logger.info('Execution', `[SIM] Filled ${signal.sym} ${signal.direction} @ ${signal.entry}`);
    return { ok:true, trade, mode:'SIMULATION' };
  } catch (err) {
    logger.error('Execution', 'simulateFill failed', err);
    return { ok:false, reason:err.message };
  }
}

function _queueManual(signal) {
  const id = `manual_${Date.now()}_${signal.sym}`;
  pending.set(id, { ...signal, queuedAt:Date.now() });
  logger.info('Execution', `[MANUAL] Queued ${id}`);
  return Promise.resolve({ ok:true, mode:'MANUAL', confirmationId:id });
}

async function confirmManual(confirmationId) {
  const signal = pending.get(confirmationId);
  if (!signal) return { ok:false, reason:'ID not found or expired' };
  pending.delete(confirmationId);
  return _simulateFill(signal);
}

function startSimMonitor(getLivePrice) {
  if (mode() !== MODES.SIMULATION || !getLivePrice) return;
  setInterval(async () => {
    for (const [id, fill] of simFills.entries()) {
      try {
        const price = await getLivePrice(fill.sym);
        if (price == null) continue;
        const isBuy = fill.direction === 'BUY';
        if (isBuy  && price >= fill.tp1) { await ai.closeTrade(id, price, 'WIN'); simFills.delete(id); }
        if (isBuy  && price <= fill.sl)  { await ai.closeTrade(id, price, 'LOSS'); simFills.delete(id); }
        if (!isBuy && price <= fill.tp1) { await ai.closeTrade(id, price, 'WIN'); simFills.delete(id); }
        if (!isBuy && price >= fill.sl)  { await ai.closeTrade(id, price, 'LOSS'); simFills.delete(id); }
      } catch {}
    }
  }, 10000);
}

function getExecutionStatus() {
  return { mode:mode(), openSims:simFills.size, pending:pending.size, safeMode:mode()!==MODES.AUTO };
}

module.exports = { execute, confirmManual, startSimMonitor, getExecutionStatus, MODES };
