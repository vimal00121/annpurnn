const { db, audit } = require('../lib/db');
const { requireAuth, requireRole } = require('../lib/auth');
const { readJson, sendJson, httpError, clientIp } = require('../lib/web');
const { allow } = require('../lib/ratelimit');

module.exports = function register(router) {
  // Food events (community langars, food drives).
  router.get('/api/events', async (req, res) => {
    const rows = db.prepare(
      "SELECT id, title, organiser, area, starts_at, ends_at, description FROM food_events WHERE status = 'active' ORDER BY starts_at"
    ).all();
    sendJson(res, 200, { events: rows });
  });

  // ---------- community chat: one open room for everyone ----------
  router.get('/api/community/messages', async (req, res) => {
    const user = requireAuth(req);
    const after = Number(req.query.after || 0);
    const rows = db.prepare(
      `SELECT m.id, m.user_id, m.body, m.created_at, u.name AS sender_name
       FROM community_messages m JOIN users u ON u.id = m.user_id
       WHERE m.removed = 0 AND m.id > ? ORDER BY m.id LIMIT 200`
    ).all(after);
    sendJson(res, 200, { messages: rows.map((m) => ({ ...m, mine: m.user_id === user.id })) });
  });

  router.post('/api/community/messages', async (req, res) => {
    const user = requireAuth(req);
    if (user.status && user.status !== 'active') throw httpError(403, 'Account is not active.');
    if (!allow(`community:${user.id}`, 10, 60)) {
      throw httpError(429, 'You are sending messages too quickly. Please slow down.');
    }
    const body = await readJson(req);
    const text = String(body.body || '').trim().slice(0, 500);
    if (!text) throw httpError(400, 'Message cannot be empty.');

    // Basic abuse screening — flagged messages stay visible but reach the
    // moderation queue for review.
    const flagged = /\b(bitch|idiot|stupid|scam|fraud)\b/i.test(text) ? 1 : 0;
    const info = db.prepare(
      'INSERT INTO community_messages (user_id, body, flagged) VALUES (?, ?, ?)'
    ).run(user.id, text, flagged);
    if (flagged) {
      audit(user.id, user.roles, 'community.flagged', 'community_message', Number(info.lastInsertRowid), null, clientIp(req));
    }
    sendJson(res, 201, {
      id: Number(info.lastInsertRowid),
      body: text,
      sender_name: user.name,
      user_id: user.id,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      mine: true
    });
  });

  // ---------- moderation (admin) ----------
  router.delete('/api/admin/community/:id', async (req, res) => {
    requireRole('admin')(req);
    const info = db.prepare(
      'UPDATE community_messages SET removed = 1, removed_by = ? WHERE id = ?'
    ).run(req.user.id, req.params.id);
    if (!info.changes) throw httpError(404, 'Message not found');
    audit(req.user.id, req.user.roles, 'community.removed', 'community_message', Number(req.params.id), null, clientIp(req));
    sendJson(res, 200, { ok: true });
  });

  // Food-safety guidance served to all clients (Feature F / food safety workflow).
  router.get('/api/safety/rules', async (req, res) => {
    sendJson(res, 200, {
      disclaimer: 'ANNPURNN does not guarantee food safety. Donors are responsible for the food they share. When in doubt, do not eat it.',
      prohibited: [
        'Alcohol, tobacco, paan or any intoxicants',
        'Raw or undercooked meat, fish or eggs',
        'Food past its safe-collection deadline',
        'Food that has been reheated more than once',
        'Opened or tampered packets',
        'Home-canned or unpasteurised items'
      ],
      guidance: [
        'Share only food you would confidently serve your own family.',
        'Cooked food should be collected within 2 hours of preparation, or kept hot above 60\u00b0C / cold below 5\u00b0C.',
        'Label vegetarian and non-vegetarian food clearly and pack them separately.',
        'Declare allergens (nuts, dairy, gluten, soya, etc.) honestly.',
        'Use clean, sealed packaging. Mention storage conditions.',
        'Follow FSSAI guidance for food donation where applicable.'
      ]
    });
  });
};
