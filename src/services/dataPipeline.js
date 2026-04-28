'use strict';
// ── StillBlvck Elite — Data Pipeline ──────────────────────────────
// Finnhub (primary) → TwelveData (fallback) → Synthetic (resilience)
// Circuit breaker per provider, request dedup, exponential backoff

const axios     = require('axios');
const NodeCache = require('node-cache');
const cfg       = require('../config');
const logger    = require('../utils/logger');

const candleCache = new NodeCache({ stdTTL:cfg.cache.candleTTL, checkperiod:30 });
const priceCache  = new NodeCache({ stdTTL:cfg.cache.priceTTL,  checkperiod:5  });
const inFlight    = new Map(); // Request deduplication

const breaker = {
  finnhub: { failures:0, until:0 },
  twelve:  { failures:0, until:0 },
};

const isCBOpen  = p => breaker[p].failures >= cfg.apis.circuitBreakerThreshold && Date.now() < breaker[p].until;
const cbFail    = p => { breaker[p].failures++; breaker[p].until = Date.now() + cfg.apis.circuitBreakerResetMs; };
const cbSuccess = p => { breaker[p].failures = 0; breaker[p].until = 0; };

const FH_SYM = { XAUUSD:'OANDA:XAU_USD',EURUSD:'OANDA:EUR_USD',GBPUSD:'OANDA:GBP_USD',USDJPY:'OANDA:USD_JPY',AUDUSD:'OANDA:AUD_USD',USDCAD:'OANDA:USD_CAD',NZDUSD:'OANDA:NZD_USD',EURGBP:'OANDA:EUR_GBP',EURJPY:'OANDA:EUR_JPY',GBPJPY:'OANDA:GBP_JPY',USDZAR:'OANDA:USD_ZAR',BTCUSD:'BINANCE:BTCUSDT' };
const TD_SYM  = { XAUUSD:'XAU/USD',EURUSD:'EUR/USD',GBPUSD:'GBP/USD',USDJPY:'USD/JPY',AUDUSD:'AUD/USD',USDCAD:'USD/CAD',NZDUSD:'NZD/USD',EURGBP:'EUR/GBP',EURJPY:'EUR/JPY',GBPJPY:'GBP/JPY',USDZAR:'USD/ZAR',BTCUSD:'BTC/USD' };
const TF_MINS = { '1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240 };
const TF_FH   = { '1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'D' };
const TF_TD   = { '1m':'1min','5m':'5min','15m':'15min','30m':'30min','1h':'1h','4h':'4h' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, retries = cfg.apis.retries, delay = cfg.apis.retryDelayMs) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries) throw err;
      await sleep(delay * Math.pow(2, i));
    }
  }
}

async function fetchFinnhub(symbol, tf, count) {
  if (isCBOpen('finnhub')) throw new Error('Finnhub circuit breaker open');
  const key = cfg.apis.finnhubKey;
  if (!key) throw new Error('No FINNHUB_API_KEY set');
  const fhSym = FH_SYM[symbol];
  if (!fhSym) throw new Error(`Finnhub: unknown symbol ${symbol}`);
  const mins = TF_MINS[tf] || 5;
  const now  = Math.floor(Date.now() / 1000);
  const from = now - mins * count * 60;
  const res  = await withRetry(() => axios.get('https://finnhub.io/api/v1/forex/candle', {
    params:  { symbol:fhSym, resolution:TF_FH[tf]||'5', from, to:now, token:key },
    timeout: cfg.apis.requestTimeoutMs,
  }));
  if (res.data.s !== 'ok' || !Array.isArray(res.data.t) || !res.data.t.length) {
    throw new Error(`Finnhub: invalid response for ${symbol}`);
  }
  cbSuccess('finnhub');
  return res.data.t.map((t,i) => ({
    time:t, o:res.data.o[i], h:res.data.h[i], l:res.data.l[i], c:res.data.c[i], v:res.data.v?.[i]||0
  }));
}

