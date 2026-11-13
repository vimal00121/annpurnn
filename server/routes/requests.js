const { db, now, audit, track, notify, config } = require('../lib/db');
const { requireAuth, requireRole } = require('../lib/auth');
const { readJson, sendJson, httpError, clientIp } = require('../lib/web');
const { allow } = require('../lib/ratelimit');
const {
  nextCode, validateRequestInput, findDuplicate, canAccept, getRequestOr404,
  isParticipant, setStatus, canTransition
} = require('../lib/requests');

// Columns that are safe to expose publicly. Sensitive data lives in
// request_private and is only attached for authorised participants.
const PUBLIC_COLUMNS = `
  id, code, is_anonymous, created_by_helper,
  food_desc, people_count, veg_pref, area, collection_time, fulfilment_mode,
  urgency_note, accessibility_note, status, allow_multiple_donors, photo_path,
  created_at, updated_at, accepted_at, ready_at, completed_at`;

function requesterLabel(row) {
  return row.created_by_helper ? 'Created by a community helper' : 'Created by a food seeker';
}

function maskPhone(phone) {
  return phone.slice(0, 3) + '•••••' + phone.slice(-3);
}

function attachPrivate(row, user) {
  if (!row) return row;
  const full = db.prepare('SELECT * FROM food_requests WHERE id = ?').get(row.id);
  const canSeePrivate = user && (
    user.id === full.creator_id ||
    (user.id === full.assigned_donor_id && full.status !== 'open') ||
    user.roles.split(',').includes('admin')
  );
  const out = { ...row, requester_label: requesterLabel(full) };
  if (canSeePrivate) {
    const priv = db.prepare('SELECT * FROM request_private WHERE request_id = ?').get(row.id);
    out.private = {
      beneficiary_alias: full.beneficiary_alias,
      exact_address: priv?.exact_address || null,
      safe_collection_point: priv?.safe_collection_point || null,
      contact_phone_masked: priv?.contact_phone ? maskPhone(priv.contact_phone) : null,
      supporting_info: priv?.supporting_info || null
    };
  }
  return out;
}

