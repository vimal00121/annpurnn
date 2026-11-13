const { db, notify } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { readJson, sendJson, httpError } = require('../lib/web');
const { allow } = require('../lib/ratelimit');

module.exports = function register(router) {
  router.get('/api/notifications', async (req, res) => {
    const user = requireAuth(req);
    const rows = db.prepare(
      'SELECT id, type, payload, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50'
    ).all(user.id);
    sendJson(res, 200, {
      notifications: rows.map((n) => ({ ...n, payload: JSON.parse(n.payload || '{}') })),
      unread: rows.filter((n) => !n.read).length
    });
  });

  router.post('/api/notifications/read', async (req, res) => {
    const user = requireAuth(req);
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(user.id);
    sendJson(res, 200, { ok: true });
  });

  // Report any user (Feature F). Rate limited.
  router.post('/api/users/:id/report', async (req, res) => {
    const user = requireAuth(req);
    const body = await readJson(req);
    if (!allow(`report:${user.id}`, 10, 24 * 3600)) throw httpError(429, 'Daily report limit reached.');
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!target) throw httpError(404, 'User not found');
    db.prepare(
      `INSERT INTO reports (reporter_id, target_type, target_id, category, details)
       VALUES (?, 'user', ?, ?, ?)`
    ).run(user.id, target.id,
      ['suspicious', 'fraud', 'safety', 'abuse', 'other'].includes(body.category) ? body.category : 'abuse',
      String(body.details || '').slice(0, 1000));
    sendJson(res, 200, { ok: true, message: 'Report submitted. Our team will review it.' });
  });

  // Block a user (Feature F).
  router.post('/api/users/:id/block', async (req, res) => {
    const user = requireAuth(req);
    const targetId = Number(req.params.id);
    if (targetId === user.id) throw httpError(400, 'You cannot block yourself.');
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
    if (!target) throw httpError(404, 'User not found');
    db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(user.id, targetId);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/users/:id/unblock', async (req, res) => {
    const user = requireAuth(req);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(user.id, Number(req.params.id));
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/blocks', async (req, res) => {
    const user = requireAuth(req);
    const rows = db.prepare(
      `SELECT b.blocked_id AS id, u.name FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?`
    ).all(user.id);
    sendJson(res, 200, { blocks: rows });
  });
};
