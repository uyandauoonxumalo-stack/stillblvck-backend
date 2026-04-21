'use strict';
// ── StillBlvck Elite — Analysis Engine ───────────────────────────
// Pure functions: no side effects, no API calls, no DB access

// ── Indicators ────────────────────────────────────────────────────
function EMA(candles, period) {
  if (!candles || candles.length < period) return 0;
  const k = 2 / (period + 1);
  let e = candles.slice(0, period).reduce((s,c) => s+c.c, 0) / period;
  for (let i = period; i < candles.length; i++) e = candles[i].c * k + e * (1-k);
  return e;
}

function RSI(candles, period = 14) {
  if (!candles || candles.length < period+1) return 50;
  let g=0, l=0;
  for (let i = candles.length-period; i < candles.length; i++) {
    const d = candles[i].c - candles[i-1].c;
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return parseFloat((100 - 100 / (1 + g/l)).toFixed(1));
}

function ATR(candles, period = 14) {
  if (!candles || candles.length < period+1) return null;
  let sum = 0;
  for (let i = candles.length-period; i < candles.length; i++) {
    const prev = candles[i-1].c;
    sum += Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-prev), Math.abs(candles[i].l-prev));
  }
  return sum / period;
}

// ── SMC Concepts ──────────────────────────────────────────────────
function detectBOS(candles, lookback = 20) {
  if (!candles || candles.length < lookback+5) return { bos:false, direction:null, level:null };
  const prev = candles.slice(-(lookback+5), -5);
  const last = candles[candles.length-1];
  const prevHigh = Math.max(...prev.map(c=>c.h));
  const prevLow  = Math.min(...prev.map(c=>c.l));
  const atr = ATR(candles) || 0.001;
  if (last.c > prevHigh + atr*0.3) return { bos:true, direction:'UP',   level:prevHigh };
  if (last.c < prevLow  - atr*0.3) return { bos:true, direction:'DOWN', level:prevLow  };
  return { bos:false, direction:null, level:null };
}

function detectCHoCH(candles, lookback = 30) {
  if (!candles || candles.length < lookback) return { choch:false, direction:null, level:null };
  const slice = candles.slice(-lookback);
  let swH=-Infinity, swHi=-1, swL=Infinity, swLi=-1;
  for (let i=2; i<slice.length-2; i++) {
    if (slice[i].h>slice[i-1].h && slice[i].h>slice[i+1].h && slice[i].h>swH) { swH=slice[i].h; swHi=i; }
    if (slice[i].l<slice[i-1].l && slice[i].l<slice[i+1].l && slice[i].l<swL) { swL=slice[i].l; swLi=i; }
  }
  const last = slice[slice.length-1];
  const atr  = ATR(candles) || 0.001;
  if (swLi>swHi && last.c>swH+atr*0.2) return { choch:true, direction:'UP',   level:swH };
  if (swHi>swLi && last.c<swL-atr*0.2) return { choch:true, direction:'DOWN', level:swL };
  return { choch:false, direction:null, level:null };
}

function detectOrderBlocks(candles, lookback = 50) {
  if (!candles || candles.length < lookback) return { bullOB:null, bearOB:null };
  const slice = candles.slice(-lookback);
  let bullOB=null, bearOB=null;
  for (let i=2; i<slice.length-1; i++) {
    const c=slice[i], nx=slice[i+1], pv=slice[i-1];
    if (pv.c>pv.o && c.c<c.o && nx.c>nx.o && (nx.c-nx.o)>(c.o-c.c)*1.5) bearOB={high:c.h,low:c.l,mid:(c.h+c.l)/2};
    if (pv.c<pv.o && c.c>c.o && nx.c<nx.o && (nx.o-nx.c)>(c.c-c.o)*1.5) bullOB={high:c.h,low:c.l,mid:(c.h+c.l)/2};
  }
  return { bullOB, bearOB };
}

function detectFVG(candles, lookback = 30) {
  if (!candles || candles.length < lookback) return { bullFVG:null, bearFVG:null };
  const slice = candles.slice(-lookback);
  let bullFVG=null, bearFVG=null;
  for (let i=2; i<slice.length; i++) {
    const c1=slice[i-2], c3=slice[i];
    if (c1.h < c3.l) bullFVG = { top:c3.l, bottom:c1.h, mid:(c3.l+c1.h)/2 };
    if (c1.l > c3.h) bearFVG = { top:c1.l, bottom:c3.h, mid:(c1.l+c3.h)/2 };
  }
  return { bullFVG, bearFVG };
}

function detectLiquiditySweep(candles, lookback = 40) {
  if (!candles || candles.length < lookback+3) return { swept:false, direction:null, level:null };
  const prev  = candles.slice(-lookback-3, -3);
  const last3 = candles.slice(-3);
  const prevH = Math.max(...prev.map(c=>c.h));
  const prevL = Math.min(...prev.map(c=>c.l));
  if (last3.some(c=>c.h>prevH) && last3[last3.length-1].c<prevH) return { swept:true, direction:'DOWN', level:prevH };
  if (last3.some(c=>c.l<prevL) && last3[last3.length-1].c>prevL) return { swept:true, direction:'UP',   level:prevL };
  return { swept:false, direction:null, level:null };
}

