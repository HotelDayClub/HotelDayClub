# Hotel Day Club: clickable demo

*Hotel life, by the day.* This is a working demo of a day-pass product. Every hotel is a **fictional example listing** shown with stock mood photos (credits are in `public/assets/CREDITS.md`). Nothing here is a real hotel, and no real payments are taken.

**Stack:** Node 20, Express, server-rendered HTML, and SQLite via `better-sqlite3`. The QR codes come from the `qrcode` package. There is no build step. The homepage is the Golden Hour design (`public/golden/`). Fraunces, Inter and Caveat are self-hosted. Other pages share that header, footer and palette via `public/golden/site.css`, on top of `styles.css` and `app.css`.

## Run it
```bash
npm install          # once, from the repo root
npm start            # http://localhost:3030, or the port in PORT. Seeds demo data if the database is missing or empty.
npm run seed         # optional reset: deletes the SQLite file and recreates it with 6 demo hotels and about 270 sample bookings. Do not run this on Render.
npm run restore -- /path/to/hdc-YYYY-MM-DD-HHmm.sqlite   # stop the server first. See "Restore a backup" below.
npm run bg           # runs in the background on http://localhost:3030, with an auto-restart loop (log: server.log)
npm test             # Playwright end-to-end test; it also refreshes screenshots/
```
Run `npm run seed` before each pitch to reset the data. Sample bookings are dated relative to today.

## Deploy on Render
`render.yaml` is a Blueprint for a free Node web service. The build command is `npm install` and the start command is `npm start`. Render sets `PORT`; the app listens on that port and the health check path is `/healthz`. That URL returns `{ok:true, db:true}` after a trivial database read. It is not a page, it is not in the sitemap, and `robots.txt` disallows it.

With no `DATA_DIR`, the database stays at `data/daypass.db` inside the app directory. On Render's free plan that disk is ephemeral, so a missing or empty SQLite database is seeded on startup and the data is wiped on every deploy. Listing view counts and the analytics history live in that same database, so they reset when the disk does. Sample figures on a demo hotel are marked Example data. Nothing else changes when `DATA_DIR` is unset: local development and the free plan keep today's paths.

### Persistent disk
SQLite only survives deploys when it lives on a disk Render does not wipe. Persistent disks are not available on the free plan. They require a paid instance (Starter or above), and that service can run only one instance.

Do this once, in order, after this version is deployed:

1. While the service is still on the old disk, log in at `/admin`, open **Backups and exports**, and use **Back up now**, **Download latest backup**, and the three CSV links. Keep those files somewhere off Render (Google Drive is enough). The first boot on a new empty disk does not copy the old database. It seeds demo data, because the old file is not on the new disk.
2. In the Render dashboard, open the `hotel-day-club` service. Go to **Settings**. Change **Instance type** from Free to **Starter**. Save. Render restarts the service. This is a short outage.
3. Open **Disks** (in the service menu) and choose **Add disk**. Name: `hdc-data`. Mount path: `/var/data`. Size: **1 GB** (enough for this SQLite file and 14 backups). Save. Render restarts again. A service with a disk cannot scale past one instance, and every later deploy restarts that one instance, so deploys have a short gap rather than a rolling restart.
4. Open **Environment**. Add `DATA_DIR` with the value `/var/data`. Do not set `DB_PATH` unless you need a different file path. Save. `DATA_DIR` is listed in `render.yaml` with `sync: false`, so a later blueprint sync does not wipe it. Leave the blueprint `plan` as `free` in git. Syncing that blueprint after the upgrade can try to move the service back to Free, which cannot keep the disk.
5. Wait for the deploy. The database file will be `/var/data/daypass.db`. Uploaded images, when that folder is used, will be `/var/data/uploads`. Backups will be `/var/data/backups`. On an empty disk the app seeds demo hotels once, because there are no hotel rows yet. Later boots do not replace a database that already has hotels. They add any missing columns. Demo hotels can still gain extra sample bookings where that sample history is short of its target. Rows you restored are not deleted.
6. Confirm `https://www.hoteldayclub.com.au/healthz` returns `{"ok":true,"db":true}`. In **Settings**, **Health Check Path** should be `/healthz` (the blueprint sets this).
7. To put the pre-disk backup back: suspend the service so the process is stopped, get the `.sqlite` file onto the machine, and run the restore command below with `DATA_DIR=/var/data`. Then resume the service. Starting the app against a database that already has hotels does not overwrite it.

