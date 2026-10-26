# Data inventory

This lists personal information the Hotel Day Club app actually stores, from the code in this repository. It is not a legal opinion. The privacy policy it is compared with is `legal/privacy-policy.md`, served at `/privacy` (draft, pending legal review). Quotes below are from that file.

The app does not take payment. Checkout shows disabled card fields and the text "This is a mock checkout. No card is needed and nothing is charged."

## Where it is stored

| Store | What | When |
| --- | --- | --- |
| SQLite file | The tables below | `DB_PATH` if set, otherwise `DATA_DIR/daypass.db` if `DATA_DIR` is set, otherwise `data/daypass.db`. On Render without `DATA_DIR` this file is on the ephemeral disk and is wiped on deploy. |
| `DATA_DIR/backups/` (or `data/backups/` when `DATA_DIR` is unset) | Up to 14 SQLite snapshots, `hdc-YYYY-MM-DD-HHmm.sqlite` | Automatic only when `DATA_DIR` is set (3:30am Australia/Sydney, and at startup if the newest file is older than 24 hours). Manual backup from `/admin/backups` always works. Same contents as the live database, including every row below. |
| `DATA_DIR/uploads/` | Image files served at `/uploads/<file>` when `DATA_DIR` is set | No upload form exists. The directory is created so a later image file can live on the disk. Nothing is written there today. Stock photos stay in `public/assets/photos` and are not personal data. |
| Process memory | Waitlist, booking-lookup and admin-login counters keyed by IP | Not written to SQLite. Cleared when the process stops. Admin login locks for 15 minutes after 5 failures. Booking lookups allow 30 in 15 minutes. |
| stdout / Render logs | Waitlist fields, and a generated admin password if `ADMIN_PASSWORD` is missing | The generated demo hotel password is not written to the log. See Logs below. Render keeps logs on its own schedule. This app does not delete them. |
| Optional webhook | Waitlist row plus `WAITLIST_WEBHOOK_TOKEN` | `POST` to `WAITLIST_WEBHOOK_URL` when that variable is set. The README script appends the row to a Google Sheet. |
| Browser | Signed `admin` cookie (value `jason`) and signed `hotel` cookie (hotel id) | httpOnly, SameSite=Lax, 12-hour expiry. Secure when `NODE_ENV` is `production`. No server-side session table. No guest account cookie. |
| Google Analytics | Page views on public guest pages | Measurement ID `G-9F5ZH1T4YN` in production unless `GA_MEASUREMENT_ID` overrides it. Not loaded on `/hotel` or `/admin`. A booking confirmation is sent as path `/booking` and title `Booking`, so the booking code in the address bar is not the hit path. The waitlist success page can send a `generate_lead` event with no name or email. |

There is no separate session store, no payment table, and no copy of a photo ID.

## Tables and columns

Demo hotels and sample bookings are inserted only when `hotels` is empty. Sample booking rows use names and `@example.com` addresses from `seed.js`, with `bookings.seeded = 1`. They are not a guest's data, but they sit in the same columns. A later boot does not delete existing rows. `seedPerformance` can insert more sample rows for `demo-%` hotels where the sample fill is short. `npm run seed` is separate: it deletes the database file and starts again.

### `bookings` (a guest's booking)

Written by `POST /book`.

| Column | Contents |
| --- | --- |
| `guest_name` | Name typed at checkout |
| `email` | Email typed at checkout (trimmed, not lower-cased) |
| `phone` | Mobile typed at checkout |
| `code` | Booking code. New bookings use `HDC-` plus 32 hex characters. Older `HDC-` plus digits still open `/booking/<code>` |
| `date`, `qty`, `party`, `unit_price`, `total`, `status`, `pass_type_id`, `hotel_id` | The day, spots, party size, price and hotel |
| `checked_in_at` | Set when a hotel checks the guest in. Empty until then |
| `rules_ack_at`, `terms_ack_at`, `risk_ack_at` | Timestamps of the three required checkboxes |
| `rules_text`, `risk_text` | Full pool-rules text and risk-warning text at the time of booking |
| `marketing_opt_in` | `1` if the optional "Email me about day passes" box was ticked, otherwise `0` |
| `cancel_note` | The free-cancellation sentence for that date (for example `Free cancellation until …`). Not a note the guest wrote |
| `created_at` | Insert time |
| `seeded`, `refunded` | Sample-data flag, and a refund flag used by demo history. Live checkout does not set `refunded` |

There is no IP column, no card column, and no version id separate from the stored text.

### `booking_addons`

Add-on name, quantity and price for a booking. No name or email of its own. Tied to `booking_id`.

### `guest_notes`

A hotel user can log a no-show or an incident from the guest list (`POST /hotel/note`). Columns: `booking_id`, `hotel_id`, `kind` (`no_show` or `incident`), `note` (optional free text, max 200 characters), `created_at`, `seeded`. The note can contain whatever the hotel types, including health details. There is no review step and no deletion control in the app.

