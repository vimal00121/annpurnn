const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

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