`DB_PATH`, if set, is the SQLite file and wins over `DATA_DIR`. Tests use that. Backups and uploads still follow `DATA_DIR` when it is set.

Automatic backups run only when `DATA_DIR` is set: at 3:30am Australia/Sydney, and at startup if the newest backup is older than 24 hours. Each file is `hdc-YYYY-MM-DD-HHmm.sqlite`, written with SQLite's online backup (not a copy of the live file). The newest 14 are kept. Success and failure are printed in the service logs. A backup on the same disk does not protect you if that disk is deleted. Download the file from Admin for a copy off Render.

### Restore a backup
Stop the server first. From the repo root, with `DATA_DIR` or `DB_PATH` pointing at the database you mean to replace:

```bash
npm run restore -- /var/data/backups/hdc-YYYY-MM-DD-HHmm.sqlite
```

The script prints both paths and asks you to type `YES`. It copies the current database to a sibling file named `daypass.db.before-restore-<timestamp>` and then replaces it. `--yes` skips the prompt when there is no terminal. Start the server after it finishes. Do not run `npm run seed` on that database. Seed deletes the file.

Set `ADMIN_PASSWORD` and `DEMO_HOTEL_PASSWORD` in the Render dashboard. Both are listed in `render.yaml` with `sync: false`, so a blueprint sync does not overwrite them. The public login pages do not show these passwords.

Public guest pages load Google Analytics 4. `GA_MEASUREMENT_ID` sets the measurement ID and defaults to `G-9F5ZH1T4YN` when the app runs with `NODE_ENV=production`. An empty value turns it off. It is not loaded on hotel or admin pages, and a booking confirmation is reported as `/booking` so the booking code is not sent. Local and test runs skip it unless `GA_MEASUREMENT_ID` is set. A successful waitlist signup can send a `generate_lead` event with no personal details.

## Launch waitlist
The homepage has a waitlist form. Each signup is saved in SQLite and, if you connect a spreadsheet, sent there as well. On the free plan the disk is wiped on every deploy, so the spreadsheet is the copy that lasts. With `DATA_DIR` pointed at a persistent disk, the SQLite row survives deploys. Keep a downloaded backup or the spreadsheet as well: a backup stored on the same disk is not an off-server copy. If the spreadsheet is not connected, or the send fails, the visitor still sees a success message. The signup is written to the server log, and it stays in SQLite until that database is removed.

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

Passwords are not printed on the site, and the login pages have no one-click demo buttons. `DEMO_HOTEL_PASSWORD` is the password for every `demo-` hotel. `ADMIN_PASSWORD` is the admin password. Set both before you start the server. Hotel passwords are stored as scrypt hashes. On startup, a stored value that is still plaintext is hashed, and a `demo-` login is updated when it does not match the current `DEMO_HOTEL_PASSWORD`. If `DEMO_HOTEL_PASSWORD` is unset, a password is generated for that process and is not written to the log, so demo hotel login will not work until you set the variable and restart. If `ADMIN_PASSWORD` is unset, that generated password is still written once to the server log. Admin login allows 5 failures per address, then waits 15 minutes. The admin cookie is HttpOnly, SameSite=Lax, expires after 12 hours, and is Secure when `NODE_ENV` is `production`. There is no second factor. `COOKIE_SECRET` is generated by Render. In production, a missing value or the built-in demo value is refused: the process logs an error and signs cookies with a random secret held only in memory, so sessions reset on restart.