module.exports = function register(router) {
  // ---------- CORE FEATURE A + C: create request ----------
  router.post('/api/requests', async (req, res) => {
    const user = requireAuth(req);
    const body = await readJson(req);
    const onBehalf = !!body.on_behalf;

    if (!allow(`reqcreate:${user.id}`, 10, 24 * 3600)) {
      throw httpError(429, 'Daily request-creation limit reached. Please try tomorrow.');
    }

    const input = validateRequestInput(body);
    const dup = findDuplicate(user.id, input.area, input.peopleCount);
    if (dup && !body.confirm_duplicate) {
      throw httpError(409, `You already have an active request ${dup.code} for ${input.peopleCount} people in ${input.area}. Duplicate requests delay food for others. Confirm only if this is genuinely a new need.`);
    }

    if (onBehalf) {
      if (!user.roles.split(',').includes('helper')) {
        throw httpError(403, 'Only community helpers can create requests for someone else.');
      }
      if (!user.helper_verified) {
        throw httpError(403, 'Your community helper account is awaiting verification by our team.');
      }
      if (!body.helper_consent_confirmed) {
        throw httpError(400, 'You must confirm the request is genuine and that you have permission to submit it.');
      }
      if (body.photo_path && !body.photo_consent_confirmed) {
        throw httpError(400, 'A beneficiary photo can only be added with informed consent from the person or their authorised representative.');
      }
    }

    const isAnonymous = body.is_anonymous === 0 ? 0 : 1;
    const alias = isAnonymous ? null : (String(body.beneficiary_alias || '').trim().slice(0, 40) || null);

    db.exec('BEGIN IMMEDIATE');
    try {
      const info = db.prepare(
        `INSERT INTO food_requests
         (code, creator_id, beneficiary_alias, is_anonymous, created_by_helper,
          helper_consent_confirmed, food_desc, people_count, veg_pref, area,
          collection_time, fulfilment_mode, urgency_note, accessibility_note,
          allow_multiple_donors, photo_path, photo_consent_confirmed, dup_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        nextCode('REQ'), user.id, alias, isAnonymous, onBehalf ? 1 : 0,
        onBehalf ? 1 : 0, input.foodDesc, input.peopleCount, input.vegPref, input.area,
        input.collectionTime, input.fulfilmentMode,
        body.urgency_note ? String(body.urgency_note).slice(0, 500) : null,
        body.accessibility_note ? String(body.accessibility_note).slice(0, 500) : null,
        body.allow_multiple_donors ? 1 : 0,
        body.photo_path ? String(body.photo_path).slice(0, 200) : null,
        body.photo_path && body.photo_consent_confirmed ? 1 : 0,
        `${input.area}|${input.peopleCount}|${input.vegPref}`
      );
      const requestId = Number(info.lastInsertRowid);
      db.prepare(
        `INSERT INTO request_private (request_id, exact_address, contact_phone, safe_collection_point, supporting_info)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        requestId,
        body.exact_address ? String(body.exact_address).slice(0, 300) : null,
        user.phone,
        body.safe_collection_point ? String(body.safe_collection_point).slice(0, 300) : null,
        body.supporting_info ? String(body.supporting_info).slice(0, 1000) : null
      );
      db.prepare(
        'INSERT INTO request_events (request_id, actor_id, to_status) VALUES (?, ?, ?)'
      ).run(requestId, user.id, 'open');
      db.exec('COMMIT');

      audit(user.id, user.roles, onBehalf ? 'request.created_for_beneficiary' : 'request.created', 'request', requestId, { area: input.area }, clientIp(req));
      track(user.id, onBehalf ? 'helper_request_created' : 'request_created', { area: input.area });

      const donors = db.prepare(
        `SELECT id FROM users WHERE roles LIKE '%donor%' AND status = 'active' AND id != ?`
      ).all(user.id);
      for (const d of donors.slice(0, 200)) {
        notify(d.id, 'new_request', { request_id: requestId, code: `REQ-${requestId}`, area: input.area });
      }

      const row = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM food_requests WHERE id = ?`).get(requestId);
      sendJson(res, 201, { ok: true, request: attachPrivate(row, user) });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  // ---------- CORE FEATURE D: public browse feed ----------
  router.get('/api/requests', async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const tab = url.searchParams.get('tab') || 'seeker';
    const area = url.searchParams.get('area');
    const veg = url.searchParams.get('veg');
    const minPeople = Number(url.searchParams.get('min_people') || 0);
    const before = url.searchParams.get('before');
    const status = url.searchParams.get('status') || 'open';
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);

    const where = ['status = ?'];
    const params = [status];
    if (tab === 'helper') where.push('created_by_helper = 1');
    else where.push('created_by_helper = 0');
    if (area) { where.push('area = ?'); params.push(area); }
    if (veg && veg !== 'any') { where.push('(veg_pref = ? OR veg_pref = ?)'); params.push(veg, 'any'); }
    if (minPeople > 0) { where.push('people_count >= ?'); params.push(minPeople); }
    if (before) { where.push('collection_time <= ?'); params.push(before); }

    const rows = db.prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM food_requests WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT ?`
    ).all(...params, limit);

    track(req.user?.id ?? null, 'feed_viewed', { tab });
    sendJson(res, 200, { requests: rows.map((r) => ({ ...r, requester_label: requesterLabel(r) })) });
  });

  // ---------- my requests (creator view) ----------
  router.get('/api/requests/mine', async (req, res) => {
    const user = requireAuth(req);
    const rows = db.prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM food_requests WHERE creator_id = ? ORDER BY created_at DESC`
    ).all(user.id);
    sendJson(res, 200, { requests: rows.map((r) => attachPrivate(r, user)) });
  });

  // ---------- request detail ----------
  router.get('/api/requests/:id', async (req, res) => {
    const row = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM food_requests WHERE id = ? OR code = ?`)
      .get(req.params.id, req.params.id);
    if (!row) throw httpError(404, 'Request not found');
    const full = db.prepare('SELECT * FROM food_requests WHERE id = ?').get(row.id);
    const out = attachPrivate(row, req.user);
    if (req.user && isParticipant(req.user, full)) {
      out.events = db.prepare(
        'SELECT from_status, to_status, note, created_at FROM request_events WHERE request_id = ? ORDER BY id'
      ).all(row.id);
    }
    sendJson(res, 200, { request: out });
  });

  // ---------- CORE FEATURE B: donor accepts ----------
  router.post('/api/requests/:id/accept', async (req, res) => {
    const user = requireRole('donor')(req);
    if (!user.phone_verified) throw httpError(403, 'Verify your phone number first.');
    if (!allow(`accept:${user.id}`, 20, 24 * 3600)) {
      throw httpError(429, 'Daily accept limit reached.');
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT * FROM food_requests WHERE id = ?').get(req.params.id);
      if (!row) throw httpError(404, 'Request not found');
      if (!canAccept(row)) {
        throw httpError(409, row.status === 'accepted'
          ? 'This request is already being helped. The requester did not allow multiple contributions.'
          : 'This request can no longer be accepted.');
      }
      if (row.creator_id === user.id) throw httpError(400, 'You cannot accept your own request.');

      db.prepare(
        `UPDATE food_requests SET status = 'accepted', assigned_donor_id = ?, accepted_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(user.id, now(), now(), row.id);
      db.prepare(
        `INSERT INTO request_events (request_id, actor_id, from_status, to_status, note)
         VALUES (?, ?, ?, 'accepted', ?)`
      ).run(row.id, user.id, row.status, `Accepted by donor #${user.id}`);

      const existing = db.prepare(
        'SELECT id FROM threads WHERE request_id = ? AND participant_b = ?'
      ).get(row.id, user.id);
      if (!existing) {
        db.prepare(
          'INSERT INTO threads (request_id, participant_a, participant_b) VALUES (?, ?, ?)'
        ).run(row.id, row.creator_id, user.id);
      }
      db.exec('COMMIT');

      notify(row.creator_id, 'request_accepted', {
        request_id: row.id,
        donor_name: user.name,
        message: 'A donor accepted your food request. Open the request to chat and see collection details.'
      });
      audit(user.id, user.roles, 'request.accepted', 'request', row.id, null, clientIp(req));
      track(user.id, 'request_accepted');

      const updated = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM food_requests WHERE id = ?`).get(row.id);
      sendJson(res, 200, { ok: true, request: attachPrivate(updated, user) });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  // ---------- status transitions (ready / cancelled / completed) ----------
  router.post('/api/requests/:id/status', async (req, res) => {
    const user = requireAuth(req);
    const body = await readJson(req);
    const row = getRequestOr404(req.params.id);
    if (!isParticipant(user, row)) throw httpError(403, 'Only the requester, the accepted donor, or an admin can update this request.');
    const to = String(body.status || '');
    if (!canTransition(row.status, to)) throw httpError(400, `Cannot move a ${row.status} request to ${to}.`);

    if (to === 'ready') {
      setStatus(row.id, 'ready', user.id, { ready_at: now() });
      notify(row.creator_id, 'request_ready', { request_id: row.id, message: 'Your food is ready for collection.' });
    } else if (to === 'cancelled') {
      setStatus(row.id, 'cancelled', user.id);
      if (row.assigned_donor_id) {
        notify(row.assigned_donor_id, 'request_cancelled', { request_id: row.id, message: 'The food request you accepted was cancelled.' });
      }
    } else if (to === 'completed') {
      const role = user.id === row.creator_id ? 'seeker' : (user.id === row.assigned_donor_id ? 'donor' : 'admin');
      db.prepare(
        `INSERT INTO request_events (request_id, actor_id, to_status, note) VALUES (?, ?, 'completed', ?)`
      ).run(row.id, user.id, `completion confirmed by ${role}`);
      const confirms = db.prepare(
        `SELECT COUNT(DISTINCT note) c FROM request_events
         WHERE request_id = ? AND to_status = 'completed' AND note LIKE 'completion confirmed%'`
      ).get(row.id).c;
      if (role === 'admin' || confirms >= 2 || !row.assigned_donor_id) {
        setStatus(row.id, 'completed', user.id, { completed_at: now() });
        notify(row.creator_id, 'request_completed', { request_id: row.id, message: 'Food request completed. Thank you for being part of ANNPURNN.' });
        if (row.assigned_donor_id) {
          notify(row.assigned_donor_id, 'request_completed', { request_id: row.id, message: 'Donation completed. Thank you for feeding someone today.' });
        }
        track(row.creator_id, 'request_completed');
      } else {
        notify(role === 'seeker' ? row.assigned_donor_id : row.creator_id, 'confirm_completion',
          { request_id: row.id, message: 'The other party marked this request complete. Please confirm.' });
      }
    }
    audit(user.id, user.roles, `request.${to}`, 'request', row.id, null, clientIp(req));
    const updated = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM food_requests WHERE id = ?`).get(row.id);
    sendJson(res, 200, { ok: true, request: attachPrivate(updated, user) });
  });

  // ---------- report a suspicious request ----------
  router.post('/api/requests/:id/report', async (req, res) => {
    const user = requireAuth(req);
    const body = await readJson(req);
    if (!allow(`report:${user.id}`, config.maxReportsPerDay, 24 * 3600)) {
      throw httpError(429, 'Daily report limit reached.');
    }
    const row = getRequestOr404(req.params.id);
    db.prepare(
      `INSERT INTO reports (reporter_id, target_type, target_id, category, details)
       VALUES (?, 'request', ?, ?, ?)`
    ).run(user.id, row.id,
      ['suspicious', 'fraud', 'safety', 'abuse', 'other'].includes(body.category) ? body.category : 'suspicious',
      String(body.details || '').slice(0, 1000));
    audit(user.id, user.roles, 'request.reported', 'request', row.id, { category: body.category }, clientIp(req));
    track(user.id, 'request_reported');
    sendJson(res, 200, { ok: true, message: 'Thank you. Our moderation team will review this request.' });
  });
};
