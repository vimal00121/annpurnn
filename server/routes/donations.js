const { db, now, audit, track, notify } = require('../lib/db');
const { requireAuth, requireRole } = require('../lib/auth');
const { readJson, sendJson, httpError, clientIp } = require('../lib/web');
const { allow } = require('../lib/ratelimit');
const { nextCode, AREAS } = require('../lib/requests');

const DONATION_PUBLIC = `
  id, code, title, description, photo_path, quantity, portions, veg,
  ingredients, allergens, storage_conditions, prepared_at, safe_until,
  area, pickup_available, delivery_available, status, safety_review, created_at`;

function maskPhone(phone) {
  return phone.slice(0, 3) + '•••••' + phone.slice(-3);
}

// Food-safety pre-checks applied to every listing before it goes live
// (Feature E + F). This is guidance screening, not a safety guarantee.
function safetyScreen(body) {
  const errors = [];
  const safeUntil = String(body.safe_until || '').trim();
  if (!safeUntil) errors.push('A safe collection deadline is required.');
  if (body.prepared_at && safeUntil && String(body.prepared_at) > safeUntil) {
    errors.push('The safe-collection deadline must be after the preparation time.');
  }
  const desc = String(body.description || '').toLowerCase();
  const prohibited = ['alcohol', 'wine', 'beer', 'liquor', 'tobacco', 'paan', 'cigarette', 'raw meat', 'raw fish', 'unpasteurised', 'unpasteurized'];
  if (prohibited.some((w) => desc.includes(w))) {
    errors.push('This item is prohibited under ANNPURNN food-safety rules.');
  }
  if (errors.length) throw httpError(400, errors.join(' '));
}