## What it does
- **Guest flow:** search by area, date and what you want (pool, gym, spa, or pool and spa). Open a listing and pick a pass the hotel defined (sun lounger, daybed, cabana, pool chair, general entry, or their own name), with how many guests it covers and the price. Optional add-ons (gym, parking, a food and drink credit, a cabana, a towel and robe pack, late access) can be added on the listing and at checkout, and the total updates. Per-person add-ons follow the number of people, not just the number of spots. Late access is offered only when the pool stays open after day-pass hours, and it ends at the pool's closing time. The pool rules are on the listing. At checkout the guest ticks the pool rules, the customer terms and the risk warning in three separate boxes, and sees the free-cancellation time for that date. Remaining spots update live from `/api/availability`. The confirmation page shows a long `HDC-` code, the pass, any add-ons, the cancellation time, a QR code, an add-to-calendar link and directions. The guest's name is shortened to a first name and initial, and the email is masked. Older short codes still open. The page is `noindex`, and lookups are limited per address.
- **Availability:** each seating type has a daily cap, and remaining spots = cap − booked. Blocked dates, days outside a hotel's day-pass days, past dates, sold-out seating, and same-day bookings after that hotel's cutoff can't be booked. The server re-checks availability inside a SQLite transaction, so the last spot can't be sold twice.
- **Demo props:** The Saltwater Terrace's daybeds (for 2, six a day) are sold out on the next open weekday. Each hotel has its own seating, open days, and pool rules. Demo listings are open on Saturday and Sunday unless that hotel has unticked the day. One rooftop keeps the last hour for room guests, so day passes end when that hour starts. One indoor pool has summer hours. Listings say New. The site does not show star ratings or reviews.
- **For hotels:** The public page is `/for-hotels`, linked from the header, the footer, the homepage and How it works. It explains the idea and asks a hotel to email us. `/hotel/join` redirects there, so a hotel cannot create its own listing from the site. Hotel login stays in the footer. Settings (`/hotel/settings`) still covers passes, weekly hours, what's included, getting there, an optional season, a same-day cutoff, an optional room-guest block, and pool rules for a hotel that is already signed in. Hotel login is at `/hotel/login` and is linked from How it works. It is not in the public footer, and neither is Admin.
- **Hotel dashboard (`/hotel`):** stats broken down by seating type (spots and people), gross including add-ons, hotel share at 75%, platform commission at 25%. **Analytics (`/hotel/analytics`)** shows the last 7, 30 or 90 days: bookings, gross revenue and your payout (what the hotel receives), fill rate against the daily cap, bookings by seating type and weekday, cancellations, refunds and no-shows, and listing views with a view-to-booking ratio. Views are a daily total stored on the server. No third-party analytics and no personal data. Demo listings are badged Example data. There is no guest-rating feature, so analytics does not show one. Today's guest list shows the seating, party size, rules acknowledgement and add-ons, and it refreshes on its own. Pause today or tomorrow, or cap the spots for today, from the top of the dashboard. The check-in page (`/hotel/checkin`) scans a booking QR with the phone camera or takes a code, and says clearly if a pass is valid, already used, for the wrong date, or cancelled. Each guest row can log a no-show or an incident. `/hotel/print` is a printable list with tick boxes. `/hotel/email-preview` is the night-before guest list, with working one-click pause and cap links. Also a booking lookup, a 14-day availability grid, upcoming guests, add-on prices and caps, and a month calendar for blocking or unblocking dates.
- **Admin (`/admin`):** pending sign-ups with an Approve button, all bookings across hotels, totals per hotel, commission totals at 25% of gross (including add-ons), guest notes (no-shows and incidents), and the launch waitlist with a CSV download at `/admin/waitlist.csv`. Filters cover hotel and code, name or email. **Backups** (`/admin/backups`) shows the last backup time and size, **Back up now**, **Download latest backup**, and CSV downloads for bookings, hotels (no passwords) and the waitlist. Those routes use the same admin login as the rest of `/admin`. They are not in the sitemap.
- **How it works (`/how-it-works`):** guest steps, a section for hotels, and a short FAQ. Linked from the header and the footer. A fuller FAQ is at `/faq`.
- **Draft legal pages:** `/privacy`, `/terms` (from `legal/customer-terms.md`), `/refunds` and `/risk` are marked draft. They stay in the footer and at checkout, and they are `noindex, follow` until `LEGAL_PAGES_INDEXABLE` is `true`. `/faq` is linked from the footer. Checkout and hotel sign-up link to the privacy page and include an unticked marketing checkbox that is not required to continue. A short banner on every page says the listings are examples. Gift cards and 5-pass packs are not sold. The footer always shows Hotel Day Club and its ABN. `ABN` overrides the number and defaults to 98 227 458 028. `CONTACT_EMAIL` is the only public contact address, used as a mailto link in the footer, FAQ, terms, privacy policy and refunds. It defaults to hello@hoteldayclub.com.au.

