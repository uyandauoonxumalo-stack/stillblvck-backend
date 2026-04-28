'use strict';
// ── StillBlvck Elite — WebSocket Manager ──────────────────────────

const { WebSocketServer } = require('ws');
const cfg    = require('../config');
const logger = require('../utils/logger');

const clients = new Set();
let wss = null;
let pingTimer = null;

function init(server) {
  wss = new WebSocketServer({ server, path:'/ws' });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
    clients.add(ws);
    logger.info('WS', `+1 client [${clients.size} total] from ${ws.ip}`);

    safeSend(ws, { type:'connected', message:'StillBlvck Elite v3 online', time:Date.now(), clients:clients.size });

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      try { handleMsg(ws, JSON.parse(raw)); }
      catch (e) { safeSend(ws, { type:'error', message:'Invalid JSON' }); }
    });
    ws.on('close', () => {
      clients.delete(ws);
      logger.info('WS', `-1 client [${clients.size} total]`);
    });
    ws.on('error', err => {
      clients.delete(ws);
      logger.warn('WS', 'Client error', err);
    });
  });

  wss.on('error', err => logger.error('WS', 'Server error', err));

  // Heartbeat every 25s — kills dead connections
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        clients.delete(ws);
        try { ws.terminate(); } catch {}
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { clients.delete(ws); }
    }
  }, cfg.ws.heartbeatMs);
  pingTimer.unref();

  logger.info('WS', 'Server initialised on /ws');
}

function handleMsg(ws, msg) {
  if (!msg?.type) return;
  if (msg.type === 'ping') safeSend(ws, { type:'pong', time:Date.now() });
}

function safeSend(ws, data) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  } catch (err) {
    clients.delete(ws);
    logger.warn('WS', 'safeSend failed', err);
  }
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  let sent = 0;
  for (const ws of clients) {
    try {
      if (ws.readyState === 1) { ws.send(payload); sent++; }
      else clients.delete(ws);
    } catch { clients.delete(ws); }
  }
  return sent;
}

const broadcastSignal = s  => broadcast({ type:'signal',  payload:s,  time:Date.now() });
const broadcastScan   = r  => broadcast({ type:'scan',    payload:r,  time:Date.now() });
const broadcastStatus = st => broadcast({ type:'status',  payload:st, time:Date.now() });
const getClientCount  = () => clients.size;

module.exports = { init, broadcast, broadcastSignal, broadcastScan, broadcastStatus, getClientCount };
