const { db, now, audit, notify } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { readJson, sendJson, httpError, clientIp } = require('../lib/web');
const { allow } = require('../lib/ratelimit');

function getThread(id) {
  return db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
}

function assertParticipant(user, thread) {
  if (!thread) throw httpError(404, 'Conversation not found');
  const isAdmin = user.roles.split(',').includes('admin');
  if (!isAdmin && user.id !== thread.participant_a && user.id !== thread.participant_b) {
    throw httpError(403, 'You are not part of this conversation.');
  }
}

module.exports = function register(router) {
  router.get('/api/threads', async (req, res) => {
    const user = requireAuth(req);
    const rows = db.prepare(
      `SELECT t.*, r.code AS request_code, d.code AS donation_code
       FROM threads t
       LEFT JOIN food_requests r ON r.id = t.request_id
       LEFT JOIN donations d ON d.id = t.donation_id
       WHERE t.participant_a = ? OR t.participant_b = ?
       ORDER BY t.created_at DESC`
    ).all(user.id, user.id);
    const out = rows.map((t) => {
      const otherId = t.participant_a === user.id ? t.participant_b : t.participant_a;
      const other = db.prepare('SELECT id, name FROM users WHERE id = ?').get(otherId);
      const last = db.prepare(
        'SELECT body, created_at, sender_id FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1'
      ).get(t.id);
      return {
        id: t.id,
        request_id: t.request_id,
        donation_id: t.donation_id,
        other: { id: other.id, name: other.name },
        last_message: last ? { body: last.body, at: last.created_at, mine: last.sender_id === user.id } : null
      };
    });
    sendJson(res, 200, { threads: out });
  });

  router.get('/api/threads/:id/messages', async (req, res) => {
    const user = requireAuth(req);
    const thread = getThread(req.params.id);
    assertParticipant(user, thread);
    const url = new URL(req.url, 'http://x');
    const after = Number(url.searchParams.get('after') || 0);
    const rows = db.prepare(
      `SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.thread_id = ? AND m.id > ? ORDER BY m.id LIMIT 200`
    ).all(thread.id, after);
    sendJson(res, 200, {
      messages: rows.map((m) => ({ ...m, mine: m.sender_id === user.id }))
    });
  });

  router.post('/api/threads/:id/messages', async (req, res) => {
    const user = requireAuth(req);
    const thread = getThread(req.params.id);
    assertParticipant(user, thread);
    if (!allow(`msg:${user.id}`, 10, 60)) {
      throw httpError(429, 'You are sending messages too quickly. Please slow down.');
    }
    const body = await readJson(req);
    const text = String(body.body || '').trim().slice(0, 1000);
    if (!text) throw httpError(400, 'Message cannot be empty.');

    // Basic abuse screening: phone-number sharing is discouraged but allowed;
    // outright abuse is flagged for moderation.
    const flagged = /\b(bitch|idiot|stupid|scam|fraud)\b/i.test(text) ? 1 : 0;
    const info = db.prepare(
      'INSERT INTO messages (thread_id, sender_id, body, flagged) VALUES (?, ?, ?, ?)'
    ).run(thread.id, user.id, text, flagged);
    if (flagged) {
      audit(user.id, user.roles, 'message.flagged', 'thread', thread.id, null, clientIp(req));
    }
    const otherId = thread.participant_a === user.id ? thread.participant_b : thread.participant_a;
    notify(otherId, 'new_message', {
      thread_id: thread.id,
      from: user.name,
      message: text.slice(0, 80)
    });
    sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid) });
  });
};
