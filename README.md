# Hotel Day Club: clickable demo

*Hotel life, by the day.* This is a working demo of a day-pass product. Every hotel is a **fictional example listing** shown with stock mood photos (credits are in `public/assets/CREDITS.md`). Nothing here is a real hotel, and no real payments are taken.

**Stack:** Node 20, Express, server-rendered HTML, and SQLite via `better-sqlite3`. The QR codes come from the `qrcode` package. There is no build step. The homepage is the Golden Hour design (`public/golden/`). Fraunces, Inter and Caveat are self-hosted. Other pages share that header, footer and palette via `public/golden/site.css`, on top of `styles.css` and `app.css`.

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
`render.yaml` is a Blueprint for a free Node web service. The build command is `npm install` and the start command is `npm start`. Render sets `PORT`; the app listens on that port and the health check path is `/`. The free tier disk is ephemeral, so a missing or empty SQLite database is seeded automatically on startup. Listing view counts and the analytics history live in that same database, so they reset when the disk does. Sample figures on a demo hotel are marked Example data.

Set `ADMIN_PASSWORD` and `DEMO_HOTEL_PASSWORD` in the Render dashboard. Both are listed in `render.yaml` with `sync: false`, so a blueprint sync does not overwrite them. The public login pages do not show these passwords.

Public guest pages load Google Analytics 4. `GA_MEASUREMENT_ID` sets the measurement ID and defaults to `G-9F5ZH1T4YN` when the app runs with `NODE_ENV=production`. An empty value turns it off. It is not loaded on hotel or admin pages, and a booking confirmation is reported as `/booking` so the booking code is not sent. Local and test runs skip it unless `GA_MEASUREMENT_ID` is set. A successful waitlist signup can send a `generate_lead` event with no personal details.

## Launch waitlist
The homepage has a waitlist form. Each signup is saved in SQLite and, if you connect a spreadsheet, sent there as well. Render's free disk is wiped on every deploy, so the spreadsheet is the copy that lasts. If the spreadsheet is not connected, or the send fails, the visitor still sees a success message. The signup is written to the server log, and it stays in SQLite until the next deploy.

The public form asks for an email. First name, suburb or postcode, and destination are optional. The person chooses "I'm a guest" or "I'm a hotel". A hotel can add a hotel name. A destination card with no listings opens the form with that destination selected, and the destination is stored with the signup. The same email updates the existing row instead of adding a second one. A hidden field catches simple bots. More than 8 submissions from one address in 15 minutes are asked to wait. The public site never lists other people's signups.

Admin, after you log in at `/admin`, has a Waitlist section and a CSV download at `/admin/waitlist.csv`. Delete removes a row from this server. It does not edit the spreadsheet.

To keep signups in a Google Sheet:

1. Create a Google Sheet. You can rename the first tab to Waitlist.
2. In the sheet, open Extensions, then Apps Script. Delete the sample code and paste the script below. Replace the secret with a long random string you keep private. Do not put that secret in this repository.
3. Click Deploy, then New deployment, then the gear, then Web app. Set "Execute as" to Me, and "Who has access" to Anyone. Deploy and copy the web app URL. It ends in `/exec`. Authorise the script when Google asks.
4. In Render, open the hotel-day-club service, then Environment. Add `WAITLIST_WEBHOOK_URL` and paste the web app URL. Add `WAITLIST_WEBHOOK_TOKEN` and paste the same secret that is in the script. Save. Render redeploys. Both keys are in `render.yaml` with `sync: false`, so a later blueprint sync does not wipe them.
5. Submit a test on the homepage, then check the sheet for a new row. You can delete that test from Admin and from the sheet.

Until step 4 is done, download `/admin/waitlist.csv` before you redeploy if you need the rows. After a deploy the on-server copy is gone. The sheet is not.

```javascript
var SECRET = 'paste the same value as WAITLIST_WEBHOOK_TOKEN';

function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('bad json');
  }
  if (SECRET && data.token !== SECRET) {
    return ContentService.createTextOutput('forbidden');
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['received_at', 'email', 'first_name', 'place', 'role', 'hotel_name', 'destination']);
  }
  sheet.appendRow([
    new Date(),
    data.email || '',
    data.first_name || '',
    data.place || '',
    data.role || '',
    data.hotel_name || '',
    data.destination || ''
  ]);
  return ContentService.createTextOutput('ok');
}
```

The token is checked by the script and is not written to the sheet. Leave `SECRET` as an empty string only if you accept that anyone with the web app URL could add rows.

## Logins
Demo hotel usernames are `demo-saltwater`, `demo-skyline`, `demo-harbourside`, `demo-palmcourt`, `demo-manly` and `demo-bayview`. The admin username is `jason`.

Passwords are not printed on the site, and the login pages have no one-click demo buttons. `DEMO_HOTEL_PASSWORD` is the password for every `demo-` hotel. `ADMIN_PASSWORD` is the admin password. If either variable is unset when the server starts, that password is generated for the process and written only to the server log. On the next start with the variable still unset, a new password is generated and the demo hotel rows are updated to match.