### `waitlist`

Written by `POST /waitlist`. The same email updates the existing row (`ON CONFLICT`).

| Column | Contents |
| --- | --- |
| `email` | Required. Stored lower-case |
| `first_name` | Optional |
| `place` | Optional suburb or postcode |
| `role` | `guest` or `hotel` |
| `hotel_name` | Optional, kept only when role is `hotel` |
| `destination` | Optional destination name |
| `created_at`, `updated_at` | Insert and last update |

The public site does not list these rows. Admin can delete one row (`POST /admin/waitlist/delete`). That does not delete a Google Sheet row, a log line, or a backup file.

### `hotels` (hotel staff and listing)

Not guest checkout data. Still personal where it names a person.

| Column | Contents |
| --- | --- |
| `contact_name`, `contact_email` | Shown on the admin pending list. Not shown on the public listing |
| `login` | Hotel username |
| `password` | scrypt hash (`scrypt$…` with a per-password salt). Plaintext values are hashed on startup. `demo-` logins are re-hashed when they do not match the current `DEMO_HOTEL_PASSWORD`. The hash is not shown on a page, in the hotels CSV, or in the log |
| `address`, `lat`, `lng` | Shown on the public listing (Getting there). Demo values are fictional addresses from `arrival.js` |
| `name`, `area`, hours, rules, prices | Listing content. Public when the hotel is active |

`hotels.marketing_opt_in` exists (default 0) and no application code writes it.

`/hotel/join` does not create a hotel. It redirects to `/for-hotels`.

### Not personal on their own

`listing_views` stores `hotel_id`, `day`, `views`, `seeded`. A count only. No IP, no cookie id. `pass_types`, `addons`, `inclusions`, `hotel_hours`, `blocked_dates`, `day_caps` are hotel configuration. `blocked_dates.reason` and inclusion `note` are free text a hotel types. They are not a guest record unless someone writes a person's name into them.

## Who can see it

- **Anyone** can open an active listing, which shows the hotel name, area, address and map pin. They cannot see the waitlist, guest names, or hotel passwords.
- **Anyone who knows a booking code** can open `/booking/<code>` with no login. The page shows a masked name (first name and last initial), a masked email (`j***@gmail.com`), the code, hotel, date, pass, party size, status, add-ons, a QR of the code, an add-to-calendar file and a directions link. It does not show the full name, the full email, or the mobile number. The page is `noindex` (`X-Robots-Tag` as well as the meta tag) and `robots.txt` disallows `/booking/`. Lookups are limited to 30 per address per 15 minutes.
- **A logged-in hotel** sees, for its own bookings, guest name, email and mobile on the dashboard table, plus code, date, pass, party, add-ons, rules-accepted flag and guest notes. Lookup also matches email and phone. The printable list and the night-before email preview show name, code, pass, party and notes, not email or mobile. Check-in shows the guest name.
- **Admin** (`admin` cookie after logging in as `jason`) sees every hotel, every booking (name, email, phone), guest notes, and the waitlist. Admin can download the SQLite backup and the CSV files. Hotel CSV columns are id, slug, name, area, status, login, contact name, contact email and address. The password column is not exported. Booking CSV includes name, email, mobile and the booking fields, not the stored rules text.
- **The waitlist webhook**, if configured, receives email, first name, place, role, hotel name and destination.
- **Google Analytics** receives the page path as implemented above. The code does not put the guest name, email, phone or booking code in the GA config or the lead event.

Unauthenticated requests to `/admin`, `/admin/backups`, `/admin/backups/latest`, `/admin/export/bookings.csv`, `/admin/export/hotels.csv` and `/admin/waitlist.csv` are redirected to `/admin/login`. `/healthz` is public and returns only `{"ok":true,"db":true}` or, on failure, `{"ok":false,"db":false}`.

## How long it is kept

There is no retention job and no configured number of days.

- Bookings, add-ons, guest notes, acceptance text and `marketing_opt_in` stay until someone deletes the database. The app has no "delete this booking" or "cancel this booking" action. Check-in only sets `checked_in_at`.
- Waitlist rows stay until an admin deletes that row, or the database is wiped.
- Backups keep the newest 14 snapshots and delete older backup files. A row deleted from the live database can still be in a backup until that file ages out. Restore-aside files (`daypass.db.before-restore-<timestamp>`) are not pruned by the backup job.
- Rate-limit IPs last for the life of the process, inside a 15-minute window.
- This repository does not set a log retention period.
- Google Analytics retention is Google's, not a setting in this app.

## How a guest can ask for deletion

The waitlist form says to email the contact address (default `hello@hoteldayclub.com.au`, or `CONTACT_EMAIL`) to unsubscribe or ask for deletion. The privacy policy says the same. There is no self-serve delete page, no unsubscribe link in the app, and no mailbox inside the app.

An admin can delete a waitlist row from `/admin`. Nothing in the admin UI deletes a booking, a guest note, or a backup. Someone with the database file, or the restore script, can delete rows by hand. A backup downloaded earlier is a separate copy and is not updated when the live row is deleted.

