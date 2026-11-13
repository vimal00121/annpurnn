# Screens & Navigation

## Web app (`public/index.html`, mobile-first SPA, hash routing)

| Screen | Route | Purpose |
|---|---|---|
| Home | `#/` | Hero + 7 tiles: Request Food, Donate Food, Help Someone, Community Requests, Food Events, Restaurant Offers*, Daily Deals* |
| Login / Sign-up | `#/auth` | Phone + OTP; role selection (seeker / donor / helper) |
| Request Food | `#/request/new` | Core Feature A form (privacy notes inline) |
| Request for Someone | `#/request/new?for=someone` | Core Feature C helper form (consent + anonymity controls) |
| Community Requests | `#/requests` | Two tabs (seekers / helper-created) + filters (area, preference, min people) |
| Request detail | `#/request/:id` | Full card, status history, accept / ready / complete / cancel / report, private collection details when authorised |
| Donate Food form | `#/donate/new` | Core Feature E listing form with allergens, storage, deadline |
| Donations feed | `#/donations` | Available listings (only after admin safety review) |
| Donation detail | `#/donation/:id` | Food details, safety disclaimer, claim / report |
| My account | `#/me` | Profile, verification badges, my requests, my donations, logout |
| Conversations | `#/threads` | Chat threads list |
| Chat thread | `#/chat/:id` | Real-time-ish chat (3 s poll) |
| Notifications | `#/notifications` | In-app notifications with deep links |
| Safety centre | `#/safety` | Food-safety guidance, prohibited foods, disclaimer, reporting info |
| Food events | `#/events` | Langars, food drives |
| Restaurant Offers* | `#/offers` | Paid ads, always labelled “Sponsored — not a food donation” |
| Daily Deals* | `#/deals` | Affiliate links with `rel="nofollow sponsored"`, labelled |

\* Commercial sections: separate routes, separate tables, separate APIs, always disclosed.

**Bottom navigation:** Home · Requests · Donate · Safety · Me.
**Language switcher:** EN → ગુજરાતી → हिन्दी (top bar, persisted).

## Admin dashboard (`public/admin.html`)

| Tab | Content |
|---|---|
| Analytics | 14 KPIs (DAU/MAU, fulfilment, donors, revenue…) |
| Users | Search, verify donor/helper, suspend/ban |
| Requests | All requests with status + helper flag |
| Donations | Safety review pass/reject |
| Complaints | Report queue: reviewing → resolved/dismissed |
| Advertising | Restaurant offers + affiliate deals + revenue |
| Audit log | Last 300 sensitive actions with actor + IP |

## Status indicators (consistent everywhere)

`Open` (gold) → `Accepted` (blue) → `Ready for collection` (green) → `Completed` (grey) / `Cancelled` (light grey).
