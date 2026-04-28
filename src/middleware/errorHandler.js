'use strict';
// ── Global Error Handler ───────────────────────────────────────────

const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const code    = err.code    || 'INTERNAL_ERROR';

  logger.error('ErrorHandler', `${req.method} ${req.path} — ${message}`, err);

  if (res.headersSent) return;
  res.status(status).json({
    ok:        false,
    error:     message,
    code,
    timestamp: Date.now(),
  });
}

function notFound(req, res) {
  res.status(404).json({
    ok:        false,
    error:     `Route not found: ${req.method} ${req.path}`,
    code:      'NOT_FOUND',
    timestamp: Date.now(),
  });
}

// Wraps async route handlers — catches thrown errors and forwards to errorHandler
function asyncWrap(fn) {
  return function asyncWrapper(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { errorHandler, notFound, asyncWrap };
