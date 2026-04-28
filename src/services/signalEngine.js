'use strict';
// ── StillBlvck Elite — Signal Engine ──────────────────────────────

const {
  RSI, ATR, detectBOS, detectCHoCH, detectOrderBlocks,
  detectFVG, detectLiquiditySweep, detectPo3Phase,
  getTrend, getMTFBias, getSession, sessionScore, volatilityOk, calcLevels,
} = require('./analysis');
const { getMultiTFCandles } = require('./dataPipeline');
const { getConfidenceBoost, getEffectiveMinConf, detectSetupType } = require('./aiLearning');
const risk   = require('./riskManager');
const logger = require('../utils/logger');

const PAIRS = [
  { sym:'XAUUSD', lbl:'XAU/USD', decimals:2, priority:1 },
  { sym:'EURUSD', lbl:'EUR/USD', decimals:5, priority:2 },
  { sym:'GBPUSD', lbl:'GBP/USD', decimals:5, priority:2 },
  { sym:'USDJPY', lbl:'USD/JPY', decimals:3, priority:2 },
  { sym:'BTCUSD', lbl:'BTC/USD', decimals:2, priority:3 },
  { sym:'AUDUSD', lbl:'AUD/USD', decimals:5, priority:3 },
  { sym:'USDCAD', lbl:'USD/CAD', decimals:5, priority:3 },
  { sym:'NZDUSD', lbl:'NZD/USD', decimals:5, priority:3 },
  { sym:'EURGBP', lbl:'EUR/GBP', decimals:5, priority:3 },
  { sym:'EURJPY', lbl:'EUR/JPY', decimals:3, priority:3 },
  { sym:'GBPJPY', lbl:'GBP/JPY', decimals:3, priority:3 },
  { sym:'USDZAR', lbl:'USD/ZAR', decimals:4, priority:3 },
];

function scoreSignal(sym, dir, c1m, c5m, c15m, c1h, c4h) {
  let score = 0;
  const factors = [];

  // 1. Session bonus
  const session = getSession();
  const sScore  = sessionScore(session);
  score += sScore;
  if (sScore >= 8) factors.push(`${session.replace('_',' ')} session`);

  // 2. Multi-timeframe alignment
  const mtf = getMTFBias(c4h, c1h, c15m);
  if (mtf.bias === 'BULLISH' && dir === 'BUY')  { score += 15 + (mtf.strength-2)*5; factors.push(`MTF bullish ${mtf.strength}/3`); }
  else if (mtf.bias === 'BEARISH' && dir === 'SELL') { score += 15 + (mtf.strength-2)*5; factors.push(`MTF bearish ${mtf.strength}/3`); }
  else if (mtf.bias !== 'NEUTRAL') score -= 10;

  // 3. BOS 15m
  const bos = detectBOS(c15m);
  if (bos.bos && ((bos.direction==='UP'&&dir==='BUY')||(bos.direction==='DOWN'&&dir==='SELL'))) {
    score += 18; factors.push('BOS confirmed 15M');
  }

  // 4. CHoCH 5m
  const choch = detectCHoCH(c5m);
  if (choch.choch && ((choch.direction==='UP'&&dir==='BUY')||(choch.direction==='DOWN'&&dir==='SELL'))) {
    score += 14; factors.push('CHoCH 5M');
  }

  // 5. Order Block 15m
  const { bullOB, bearOB } = detectOrderBlocks(c15m);
  const last15 = c15m?.[c15m.length-1];
  if (last15) {
    if (dir==='BUY'  && bullOB && last15.l<=bullOB.high && last15.c>=bullOB.low)  { score+=12; factors.push('Bullish OB retest'); }
    if (dir==='SELL' && bearOB && last15.h>=bearOB.low  && last15.c<=bearOB.high) { score+=12; factors.push('Bearish OB retest'); }
  }

  // 6. FVG 5m
  const { bullFVG, bearFVG } = detectFVG(c5m);
  const last5 = c5m?.[c5m.length-1];
  if (last5) {
    if (dir==='BUY'  && bullFVG && last5.l<=bullFVG.top && last5.c>=bullFVG.bottom) { score+=8; factors.push('Bullish FVG fill'); }
    if (dir==='SELL' && bearFVG && last5.h>=bearFVG.bottom && last5.c<=bearFVG.top) { score+=8; factors.push('Bearish FVG fill'); }
  }

  // 7. Liquidity sweep 15m
  const sweep = detectLiquiditySweep(c15m);
  if (sweep.swept && ((sweep.direction==='UP'&&dir==='BUY')||(sweep.direction==='DOWN'&&dir==='SELL'))) {
    score+=10; factors.push('Liquidity sweep + reversal');
  }

  // 8. RSI filter
  const rsi1 = RSI(c1m);
  const rsi5 = RSI(c5m);
  const rsiOk = dir==='BUY' ? (rsi1<68&&rsi5<72) : (rsi1>32&&rsi5>28);
  if (rsiOk) {
    score += 6;
    if (dir==='BUY'  && rsi1<40) { score+=5; factors.push(`RSI oversold ${rsi1}`); }
    if (dir==='SELL' && rsi1>60) { score+=5; factors.push(`RSI overbought ${rsi1}`); }
  } else score -= 8;

  // 9. Gold priority
  if (sym === 'XAUUSD') score += 5;

  // 10. Po3 phase alignment bonus
  const po3 = detectPo3Phase(c15m, dir);
  if (po3.phase === 'MANIPULATION' && sweep.swept) { score+=8; factors.push('Po3 Manipulation → Reversal'); }
  if (po3.phase === 'EXPANSION')     { score+=5; factors.push('Po3 Expansion'); }
  if (po3.phase === 'ACCUMULATION')  { score+=3; }

  return {
    score:       Math.max(0, Math.min(100, score)),
    factors,
    session,
    mtfBias:     mtf.bias,
    rsi:         rsi1,
    marketPhase: po3.phase,
  };
}

