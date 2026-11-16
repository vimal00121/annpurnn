const crypto = require('node:crypto');
const { db, now, config } = require('./db');
const { allow } = require('./ratelimit');

// ---------- passwords (helpers/admin could later get passwords; OTP is primary) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// ---------- OTP ----------
function hashCode(phone, code) {
  return crypto.createHmac('sha256', config.secret).update(`${phone}:${code}`).digest('hex');
}

async function issueOtp(phone, purpose = 'login', ip) {
  if (!allow(`otp:${phone}`, 5, 15 * 60)) {
    const err = new Error('Too many OTP requests. Please wait 15 minutes.');
    err.status = 429;
    throw err;
  }
  const code = String(crypto.randomInt(100000, 999999));
  const expires = new Date(Date.now() + config.otpTtlMinutes * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?)`
  ).run(phone, hashCode(phone, code), purpose, expires);
  await require('./otp-sender').send(phone, code);
  // The code is only returned by the API in dev mode with no real SMS
  // provider configured (otherwise it would leak to the client).
  const smsLive = require('./otp-sender').providerName();
  return config.devOtp && !smsLive ? code : null;
}

function verifyOtp(phone, code, purpose = 'login') {
  const row = db.prepare(
    `SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND used = 0
     ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose);
  if (!row) return false;
  if (row.expires_at < now()) return false;
  if (row.attempts >= config.otpMaxAttempts) return false;
  if (row.code_hash !== hashCode(phone, String(code))) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return false;
  }
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);
  return true;
}

// ---------- sessions ----------
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, userId, expires);
  return token;
}

function destroySession(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    roles: u.roles.split(','),
    langs: u.langs,
    area: u.area,
    phoneVerified: !!u.phone_verified,
    donorVerified: !!u.donor_verified,
    helperVerified: !!u.helper_verified,
    status: u.status
  };
}

// Attaches req.user (or null) from the session cookie / Authorization header.
function sessionMiddleware(req, res, next) {
  req.user = null;
  let token = null;
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)annpurnn_session=([^;]+)/);
  if (m) token = decodeURIComponent(m[1]);
  if (!token && (req.headers.authorization || '').startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = db.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    ).get(tokenHash, now());
    if (row && row.status === 'active') req.user = row;
    req.sessionToken = token;
  }
  next();
}

function requireAuth(req) {
  if (!req.user) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  return req.user;
}

function requireRole(...roles) {
  return (req) => {
    const user = requireAuth(req);
    const userRoles = user.roles.split(',');
    if (!roles.some((r) => userRoles.includes(r))) {
      const err = new Error('You do not have permission to perform this action');
      err.status = 403;
      throw err;
    }
    return user;
  };
}

module.exports = {
  hashPassword, verifyPassword,
  issueOtp, verifyOtp,
  createSession, destroySession, sessionMiddleware,
  requireAuth, requireRole, publicUser
};
