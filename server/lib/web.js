const { URL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2'
};

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `annpurnn_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 3600}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'annpurnn_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : null) || req.socket.remoteAddress || '';
}

// Security headers for every response.
function securityHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
}

function serveStatic(rootDir, urlPath, res) {
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(rootDir, safe);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    // pattern like /api/requests/:id/accept
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    }) + '$');
    this.routes.push({ method, regex, keys, handler });
  }

  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  patch(p, h) { this.add('PATCH', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

module.exports = {
  readBody, readJson, sendJson, httpError,
  setSessionCookie, clearSessionCookie, clientIp,
  securityHeaders, serveStatic, Router
};
