'use strict';
// ── StillBlvck Elite — Alert Service ──────────────────────────────

const axios  = require('axios');
const cfg    = require('../config');
const logger = require('../utils/logger');

const sent = new Map(); // Dedup window

function isDup(key) {
  const t = sent.get(key);
  if (t && Date.now()-t < cfg.alerts.dedupWindowMs) return true;
  sent.set(key, Date.now());
  if (sent.size > 200) {
    const now = Date.now();
    for (const [k,v] of sent.entries()) {
      if (now-v > cfg.alerts.dedupWindowMs) sent.delete(k);
    }
  }
  return false;
}

function format(sig) {
  const arrow = sig.direction==='BUY' ? '🟢📈' : '🔴📉';
  return [
    `${arrow} *StillBlvck Elite — ${sig.direction} Signal*`,
    `━━━━━━━━━━━━━━━━━━`,
    `*Pair:*      ${sig.lbl||sig.sym}`,
    `*Confidence:* ${sig.confidence}%`,
    `*Setup:*     ${sig.setupType||'—'}`,
    `*Phase:*     ${sig.marketPhase||'—'}`,
    `*Session:*   ${sig.session||'—'}`,
    `━━━━━━━━━━━━━━━━━━`,
    `*Entry:* ${sig.entry}  *SL:* ${sig.sl}`,
    `*TP1:*   ${sig.tp1}   *TP2:* ${sig.tp2||'N/A'}`,
    `*R:R:*   1:${sig.rr1||'—'}`,
    `━━━━━━━━━━━━━━━━━━`,
    `${sig.reason||'SMC Setup confirmed'}`,
    `_StillBlvck.Agency — Uyanda Nxumalo_`,
  ].join('\n');
}

async function sendWhatsApp(sig) {
  const ph = cfg.alerts.whatsappPhone;
  const key= cfg.alerts.callmebotKey;
  if (!ph || !key) return { sent:false, reason:'WhatsApp not configured' };
  if (isDup(`wa_${sig.sym}_${sig.direction}`)) return { sent:false, reason:'Dedup window' };
  try {
    const text = `StillBlvck ${sig.sym} ${sig.direction} E:${sig.entry} SL:${sig.sl} TP:${sig.tp1} Conf:${sig.confidence}% ${sig.session||''}`;
    await axios.get(`https://api.callmebot.com/whatsapp.php`, {
      params: { phone:ph, text, apikey:key },
      timeout: 10000,
    });
    logger.info('Alert', `WhatsApp sent: ${sig.sym} ${sig.direction}`);
    return { sent:true };
  } catch (e) { logger.warn('Alert', 'WhatsApp failed', e); return { sent:false, reason:e.message }; }
}

async function sendTelegram(sig) {
  const tok = cfg.alerts.telegramToken;
  const cid = cfg.alerts.telegramChatId;
  if (!tok || !cid) return { sent:false, reason:'Telegram not configured' };
  if (isDup(`tg_${sig.sym}_${sig.direction}`)) return { sent:false, reason:'Dedup window' };
  try {
    await axios.post(`https://api.telegram.org/bot${tok}/sendMessage`, {
      chat_id: cid, text: format(sig), parse_mode:'Markdown',
    }, { timeout:10000 });
    logger.info('Alert', `Telegram sent: ${sig.sym} ${sig.direction}`);
    return { sent:true };
  } catch (e) { logger.warn('Alert', 'Telegram failed', e); return { sent:false, reason:e.message }; }
}

async function alertSignal(sig) {
  if ((sig.confidence||0) < cfg.signals.minConfidence) return;
  const [wa, tg] = await Promise.allSettled([ sendWhatsApp(sig), sendTelegram(sig) ]);
  return { whatsapp: wa.value||{sent:false}, telegram: tg.value||{sent:false} };
}

module.exports = { alertSignal, sendWhatsApp, sendTelegram };
