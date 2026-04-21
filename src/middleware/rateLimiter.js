'use strict';
// ── In-Memory Rate Limiter ─────────────────────────────────────────

const cfg = require('../config');
const map = new Map();

// Cleanup stale entries every 5 minutes
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, d] of map.entries()) {
    if (now - d.t > cfg.rateLimit.windowMs * 2) map.delete(ip);
  }
}, 300000);
cleanup.unref(); // Don't block process exit

function rateLimiter(req, res, next) {
  const ip  = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const d   = map.get(ip) || { c: 0, t: now };

  if (now - d.t > cfg.rateLimit.windowMs) { d.c = 0; d.t = now; }
  d.c++;
  map.set(ip, d);

  if (d.c > cfg.rateLimit.max) {
    const retryAfter = Math.ceil((d.t + cfg.rateLimit.windowMs - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      ok:         false,
      error:      'Rate limit exceeded',
      retryAfter,
      timestamp:  Date.now(),
    });
  }
  next();
}

module.exports = rateLimiter;
