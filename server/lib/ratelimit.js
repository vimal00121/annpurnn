const { db } = require('./db');

// Fixed-window rate limiter backed by SQLite so limits survive restarts.
// Returns true if the action is allowed, false if the limit is exhausted.
function allow(key, limit, windowSeconds) {
  const win = Math.floor(Date.now() / (windowSeconds * 1000));
  const windowStart = new Date(win * windowSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const row = db.prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?').get(key, windowStart);
  if (!row) {
    db.prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
                ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`).run(key, windowStart);
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ? AND window_start = ?').run(key, windowStart);
  return true;
}

function cleanup() {
  db.prepare("DELETE FROM rate_limits WHERE window_start < datetime('now', '-1 day')").run();
}

module.exports = { allow, cleanup };