async function fetchTwelve(symbol, tf, count) {
  if (isCBOpen('twelve')) throw new Error('TwelveData circuit breaker open');
  const key = cfg.apis.twelveDataKey;
  if (!key) throw new Error('No TWELVEDATA_API_KEY set');
  const tdSym = TD_SYM[symbol];
  if (!tdSym) throw new Error(`TwelveData: unknown symbol ${symbol}`);
  const res = await withRetry(() => axios.get('https://api.twelvedata.com/time_series', {
    params:  { symbol:tdSym, interval:TF_TD[tf]||'5min', outputsize:count, apikey:key, format:'JSON' },
    timeout: cfg.apis.requestTimeoutMs,
  }));
  if (res.data.status === 'error' || !Array.isArray(res.data.values) || !res.data.values.length) {
    throw new Error(`TwelveData: invalid response for ${symbol}`);
  }
  cbSuccess('twelve');
  return res.data.values.reverse().map(d => ({
    time: Math.floor(new Date(d.datetime).getTime() / 1000),
    o: parseFloat(d.open), h: parseFloat(d.high),
    l: parseFloat(d.low),  c: parseFloat(d.close),
    v: parseFloat(d.volume || 0),
  }));
}

// Synthetic fallback — deterministic enough for analysis, never crashes system
function synthetic(symbol, tf, count) {
  logger.warn('DataPipeline', `Using synthetic data: ${symbol} ${tf}`);
  const base = { XAUUSD:2340,EURUSD:1.085,GBPUSD:1.265,USDJPY:151.5,BTCUSD:67000,AUDUSD:0.653,USDCAD:1.365,NZDUSD:0.605,EURGBP:0.858,EURJPY:164.5,GBPJPY:191.5,USDZAR:18.9 };
  const vol  = { XAUUSD:8,EURUSD:0.003,GBPUSD:0.004,USDJPY:0.5,BTCUSD:800,AUDUSD:0.002,USDCAD:0.003,NZDUSD:0.002,EURGBP:0.002,EURJPY:0.6,GBPJPY:0.8,USDZAR:0.15 };
  const mins = TF_MINS[tf] || 5;
  const now  = Math.floor(Date.now() / 1000);
  let p = base[symbol] || 1.0;
  return Array.from({ length:count }, (_,i) => {
    const t = now - (count-1-i) * mins * 60;
    const m = (Math.random() - 0.48) * (vol[symbol] || 0.003);
    p += m;
    return { time:t, o:p-m/2, h:p+Math.random()*Math.abs(m)*0.5, l:p-Math.random()*Math.abs(m)*0.5, c:p, v:Math.random()*1000 };
  });
}

async function getCandles(symbol, tf = '5m', count = 150) {
  const cacheKey = `${symbol}_${tf}_${count}`;

  // Cache hit
  const hit = candleCache.get(cacheKey);
  if (hit) return hit;

  // Request deduplication
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = (async () => {
    let candles;
    try {
      candles = await fetchFinnhub(symbol, tf, count);
      logger.info('DataPipeline', `Finnhub OK: ${symbol} ${tf}`);
    } catch (e1) {
      cbFail('finnhub');
      logger.warn('DataPipeline', `Finnhub failed: ${e1.message}`);
      try {
        candles = await fetchTwelve(symbol, tf, count);
        logger.info('DataPipeline', `TwelveData OK: ${symbol} ${tf}`);
      } catch (e2) {
        cbFail('twelve');
        logger.warn('DataPipeline', `TwelveData failed: ${e2.message} — synthetic fallback`);
        candles = synthetic(symbol, tf, count);
      }
    }
    if (candles?.length) candleCache.set(cacheKey, candles);
    return candles || [];
  })();

  inFlight.set(cacheKey, promise);
  try { return await promise; }
  finally { inFlight.delete(cacheKey); }
}

async function getMultiTFCandles(symbol) {
  const tfs = ['1m','5m','15m','1h','4h'];
  const out  = {};
  for (const tf of tfs) {
    try { out[tf] = await getCandles(symbol, tf); }
    catch { out[tf] = synthetic(symbol, tf, 100); }
    await sleep(150); // Respect rate limits
  }
  return out;
}

async function getLivePrice(symbol) {
  const hit = priceCache.get(symbol);
  if (hit) return hit;
  try {
    const c = await getCandles(symbol, '1m', 2);
    if (c?.length) { const p = c[c.length-1].c; priceCache.set(symbol, p); return p; }
  } catch {}
  return null;
}

function getProviderStatus() {
  return {
    finnhub: { open:isCBOpen('finnhub'), failures:breaker.finnhub.failures },
    twelve:  { open:isCBOpen('twelve'),  failures:breaker.twelve.failures  },
  };
}

function clearCache() {
  candleCache.flushAll();
  priceCache.flushAll();
}

module.exports = { getCandles, getMultiTFCandles, getLivePrice, getProviderStatus, clearCache };
