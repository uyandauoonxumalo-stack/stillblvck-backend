'use strict';
const express      = require('express');
const router       = express.Router();
const { asyncWrap }           = require('../middleware/errorHandler');
const { scanAll, signalForPair } = require('../services/signalEngine');
const { broadcastScan }          = require('../services/wsManager');
const { alertSignal }            = require('../services/alertService');
const { execute }                = require('../services/executionService');
const logger = require('../utils/logger');

let lastResult  = null;
let scanLock    = false;

// GET /api/signals
router.get('/', asyncWrap(async (req, res) => {
  if (lastResult && Date.now() - lastResult.scannedAt < 25000) {
    return res.json({ ok:true, ...lastResult, cached:true });
  }
  if (scanLock) {
    return res.json({ ok:true, ...lastResult, cached:true, scanning:true });
  }
  scanLock = true;
  try {
    const result = await scanAll();
    lastResult   = result;
    broadcastScan(result);
    for (const sig of result.signals.slice(0, 3)) {
      alertSignal(sig).catch(() => {});
      execute(sig).catch(()  => {});
    }
    res.json({ ok:true, ...result });
  } finally {
    scanLock = false;
  }
}));

// POST /api/signals/scan — force fresh scan
router.post('/scan', asyncWrap(async (req, res) => {
  if (scanLock) return res.json({ ok:false, message:'Scan already in progress' });
  scanLock = true;
  try {
    const result = await scanAll();
    lastResult   = result;
    broadcastScan(result);
    for (const sig of result.signals) {
      alertSignal(sig).catch(() => {});
      execute(sig).catch(()  => {});
    }
    res.json({ ok:true, ...result });
  } finally {
    scanLock = false;
  }
}));

// GET /api/signals/:pair
router.get('/:pair', asyncWrap(async (req, res) => {
  const sig = await signalForPair(req.params.pair.toUpperCase());
  if (!sig) return res.status(404).json({ ok:false, error:'Pair not found or no data' });
  res.json({ ok:true, signal:sig });
}));

module.exports = router;
