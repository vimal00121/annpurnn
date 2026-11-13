// Seeds demo data for local development and testing.
const { db, now, notify } = require('./lib/db');
const { hashPassword } = require('./lib/auth');

const existing = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (existing > 0) {
  console.log('[ANNPURNN] Database already seeded; skipping.');
  process.exit(0);
}

function user(phone, name, roles, area, flags = {}) {
  const info = db.prepare(
    `INSERT INTO users (phone, name, roles, langs, area, phone_verified, donor_verified, helper_verified)
     VALUES (?, ?, ?, 'gu', ?, ?, ?, ?)`
  ).run(phone, name, roles, area,
    flags.pv ? 1 : 0, flags.dv ? 1 : 0, flags.hv ? 1 : 0);
  return Number(info.lastInsertRowid);
}

const seeker = user('+919800000001', 'Seema Ben', 'seeker', 'Adajan', { pv: 1 });
const donor = user('+919800000002', 'Rajesh Patel', 'donor', 'Vesu', { pv: 1, dv: 1 });
const donor2 = user('+919800000003', 'Meena Shah', 'donor,helper', 'Adajan', { pv: 1, dv: 1, hv: 1 });
const helper = user('+919800000004', 'Arjun Bhai (NGO Volunteer)', 'helper', 'Varachha', { pv: 1, hv: 1 });
const admin = user('+919800000009', 'ANNPURNN Admin', 'admin', 'Nanpura', { pv: 1 });

