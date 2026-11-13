# Food Safety Workflow

> ANNPURNN is a connection platform. **It never guarantees food safety.** Donors are responsible for what they share; seekers should inspect food before eating. This is stated in-app on every donation detail and in the Safety Centre.

## 1. Listing-time screening (automatic, `server/routes/donations.js`)
Every donation is checked before it can be listed:
- Safe collection **deadline is mandatory**.
- Deadline must not precede preparation time.
- Prohibited items rejected: alcohol, tobacco/paan, raw meat/fish/eggs, unpasteurised products.
- Donor must declare veg/non-veg; allergens and storage conditions fields provided.

## 2. Admin safety review (before visibility)
- New listings enter `safety_review: pending` and are **invisible in the public feed**.
- An admin passes or rejects each listing in the dashboard (Donations tab), with a note; decision is audit-logged.
- Rejected listings never become visible; reporters can flag live listings too.

## 3. Guidance shown to everyone (`GET /api/safety/rules`, Safety Centre screen)
- Share only food you would serve your own family.
- Cooked food collected within 2 hours, or held hot > 60 °C / cold < 5 °C.
- Veg and non-veg packed and labelled separately.
- Honest allergen declaration; clean sealed packaging; state storage conditions.
- Prohibited list (see above) plus: no reheated-more-than-once food, no opened/tampered packets, no home-canned items.

## 4. Trust rules
- An uploaded photo or a user's claim is **never** treated as proof of safety or of genuine need.
- Donor verification badges and completion history help seekers choose.
- Every donation detail page shows the non-guarantee disclaimer and links to the Safety Centre.
- Suspicious listings can be reported by any logged-in user (rate-limited) and land in the admin complaints queue.

## 5. Before public launch (checklist)
- [ ] Legal review of donor terms: donor responsibility, Good-Samaritan framing consistent with FSSAI food-donation guidance.
- [ ] Partner with local food-safety trainers for donor onboarding material (English/Gujarati/Hindi).
- [ ] Incident workflow: food-safety complaint → admin `reviewing` → donor suspension pending investigation → record outcome.
- [ ] Consider optional FSSAI-registered kitchen partnerships for high-volume donors.
- [ ] Temperature/logistics guidance for delivery volunteers.
