'use strict';
const express    = require('express');
const router     = express.Router();
const { asyncWrap } = require('../middleware/errorHandler');
const { getCandles } = require('../services/dataPipeline');

router.get('/', asyncWrap(async (req, res) => {
  const { symbol='XAUUSD', tf='5m', count=100 } = req.query;
  const candles = await getCandles(symbol.toUpperCase(), tf, Math.min(parseInt(count)||100, 500));
  res.json({ ok:true, symbol:symbol.toUpperCase(), tf, candles, count:candles.length });
}));

module.exports = router;
