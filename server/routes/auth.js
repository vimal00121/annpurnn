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

function normaliseEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    throw httpError(400, 'Enter a valid email address.');
  }
  return email;
}

// Resolves the login identifier from a request body: phone or email.
function identifierFrom(body) {
  if (body.email) return { email: normaliseEmail(body.email) };
  if (body.phone) return { phone: normalisePhone(body.phone) };
  throw httpError(400, 'Enter your phone number or email address.');
}

module.exports = function register(router) {
  router.post('/api/auth/otp/request', async (req, res) => {
    const body = await readJson(req);
    const id = identifierFrom(body);
    if (!clientIp(req) || !require('../lib/ratelimit').allow(`otpreq:${clientIp(req)}`, 10, 3600)) {
      throw httpError(429, 'Too many OTP requests from this network.');
    }
    const identifier = id.email || id.phone;
    const devCode = await issueOtp(identifier, 'login', clientIp(req));
    track(null, 'otp_requested');
    sendJson(res, 200, {
      ok: true,
      message: 'OTP sent. It is valid for 10 minutes.',
      // Only present in development so the app works without an SMS/email gateway.
      dev_otp: devCode || undefined
    });
  });

  router.post('/api/auth/otp/verify', async (req, res) => {
    const body = await readJson(req);
    const id = identifierFrom(body);
    const identifier = id.email || id.phone;
    const name = String(body.name || '').trim().slice(0, 80);
    const roles = Array.isArray(body.roles) && body.roles.length
      ? body.roles.filter((r) => ['seeker', 'donor', 'helper'].includes(r))
      : ['seeker'];
    if (!verifyOtp(identifier, body.code, 'login')) {
      throw httpError(401, 'Invalid or expired OTP.');
    }
    let user = id.email
      ? db.prepare('SELECT * FROM users WHERE email = ?').get(id.email)
      : db.prepare('SELECT * FROM users WHERE phone = ?').get(id.phone);
    if (!user) {
      if (!name) throw httpError(400, 'Please tell us your name to create your account.');
      const info = id.email
        ? db.prepare(
            `INSERT INTO users (email, name, roles, langs, area) VALUES (?, ?, ?, ?, ?)`
          ).run(id.email, name, roles.join(','), body.langs || config.defaultLang, body.area || null)
        : db.prepare(
            `INSERT INTO users (phone, name, roles, langs, area) VALUES (?, ?, ?, ?, ?)`
          ).run(id.phone, name, roles.join(','), body.langs || config.defaultLang, body.area || null);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
      audit(user.id, 'new', 'user.registered', 'user', user.id, { roles, via: id.email ? 'email' : 'phone' }, clientIp(req));
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
    db.prepare(id.email
      ? 'UPDATE users SET email_verified = 1 WHERE id = ?'
      : 'UPDATE users SET phone_verified = 1 WHERE id = ?'
    ).run(user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const token = createSession(user.id);
    track(user.id, 'login');
    audit(user.id, user.roles, 'auth.login', 'user', user.id, { via: id.email ? 'email' : 'phone' }, clientIp(req));
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
