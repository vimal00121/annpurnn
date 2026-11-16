# Backend API & Permissions

Base URL: `/api`. Auth: `annpurnn_session` HttpOnly cookie (web) or `Authorization: Bearer <token>` (Android-ready). All errors: `{ "error": "message" }` with proper HTTP status.

## Permission matrix

| Endpoint | Anonymous | Seeker | Donor | Helper | Admin |
|---|---|---|---|---|---|
| `POST /auth/otp/request`, `/auth/otp/verify` (phone **or email**) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /requests`, `/donations`, `/events`, `/safety/rules` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET·POST /community/messages` (community chat) | ❌ | ✅ | ✅ | ✅ | ✅ |
| `GET /requests/:id` | public columns only | + own private | + matched private | + own private | + all private |
| `POST /requests` | ❌ | ✅ (own) | ✅ | ✅ (own + on-behalf) | ✅ |
| `POST /requests/:id/accept` | ❌ | ❌ | ✅ | ❌ | ❌* |
| `POST /requests/:id/status` | ❌ | participant | participant | participant | ✅ |
| `POST /donations` | ❌ | ❌ | ✅ | ❌ | ❌* |
| `POST /donations/:id/claim` | ❌ | ✅ | ✅ | ✅ | ✅ |
| `POST /donations/:id/claims/:cid/approve` | ❌ | ❌ | owner only | ❌ | ❌ |
| `GET /threads*`, `POST /threads/:id/messages` | ❌ | participant | participant | participant | ✅ |
| `POST /users/:id/report`, `/block` | ❌ | ✅ | ✅ | ✅ | ✅ |
| `POST /upload` | ❌ | ✅ | ✅ | ✅ | ✅ |
| `GET/PATCH /admin/*` | ❌ | ❌ | ❌ | ❌ | ✅ |

\* Admins act through admin endpoints; direct accept/donate is intentionally donor-only.

## Endpoints

### Auth
- `POST /api/auth/otp/request` `{phone}` → sends OTP (5/15 min per phone, 10/h per IP). Dev mode returns `dev_otp`.
- `POST /api/auth/otp/verify` `{phone, code, name?, roles?}` → `{token, user}`; creates account on first login, merges roles.
- `POST /api/auth/logout` · `GET /api/me` · `PATCH /api/me` `{name?, area?, langs?}`
- `GET /api/meta/areas` → valid Surat areas.

### Requests (Features A–D)
- `POST /api/requests` — `{food_desc, people_count, veg_pref: veg|nonveg|any, area, collection_time, fulfilment_mode: pickup|pickup_or_delivery, urgency_note?, accessibility_note?, exact_address?, allow_multiple_donors?, confirm_duplicate?}`
  Helper mode adds: `on_behalf: true, helper_consent_confirmed: true, is_anonymous, beneficiary_alias?, safe_collection_point?, supporting_info?, photo_path?, photo_consent_confirmed?`
  - `409` on duplicate (same creator + area + people count, active, <12 h) unless `confirm_duplicate`.
  - `400` if helper photo without consent; `403` for non-helpers on behalf / unverified helpers.
- `GET /api/requests?tab=seeker|helper&area=&veg=&min_people=&before=&status=&limit=` — **public columns only**.
- `GET /api/requests/mine` · `GET /api/requests/:id` (private block only for authorised callers).
- `POST /api/requests/:id/accept` — donor; `BEGIN IMMEDIATE` race-guard; `409` if already accepted without `allow_multiple_donors`; creates chat thread; notifies seeker.
- `POST /api/requests/:id/status` `{status: ready|completed|cancelled}` — participants only; completion requires confirmation from both sides (or admin).
- `POST /api/requests/:id/report` `{category, details}` — rate-limited 10/day.

### Donations (Feature E)
- `POST /api/donations` — `{title, description, quantity?, portions?, veg, ingredients?, allergens?, storage_conditions?, prepared_at?, safe_until!, area!, exact_address?, pickup_available?, delivery_available?}` → safety screen (prohibited items, deadline sanity) → `safety_review: pending`.
- `GET /api/donations` — only `available` + `passed` review. `GET /api/donations/mine`, `GET /api/donations/:id`.
- `POST /api/donations/:id/claim` `{request_id?}` → donor notified.
- `POST /api/donations/:id/claims/:claimId/approve|decline` — donor only; approve reveals address to claimer, matches linked request.
- `POST /api/donations/:id/complete` · `POST /api/donations/:id/report`.

### Chat & notifications (Feature B)
- `GET /api/threads` · `GET /api/threads/:id/messages?after=` · `POST /api/threads/:id/messages` (10/min, participant-only, abuse flagging).
- `GET /api/notifications` · `POST /api/notifications/read`.

### Trust & safety (Feature F)
- `POST /api/users/:id/report` · `POST /api/users/:id/block` · `POST /api/users/:id/unblock` · `GET /api/blocks`.
- `POST /api/upload` — raw image body (JPEG/PNG/WebP ≤ 3 MB), stored privately, served only to logged-in sessions via `/uploads/*`.

### Admin (Feature F + dashboard)
- `GET /api/admin/users` · `PATCH /api/admin/users/:id` `{status?, donor_verified?, helper_verified?, roles?}`
- `GET /api/admin/requests` · `GET /api/admin/donations` · `PATCH /api/admin/donations/:id/safety-review` `{safety_review: passed|rejected, note}`
- `GET /api/admin/reports` · `PATCH /api/admin/reports/:id` `{status: reviewing|resolved|dismissed, note}`
- `GET /api/admin/community` · `DELETE /api/admin/community/:id` (remove a chat message)
- `GET /api/admin/audit` · `GET /api/admin/analytics`.

### Community
- `GET /api/events`
- `GET /api/community/messages?after=<id>` · `POST /api/community/messages` `{body}` (login required, 10 msgs/min, abuse-flagged)
- `GET /api/safety/rules`

## Data exposed publicly (explicit list)

Public request objects contain: `id, code, food_desc, people_count, veg_pref, area, collection_time, fulfilment_mode, urgency_note, accessibility_note, status, allow_multiple_donors, created_by_helper, is_anonymous, timestamps`.
They **never** contain: beneficiary alias, exact address, phone numbers, creator identity, private supporting info.
