const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requireAuth } = require('../lib/auth');
const { readBody, sendJson, httpError, clientIp } = require('../lib/web');
const { config, audit } = require('../lib/db');
const { allow } = require('../lib/ratelimit');

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

// Photo uploads are optional everywhere in ANNPURNN and are never required to
// prove need. Files are stored in the private upload dir and served through
// the authenticated static handler only.
module.exports = function register(router) {
  router.post('/api/upload', async (req, res) => {
    const user = requireAuth(req);
    if (!allow(`upload:${user.id}`, 10, 24 * 3600)) throw httpError(429, 'Daily upload limit reached.');
    const ct = (req.headers['content-type'] || '').split(';')[0].trim();
    if (!ALLOWED[ct]) throw httpError(400, 'Only JPEG, PNG or WebP images are allowed.');
    const buf = await readBody(req, 3 * 1024 * 1024);
    if (!buf.length) throw httpError(400, 'Empty file.');
    const name = crypto.randomBytes(16).toString('hex') + ALLOWED[ct];
    fs.writeFileSync(path.join(config.uploadDir, name), buf);
    audit(user.id, user.roles, 'upload.created', 'image', null, { file: name }, clientIp(req));
    sendJson(res, 201, { ok: true, path: `/uploads/${name}` });
  });
};
