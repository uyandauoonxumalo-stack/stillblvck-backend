'use strict';
const express    = require('express');
const router     = express.Router();
const { asyncWrap } = require('../middleware/errorHandler');
const Trade      = require('../models/Trade');
const ai         = require('../services/aiLearning');
const risk       = require('../services/riskManager');

// GET /api/trades
router.get('/', asyncWrap(async (req, res) => {
  const { status, pair, setupType, session, direction, outcome, limit=50, page=1 } = req.query;
  const filter = {};
  if (status)    filter.status    = status.toUpperCase();
  if (pair)      filter.pair      = pair.toUpperCase();
  if (setupType) filter.setupType = setupType.toUpperCase();
  if (session)   filter.session   = session.toUpperCase();
  if (direction) filter.direction = direction.toUpperCase();
  if (outcome)   filter.outcome   = outcome.toUpperCase();
  const lim  = Math.min(parseInt(limit) || 50, 200);
  const skip = (Math.max(parseInt(page) || 1, 1) - 1) * lim;
  const [trades, total] = await Promise.all([
    Trade.find(filter).sort({ openedAt:-1 }).skip(skip).limit(lim).lean(),
    Trade.countDocuments(filter),
  ]);
  res.json({ ok:true, trades, count:trades.length, total, page:parseInt(page)||1, pages:Math.ceil(total/lim) });
}));

// GET /api/trades/:id
router.get('/:id', asyncWrap(async (req, res) => {
  const t = await Trade.findById(req.params.id).lean();
  if (!t) return res.status(404).json({ ok:false, error:'Trade not found' });
  res.json({ ok:true, trade:t });
}));

// POST /api/trades
router.post('/', asyncWrap(async (req, res) => {
  const { pair, direction, entry, sl, tp1, tp2, confidence, reason, setupType, session, notes, emotion, grade } = req.body;
  if (!pair || !direction || entry==null || sl==null || tp1==null) {
    return res.status(400).json({ ok:false, error:'Required: pair, direction, entry, sl, tp1' });
  }
  const trade = await Trade.create({
    pair:pair.toUpperCase(), direction:direction.toUpperCase(),
    entry:+entry, sl:+sl, tp1:+tp1, tp2:tp2?+tp2:undefined,
    confidence:+confidence||0, reason:reason||'',
    setupType:setupType||'MANUAL', session:session||'UNKNOWN',
    notes:notes||'', emotion:emotion||'', grade:grade||'',
    source:'MANUAL', status:'OPEN', lifecycle:'OPEN',
  });
  res.status(201).json({ ok:true, trade });
}));

// PATCH /api/trades/:id — update journal fields only
router.patch('/:id', asyncWrap(async (req, res) => {
  const allowed = ['notes','emotion','grade','screenshot','setupType','lifecycle'];
  const updates = {};
  for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
  if (!Object.keys(updates).length) return res.status(400).json({ ok:false, error:'No valid fields to update' });
  const trade = await Trade.findByIdAndUpdate(req.params.id, updates, { new:true });
  if (!trade) return res.status(404).json({ ok:false, error:'Trade not found' });
  res.json({ ok:true, trade });
}));

// PATCH /api/trades/:id/close
router.patch('/:id/close', asyncWrap(async (req, res) => {
  const { closePrice, status, notes } = req.body;
  if (!['WIN','LOSS','BE','CANCELLED'].includes(status)) {
    return res.status(400).json({ ok:false, error:'status must be WIN, LOSS, BE, or CANCELLED' });
  }
  await ai.closeTrade(req.params.id, closePrice != null ? +closePrice : null, status, notes);
  const trade = await Trade.findById(req.params.id);
  if (trade?.pnlR != null) risk.recordOutcome(trade.pnlR);
  res.json({ ok:true, trade });
}));

// DELETE /api/trades/:id
router.delete('/:id', asyncWrap(async (req, res) => {
  await Trade.findByIdAndUpdate(req.params.id, { status:'CANCELLED', outcome:'CANCELLED', lifecycle:'ANALYZED', closedAt:new Date() });
  res.json({ ok:true, message:'Trade cancelled' });
}));

module.exports = router;
