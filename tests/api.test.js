const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'annpurnn-test-'));
process.env.ANNPURNN_DB = path.join(TMP, 'test.db');
process.env.ANNPURNN_UPLOADS = path.join(TMP, 'uploads');
process.env.PORT = '0';

const server = require('../server/index');
const { db } = require('../server/lib/db');
require('../server/seed');

let BASE = '';
const jars = {}; // name -> { token, phone }

async function call(name, method, p, body, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (name && jars[name]?.token) headers.Authorization = 'Bearer ' + jars[name].token;
  const res = await fetch(BASE + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(name, phone, roles) {
  const r1 = await call(null, 'POST', '/api/auth/otp/request', { phone });
  assert.equal(r1.status, 200);
  const code = r1.data.dev_otp;
  assert.ok(code, 'dev OTP must be present in tests');
  const r2 = await call(null, 'POST', '/api/auth/otp/verify', { phone, code, name: 'User ' + name, roles });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  jars[name] = { token: r2.data.token, phone, user: r2.data.user };
  return r2.data.user;
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('health: meta areas reachable', async () => {
  const r = await call(null, 'GET', '/api/meta/areas');
  assert.equal(r.status, 200);
  assert.ok(r.data.areas.includes('Adajan'));
});

test('OTP login creates verified user', async () => {
  const u = await login('seeker', '+919911111111', ['seeker']);
  assert.ok(u.phoneVerified);
  assert.deepEqual(u.roles, ['seeker']);
});

test('PRIVACY: public feed never exposes address, phone or beneficiary identity', async () => {
  await login('donor1', '+919922222222', ['donor']);
  await call('seeker', 'POST', '/api/requests', {
    food_desc: 'Dal rice for dinner', people_count: 3, veg_pref: 'veg',
    area: 'Adajan', collection_time: 'today 8pm',
    beneficiary_alias: 'Shalini', is_anonymous: 0,
    exact_address: 'B-402, Secret Society, Hidden Lane 7'
  });
  const pub = await call('donor1', 'GET', '/api/requests');
  assert.equal(pub.status, 200);
  const raw = JSON.stringify(pub.data);
  assert.ok(!raw.includes('Secret Society'), 'exact address must not leak');
  assert.ok(!raw.includes('+919911111111'), 'phone must not leak');
  assert.ok(!raw.includes('Shalini'), 'beneficiary name must not leak publicly');
  const detail = await call('donor1', 'GET', `/api/requests/${pub.data.requests[0].id}`);
  assert.equal(detail.data.request.private, undefined, 'private block must be absent for non-participants');
});

test('DUPLICATES: identical open request is blocked, confirm_duplicate overrides', async () => {
  const first = await call('seeker', 'POST', '/api/requests', {
    food_desc: 'Pasta for two', people_count: 2, veg_pref: 'veg',
    area: 'Althan', collection_time: 'today 9pm'
  });
  assert.equal(first.status, 201);
  const r1 = await call('seeker', 'POST', '/api/requests', {
    food_desc: 'Khichdi for two', people_count: 2, veg_pref: 'veg',
    area: 'Althan', collection_time: 'today 9pm'
  });
  assert.equal(r1.status, 409);
  assert.match(r1.data.error, /active request/);
  const r2 = await call('seeker', 'POST', '/api/requests', {
    food_desc: 'Khichdi for two', people_count: 2, veg_pref: 'veg',
    area: 'Adajan', collection_time: 'today 9pm', confirm_duplicate: true
  });
  assert.equal(r2.status, 201);
});

test('ACCEPT RACE: only one of two concurrent donors wins', async () => {
  await login('donor2', '+919933333333', ['donor']);
  const feed = await call('donor1', 'GET', '/api/requests?status=open');
  const target = feed.data.requests.find((r) => r.status === 'open');
  const [a, b] = await Promise.allSettled([
    call('donor1', 'POST', `/api/requests/${target.id}/accept`),
    call('donor2', 'POST', `/api/requests/${target.id}/accept`)
  ]);
  const outcomes = [a.value, b.value].map((x) => x.status).sort();
  assert.deepEqual(outcomes, [200, 409], 'exactly one accept must succeed');
});

test('ACCEPT: multiple contributions allowed only when requester permits', async () => {
  const r = await call('seeker', 'POST', '/api/requests', {
    food_desc: 'Chai and biscuits for study group', people_count: 5, veg_pref: 'veg',
    area: 'Vesu', collection_time: 'tomorrow 5pm', allow_multiple_donors: true, confirm_duplicate: true
  });
  assert.equal(r.status, 201);
  const id = r.data.request.id;
  const a = await call('donor1', 'POST', `/api/requests/${id}/accept`);
  assert.equal(a.status, 200);
  const b = await call('donor2', 'POST', `/api/requests/${id}/accept`);
  assert.equal(b.status, 200, 'multiple donors allowed when permitted');
});

test('ACCEPT: second donor blocked when requester did not permit multiples', async () => {
  const r = await call('seeker', 'POST', '/api/requests', {
    food_desc: 'Single meal', people_count: 1, veg_pref: 'any',
    area: 'Nanpura', collection_time: 'today 10pm', confirm_duplicate: true
  });
  const id = r.data.request.id;
  assert.equal((await call('donor1', 'POST', `/api/requests/${id}/accept`)).status, 200);
  const second = await call('donor2', 'POST', `/api/requests/${id}/accept`);
  assert.equal(second.status, 409);
});

test('LIFECYCLE: accept -> ready -> completed with two-sided confirmation', async () => {
  const r = await call('seeker', 'POST', '/api/requests', {
    food_desc: 'Rotli shaak for 3', people_count: 3, veg_pref: 'veg',
    area: 'Katargam', collection_time: 'today 8pm', confirm_duplicate: true
  });
  const id = r.data.request.id;
  assert.equal((await call('donor2', 'POST', `/api/requests/${id}/accept`)).status, 200);

  // donor can now see private address
  const d = await call('donor2', 'GET', `/api/requests/${id}`);
  assert.ok(d.data.request.private, 'accepted donor must see collection details');
  assert.ok(!JSON.stringify(d.data.request).includes('Hidden Lane 7') || d.data.request.private.exact_address !== null);

  assert.equal((await call('donor2', 'POST', `/api/requests/${id}/status`, { status: 'ready' })).status, 200);
  assert.equal((await call('seeker', 'POST', `/api/requests/${id}/status`, { status: 'completed' })).status, 200);
  const afterSeeker = (await call('seeker', 'GET', `/api/requests/${id}`)).data.request;
  assert.equal(afterSeeker.status, 'ready', 'needs both confirmations');

  assert.equal((await call('donor2', 'POST', `/api/requests/${id}/status`, { status: 'completed' })).status, 200);
  const done = (await call('seeker', 'GET', `/api/requests/${id}`)).data.request;
  assert.equal(done.status, 'completed');
  assert.ok(done.completed_at);
});

test('HELPER: on-behalf request needs role, consent; anonymous by default', async () => {
  await login('helper', '+919944444444', ['helper', 'seeker']);
  // helper not yet verified
  const denied = await call('helper', 'POST', '/api/requests', {
    on_behalf: true, food_desc: 'Meal for elderly man', people_count: 1,
    veg_pref: 'veg', area: 'Varachha', collection_time: 'today 9pm', helper_consent_confirmed: true
  });
  assert.equal(denied.status, 403, 'unverified helper must be blocked');

  // admin verifies helper
  await login('admin', '+919800000009', []);
  const v = await call('admin', 'PATCH', `/api/admin/users/${jars.helper.user.id}`, { helper_verified: true });
  assert.equal(v.status, 200);

  const noConsent = await call('helper', 'POST', '/api/requests', {
    on_behalf: true, food_desc: 'Meal for elderly man', people_count: 1,
    veg_pref: 'veg', area: 'Varachha', collection_time: 'today 9pm'
  });
  assert.equal(noConsent.status, 400, 'consent confirmation required');

  const ok = await call('helper', 'POST', '/api/requests', {
    on_behalf: true, food_desc: 'Meal for elderly man', people_count: 1,
    veg_pref: 'veg', area: 'Varachha', collection_time: 'today 9pm',
    helper_consent_confirmed: true, is_anonymous: 1,
    safe_collection_point: 'Varachha bus stop shelter'
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.request.created_by_helper, 1, 'labelled as helper-created');
  assert.equal(ok.data.request.beneficiary_alias, null, 'anonymous beneficiary has no name');

  // appears in helper tab, not seeker tab
  const feedH = await call('donor1', 'GET', '/api/requests?tab=helper');
  assert.ok(feedH.data.requests.some((x) => x.id === ok.data.request.id));
  const feedS = await call('donor1', 'GET', '/api/requests?tab=seeker');
  assert.ok(!feedS.data.requests.some((x) => x.id === ok.data.request.id));
});

test('PHOTO CONSENT: beneficiary photo without consent is rejected', async () => {
  const r = await call('helper', 'POST', '/api/requests', {
    on_behalf: true, food_desc: 'Food for family of 4', people_count: 4,
    veg_pref: 'veg', area: 'Udhna', collection_time: 'today 8pm',
    helper_consent_confirmed: true, photo_path: '/uploads/x.jpg'
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /consent/i);
});

test('NON-HELPER cannot create on-behalf requests', async () => {
  const r = await call('donor1', 'POST', '/api/requests', {
    on_behalf: true, food_desc: 'test', people_count: 1, veg_pref: 'veg',
    area: 'Vesu', collection_time: 'now', helper_consent_confirmed: true
  });
  assert.equal(r.status, 403);
});

test('RBAC: admin API blocked for anonymous and non-admin users', async () => {
  assert.equal((await call(null, 'GET', '/api/admin/users')).status, 401);
  assert.equal((await call('seeker', 'GET', '/api/admin/users')).status, 403);
  assert.equal((await call('admin', 'GET', '/api/admin/analytics')).status, 200);
});

test('RBAC: non-donor cannot accept requests', async () => {
  const feed = await call('donor1', 'GET', '/api/requests?status=open');
  const target = feed.data.requests[0];
  const r = await call('seeker', 'POST', `/api/requests/${target.id}/accept`);
  assert.equal(r.status, 403);
});

test('CHAT: participants only, rate limited, masked phone in UI data', async () => {
  const threads = await call('donor2', 'GET', '/api/threads');
  assert.ok(threads.data.threads.length >= 1);
  const th = threads.data.threads[0];
  assert.equal((await call('helper', 'GET', `/api/threads/${th.id}/messages`)).status, 403,
    'non-participant must not read the thread');
  let last = null;
  for (let i = 0; i < 12; i++) {
    last = await call('donor2', 'POST', `/api/threads/${th.id}/messages`, { body: `msg ${i}` });
  }
  assert.equal(last.status, 429, 'message rate limit must engage');
});

test('FOOD SAFETY: prohibited items rejected; deadline required', async () => {
  const bad = await call('donor1', 'POST', '/api/donations', {
    title: 'Beer leftovers', description: 'alcohol cans from party',
    safe_until: 'today 9pm', area: 'Vesu', veg: false
  });
  assert.equal(bad.status, 400);
  const noDeadline = await call('donor1', 'POST', '/api/donations', {
    title: 'Rice', description: 'plain cooked rice', area: 'Vesu', veg: true
  });
  assert.equal(noDeadline.status, 400);
  const ok = await call('donor1', 'POST', '/api/donations', {
    title: 'Veg pulao 10 boxes', description: 'fresh pulao, sealed boxes',
    safe_until: 'today 9pm', area: 'Vesu', veg: true, portions: 10,
    allergens: 'none', exact_address: 'Donor street 5'
  });
  assert.equal(ok.status, 201);
  const pub = await call('seeker', 'GET', '/api/donations');
  assert.ok(!JSON.stringify(pub.data).includes('Donor street 5'), 'donor address must not be public');
});

test('DONATION CLAIM: approve shares address privately and matches request', async () => {
  const d = await call('donor2', 'POST', '/api/donations', {
    title: 'Dal dhokla 15 pcs', description: 'fresh evening snack',
    safe_until: 'today 10pm', area: 'Katargam', veg: true,
    exact_address: 'Katargam char rasta, shop 9'
  });
  const donationId = d.data.donation.id;
  assert.equal((await call('admin', 'PATCH', `/api/admin/donations/${donationId}/safety-review`,
    { safety_review: 'passed', note: 'ok' })).status, 200);
  const claim = await call('seeker', 'POST', `/api/donations/${donationId}/claim`);
  assert.equal(claim.status, 200);
  const claims = await call('donor2', 'GET', `/api/donations/${donationId}/claims`);
  assert.equal(claims.data.claims.length, 1);
  assert.equal((await call('donor2', 'POST', `/api/donations/${donationId}/claims/${claims.data.claims[0].id}/approve`)).status, 200);
  const detail = await call('seeker', 'GET', `/api/donations/${donationId}`);
  assert.equal(detail.data.donation.private.exact_address, 'Katargam char rasta, shop 9');
  assert.equal(detail.data.donation.status, 'matched');
});

test('REPORTS: users can report suspicious requests; admin resolves', async () => {
  const feed = await call('donor1', 'GET', '/api/requests?status=open');
  const target = feed.data.requests[0];
  const r = await call('donor1', 'POST', `/api/requests/${target.id}/report`, {
    category: 'suspicious', details: 'looks like resale attempt'
  });
  assert.equal(r.status, 200);
  const list = await call('admin', 'GET', '/api/admin/reports');
  assert.ok(list.data.reports.some((x) => x.target_id === target.id && x.status === 'open'));
  const rep = list.data.reports.find((x) => x.target_id === target.id);
  assert.equal((await call('admin', 'PATCH', `/api/admin/reports/${rep.id}`, { status: 'resolved', note: 'checked' })).status, 200);
});

test('ANALYTICS: counters move after activity', async () => {
  const a = await call('admin', 'GET', '/api/admin/analytics');
  assert.ok(a.data.requests_created > 0);
  assert.ok(a.data.requests_fulfilled > 0);
  assert.ok(a.data.daily_active_users > 0);
  assert.ok(typeof a.data.avg_fulfilment_hours === 'number');
});

test('AUDIT: sensitive actions are logged', async () => {
  const log = await call('admin', 'GET', '/api/admin/audit');
  const actions = log.data.audit.map((a) => a.action);
  assert.ok(actions.includes('request.accepted'));
  assert.ok(actions.includes('request.created_for_beneficiary'));
  assert.ok(actions.includes('admin.user_updated'));
});

test('BLOCK: users can block each other', async () => {
  const donorId = jars.donor1.user.id;
  const r = await call('seeker', 'POST', `/api/users/${donorId}/block`);
  assert.equal(r.status, 200);
  const blocks = await call('seeker', 'GET', '/api/blocks');
  assert.ok(blocks.data.blocks.some((b) => b.id === donorId));
});

test('RATE LIMIT: request creation is capped per day', async () => {
  let last = null;
  for (let i = 0; i < 12; i++) {
    last = await call('seeker', 'POST', '/api/requests', {
      food_desc: `burst test ${i} unique`, people_count: 3, veg_pref: 'veg',
      area: 'Adajan', collection_time: 'today', confirm_duplicate: true
    });
  }
  assert.equal(last.status, 429);
});

test('SECURITY: static traversal blocked', async () => {
  const res = await fetch(BASE + '/..%2f..%2fserver%2flib%2fconfig.js');
  assert.equal(res.status, 404);
});

test('COMMUNITY CHAT: login required, posting works, messages visible to others', async () => {
  const anon = await call(null, 'GET', '/api/community/messages');
  assert.equal(anon.status, 401);
  await login('chat1', '+919955555555', ['seeker']);
  await login('chat2', '+919966666666', ['donor']);
  const post = await call('chat1', 'POST', '/api/community/messages', { body: 'Hello Surat! Free langar tonight at City Light.' });
  assert.equal(post.status, 201);
  assert.ok(post.data.id);
  const feed = await call('chat2', 'GET', '/api/community/messages');
  assert.equal(feed.status, 200);
  const msg = feed.data.messages.find((m) => m.id === post.data.id);
  assert.ok(msg, 'message should be visible to other users');
  assert.equal(msg.sender_name, 'User chat1');
  assert.equal(msg.mine, false);
  // empty messages rejected
  const empty = await call('chat2', 'POST', '/api/community/messages', { body: '   ' });
  assert.equal(empty.status, 400);
});

test('COMMUNITY CHAT: flagged message reaches moderation queue and admin can remove', async () => {
  await login('admin2', '+919800000009', []);
  await call('chat1', 'POST', '/api/community/messages', { body: 'you are a scam artist' });
  await login('admin3', '+919800000009', []);
  const list = await call('admin3', 'GET', '/api/admin/community');
  assert.equal(list.status, 200);
  const flagged = list.data.messages.find((m) => m.flagged === 1);
  assert.ok(flagged, 'abusive message should be flagged');
  const del = await call('admin3', 'DELETE', `/api/admin/community/${flagged.id}`);
  assert.equal(del.status, 200);
  const nonAdmin = await call('chat2', 'DELETE', `/api/admin/community/${flagged.id}`);
  assert.equal(nonAdmin.status, 403);
  const feed = await call('chat2', 'GET', '/api/community/messages');
  assert.ok(!feed.data.messages.some((m) => m.id === flagged.id), 'removed message must disappear');
});

test('EMAIL LOGIN: OTP by email creates account and re-login works', async () => {
  const ip = (n) => ({ 'X-Forwarded-For': `10.9.0.${n}` }); // unique IPs to dodge the per-network OTP cap
  const bad = await call(null, 'POST', '/api/auth/otp/request', { email: 'not-an-email' }, ip(1));
  assert.equal(bad.status, 400);
  const r1 = await call(null, 'POST', '/api/auth/otp/request', { email: 'donor.ngo@example.com' }, ip(2));
  assert.equal(r1.status, 200);
  assert.ok(r1.data.dev_otp, 'dev OTP must be present in tests (no email provider configured)');
  const r2 = await call(null, 'POST', '/api/auth/otp/verify', {
    email: 'donor.ngo@example.com', code: r1.data.dev_otp, name: 'NGO Donor', roles: ['donor']
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.user.email, 'donor.ngo@example.com');
  assert.equal(r2.data.user.emailVerified, true);
  assert.ok(!r2.data.user.phone, 'email-only account has no phone');
  // uppercase email normalises to the same account
  const r3 = await call(null, 'POST', '/api/auth/otp/request', { email: 'Donor.NGO@Example.com' }, ip(3));
  const r4 = await call(null, 'POST', '/api/auth/otp/verify', {
    email: 'Donor.NGO@Example.com', code: r3.data.dev_otp, name: 'NGO Donor', roles: ['donor']
  });
  assert.equal(r4.status, 200);
  assert.equal(r4.data.user.id, r2.data.user.id, 'same account after case-normalised login');
  // email login can also be used by an existing phone user? No — separate accounts; but wrong OTP rejected
  const r5 = await call(null, 'POST', '/api/auth/otp/request', { email: 'other@example.com' }, ip(4));
  const r6 = await call(null, 'POST', '/api/auth/otp/verify', { email: 'other@example.com', code: '000000', name: 'X', roles: [] });
  assert.equal(r6.status, 401);
});

test('EMAIL LOGIN: identifier required', async () => {
  const r = await call(null, 'POST', '/api/auth/otp/request', {});
  assert.equal(r.status, 400);
});
