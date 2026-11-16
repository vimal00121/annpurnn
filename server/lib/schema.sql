PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,              -- stored E.164, never shown publicly
  name TEXT NOT NULL,
  langs TEXT NOT NULL DEFAULT 'en',
  roles TEXT NOT NULL DEFAULT 'seeker',    -- csv: seeker,donor,helper,admin
  phone_verified INTEGER NOT NULL DEFAULT 0,
  donor_verified INTEGER NOT NULL DEFAULT 0,
  helper_verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',   -- active | suspended | banned
  area TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Public request data. Everything in this table is safe to expose in the
-- public feed. Names, exact addresses and phone numbers are NOT here.
CREATE TABLE IF NOT EXISTS food_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,               -- public request id, e.g. REQ-SRT-000123
  creator_id INTEGER NOT NULL REFERENCES users(id),
  beneficiary_alias TEXT,                  -- first name or anonymous label, optional
  is_anonymous INTEGER NOT NULL DEFAULT 1,
  created_by_helper INTEGER NOT NULL DEFAULT 0,
  helper_consent_confirmed INTEGER NOT NULL DEFAULT 0,
  food_desc TEXT NOT NULL,
  people_count INTEGER NOT NULL,
  veg_pref TEXT NOT NULL DEFAULT 'veg',    -- veg | nonveg | any
  area TEXT NOT NULL,                      -- neighbourhood only, never exact address
  collection_time TEXT NOT NULL,
  fulfilment_mode TEXT NOT NULL DEFAULT 'pickup', -- pickup | pickup_or_delivery
  urgency_note TEXT,                       -- optional, public
  accessibility_note TEXT,                 -- optional, public
  status TEXT NOT NULL DEFAULT 'open',     -- open|accepted|ready|completed|cancelled
  allow_multiple_donors INTEGER NOT NULL DEFAULT 0,
  photo_path TEXT,                         -- OPTIONAL; only with recorded consent
  photo_consent_confirmed INTEGER NOT NULL DEFAULT 0,
  assigned_donor_id INTEGER REFERENCES users(id),
  dup_key TEXT,                            -- duplicate-detection fingerprint
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  ready_at TEXT,
  completed_at TEXT
);

-- Sensitive request data in an isolated table. Only served to the matched
-- donor/seeker pair after acceptance (and to admins). Public API never joins it.
CREATE TABLE IF NOT EXISTS request_private (
  request_id INTEGER PRIMARY KEY REFERENCES food_requests(id),
  exact_address TEXT,
  contact_phone TEXT,
  safe_collection_point TEXT,
  supporting_info TEXT
);

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES food_requests(id),
  actor_id INTEGER REFERENCES users(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,               -- public id, e.g. DON-SRT-000123
  donor_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  photo_path TEXT,
  quantity TEXT,
  portions INTEGER,
  veg INTEGER NOT NULL DEFAULT 1,          -- 1 veg, 0 non-veg
  ingredients TEXT,
  allergens TEXT,
  storage_conditions TEXT,
  prepared_at TEXT,
  safe_until TEXT NOT NULL,                -- safe collection deadline
  area TEXT NOT NULL,
  pickup_available INTEGER NOT NULL DEFAULT 1,
  delivery_available INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available', -- available|matched|completed|expired|removed
  safety_review TEXT NOT NULL DEFAULT 'pending', -- pending|passed|rejected
  safety_review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  matched_request_id INTEGER REFERENCES food_requests(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Private exact address for donations; shared only after a claim is accepted.
CREATE TABLE IF NOT EXISTS donation_private (
  donation_id INTEGER PRIMARY KEY REFERENCES donations(id),
  exact_address TEXT,
  contact_phone TEXT
);

CREATE TABLE IF NOT EXISTS donation_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donation_id INTEGER NOT NULL REFERENCES donations(id),
  requester_id INTEGER NOT NULL REFERENCES users(id),
  request_id INTEGER REFERENCES food_requests(id),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|completed|declined
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES food_requests(id),
  donation_id INTEGER REFERENCES donations(id),
  participant_a INTEGER NOT NULL REFERENCES users(id),
  participant_b INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id),
  target_type TEXT NOT NULL,               -- request|donation|user|message
  target_id INTEGER NOT NULL,
  category TEXT NOT NULL,                  -- suspicious|safety|fraud|abuse|other
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',     -- open|reviewing|resolved|dismissed
  resolution_note TEXT,
  handled_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocker_id INTEGER NOT NULL REFERENCES users(id),
  blocked_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  meta TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS food_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  organiser TEXT,
  area TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

-- Community chat: one open room where members can talk. Logged-in users only,
-- rate-limited, abuse-flagged for moderation. Admins can remove messages.
CREATE TABLE IF NOT EXISTS community_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  removed_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_messages_recent ON community_messages (removed, id);

-- Product analytics (DAU/MAU, funnel events). Never contains private data.
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON food_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_area ON food_requests(area);
CREATE INDEX IF NOT EXISTS idx_requests_creator ON food_requests(creator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_analytics_name ON analytics_events(name, created_at);