async function analysePair(pair) {
  try {
    const candles = await getMultiTFCandles(pair.sym);
    const c1m  = candles['1m']  || [];
    const c5m  = candles['5m']  || [];
    const c15m = candles['15m'] || [];
    const c1h  = candles['1h']  || [];
    const c4h  = candles['4h']  || [];

    if (c5m.length < 30) return null;

    if (!volatilityOk(c15m, pair.sym)) {
      return { sym:pair.sym, lbl:pair.lbl, direction:'HOLD', confidence:0, reason:'Extreme volatility — blocked', factors:[], session:getSession() };
    }

    const bS = scoreSignal(pair.sym, 'BUY',  c1m, c5m, c15m, c1h, c4h);
    const sS = scoreSignal(pair.sym, 'SELL', c1m, c5m, c15m, c1h, c4h);

    let dir, raw, factors, session, mtfBias, rsi, marketPhase;
    if (bS.score >= sS.score && bS.score >= 55) {
      dir='BUY';  raw=bS.score; ({ factors,session,mtfBias,rsi,marketPhase } = bS);
    } else if (sS.score > bS.score && sS.score >= 55) {
      dir='SELL'; raw=sS.score; ({ factors,session,mtfBias,rsi,marketPhase } = sS);
    } else {
      return { sym:pair.sym, lbl:pair.lbl, direction:'HOLD', confidence:0, reason:`Scores: BUY:${bS.score} SELL:${sS.score}`, factors:[], session:getSession() };
    }

    const aiBoost    = await getConfidenceBoost({ sym:pair.sym, direction:dir, confidence:raw });
    const confidence = Math.min(100, Math.max(0, Math.round(raw + aiBoost)));
    const levels     = calcLevels(c15m.length>=20 ? c15m : c5m, dir, pair);
    const setupType  = detectSetupType(factors);

    return {
      sym:pair.sym, lbl:pair.lbl, direction:dir,
      confidence, rawScore:raw, aiBoost,
      entry:levels.entry, sl:levels.sl, tp1:levels.tp1, tp2:levels.tp2,
      rr1:levels.rr1, rr2:levels.rr2, rrRatio:levels.rr1,
      factors, session, mtfBias, rsi, setupType, marketPhase,
      reason:    factors.slice(0,3).join(' · '),
      generatedAt: Date.now(),
    };
  } catch (err) {
    logger.warn('SignalEngine', `${pair.sym} error: ${err.message}`);
    return null;
  }
}

async function scanAll() {
  const minConf = getEffectiveMinConf();
  const results = [];

  for (const pair of PAIRS) {
    const sig = await analysePair(pair);
    if (sig) results.push(sig);
    await new Promise(r => setTimeout(r, 250)); // Rate limit spacing
  }

  const live = results.filter(s => s.direction!=='HOLD' && s.confidence>=minConf);
  const hold = results.filter(s => s.direction==='HOLD' || s.confidence<minConf);

  // Risk-validate each live signal
  const validated = [];
  for (const sig of live) {
    const v = await risk.validateTrade(sig);
    if (v.ok) validated.push(sig);
    else logger.info('SignalEngine', `${sig.sym} blocked by risk: ${v.reason}`);
  }

  validated.sort((a,b) => {
    const pa = PAIRS.find(p=>p.sym===a.sym)?.priority || 9;
    const pb = PAIRS.find(p=>p.sym===b.sym)?.priority || 9;
    return (b.confidence - a.confidence) || (pa - pb);
  });

  const suggestions = hold
    .filter(s => (s.rawScore||0) > 0)
    .sort((a,b) => (b.rawScore||0) - (a.rawScore||0))
    .slice(0, 3)
    .map(s => ({ sym:s.sym, lbl:s.lbl, direction:s.direction==='HOLD'?'WATCH':s.direction, confidence:Math.round((s.rawScore||0)*0.82), reason:s.reason||'Setup forming' }));

  return {
    signals:      validated,
    allResults:   results,
    suggestions,
    scannedAt:    Date.now(),
    session:      getSession(),
    pairsScanned: results.length,
    minConfUsed:  minConf,
  };
}

async function signalForPair(sym) {
  const pair = PAIRS.find(p => p.sym === sym);
  if (!pair) throw new Error(`Unknown pair: ${sym}`);
  return analysePair(pair);
}

module.exports = { scanAll, signalForPair, PAIRS };