## SEO checklist
Public marketing pages (home, for hotels, how it works, FAQ, guides, and destination pages) are `index, follow` when `SITE_INDEXABLE` is unset or `true`. Draft legal pages (`/privacy`, `/terms`, `/refunds`, `/risk`) stay in the footer and are `noindex, follow`, and they are left out of the sitemap, until `LEGAL_PAGES_INDEXABLE` is `true` (also `1`, `on` or `yes`). Unset or empty leaves them out of search. Demo listings, checkout, booking confirmations, `/admin` and `/hotel` stay `noindex`. `robots.txt` allows the public site, disallows those private paths, and points at `https://www.hoteldayclub.com.au/sitemap.xml`. The sitemap never lists a demo hotel.

`SITE_INDEXABLE=false` (also `0`, `off` or `no`) switches the whole site to `noindex, nofollow` and makes `robots.txt` a single `Disallow: /` with no sitemap line. Leave it `true` in production unless you need to pull the site out of search quickly. An empty value is the same as `true`.

What still has to be done by hand:

1. In [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters), add the property `https://www.hoteldayclub.com.au`. Put the verification token in `GOOGLE_SITE_VERIFICATION` or `BING_SITE_VERIFICATION` on Render (both are `sync: false` in `render.yaml`). The matching meta tag is rendered only when the value is set.
2. Submit `https://www.hoteldayclub.com.au/sitemap.xml`.
3. Point the bare domain at the host. `http://hoteldayclub.com.au` and `http://www.hoteldayclub.com.au` only 301 to `https://www.hoteldayclub.com.au` once the request reaches this app. If the apex times out, DNS is not sending it here. In Render, add `hoteldayclub.com.au` as a custom domain (redirect or alias to `www`). In DNS, `www` should be a CNAME to the Render hostname, and the apex needs the A or ALIAS record Render shows for that domain. The app cannot fix a name that never resolves.
4. A new hotel is indexed when `is_demo` is `0`, which is the default. Demo rows are forced back to `is_demo=1` on startup when the login starts with `demo-` or the name contains `(Demo)`. Do not use that login or that suffix for a real hotel. Do not add reviews, ratings or made-up counts.
5. The share image is already at `/assets/og-image-1200x630.png`. Keep using a file we host.

## Going live: what's still needed
1. **Hosting:** Vercel (porting to Next.js is straightforward because routes map one to one) or Render or Fly.io for this Express app as is.
2. **Hosted database:** Supabase Postgres (or Neon). Swap `better-sqlite3` for Postgres or Prisma. The schema is in `db.js`.
3. **Payments: Stripe Connect.** Onboard each hotel as an Express connected account. Use destination charges with `application_fee_amount` = 25%, so 75% goes to the hotel. Add webhooks to confirm bookings, plus refunds and cancellations.
4. **Real auth:** hotel staff accounts with password reset, roles, and a second factor. Demo hotel passwords are scrypt hashes checked with a constant-time compare. Admin is still one shared password, with a per-address lockout, and there is no two-factor step.
5. **Email and SMS confirmations** (for example Postmark or Resend, and Twilio). The check-in page already scans a booking QR with the phone camera. `/hotel/email-preview` only simulates the night-before guest list.
6. Legal: replace the draft pages in `legal/` with signed terms, a privacy policy, waivers and age checks. Then set `LEGAL_PAGES_INDEXABLE` to `true` on Render so `/privacy`, `/terms`, `/refunds` and `/risk` can be indexed. Use real hotel photos and names only after that hotel has agreed to be listed. Get trade mark clearance for the name.
7. Ops: timezone handling (it currently uses the server's local time), rate limiting and CSRF tokens. Nightly SQLite backups and `GET /healthz` are in place once `DATA_DIR` is set. See the persistent-disk steps above. A personal-data inventory is in `docs/data-inventory.md`.

## Screenshots
`screenshots/{home,listing,checkout,confirmation,hotel-dashboard,admin}-{desktop,mobile}.png`
