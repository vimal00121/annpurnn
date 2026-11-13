# ANNPURNN — Architecture (MVP)

> Connect surplus food with people who need it. Free forever, with dignity and privacy.

## 1. Product principles

1. **Donated food is always free.** No paywall, ads or commission can ever sit between a food seeker and food.
2. **Dignity by design.** No poverty proof, no humiliating photos, no public personal stories.
3. **Privacy by separation.** Sensitive data (exact addresses, phones, beneficiary names) lives in isolated tables and is served only to matched participants.
4. **Commercial sections are quarantined.** Restaurant Offers and Daily Deals have dedicated tables, APIs and screens, and are always labelled as sponsored.
5. **Same backend for web and Android.** The Android app (future) consumes the same REST API with Bearer-token auth; session cookies exist only for the web client.

## 2. System overview

```
┌───────────────────────────┐        ┌───────────────────────────┐
│  Mobile-first Web SPA     │        │  Future Android app       │
│  public/ (vanilla JS)     │        │  (same REST API, Bearer)  │
└─────────────┬─────────────┘        └─────────────┬─────────────┘
              │  HTTPS + session cookie             │  HTTPS + Bearer token
              ▼                                     ▼
        ┌─────────────────────────────────────────────────┐
        │  Node.js HTTP server (server/index.js)          │
        │  • Router + RBAC middleware                     │
        │  • OTP auth, sessions, rate limits              │
        │  • Privacy filter: public vs private columns    │
        │  • Audit + product analytics                    │
        └───────────────┬─────────────────────────────────┘
                        ▼
        ┌─────────────────────────────────────────────────┐
        │  SQLite (server/lib/schema.sql)                 │
        │  Public tables  ── safe columns only            │
        │  *_private      ── addresses, phones, aliases   │
        │  audit_log, analytics_events, rate_limits       │
        └─────────────────────────────────────────────────┘
```

### Why this stack for the MVP
- **Zero runtime dependencies** — `node:sqlite`, `node:http`, `node:crypto`. Nothing to patch, nothing to supply-chain-audit, runs anywhere Node ≥ 22.13 runs.
- **SQLite (WAL)** — perfect for a city-scale MVP; the data layer is isolated in `server/lib/db.js` + `schema.sql`, so moving to PostgreSQL later is a contained change.
- **REST + JSON** — the exact contract an Android app needs.

## 3. Roles and permissions

| Role | Can |
|---|---|
| Food Seeker (`seeker`) | Create own food requests, claim donations, chat, report, block |
| Food Donor (`donor`) | Browse/accept requests, list donations, approve claims, offer delivery, chat |
| Community Helper (`helper`) | Everything a seeker does **plus** create requests *for someone else* (requires `helper_verified`) |
| Admin (`admin`) | Verification, moderation, complaints, analytics, ads, audit log |

Roles are stored as CSV on `users.roles`; a user can hold several. Every admin route calls `requireRole('admin')`; every mutating route calls `requireAuth` / `requireRole`. See `docs/API.md` for the full matrix.

## 4. Privacy architecture (the core of the design)

- `food_requests` holds **only public-safe columns**. `beneficiary_alias`, exact address and phone are **not** in it.
- `request_private` / `donation_private` are separate tables. Public list endpoints never join them.
- `attachPrivate()` is the single choke point that attaches private data — and only when the caller is the creator, the accepted donor (or approved claimer), or an admin.
- Phones are additionally **masked** (`+91•••••123`) even for participants; real contact happens through in-app chat.
- Beneficiary photos are optional, require an explicit consent flag, and are stored in a private upload dir served only to logged-in sessions.
- Test-enforced: `tests/api.test.js` fails if any address/phone/name leaks into a public response.

## 5. Key flows

### Request lifecycle (Features A + B)
```
open ──accept(donor, BEGIN IMMEDIATE race-guard)──▶ accepted
accepted ──donor marks ready──▶ ready
accepted/ready ──both parties confirm──▶ completed   (one-sided confirm is recorded, other side is notified)
any active state ──▶ cancelled (by creator/donor/admin)
```
- `allow_multiple_donors = 1` lets additional donors accept; otherwise the second accept gets `409`.
- Every transition writes `request_events` (status history + who confirmed what).

### Helper flow (Feature C)
`helper` role + `helper_verified` + explicit `helper_consent_confirmed` → request is labelled **“Created by a community helper”**, beneficiary anonymous by default, photo only with recorded consent.

### Donation flow (Feature E)
Listing → automatic safety screening (prohibited items, deadline sanity) → **admin safety review (`passed`)** → visible in browse → claim → donor approves → address shared privately → matched/completed.

## 6. Abuse prevention
- OTP issue: 5 / 15 min per phone, 10 / hour per IP.
- Requests: 10 / day per user; duplicate detector blocks same area+people-count while a request is active.
- Messages: 10 / minute per user; abuse keyword flagging → moderation audit.
- Reports: 10 / day per user. Admins can suspend/ban accounts.

## 7. Scalability path
1. **Now:** single Node process + SQLite. Fine for a Surat launch (thousands of requests/day).
2. **Next:** move DB to PostgreSQL (swap `server/lib/db.js`), add Redis for rate limits/sessions, put Nginx in front for TLS.
3. **Later:** extract notification service (FCM for Android push), object storage (S3-compatible) for photos, read replicas for the feed.

## 8. Module map

| Path | Purpose |
|---|---|
| `server/index.js` | HTTP server, static files, route registration |
| `server/lib/schema.sql` | Full DB schema |
| `server/lib/db.js` | DB handle, audit, analytics, notifications |
| `server/lib/auth.js` | OTP, sessions (scrypt/HMAC), RBAC |
| `server/lib/web.js` | Router, JSON, cookies, security headers, static |
| `server/lib/requests.js` | Validation, duplicate detection, status machine |
| `server/lib/ratelimit.js` | SQLite-backed fixed-window limiter |
| `server/routes/*.js` | auth, requests, donations, chat, notifications, upload, admin, commerce |
| `public/` | Web SPA (mobile-first) |
| `public/admin.html` | Admin & moderation dashboard |
| `tests/api.test.js` | 22 end-to-end API tests |