function request(creator, opts) {
  const info = db.prepare(
    `INSERT INTO food_requests
     (code, creator_id, beneficiary_alias, is_anonymous, created_by_helper, helper_consent_confirmed,
      food_desc, people_count, veg_pref, area, collection_time, fulfilment_mode, urgency_note,
      accessibility_note, status, allow_multiple_donors)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.code, creator, opts.alias ?? null, opts.anon === 0 ? 0 : 1, opts.helper ? 1 : 0,
    opts.helper ? 1 : 0, opts.food, opts.people, opts.veg, opts.area, opts.time,
    opts.mode || 'pickup', opts.urgency || null, opts.access || null, opts.status || 'open',
    opts.multi ? 1 : 0
  );
  const id = Number(info.lastInsertRowid);
  db.prepare(
    'INSERT INTO request_private (request_id, exact_address, contact_phone, safe_collection_point, supporting_info) VALUES (?, ?, ?, ?, ?)'
  ).run(id, opts.address ?? null, '+919800000001', opts.point ?? null, opts.supporting ?? null);
  db.prepare('INSERT INTO request_events (request_id, actor_id, to_status) VALUES (?, ?, ?)').run(id, creator, 'open');
  return id;
}

request(seeker, {
  code: 'REQ-SRT-2025-000001', food: 'Cooked dal, rice and sabzi for family', people: 4,
  veg: 'veg', area: 'Adajan', time: 'Today 7:00 PM', urgency: 'No cooking gas since morning',
  address: 'Flat 12, Shanti Apartments, Near Adajan Cross Road'
});
request(seeker, {
  code: 'REQ-SRT-2025-000002', food: 'Any vegetarian meal', people: 2,
  veg: 'veg', area: 'Vesu', time: 'Tomorrow 1:00 PM', mode: 'pickup_or_delivery',
  access: 'Wheelchair user, ground-floor collection preferred',
  address: 'Shop 4, Vesu Main Road lane 2'
});
request(helper, {
  code: 'REQ-SRT-2025-000003', helper: true, anon: 1, food: 'Simple khichdi for elderly person', people: 1,
  veg: 'veg', area: 'Varachha', time: 'Today 8:00 PM',
  point: 'Varachha Bus Stop community centre', supporting: 'Beneficiary cannot use a mobile phone. Volunteer will collect.'
});
request(helper, {
  code: 'REQ-SRT-2025-000004', helper: true, anon: 1, food: 'Chapati and tea for 6 homeless people', people: 6,
  veg: 'veg', area: 'Sahara Darwaja', time: 'Today 9:30 PM', multi: 1,
  point: 'Night shelter near Sahara Darwaja bridge'
});

function donation(donorId, opts) {
  const info = db.prepare(
    `INSERT INTO donations (code, donor_id, title, description, quantity, portions, veg, ingredients,
     allergens, storage_conditions, prepared_at, safe_until, area, pickup_available, delivery_available, status, safety_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 'passed')`
  ).run(opts.code, donorId, opts.title, opts.desc, opts.qty, opts.portions, opts.veg ? 1 : 0,
    opts.ingredients || null, opts.allergens || null, opts.storage || null, opts.prepared, opts.until, opts.area,
    opts.pickup === 0 ? 0 : 1, opts.delivery ? 1 : 0);
  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO donation_private (donation_id, exact_address, contact_phone) VALUES (?, ?, ?)')
    .run(id, opts.address ?? null, '+919800000002');
  return id;
}

donation(donor, {
  code: 'DON-SRT-2025-000001', title: 'Fresh Gujarati thali (30 portions)', desc: 'Surplus from a family function: rotli, dal, bhat, shaak. Freshly cooked this afternoon.',
  qty: '30 thalis', portions: 30, veg: 1, ingredients: 'Wheat, toor dal, rice, seasonal vegetables, ghee',
  allergens: 'Contains dairy (ghee, dahi)', storage: 'Kept hot above 60°C in insulated boxes',
  prepared: '2025-01-01 15:00', until: '2025-01-01 20:00', area: 'Vesu', delivery: 1,
  address: 'A-7, Riverview Flats, Vesu'
});
donation(donor2, {
  code: 'DON-SRT-2025-000002', title: 'Farsan and snacks (20 packets)', desc: 'Unopened packets of farsan from a shop closing stock, well within expiry.',
  qty: '20 packets', portions: 20, veg: 1, ingredients: 'Gram flour, oils, spices',
  allergens: 'May contain peanuts', storage: 'Sealed packets, room temperature',
  prepared: '2025-01-01 10:00', until: '2025-01-03 18:00', area: 'Adajan',
  address: 'Shreeji Farsan Mart, Adajan'
});

db.prepare(`INSERT INTO food_events (title, organiser, area, starts_at, ends_at, description) VALUES
  ('Sunday Langar', 'Gurudwara Sahib Seva Society', 'City Light', '2025-01-05 12:00', '2025-01-05 15:00', 'Free community langar for everyone. No questions asked.'),
  ('Food Drive - Udhna', 'ANNPURNN Volunteers', 'Udhna', '2025-01-07 18:00', '2025-01-07 21:00', 'Weekly evening food distribution near Udhna railway station.')`);

db.prepare(`INSERT INTO restaurant_offers (restaurant_name, area, headline, details) VALUES
  ('Kathiyawadi Kitchen', 'Piplod', '20% off lunch thali (paid ad)', 'Sponsored advertisement. Not a food donation.')`);

db.prepare(`INSERT INTO affiliate_deals (product_name, sponsor, category, url, price_text) VALUES
  ('Steel tiffin boxes (2pc)', 'Amazon', 'kitchen', 'https://www.amazon.in/s?k=steel+tiffin', '₹499'),
  ('Bulk rice 10kg', 'Flipkart', 'grocery', 'https://www.flipkart.com/search?q=rice+10kg', '₹549')`);

db.prepare('INSERT INTO ad_revenue (source, ref_id, amount_paise, note) VALUES (?, 1, 150000, ?), (?, 1, 4500, ?)')
  .run('restaurant', 'Monthly restaurant ad slot', 'affiliate', 'Jan affiliate commission');

notify(seeker, 'welcome', { message: 'Welcome to ANNPURNN. You can request food free of charge, always.' });

console.log('[ANNPURNN] Seed complete.');
console.log('  Admin login phone: +919800000009 (OTP shown in server console in dev mode)');
console.log('  Donor: +919800000002 | Seeker: +919800000001 | Helper: +919800000004');
