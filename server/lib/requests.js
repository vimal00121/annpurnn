const { db, now, config } = require('./db');
const { httpError } = require('./web');

function nextCode(prefix) {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = ?`).get(prefix === 'REQ' ? 'food_requests' : 'donations');
  const n = (row ? row.seq : 0) + 1;
  return `${prefix}-SRT-${year}-${String(n).padStart(6, '0')}`;
}

const AREAS = [
  'Adajan', 'Athwa', 'Althan', 'Bhatar', 'City Light', 'Dumas Road', 'Fulpada',
  'Katargam', 'Limbayat', 'Nanpura', 'Palsana', 'Parvat Patiya', 'Piplod',
  'Rander', 'Sachin', 'Sahara Darwaja', 'Singanpore', 'Surat Textile Market',
  'Udhna', 'Vesu', 'Ved Road', 'Varachha', 'Other'
];

function validateRequestInput(body) {
  const errors = [];
  const foodDesc = String(body.food_desc || '').trim();
  const peopleCount = Number(body.people_count);
  const area = String(body.area || '').trim();
  const collectionTime = String(body.collection_time || '').trim();

  if (foodDesc.length < 3 || foodDesc.length > 500) errors.push('Describe the food needed (3-500 characters).');
  if (!Number.isInteger(peopleCount) || peopleCount < 1 || peopleCount > 200) errors.push('Number of people must be between 1 and 200.');
  if (!AREAS.includes(area)) errors.push('Choose a valid Surat area.');
  if (!collectionTime) errors.push('Preferred collection time is required.');
  if (!['veg', 'nonveg', 'any'].includes(body.veg_pref)) errors.push('Invalid food preference.');
  if (!['pickup', 'pickup_or_delivery'].includes(body.fulfilment_mode || 'pickup')) errors.push('Invalid fulfilment mode.');
  for (const key of ['urgency_note', 'accessibility_note']) {
    if (body[key] && String(body[key]).length > 500) errors.push(`${key} must be 500 characters or fewer.`);
  }
  if (errors.length) throw httpError(400, errors.join(' '));

  return { foodDesc, peopleCount, area, collectionTime, vegPref: body.veg_pref, fulfilmentMode: body.fulfilment_mode || 'pickup' };
}

// Duplicate detection: same creator + same area + same people count while an
// earlier request is still open, within the configured window. Returns the
// conflicting request or null.
function findDuplicate(creatorId, area, peopleCount) {
  return db.prepare(
    `SELECT id, code, created_at FROM food_requests
     WHERE creator_id = ? AND area = ? AND people_count = ?
       AND status IN ('open', 'accepted', 'ready')
       AND created_at > datetime('now', ?)`
  ).get(creatorId, area, peopleCount, `-${config.duplicateWindowHours} hours`) || null;
}

function canAccept(request) {
  if (!['open', 'accepted'].includes(request.status)) return false;
  if (request.status === 'accepted' && !request.allow_multiple_donors) return false;
  if (request.creator_id === request.assigned_donor_id) return false;
  return true;
}

function getRequestOr404(id) {
  const row = db.prepare('SELECT * FROM food_requests WHERE id = ?').get(id);
  if (!row) throw httpError(404, 'Request not found');
  return row;
}

function isParticipant(user, request) {
  if (!user) return false;
  if (user.id === request.creator_id) return true;
  if (user.id === request.assigned_donor_id) return true;
  return user.roles.split(',').includes('admin');
}

function addRequestEvent(requestId, actorId, from, to, note) {
  db.prepare(
    'INSERT INTO request_events (request_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)'
  ).run(requestId, actorId ?? null, from ?? null, to, note ?? null);
}

function setStatus(requestId, toStatus, actorId, extra = {}) {
  const reqRow = getRequestOr404(requestId);
  const cols = { status: toStatus, updated_at: now(), ...extra };
  const sets = Object.keys(cols).map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE food_requests SET ${sets} WHERE id = ?`).run(...Object.values(cols), requestId);
  addRequestEvent(requestId, actorId, reqRow.status, toStatus);
  return reqRow;
}

const STATUS_FLOW = {
  open: ['accepted', 'cancelled'],
  accepted: ['ready', 'completed', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

function canTransition(from, to) {
  return (STATUS_FLOW[from] || []).includes(to);
}

module.exports = {
  nextCode, AREAS, validateRequestInput, findDuplicate, canAccept,
  getRequestOr404, isParticipant, addRequestEvent, setStatus, canTransition
};
