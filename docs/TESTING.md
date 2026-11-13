# Testing Plan

## Automated suite (`npm test` → `node --test tests/api.test.js`)

22 end-to-end tests run against a real server instance with an isolated temp database. All pass.

| # | Area | What is verified |
|---|---|---|
| 1 | Health | Meta/areas endpoint reachable |
| 2 | Auth | OTP issue + verify, account creation, `phone_verified` |
| 3 | **Privacy** | Public feed contains **no** exact address, **no** phone, **no** beneficiary name; non-participant gets no `private` block on detail |
| 4 | **Duplicate requests** | Identical active request → `409`; `confirm_duplicate` override works |
| 5 | **Accept race** | Two concurrent donors: exactly one `200`, one `409` (BEGIN IMMEDIATE guard) |
| 6 | Multiple contributions | Allowed only when requester sets `allow_multiple_donors` |
| 7 | Single-accept | Second donor blocked when multiples not permitted |
| 8 | Lifecycle | open → accepted → ready → completed with **two-sided confirmation**; one-sided confirm does not complete |
| 9 | **Helper flow** | Unverified helper blocked; consent mandatory; anonymous default; helper-tab routing; public labelling |
| 10 | **Privacy (photo)** | Beneficiary photo without consent → `400` |
| 11 | Role gate | Non-helper cannot create on-behalf requests |
| 12 | **RBAC** | Admin API: `401` anonymous, `403` non-admin, `200` admin |
| 13 | Role gate | Non-donor cannot accept |
| 14 | Chat | Participant-only reads; 10 msg/min rate limit engages |
| 15 | **Food safety** | Prohibited items rejected; deadline mandatory; donor address not public |
| 16 | Donation claim | Admin safety review required; approval shares address privately; status `matched` |
| 17 | Reporting | Report lands in admin queue; admin resolves |
| 18 | Analytics | Counters move after real activity |
| 19 | Audit | `request.accepted`, `request.created_for_beneficiary`, `admin.user_updated` logged |
| 20 | Blocking | User block + list |
| 21 | Rate limits | Request-creation daily cap engages (`429`) |
| 22 | Security | Static path traversal blocked |

## Manual test matrix (before each release)

**Fraudulent requests**
1. Create 11 requests in a day → 11th gets `429`.
2. Same area+people duplicate → warning shown in UI, confirm path works.
3. Report a request → visible in admin complaints; resolve it.

**Privacy protection**
4. Donor browses feed as anonymous visitor → no private fields in network responses (inspect DevTools).
5. Helper creates anonymous request → beneficiary name absent from public API and from other users' detail views.
6. Photo upload without consent checkbox → blocked client- and server-side.
7. Unauthenticated `GET /uploads/<file>` → `401`.

**Core loops**
8. Full journey: seeker request → donor accept → chat both ways → ready → both confirm → completed; check notifications at every step for both parties.
9. Donation journey: list → admin pass → claim → approve → address visible to claimer → complete.
10. Helper journey with delivery mode and safe collection point.
11. Language switch EN/ગુજરાતી/हिन्दी on every screen; status colours consistent.
12. Admin: verify donor, verify helper, suspend user, reject listing, toggle ads, audit log grows.

**Mobile**
13. 360 px viewport: tiles wrap to 2 columns, bottom nav reachable, forms usable one-handed.
14. Slow-3G throttling: SPA still navigates; chat polls degrade gracefully.

## Future automated additions
- Load test (k6): 100 concurrent accepts on one request — assert single winner.
- Fuzzing: malformed JSON, oversized payloads, invalid area codes, unicode names.
- Frontend: Playwright smoke of the three core journeys.
