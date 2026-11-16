const http = require('node:http');
const path = require('node:path');
const config = require('./lib/config');
const { sessionMiddleware } = require('./lib/auth');
const { sendJson, securityHeaders, serveStatic, Router } = require('./lib/web');

const router = new Router();
require('./routes/auth')(router);
require('./routes/requests')(router);
require('./routes/donations')(router);
require('./routes/chat')(router);
require('./routes/notifications')(router);
require('./routes/upload')(router);
require('./routes/admin')(router);
require('./routes/community')(router);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      sessionMiddleware(req, res, () => {});
      const match = router.match(req.method, pathname);
      if (!match) return sendJson(res, 404, { error: 'Not found' });
      req.params = match.params;
      req.query = Object.fromEntries(url.searchParams);
      await match.handler(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); res.end(); return;
    }
    if (pathname === '/' || pathname === '/admin') {
      return serveStatic(PUBLIC_DIR, pathname === '/' ? 'index.html' : 'admin.html', res);
    }
    if (pathname.startsWith('/uploads/')) {
      // Private image storage: only logged-in users may view uploaded photos.
      const { sessionMiddleware } = require('./lib/auth');
      sessionMiddleware(req, res, () => {});
      if (!req.user) { res.writeHead(401); res.end('Login required'); return; }
      return serveStatic(require('./lib/config').uploadDir, pathname.slice('/uploads/'.length), res);
    }
    return serveStatic(PUBLIC_DIR, pathname.slice(1), res);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) {
      console.error(`[ANNPURNN] ${req.method} ${pathname} failed:`, err);
    }
    sendJson(res, status, { error: err.message || 'Server error' });
  }
});

setInterval(() => require('./lib/ratelimit').cleanup(), 60 * 60 * 1000).unref();

server.listen(config.port, config.host, () => {
  console.log(`[ANNPURNN] serving on http://${config.host}:${config.port} (db: ${config.dbFile})`);
});

module.exports = server;