## Logs

When `WAITLIST_WEBHOOK_URL` is unset, every successful signup logs the email, first name, place, role, hotel name and destination (`waitlist.js`, "stored locally"). The same fields are logged if the webhook URL is invalid, the webhook returns an error, it times out, or the database insert throws (`server.js`). A successful webhook logs only the HTTP status, not the row.

If `ADMIN_PASSWORD` is unset at startup, `passwords.js` generates a password and writes it to the log. If `DEMO_HOTEL_PASSWORD` is unset, a password is generated and is not written to the log, so demo hotel login will not work until the variable is set and the process restarts. Set both variables.

The in-memory rate limit uses `req.ip` and does not log it on its own.

## What does not match `/privacy`

These are differences between the code and the draft policy. They are not a rewrite of the policy.

1. **Payment provider.** The policy says: "Payment details: handled by our payment provider Stripe. We see only limited details (for example, card type, last 4 digits, and payment status). We don't store full card numbers." The app has no Stripe client, no charge, and no card fields stored. Checkout labels the card inputs as a demo and disables them.

2. **IP address on acceptance.** The policy says acceptance records include "when you accepted our Terms, the hotel's rules and the risk warning, which version you saw, and the IP address used." The booking row stores the three timestamps and the full rules and risk text. It does not store an IP address, and it does not store a separate version number.

3. **What the hotel sees.** Section 5 says the hotel receives "your name, booking code, pass and party size (and any notes you add)". The hotel dashboard also shows the guest's email and mobile. Checkout's own note says "We use your name, email and mobile to hold this booking and show it to the hotel." That checkout sentence matches the dashboard. Section 5 does not list email or mobile.

4. **Booking link.** The policy does not describe `/booking/<code>`. Anyone with the code can open that page with no login. The page shows a masked name (first name and last initial) and a masked email, plus the code, hotel, date, pass, party size and status. It does not show the full name, the full email, or the mobile number. The policy still needs a sentence if that page stays public. Suggested wording is in `docs/policy-fixes-needed.md`.

5. **No-show notes.** The policy's incident line is "if the hotel reports an incident or refused entry linked to your booking, a short note of what happened." The app also stores `kind = no_show`, with the same free-text note. There is no refused-entry flag separate from that note.

6. **Marketing send and unsubscribe.** The policy says: "We send marketing emails or SMS (for example, hot-day alerts, new hotels and offers) only if you've opted in. Every marketing message identifies us and has an unsubscribe option, and we act on unsubscribes within 5 working days." The app stores `marketing_opt_in` and does not send email or SMS at all. The confirmation page says "No email is sent in this demo." There is no unsubscribe route and no record of an unsubscribe. The only in-product instruction is to email the contact address.

7. **Security claims.** The policy says: "We use reasonable steps to protect personal information: access controls, strong passwords and two-factor authentication on admin accounts, encrypted connections, and giving hotels only the minimum details." Hotel passwords are scrypt hashes, compared in constant time. Admin login is still one shared password, compared in constant time, with a lockout after 5 failures in 15 minutes. The admin cookie is HttpOnly, SameSite=Lax, expires after 12 hours, and is Secure when `NODE_ENV` is `production`. There is no second factor. If `COOKIE_SECRET` is unset, cookies are signed with the fixed default in `server.js`. A logged-in hotel still sees email and mobile for its own bookings, which is more than the "minimum details" list in section 5. A hotel's queries are limited to that hotel's id.

8. **Retention.** The policy says: "We keep booking and payment records for as long as needed for tax and legal purposes. We delete or de-identify guest lists and marketing data when no longer needed. Hotels are asked to delete guest lists after the visit." There are no payment records. There is no deletion or de-identification job, no maximum age, and no message in the product asking a hotel to delete a guest list. Guest lists, notes and the marketing flag remain in SQLite, and in backups, until a person removes them.

9. **Communications.** The policy lists "Communications: emails, messages and complaints you send us." The app does not store inbound email or a complaint form. Contact is a `mailto:` link.

10. **Server logs and backups.** The policy does not mention server logs or database backups. Logs can contain the full waitlist row (item above). Backups and the admin CSV downloads are extra copies of the booking, hotel and waitlist data. The 14 backup files are not described as a retention period.

11. **Waitlist connection.** This part matches the code. The policy says: "The list is stored in the site database. If a waitlist connection is turned on, we also send a copy to that store so the list survives a server reset. We do not send your waitlist details to Google Analytics. A successful signup can record a lead event with no name, email or other personal details." The fields in section 1 and section 3 (email, first name, suburb or postcode, guest or hotel, hotel name, destination) are the columns the form saves. The log line in item 10 is the part the policy does not mention.

The Google Analytics sentences in section 2 match the snippet in `server.js`: public guest pages only, no name, email, phone or booking code in the hit, and the lead event has no personal details.