// ── Po3 Market Phase Detection ────────────────────────────────────
function detectPo3Phase(candles, dir) {
  if (!candles || candles.length < 30) return { phase:'UNKNOWN', confidence:0 };
  const sweep = detectLiquiditySweep(candles);
  const bos   = detectBOS(candles);
  const fvg   = detectFVG(candles);
  const choch = detectCHoCH(candles);

  // Accumulation: price ranging, OB below, FVG present
  if (!bos.bos && !choch.choch && (fvg.bullFVG || fvg.bearFVG)) {
    return { phase:'ACCUMULATION', confidence:65 };
  }
  // Manipulation: liquidity swept
  if (sweep.swept) {
    return { phase:'MANIPULATION', confidence:80 };
  }
  // Distribution: BOS confirmed, opposite direction
  if (bos.bos && bos.direction === 'DOWN' && dir === 'SELL') {
    return { phase:'DISTRIBUTION', confidence:75 };
  }
  if (bos.bos && bos.direction === 'UP' && dir === 'BUY') {
    return { phase:'EXPANSION', confidence:75 };
  }
  if (choch.choch) {
    return { phase:'REVERSAL', confidence:70 };
  }
  return { phase:'CONSOLIDATION', confidence:40 };
}

// ── Trend ─────────────────────────────────────────────────────────
function getTrend(candles) {
  if (!candles || candles.length < 50) return 'FLAT';
  const e20=EMA(candles,20), e50=EMA(candles,50), last=candles[candles.length-1].c;
  const atr=ATR(candles)||0.001;
  if (last>e20 && e20>e50 && last>e50+atr*0.3) return 'UP';
  if (last<e20 && e20<e50 && last<e50-atr*0.3) return 'DOWN';
  return 'FLAT';
}

function getMTFBias(c4h, c1h, c15m) {
  const t4h = c4h?.length>=50  ? getTrend(c4h)  : 'FLAT';
  const t1h = c1h?.length>=50  ? getTrend(c1h)  : 'FLAT';
  const t15 = c15m?.length>=50 ? getTrend(c15m) : 'FLAT';
  const bulls = [t4h,t1h,t15].filter(t=>t==='UP').length;
  const bears = [t4h,t1h,t15].filter(t=>t==='DOWN').length;
  if (bulls >= 2) return { bias:'BULLISH', strength:bulls };
  if (bears >= 2) return { bias:'BEARISH', strength:bears };
  return { bias:'NEUTRAL', strength:0 };
}

// ── Session ───────────────────────────────────────────────────────
function getSession() {
  const h = new Date().getUTCHours();
  if (h>=13&&h<17) return 'OVERLAP';
  if (h>=8 &&h<12) return 'LONDON';
  if (h>=13&&h<22) return 'NEW_YORK';
  if (h>=22||h<1)  return 'SYDNEY';
  if (h>=0 &&h<8)  return 'TOKYO';
  return 'OFF_HOURS';
}

function sessionScore(session) {
  return { OVERLAP:15, LONDON:10, NEW_YORK:8, TOKYO:4, SYDNEY:2, OFF_HOURS:0 }[session] || 0;
}

function isMarketOpen() {
  const day = new Date().getUTCDay();
  return day >= 1 && day <= 5; // Mon–Fri
}

// ── Volatility ────────────────────────────────────────────────────
function volatilityOk(candles, pair) {
  const atr = ATR(candles, 14);
  if (!atr) return true;
  const base = { XAUUSD:8,EURUSD:0.0008,GBPUSD:0.001,USDJPY:0.12,BTCUSD:600,AUDUSD:0.0007,USDCAD:0.0008,NZDUSD:0.0006,EURGBP:0.0006,EURJPY:0.15,GBPJPY:0.18,USDZAR:0.12 };
  return (atr / (base[pair] || 0.001)) < 4.0;
}

// ── SL/TP Calculator ──────────────────────────────────────────────
function calcLevels(candles, direction, pair) {
  const last   = candles[candles.length-1];
  const atr    = ATR(candles, 14) || last.c * 0.001;
  const d      = pair?.decimals || 5;
  const entry  = parseFloat(last.c.toFixed(d));
  const slD=atr*1.5, tp1D=atr*2.0, tp2D=atr*3.5;
  if (direction === 'BUY') return {
    entry, sl:parseFloat((entry-slD).toFixed(d)), tp1:parseFloat((entry+tp1D).toFixed(d)),
    tp2:parseFloat((entry+tp2D).toFixed(d)), rr1:parseFloat((tp1D/slD).toFixed(2)), rr2:parseFloat((tp2D/slD).toFixed(2)),
  };
  return {
    entry, sl:parseFloat((entry+slD).toFixed(d)), tp1:parseFloat((entry-tp1D).toFixed(d)),
    tp2:parseFloat((entry-tp2D).toFixed(d)), rr1:parseFloat((tp1D/slD).toFixed(2)), rr2:parseFloat((tp2D/slD).toFixed(2)),
  };
}

module.exports = {
  EMA, RSI, ATR,
  detectBOS, detectCHoCH, detectOrderBlocks, detectFVG, detectLiquiditySweep,
  detectPo3Phase,
  getTrend, getMTFBias, getSession, sessionScore, isMarketOpen, volatilityOk, calcLevels,
};
