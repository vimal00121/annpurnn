const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Lightweight migrations for databases created before email login existed.
(function migrate() {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (userCols.length && !userCols.includes('email')) {
    // users.phone used to be NOT NULL; rebuild so email-only accounts are possible.
    db.exec(`
      ALTER TABLE users RENAME TO users_old;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE,
        email TEXT UNIQUE,
        name TEXT NOT NULL,
        langs TEXT NOT NULL DEFAULT 'en',
        roles TEXT NOT NULL DEFAULT 'seeker',
        phone_verified INTEGER NOT NULL DEFAULT 0,
        email_verified INTEGER NOT NULL DEFAULT 0,
        donor_verified INTEGER NOT NULL DEFAULT 0,
        helper_verified INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        area TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users (id, phone, name, langs, roles, phone_verified, donor_verified, helper_verified, status, area, created_at, updated_at)
        SELECT id, phone, name, langs, roles, phone_verified, donor_verified, helper_verified, status, area, created_at, updated_at FROM users_old;
      DROP TABLE users_old;
    `);
    console.log('[ANNPURNN] migrated users table for email login');
  }
  const otpCols = db.prepare('PRAGMA table_info(otp_codes)').all().map((c) => c.name);
  if (otpCols.length && !otpCols.includes('email')) {
    db.exec('ALTER TABLE otp_codes ADD COLUMN email TEXT');
  }
})();

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function audit(actorId, actorRole, action, entityType, entityId, meta, ip) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, meta, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(actorId ?? null, actorRole ?? null, action, entityType ?? null, entityId ?? null,
    meta ? JSON.stringify(meta) : null, ip ?? null);
}

function track(userId, name, meta) {
  db.prepare('INSERT INTO analytics_events (user_id, name, meta) VALUES (?, ?, ?)')
    .run(userId ?? null, name, meta ? JSON.stringify(meta) : null);
}

function notify(userId, type, payload) {
  db.prepare('INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)')
    .run(userId, type, JSON.stringify(payload ?? {}));
}

module.exports = { db, now, audit, track, notify, config };
