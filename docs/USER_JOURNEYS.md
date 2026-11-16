# User Journeys (all four roles)

## Journey 1 — Food Seeker (self-request)

```
Open ANNPURNN
   │
   ▼
Home ──▶ "Request Food" ──▶ Login (phone + OTP, first time)
   │                            │
   │                            ▼
   │                      Fill: food needed, #people, veg/non-veg,
   │                      area, collection time, pickup/delivery,
   │                      optional urgency + accessibility notes,
   │                      exact address (PRIVATE)
   │                            │
   │                    duplicate check ──duplicate──▶ warning → confirm or stop
   │                            │ unique
   │                            ▼
   │                    Request live (status: OPEN) ──▶ donors notified
   │                            │
   │                    donor accepts ──▶ notification + masked phone + chat opens
   │                            │
   │                    see exact collection details (consent already given at creation)
   │                            │
   │                    donor marks READY ──▶ notification
   │                            │
   │                    both confirm ──▶ COMPLETED ──▶ history saved
   ▼
```

**Privacy guarantees:** exact address/phone never public; no photo required; no poverty proof.

## Journey 2 — Food Donor

```
Login (phone + OTP, choose donor role)
   │
   ▼
Browse "Community Food Requests" ── two tabs: seekers | helper-created
   │        filters: area, veg/non-veg, min people, collection time
   │        each card: request ID, quantity, #people, AREA ONLY, time,
   │                   status, pickup/delivery, helper badge
   │
   ├─▶ "Accept Request" (race-safe; 409 if already helped and no multiples allowed)
   │        │
   │        ▼
   │   Chat thread opens ── agree time/place ── exact address revealed
   │        │
   │        ▼
   │   Mark "Ready for Collection" ──▶ seeker notified
   │        │
   │        ▼
   │   Both confirm ──▶ COMPLETED (donation history recorded)
   │
   └─▶ OR "Donate Food": listing with photo, portions, ingredients/allergens,
            storage, safe deadline, pickup/delivery
                 │
                 ▼
         automatic safety screen ──▶ admin safety review ──▶ visible
                 │
             seekers claim ──▶ donor approves ──▶ address shared privately
```

Donors can also **report suspicious requests** from any request card.

## Journey 3 — Community Helper (request on behalf)

```
Login with helper role ──▶ admin verification required (helper_verified)
   │
   ▼
Home ──▶ "Help Someone Get Food"
   │
   ▼
Enter:
  • own contact + account ID (automatic)
  • beneficiary first name OR anonymous identifier (anonymous by default)
  • #people, food, preference
  • general area / safe collection point (bus stop, community centre)
  • preferred collection time
  • whether helper collects, or donor voluntarily delivers
  • optional supporting info
  • photo: OPTIONAL + explicit consent checkbox (never mandatory)
   │
   ▼
Confirm: "This request is genuine and I have permission to submit it"
   │
   ▼
Request created, publicly labelled 🤝 "Created by a community helper"
   │
   ▼
Donor accepts ──▶ chat between DONOR and HELPER ──▶ collection/delivery
```

**Rules enforced by code:** no consent → 400; photo without consent → 400; non-helper → 403; unverified helper → 403; beneficiary anonymous to the public; helper is never presented as the beneficiary.

## Journey 4 — Admin / Moderator

```
/admin ──▶ OTP login (admin account)
   │
   ▼
📊 Analytics   DAU/MAU, requests created/fulfilled, avg fulfilment time,
│              active & repeat donors, helper requests, collections,
│              cancellations, community chat activity
├─▶ 👥 Users          search, verify donor / helper, suspend, ban
├─▶ 🍲 Requests       monitor all requests + statuses (incl. helper-created)
├─▶ 🤲 Donations      food-safety review: pass / reject each listing
├─▶ 🚩 Complaints     suspicious/fraud/safety reports → reviewing → resolved/dismissed
├──▶ 💬 Community chat moderate the open chat room, remove abusive messages
└─▶ 🧾 Audit log      every sensitive action, with actor + IP
```
