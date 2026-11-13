const { db, track } = require('../lib/db');
const { sendJson, httpError } = require('../lib/web');

module.exports = function register(router) {
  // Food events (community langars, food drives).
  router.get('/api/events', async (req, res) => {
    const rows = db.prepare(
      "SELECT id, title, organiser, area, starts_at, ends_at, description FROM food_events WHERE status = 'active' ORDER BY starts_at"
    ).all();
    sendJson(res, 200, { events: rows });
  });

  // ---------- commercial sections (kept fully separate from donations) ----------
  router.get('/api/offers/restaurants', async (req, res) => {
    const rows = db.prepare(
      'SELECT id, restaurant_name, area, headline, details FROM restaurant_offers WHERE active = 1 ORDER BY id DESC'
    ).all();
    sendJson(res, 200, {
      disclosure: 'Paid advertisements from restaurants. These are not food donations.',
      offers: rows
    });
  });

  router.post('/api/offers/restaurants/:id/view', async (req, res) => {
    db.prepare('UPDATE restaurant_offers SET views = views + 1 WHERE id = ?').run(req.params.id);
    track(req.user?.id ?? null, 'restaurant_offer_view', { id: req.params.id });
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/deals', async (req, res) => {
    const rows = db.prepare(
      'SELECT id, product_name, sponsor, category, url, price_text FROM affiliate_deals WHERE active = 1 ORDER BY id DESC'
    ).all();
    sendJson(res, 200, {
      disclosure: 'Sponsored affiliate listings (Amazon/Flipkart). ANNPURNN may earn a commission. Food requests are always free.',
      deals: rows
    });
  });

  router.post('/api/deals/:id/click', async (req, res) => {
    const row = db.prepare('SELECT id FROM affiliate_deals WHERE id = ?').get(req.params.id);
    if (!row) throw httpError(404, 'Deal not found');
    db.prepare('UPDATE affiliate_deals SET clicks = clicks + 1 WHERE id = ?').run(req.params.id);
    track(req.user?.id ?? null, 'affiliate_click', { id: req.params.id });
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
        'Cooked food should be collected within 2 hours of preparation, or kept hot above 60°C / cold below 5°C.',
        'Label vegetarian and non-vegetarian food clearly and pack them separately.',
        'Declare allergens (nuts, dairy, gluten, soya, etc.) honestly.',
        'Use clean, sealed packaging. Mention storage conditions.',
        'Follow FSSAI guidance for food donation where applicable.'
      ]
    });
  });
};