## What it does
- **Guest flow:** search by area, date and seating type. Open a listing and pick a spot the hotel defined (sun lounger, daybed, cabana, pool chair, general entry, or their own name), with how many people it holds, the price, and how many are left. Optional add-ons (gym, parking, a food and drink credit, a cabana, a towel and robe pack, late access) can be added on the listing and at checkout, and the total updates. Per-person add-ons follow the number of people, not just the number of spots. Late access is offered only when the pool stays open after day-pass hours, and it ends at the pool's closing time. The pool rules are on the listing. At checkout the guest ticks the pool rules, the customer terms and the risk warning in three separate boxes, and sees the free-cancellation time for that date. Remaining spots update live from `/api/availability`. The confirmation page shows an `HDC-xxxxx` code, the seating, any add-ons, the cancellation time, and a QR code.
- **Availability:** each seating type has a daily cap, and remaining spots = cap − booked. Blocked dates, days outside a hotel's day-pass days, past dates, sold-out seating, and same-day bookings after that hotel's cutoff can't be booked. The server re-checks availability inside a SQLite transaction, so the last spot can't be sold twice.
- **Demo props:** The Saltwater Terrace's daybeds (for 2, six a day) are sold out on the next open weekday. Each hotel has its own seating, open days, and pool rules. Demo listings are open on Saturday and Sunday unless that hotel has unticked the day. One rooftop keeps the last hour for room guests, so day passes end when that hour starts. One indoor pool has summer hours. Listings say New. The site does not show star ratings or reviews.
- **Hotel setup:** List a hotel (`/hotel/join`, also linked from How it works and the hotel login) and Settings (`/hotel/settings`) capture seating, weekly hours, an optional season, a same-day cutoff, an optional room-guest block, and pool rules. New sign-ups stay pending until an admin approves them, so they don't appear on the public site. An optional marketing checkbox is separate from the application.
- **Hotel dashboard (`/hotel`):** stats broken down by seating type (spots and people), gross including add-ons, hotel share at 75%, platform commission at 25%. **Analytics (`/hotel/analytics`)** shows the last 7, 30 or 90 days: bookings, gross revenue and your payout (what the hotel receives), fill rate against the daily cap, bookings by seating type and weekday, cancellations, refunds and no-shows, and listing views with a view-to-booking ratio. Views are a daily total stored on the server. No third-party analytics and no personal data. Demo listings are badged Example data. There is no guest-rating feature, so analytics does not show one. Today's guest list shows the seating, party size, rules acknowledgement and add-ons, and it refreshes on its own. Pause today or tomorrow, or cap the spots for today, from the top of the dashboard. The check-in page (`/hotel/checkin`) scans a booking QR with the phone camera or takes a code, and says clearly if a pass is valid, already used, for the wrong date, or cancelled. Each guest row can log a no-show or an incident. `/hotel/print` is a printable list with tick boxes. `/hotel/email-preview` is the night-before guest list, with working one-click pause and cap links. Also a booking lookup, a 14-day availability grid, upcoming guests, add-on prices and caps, and a month calendar for blocking or unblocking dates.
- **Admin (`/admin`):** pending sign-ups with an Approve button, all bookings across hotels, totals per hotel, commission totals at 25% of gross (including add-ons), guest notes (no-shows and incidents), and the launch waitlist with a CSV download at `/admin/waitlist.csv`. Filters cover hotel and code, name or email.
- **How it works (`/how-it-works`):** guest steps, a section for hotels, and a short FAQ. Linked from the header and the footer. A fuller FAQ is at `/faq`.
- **Draft legal pages:** `/privacy`, `/terms` (from `legal/customer-terms.md`), `/refunds` and `/risk` are marked draft. `/faq` is linked from the footer. Checkout and hotel sign-up link to the privacy page and include an unticked marketing checkbox that is not required to continue. A short banner on every page says the listings are examples. Gift cards and 5-pass packs are not sold. The footer always shows Hotel Day Club and its ABN. `ABN` overrides the number and defaults to 98 227 458 028. `CONTACT_EMAIL` is the only public contact address, used as a mailto link in the footer, FAQ, terms, privacy policy and refunds. It defaults to hello@hoteldayclub.com.au.

## Going live: what's still needed
1. **Hosting:** Vercel (porting to Next.js is straightforward because routes map one to one) or Render or Fly.io for this Express app as is.
2. **Hosted database:** Supabase Postgres (or Neon). Swap `better-sqlite3` for Postgres or Prisma. The schema is in `db.js`.
3. **Payments: Stripe Connect.** Onboard each hotel as an Express connected account. Use destination charges with `application_fee_amount` = 25%, so 75% goes to the hotel. Add webhooks to confirm bookings, plus refunds and cancellations.
4. **Real auth:** proper hotel staff accounts with hashed passwords or magic links, roles, and password reset (for example Supabase Auth). The demo uses plaintext seeded passwords and signed cookies.
5. **Email and SMS confirmations** (for example Postmark or Resend, and Twilio). The check-in page already scans a booking QR with the phone camera. `/hotel/email-preview` only simulates the night-before guest list.
6. Legal: replace the draft pages in `legal/` with signed terms, a privacy policy, waivers and age checks. Use real hotel photos and names only after that hotel has agreed to be listed. Get trade mark clearance for the name.
7. Ops: timezone handling (it currently uses the server's local time), rate limiting, CSRF tokens, backups and monitoring.

## Screenshots
`screenshots/{home,listing,checkout,confirmation,hotel-dashboard,admin}-{desktop,mobile}.png`
