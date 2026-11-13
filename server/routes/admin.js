const { db, now, audit, track } = require('../lib/db');
const { requireRole } = require('../lib/auth');
const { readJson, sendJson, httpError, clientIp } = require('../lib/web');

function admin(req) {
  return requireRole('admin')(req);
}

module.exports = function register(router) {
  // ---------- users ----------
  router.get('/api/admin/users', async (req, res) => {
    admin(req);
    const url = new URL(req.url, 'http://x');
    const q = url.searchParams.get('q');
    const rows = q
      ? db.prepare(`SELECT id, phone, name, roles, status, phone_verified, donor_verified, helper_verified, area, created_at FROM users WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 200`).all(`%${q}%`, `%${q}%`)
      : db.prepare(`SELECT id, phone, name, roles, status, phone_verified, donor_verified, helper_verified, area, created_at FROM users ORDER BY id DESC LIMIT 200`).all();
    sendJson(res, 200, { users: rows });
  });

  router.patch('/api/admin/users/:id', async (req, res) => {
    const me = admin(req);
    const body = await readJson(req);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) throw httpError(404, 'User not found');
    const allowed = {};
    if (['active', 'suspended', 'banned'].includes(body.status)) allowed.status = body.status;
    if (typeof body.donor_verified === 'boolean') allowed.donor_verified = body.donor_verified ? 1 : 0;
    if (typeof body.helper_verified === 'boolean') allowed.helper_verified = body.helper_verified ? 1 : 0;
    if (typeof body.roles === 'string') {
      const roles = body.roles.split(',').map((r) => r.trim()).filter((r) => ['seeker', 'donor', 'helper', 'admin'].includes(r));
      if (roles.length) allowed.roles = [...new Set(roles)].join(',');
    }
    if (!Object.keys(allowed).length) throw httpError(400, 'Nothing to update.');
    const sets = Object.keys(allowed).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`).run(...Object.values(allowed), now(), target.id);
    audit(me.id, 'admin', 'admin.user_updated', 'user', target.id, allowed, clientIp(req));
    sendJson(res, 200, { ok: true });
  });

  // ---------- requests moderation ----------
  router.get('/api/admin/requests', async (req, res) => {
    admin(req);
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status');
    const rows = status
      ? db.prepare('SELECT * FROM food_requests WHERE status = ? ORDER BY id DESC LIMIT 200').all(status)
      : db.prepare('SELECT * FROM food_requests ORDER BY id DESC LIMIT 200').all();
    sendJson(res, 200, { requests: rows });
  });

  router.get('/api/admin/donations', async (req, res) => {
    admin(req);
    const rows = db.prepare(
      `SELECT d.*, u.name AS donor_name FROM donations d JOIN users u ON u.id = d.donor_id
       ORDER BY d.id DESC LIMIT 200`
    ).all();
    sendJson(res, 200, { donations: rows });
  });

  router.patch('/api/admin/donations/:id/safety-review', async (req, res) => {
    const me = admin(req);
    const body = await readJson(req);
    if (!['pending', 'passed', 'rejected'].includes(body.safety_review)) throw httpError(400, 'Invalid review status.');
    db.prepare(
      `UPDATE donations SET safety_review = ?, safety_review_note = ?, reviewed_by = ? WHERE id = ?`
    ).run(body.safety_review, String(body.note || '').slice(0, 500), me.id, req.params.id);
    audit(me.id, 'admin', 'admin.donation_reviewed', 'donation', Number(req.params.id),
      { safety_review: body.safety_review }, clientIp(req));
    sendJson(res, 200, { ok: true });
  });

  // ---------- reports / complaints ----------
  router.get('/api/admin/reports', async (req, res) => {
    admin(req);
    const rows = db.prepare(
      `SELECT r.*, u.name AS reporter_name FROM reports r
       LEFT JOIN users u ON u.id = r.reporter_id ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 200`
    ).all();
    sendJson(res, 200, { reports: rows });
  });

  router.patch('/api/admin/reports/:id', async (req, res) => {
    const me = admin(req);
    const body = await readJson(req);
    if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(body.status)) throw httpError(400, 'Invalid status.');
    db.prepare(
      `UPDATE reports SET status = ?, resolution_note = ?, handled_by = ?, resolved_at = ? WHERE id = ?`
    ).run(body.status, String(body.note || '').slice(0, 500), me.id,
      ['resolved', 'dismissed'].includes(body.status) ? now() : null, req.params.id);
    audit(me.id, 'admin', 'admin.report_handled', 'report', Number(req.params.id), { status: body.status }, clientIp(req));
    sendJson(res, 200, { ok: true });
  });

  // ---------- ads management ----------
  router.get('/api/admin/ads', async (req, res) => {
    admin(req);
    const offers = db.prepare('SELECT * FROM restaurant_offers ORDER BY id DESC').all();
    const deals = db.prepare('SELECT * FROM affiliate_deals ORDER BY id DESC').all();
    const revenue = db.prepare(
      `SELECT source, SUM(amount_paise) AS total_paise FROM ad_revenue GROUP BY source`
    ).all();
    sendJson(res, 200, { offers, deals, revenue });
  });

  router.post('/api/admin/ads/restaurant', async (req, res) => {
    const me = admin(req);
    const body = await readJson(req);
    const info = db.prepare(
      `INSERT INTO restaurant_offers (restaurant_name, area, headline, details) VALUES (?, ?, ?, ?)`
    ).run(String(body.restaurant_name || '').slice(0, 120), String(body.area || '').slice(0, 80),
      String(body.headline || '').slice(0, 200), String(body.details || '').slice(0, 500));
    audit(me.id, 'admin', 'admin.ad_created', 'restaurant_offer', Number(info.lastInsertRowid), null, clientIp(req));
    sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid) });
  });

  router.post('/api/admin/ads/affiliate', async (req, res) => {
    const me = admin(req);
    const body = await readJson(req);
    const info = db.prepare(
      `INSERT INTO affiliate_deals (product_name, sponsor, category, url, price_text) VALUES (?, ?, ?, ?, ?)`
    ).run(String(body.product_name || '').slice(0, 120), String(body.sponsor || '').slice(0, 60),
      String(body.category || '').slice(0, 60), String(body.url || '').slice(0, 500),
      String(body.price_text || '').slice(0, 40));
    audit(me.id, 'admin', 'admin.ad_created', 'affiliate_deal', Number(info.lastInsertRowid), null, clientIp(req));
    sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid) });
  });

  router.patch('/api/admin/ads/:kind/:id/toggle', async (req, res) => {
    const me = admin(req);
    const table = req.params.kind === 'restaurant' ? 'restaurant_offers' : 'affiliate_deals';
    const row = db.prepare(`SELECT active FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) throw httpError(404, 'Ad not found');
    db.prepare(`UPDATE ${table} SET active = ? WHERE id = ?`).run(row.active ? 0 : 1, req.params.id);
    audit(me.id, 'admin', 'admin.ad_toggled', table, Number(req.params.id), null, clientIp(req));
    sendJson(res, 200, { ok: true });
  });

  // ---------- audit log ----------
  router.get('/api/admin/audit', async (req, res) => {
    admin(req);
    const rows = db.prepare(
      `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.id DESC LIMIT 300`
    ).all();
    sendJson(res, 200, { audit: rows });
  });

  // ---------- analytics ----------
  router.get('/api/admin/analytics', async (req, res) => {
    admin(req);
    const today = db.prepare(
      `SELECT COUNT(DISTINCT user_id) n FROM analytics_events WHERE date(created_at) = date('now') AND user_id IS NOT NULL`
    ).get().n;
    const month = db.prepare(
      `SELECT COUNT(DISTINCT user_id) n FROM analytics_events WHERE created_at > datetime('now', '-30 days') AND user_id IS NOT NULL`
    ).get().n;
    const requestsCreated = db.prepare('SELECT COUNT(*) n FROM food_requests').get().n;
    const requestsFulfilled = db.prepare("SELECT COUNT(*) n FROM food_requests WHERE status = 'completed'").get().n;
    const avgFulfilment = db.prepare(
      `SELECT AVG(julianday(completed_at) - julianday(created_at)) * 24 AS hours
       FROM food_requests WHERE completed_at IS NOT NULL`
    ).get().hours;
    const activeDonors = db.prepare(
      `SELECT COUNT(DISTINCT donor_id) n FROM donations WHERE created_at > datetime('now', '-30 days')`
    ).get().n;
    const repeatDonors = db.prepare(
      `SELECT COUNT(*) n FROM (SELECT donor_id FROM donations GROUP BY donor_id HAVING COUNT(*) > 1)`
    ).get().n;
    const helperRequests = db.prepare('SELECT COUNT(*) n FROM food_requests WHERE created_by_helper = 1').get().n;
    const successfulCollections = db.prepare(
      `SELECT COUNT(*) n FROM request_events WHERE note LIKE 'completion confirmed by seeker%'`
    ).get().n;
    const cancellations = db.prepare("SELECT COUNT(*) n FROM food_requests WHERE status = 'cancelled'").get().n;
    const offerViews = db.prepare('SELECT COALESCE(SUM(views),0) n FROM restaurant_offers').get().n;
    const affiliateClicks = db.prepare('SELECT COALESCE(SUM(clicks),0) n FROM affiliate_deals').get().n;
    const revenue = db.prepare(
      `SELECT COALESCE(SUM(amount_paise),0) paise FROM ad_revenue`
    ).get().paise;
    const openReports = db.prepare("SELECT COUNT(*) n FROM reports WHERE status = 'open'").get().n;

    sendJson(res, 200, {
      daily_active_users: today,
      monthly_active_users: month,
      requests_created: requestsCreated,
      requests_fulfilled: requestsFulfilled,
      avg_fulfilment_hours: avgFulfilment ? Math.round(avgFulfilment * 10) / 10 : 0,
      active_donors: activeDonors,
      repeat_donors: repeatDonors,
      helper_created_requests: helperRequests,
      successful_collections: successfulCollections,
      cancellations,
      restaurant_offer_views: offerViews,
      affiliate_clicks: affiliateClicks,
      advertising_revenue_paise: revenue,
      open_reports: openReports
    });
  });
};
