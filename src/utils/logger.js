'use strict';
// ── StillBlvck Elite — Structured Logger ──────────────────────────
// Levels: INFO < WARN < ERROR
// Output: JSON to stdout/stderr, timestamped

const LEVELS = { INFO: 0, WARN: 1, ERROR: 2 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? 0;

function log(level, source, message, data) {
  if ((LEVELS[level] ?? 0) < MIN_LEVEL) return;

  const entry = {
    ts:      new Date().toISOString(),
    level,
    source,
    message: String(message),
  };

  if (data !== undefined) {
    if (data instanceof Error) {
      entry.error = { name: data.name, message: data.message, stack: data.stack?.split('\n').slice(0, 3).join(' | ') };
    } else if (data !== null && typeof data === 'object') {
      entry.data = data;
    } else {
      entry.data = data;
    }
  }

  const str = JSON.stringify(entry);
  if (level === 'ERROR') process.stderr.write(str + '\n');
  else                   process.stdout.write(str + '\n');
}

const logger = {
  info:  (src, msg, data) => log('INFO',  src, msg, data),
  warn:  (src, msg, data) => log('WARN',  src, msg, data),
  error: (src, msg, data) => log('ERROR', src, msg, data),
};

module.exports = logger;