module.exports = function register(router) {
  // ---------- CORE FEATURE E: create donation ----------
  router.post('/api/donations', async (req, res) => {
    const user = requireRole('donor')(req);
    if (!user.phone_verified) throw httpError(403, 'Verify your phone number first.');
    if (!allow(`donate:${user.id}`, 10, 24 * 3600)) throw httpError(429, 'Daily donation-listing limit reached.');

    const body = await readJson(req);
    const title = String(body.title || '').trim().slice(0, 120);
    const description = String(body.description || '').trim().slice(0, 1000);
    const area = String(body.area || '').trim();
    if (title.length < 3) throw httpError(400, 'Give your donation a short title.');
    if (description.length < 10) throw httpError(400, 'Describe the food (at least 10 characters).');
    if (!AREAS.includes(area)) throw httpError(400, 'Choose a valid Surat area.');
    safetyScreen(body);

    const info = db.prepare(
      `INSERT INTO donations
       (code, donor_id, title, description, photo_path, quantity, portions, veg,
        ingredients, allergens, storage_conditions, prepared_at, safe_until, area,
        pickup_available, delivery_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nextCode('DON'), user.id, title, description,
      body.photo_path ? String(body.photo_path).slice(0, 200) : null,
      body.quantity ? String(body.quantity).slice(0, 120) : null,
      Number.isInteger(body.portions) && body.portions > 0 ? body.portions : null,
      body.veg ? 1 : 0,
      body.ingredients ? String(body.ingredients).slice(0, 500) : null,
      body.allergens ? String(body.allergens).slice(0, 500) : null,
      body.storage_conditions ? String(body.storage_conditions).slice(0, 300) : null,
      body.prepared_at ? String(body.prepared_at).slice(0, 40) : null,
      String(body.safe_until).slice(0, 40), area,
      body.pickup_available === 0 ? 0 : 1,
      body.delivery_available ? 1 : 0
    );
    const donationId = Number(info.lastInsertRowid);
    db.prepare(
      'INSERT INTO donation_private (donation_id, exact_address, contact_phone) VALUES (?, ?, ?)'
    ).run(donationId,
      body.exact_address ? String(body.exact_address).slice(0, 300) : null,
      user.phone);

    audit(user.id, user.roles, 'donation.created', 'donation', donationId, { area }, clientIp(req));
    track(user.id, 'donation_created');
    const row = db.prepare(`SELECT ${DONATION_PUBLIC} FROM donations WHERE id = ?`).get(donationId);
    sendJson(res, 201, { ok: true, donation: { ...row, mine: true } });
  });

  // ---------- browse donations ----------
  router.get('/api/donations', async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const area = url.searchParams.get('area');
    const veg = url.searchParams.get('veg');
    const where = ["status = 'available'", "safety_review = 'passed'"];
    const params = [];
    if (area) { where.push('area = ?'); params.push(area); }
    if (veg && veg !== 'any') { where.push('veg = ?'); params.push(veg === 'veg' ? 1 : 0); }
    const rows = db.prepare(
      `SELECT ${DONATION_PUBLIC} FROM donations WHERE ${where.join(' AND ')}
       ORDER BY safe_until ASC LIMIT 100`
    ).all(...params);
    track(req.user?.id ?? null, 'donations_viewed');
    sendJson(res, 200, { donations: rows });
  });

  router.get('/api/donations/mine', async (req, res) => {
    const user = requireAuth(req);
    const rows = db.prepare(
      `SELECT ${DONATION_PUBLIC} FROM donations WHERE donor_id = ? ORDER BY created_at DESC`
    ).all(user.id);
    sendJson(res, 200, { donations: rows });
  });

  router.get('/api/donations/:id', async (req, res) => {
    const row = db.prepare(`SELECT ${DONATION_PUBLIC} FROM donations WHERE id = ? OR code = ?`)
      .get(req.params.id, req.params.id);
    if (!row) throw httpError(404, 'Donation not found');
    const full = db.prepare('SELECT * FROM donations WHERE id = ?').get(row.id);
    const out = { ...row, donor_alias: 'Donor #' + full.donor_id };
    const approvedClaim = req.user ? db.prepare(
      "SELECT id FROM donation_claims WHERE donation_id = ? AND requester_id = ? AND status = 'approved'"
    ).get(row.id, req.user.id) : null;
    if (req.user && (req.user.id === full.donor_id || req.user.roles.split(',').includes('admin') || approvedClaim)) {
      const priv = db.prepare('SELECT * FROM donation_private WHERE donation_id = ?').get(row.id);
      out.private = {
        exact_address: priv?.exact_address || null,
        contact_phone_masked: priv?.contact_phone ? maskPhone(priv.contact_phone) : null
      };
    }
    sendJson(res, 200, { donation: out });
  });

  // ---------- claim a donation (seeker/admin-approved flow) ----------
  router.post('/api/donations/:id/claim', async (req, res) => {
    const user = requireAuth(req);
    const body = await readJson(req);
    if (!allow(`claim:${user.id}`, 15, 24 * 3600)) throw httpError(429, 'Daily claim limit reached.');
    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    if (!donation) throw httpError(404, 'Donation not found');
    if (donation.status !== 'available' || donation.safety_review !== 'passed') {
      throw httpError(409, 'This donation is no longer available.');
    }
    if (donation.donor_id === user.id) throw httpError(400, 'You cannot claim your own donation.');
    if (body.request_id) {
      const linked = db.prepare('SELECT * FROM food_requests WHERE id = ?').get(body.request_id);
      if (!linked || linked.creator_id !== user.id) throw httpError(400, 'Invalid linked request.');
    }
    db.prepare(
      'INSERT INTO donation_claims (donation_id, requester_id, request_id) VALUES (?, ?, ?)'
    ).run(donation.id, user.id, body.request_id || null);
    notify(donation.donor_id, 'donation_claim', {
      donation_id: donation.id,
      message: 'Someone requested your food listing. Review and approve it from My Donations.'
    });
    audit(user.id, user.roles, 'donation.claim_requested', 'donation', donation.id, null, clientIp(req));
    sendJson(res, 200, { ok: true, message: 'Claim sent to the donor for approval.' });
  });

  // Donor approves a claim → shares private address with claimer.
  router.post('/api/donations/:id/claims/:claimId/approve', async (req, res) => {
    const user = requireRole('donor')(req);
    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    if (!donation || donation.donor_id !== user.id) throw httpError(403, 'Only the donor can approve claims.');
    const claim = db.prepare('SELECT * FROM donation_claims WHERE id = ? AND donation_id = ?')
      .get(req.params.claimId, donation.id);
    if (!claim || claim.status !== 'pending') throw httpError(409, 'Claim is not pending.');

    db.prepare("UPDATE donation_claims SET status = 'approved' WHERE id = ?").run(claim.id);
    db.prepare("UPDATE donations SET status = 'matched', matched_request_id = ? WHERE id = ?")
      .run(claim.request_id, donation.id);

    if (claim.request_id) {
      const linked = db.prepare('SELECT * FROM food_requests WHERE id = ?').get(claim.request_id);
      if (linked && linked.status === 'open') {
        db.prepare(
          `UPDATE food_requests SET status = 'accepted', assigned_donor_id = ?, accepted_at = ?, updated_at = ? WHERE id = ?`
        ).run(user.id, now(), now(), linked.id);
        db.prepare(
          `INSERT INTO request_events (request_id, actor_id, from_status, to_status, note)
           VALUES (?, ?, 'open', 'accepted', 'Matched via donation listing')`
        ).run(linked.id, user.id);
      }
    }
    const thread = db.prepare('SELECT id FROM threads WHERE donation_id = ?').get(donation.id);
    if (!thread) {
      db.prepare('INSERT INTO threads (donation_id, participant_a, participant_b) VALUES (?, ?, ?)')
        .run(donation.id, donation.donor_id, claim.requester_id);
    }
    notify(claim.requester_id, 'claim_approved', {
      donation_id: donation.id,
      message: 'Your claim was approved. Open the donation to see collection address and time.'
    });
    audit(user.id, user.roles, 'donation.claim_approved', 'donation', donation.id, { claim_id: claim.id }, clientIp(req));
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/donations/:id/claims/:claimId/decline', async (req, res) => {
    const user = requireRole('donor')(req);
    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    if (!donation || donation.donor_id !== user.id) throw httpError(403, 'Only the donor can decline claims.');
    db.prepare("UPDATE donation_claims SET status = 'declined' WHERE id = ? AND donation_id = ?")
      .run(req.params.claimId, donation.id);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/donations/:id/claims', async (req, res) => {
    const user = requireRole('donor')(req);
    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    if (!donation || donation.donor_id !== user.id) throw httpError(403, 'Only the donor can view claims.');
    const rows = db.prepare(
      `SELECT c.id, c.status, c.request_id, c.created_at, u.name AS requester_name
       FROM donation_claims c JOIN users u ON u.id = c.requester_id
       WHERE c.donation_id = ? ORDER BY c.id DESC`
    ).all(donation.id);
    sendJson(res, 200, { claims: rows });
  });

  router.post('/api/donations/:id/complete', async (req, res) => {
    const user = requireRole('donor')(req);
    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    if (!donation || donation.donor_id !== user.id) throw httpError(403, 'Only the donor can complete a listing.');
    db.prepare("UPDATE donations SET status = 'completed' WHERE id = ?").run(donation.id);
    audit(user.id, user.roles, 'donation.completed', 'donation', donation.id, null, clientIp(req));
    track(user.id, 'donation_completed');
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/donations/:id/report', async (req, res) => {
    const user = requireAuth(req);
    const body = await readJson(req);
    if (!allow(`report:${user.id}`, 10, 24 * 3600)) throw httpError(429, 'Daily report limit reached.');
    const donation = db.prepare('SELECT id FROM donations WHERE id = ?').get(req.params.id);
    if (!donation) throw httpError(404, 'Donation not found');
    db.prepare(
      `INSERT INTO reports (reporter_id, target_type, target_id, category, details)
       VALUES (?, 'donation', ?, ?, ?)`
    ).run(user.id, donation.id,
      ['suspicious', 'safety', 'fraud', 'abuse', 'other'].includes(body.category) ? body.category : 'safety',
      String(body.details || '').slice(0, 1000));
    audit(user.id, user.roles, 'donation.reported', 'donation', donation.id, null, clientIp(req));
    sendJson(res, 200, { ok: true, message: 'Thank you. Our food-safety team will review this listing.' });
  });
};
