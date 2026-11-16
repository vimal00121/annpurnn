const { db, now, audit, track, config } = require('../lib/db');
const {
  issueOtp, verifyOtp, createSession, destroySession,
  requireAuth, publicUser
} = require('../lib/auth');
const { readJson, sendJson, httpError, setSessionCookie, clearSessionCookie, clientIp } = require('../lib/web');
const { AREAS } = require('../lib/requests');

function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\+91\d{10}$/.test(digits)) return digits;
  if (/^91\d{10}$/.test(digits)) return '+' + digits;
  if (/^0\d{10}$/.test(digits)) return '+91' + digits.slice(1); // 0-prefixed STD format
  if (/^\d{10}$/.test(digits)) return '+91' + digits;
  throw httpError(400, 'Enter a valid 10-digit Indian mobile number.');
}

module.exports = function register(router) {
  router.post('/api/auth/otp/request', async (req, res) => {
    const body = await readJson(req);
    const phone = normalisePhone(body.phone);
    if (!clientIp(req) || !require('../lib/ratelimit').allow(`otpreq:${clientIp(req)}`, 10, 3600)) {
      throw httpError(429, 'Too many OTP requests from this network.');
    }
    const devCode = await issueOtp(phone, 'login', clientIp(req));
    track(null, 'otp_requested');
    sendJson(res, 200, {
      ok: true,
      message: 'OTP sent. It is valid for 10 minutes.',
      // Only present in development so the app works without an SMS gateway.
      dev_otp: devCode || undefined
    });
  });

  router.post('/api/auth/otp/verify', async (req, res) => {
    const body = await readJson(req);
    const phone = normalisePhone(body.phone);
    const name = String(body.name || '').trim().slice(0, 80);
    const roles = Array.isArray(body.roles) && body.roles.length
      ? body.roles.filter((r) => ['seeker', 'donor', 'helper'].includes(r))
      : ['seeker'];
    if (!verifyOtp(phone, body.code, 'login')) {
      throw httpError(401, 'Invalid or expired OTP.');
    }
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user) {
      if (!name) throw httpError(400, 'Please tell us your name to create your account.');
      const info = db.prepare(
        `INSERT INTO users (phone, name, roles, langs, area) VALUES (?, ?, ?, ?, ?)`
      ).run(phone, name, roles.join(','), body.langs || config.defaultLang, body.area || null);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
      audit(user.id, 'new', 'user.registered', 'user', user.id, { roles }, clientIp(req));
    } else if (user.status !== 'active') {
      throw httpError(403, 'This account is suspended. Contact support.');
    } else {
      // merge any newly requested roles into the existing set
      const existing = user.roles.split(',');
      const merged = [...new Set([...existing, ...roles])].join(',');
      if (merged !== user.roles) {
        db.prepare('UPDATE users SET roles = ? WHERE id = ?').run(merged, user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      }
    }
    db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const token = createSession(user.id);
    track(user.id, 'login');
    audit(user.id, user.roles, 'auth.login', 'user', user.id, null, clientIp(req));
    setSessionCookie(res, token);
    sendJson(res, 200, { ok: true, token, user: publicUser(user) });
  });

  router.post('/api/auth/logout', async (req, res) => {
    if (req.sessionToken) destroySession(req.sessionToken);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/me', async (req, res) => {
    if (!req.user) return sendJson(res, 200, { user: null });
    sendJson(res, 200, { user: publicUser(req.user) });
  });

  router.patch('/api/me', async (req, res) => {
    const user = requireAuth(req);
    const body = await readJson(req);
    const updates = {};
    if (body.name) updates.name = String(body.name).trim().slice(0, 80);
    if (body.area && AREAS.includes(body.area)) updates.area = body.area;
    if (body.langs && ['en', 'gu', 'hi'].includes(body.langs)) updates.langs = body.langs;
    if (!Object.keys(updates).length) throw httpError(400, 'Nothing to update.');
    const sets = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...Object.values(updates), now(), user.id);
    audit(user.id, user.roles, 'user.updated_profile', 'user', user.id, updates, clientIp(req));
    sendJson(res, 200, { ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
  });

  router.get('/api/meta/areas', async (req, res) => {
    sendJson(res, 200, { areas: AREAS });
  });
};
