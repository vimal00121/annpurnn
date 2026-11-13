# Security & Privacy Implementation

## Authentication
- **Phone OTP** (6 digits, HMAC-hashed with the server secret — a DB leak does not reveal codes), 10-minute expiry, max 5 attempts, single use.
- Rate limits: 5 OTPs / 15 min per phone, 10 OTPs / hour per IP.
- Sessions: 256-bit random tokens; only the SHA-256 hash is stored; HttpOnly + SameSite=Lax cookie for web, Bearer tokens for the future Android app; 14-day expiry.
- No passwords to leak; scrypt helper available for future staff accounts.

## Authorization
- Role-based (`seeker`, `donor`, `helper`, `admin`) enforced server-side on every route (`requireAuth`, `requireRole`).
- Object-level checks: only participants read a chat thread; only the matched donor sees a request's private address; only the approved claimer sees a donation's address; only the donor manages claims.
- Self-accept blocked; acceptance requires donor role **and** verified phone.

## Privacy of beneficiaries (non-negotiable rules → code)
| Rule | Implementation |
|---|---|
| No public faces/names/phones/addresses | Public SQL columns exclude them; `request_private`/`donation_private` tables; `attachPrivate()` choke point; test-enforced |
| Photo optional + informed consent | Photo never required; `photo_consent_confirmed` must be true or `400` |
| Anonymous option | `is_anonymous` default 1; alias stored only in private block |
| No poverty proof | No required photos, income fields, or story fields anywhere |
| Helper genuineness | `helper_consent_confirmed` required; helper verification by admin; public label “Created by a community helper” |
| Helper ≠ beneficiary | Separate `creator_id` vs `beneficiary_alias`; helper banner; anonymous default |
| Precise location only when necessary + consent | Address stored privately; revealed only to the accepted donor / approved claimer |

## Data protection
- Phones stored E.164, masked (`+91•••••123`) whenever displayed.
- Photos in private `data/uploads`, served **only** to authenticated sessions; random filenames; MIME + size allow-list (JPEG/PNG/WebP ≤ 3 MB).
- Parameterised SQL everywhere (no string-built queries).
- `audit_log` records actor, role, action, entity, IP for: registrations, logins, request create/accept/status, helper on-behalf creates, uploads, donations, reviews, report handling, admin user changes, ad changes.

## Transport & headers
- CSP (`default-src 'self'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`.
- Path-traversal-safe static server (normalised + prefix check, test-enforced).
- Deploy behind TLS (Nginx/Caddy) — see DEPLOYMENT.md.

## Abuse prevention
| Threat | Mitigation |
|---|---|
| Duplicate/fraudulent requests | Duplicate detector (409) + 10 requests/day + admin report queue |
| Request flooding | Per-user daily caps + OTP-gated accounts + suspension/ban |
| Chat abuse | 10 msg/min, keyword flagging → audit, admin review |
| Fake donors | Phone verification required to accept; donor verification badge; reports |
| Photo misuse | Consent flag, private storage, auth-only serving, 10 uploads/day |
| Scraping private data | Public endpoints physically cannot return private columns |

## Compliance notes
- **FSSAI**: food donors are guided to FSSAI food-donation rules; listings carry allergens/storage/deadline; the app never claims to guarantee safety (`/api/safety/rules` disclaimer shown in-app).
- **DPDP Act 2023 (India)**: purpose-limited collection, consent flags recorded, masked display, deletion path via admin suspension + DB retention policy (see DEPLOYMENT.md hardening).
- Before public launch: add a Terms of Use + Privacy Policy screen, a grievance-officer contact (required for Indian intermediaries), and DPO review.
