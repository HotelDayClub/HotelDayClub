# Hotel Day Club: clickable demo

*Hotel life, by the day.* This is a working demo of a Sydney hotel pool and spa day-pass marketplace, built for sales pitches. Every hotel is a **fictional demo listing** shown with stock mood photos (credits are in `public/assets/CREDITS.md`). No real payments are taken.

**Stack:** Node 20, Express, server-rendered HTML, and SQLite via `better-sqlite3`. The QR codes come from the `qrcode` package. There are no external accounts and no build step. The styles reuse the brand mockup's `styles.css`, with `public/app.css` added on top.

## Run it
```bash
npm install          # once, from the repo root
npm start            # http://localhost:3030, or the port in PORT. Seeds demo data if the database is missing or empty.
npm run seed         # optional reset: recreates data/daypass.db with 6 demo hotels and about 270 sample bookings
npm run bg           # runs in the background on http://localhost:3030, with an auto-restart loop (log: server.log)
npm test             # Playwright end-to-end test; it also refreshes screenshots/
```
Run `npm run seed` before each pitch to reset the data. Sample bookings are dated relative to today.

## Deploy on Render
`render.yaml` is a Blueprint for a free Node web service. The build command is `npm install` and the start command is `npm start`. Render sets `PORT`; the app listens on that port and the health check path is `/`. The free tier disk is ephemeral, so a missing or empty SQLite database is seeded automatically on startup.

## Demo logins
| Who | URL | Username | Password |
|---|---|---|---|
| The Saltwater Terrace (Demo), Eastern Beaches | /hotel | `demo-saltwater` | `demo1234` |
| Skyline Rooftop Hotel (Demo), North Sydney | /hotel | `demo-skyline` | `demo1234` |
| Harbourside Lido (Demo), CBD | /hotel | `demo-harbourside` | `demo1234` |
| Palm Court Resort (Demo), Parramatta | /hotel | `demo-palmcourt` | `demo1234` |
| Manly Sands House (Demo), Northern Beaches | /hotel | `demo-manly` | `demo1234` |
| Bayview Spa Hotel (Demo), Eastern Suburbs | /hotel | `demo-bayview` | `demo1234` |
| Admin (Jason) | /admin | `jason` | `admin1234` |

The hotel login page also has one-click demo login buttons.

## What it does
- **Guest flow:** search by area, date and seating type. Open a listing and pick a spot the hotel defined (sun lounger, daybed, cabana, pool chair, general entry, or their own name), with how many people it holds, the price, and how many are left. Optional add-ons (gym, parking, a food and drink credit, a cabana, a towel and robe pack, late access) can be added on the listing and at checkout, and the total updates. Per-person add-ons follow the number of people, not just the number of spots. The pool rules are on the listing, and the guest ticks them at checkout. Remaining spots update live from `/api/availability`. The confirmation page shows an `HDC-xxxxx` code, the seating, any add-ons, and a QR code.
- **Availability:** each seating type has a daily cap, and remaining spots = cap − booked. Blocked dates, days outside a hotel's day-pass days, past dates, sold-out seating, and same-day bookings after that hotel's cutoff can't be booked. The server re-checks availability inside a SQLite transaction, so the last spot can't be sold twice.
- **Demo props:** The Saltwater Terrace's daybeds (for 2, six a day) are sold out on the next open weekday. Each hotel has its own seating, weekday hours, and pool rules. One rooftop keeps the last hour for room guests. One indoor pool has summer hours. Listings show New until there are verified reviews.
- **Hotel setup:** Become a partner (`/hotel/join`, also linked from How it works and the hotel login) and Settings (`/hotel/settings`) capture seating, weekly hours, an optional season, a same-day cutoff, an optional room-guest block, and pool rules. New sign-ups stay pending until an admin approves them, so they don't appear on the public site.
- **Hotel dashboard (`/hotel`):** stats broken down by seating type (spots and people), gross including add-ons, hotel share at 75%, platform commission at 25%. Today's guest list shows the seating, party size, rules acknowledgement and add-ons, and it refreshes on its own. The check-in page (`/hotel/checkin`) does the same, with a booking code box. Also a booking lookup, a 14-day availability grid, upcoming guests, add-on prices and caps, and a month calendar for blocking or unblocking dates.
- **Admin (`/admin`):** pending partner hotels with an Approve button, all bookings across hotels, totals per hotel, and commission totals at 25% of gross (including add-ons), with filters by hotel and by code, name or email.
- **How it works (`/how-it-works`):** guest steps, hotel partner terms, and an FAQ. Linked from the header and the footer.

## Going live: what's still needed
1. **Hosting:** Vercel (porting to Next.js is straightforward because routes map one to one) or Render or Fly.io for this Express app as is.
2. **Hosted database:** Supabase Postgres (or Neon). Swap `better-sqlite3` for Postgres or Prisma. The schema is in `db.js`.
3. **Payments: Stripe Connect.** Onboard each hotel as an Express connected account. Use destination charges with `application_fee_amount` = 25%, so 75% goes to the hotel. Add webhooks to confirm bookings, plus refunds and cancellations.
4. **Real auth:** proper hotel staff accounts with hashed passwords or magic links, roles, and password reset (for example Supabase Auth). The demo uses plaintext seeded passwords and signed cookies.
5. **Email and SMS confirmations** (for example Postmark or Resend, and Twilio), and a phone-camera QR scanner for check-in.
6. Legal: terms, a privacy policy, waivers and age checks (see `../05-legal-risk.md`). Real hotel photos and names only once partner agreements are signed. Get trade mark clearance for the name.
7. Ops: timezone handling (it currently uses the server's local time, set to Sydney), rate limiting, CSRF tokens, backups and monitoring.

## Screenshots
`screenshots/{home,listing,checkout,confirmation,hotel-dashboard,admin}-{desktop,mobile}.png`
