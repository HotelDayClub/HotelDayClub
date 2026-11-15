const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ymd, addDays, esc } = require('../util');
const { FOOD_RULE, GuestCheckIn } = require('../offering');
const { TicketView } = require('../bookingPage');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-booking-page-'));
const dbPath = path.join(dir, 'app.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
process.env.ADMIN_PASSWORD = 'booking-page-admin';
process.env.DEMO_HOTEL_PASSWORD = 'booking-page-hotel';
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const db = require('../db');
const { hashPassword } = require('../passwords');
const later = ymd(addDays(new Date(), 40));
const hotelId = db.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo, timezone, state, address, photos, day_entrance, transit_note, lat, lng)
  VALUES ('page-pool', 'Harbour Hotel (Demo)', 'Brisbane', 'page-pool', ?, 'active', 1, 'Australia/Brisbane', 'QLD', '1 Demo St, Brisbane QLD 4000', '["hero-loungers.jpg"]', 'Use the pool door.', 'The station is a short walk.', -27.47, 153.02)`).run(hashPassword('booking-page-hotel')).lastInsertRowid;
for (let weekday = 0; weekday < 7; weekday++) {
  db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)').run(hotelId, weekday, '09:00', '17:00');
}
const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds, kind) VALUES (?, 'lounger', 'Sun lounger', 40, 10, 1, 'lounger')`).run(hotelId).lastInsertRowid;
db.prepare(`INSERT INTO inclusions (hotel_id, code, mode, price, daily_cap, note) VALUES (?, 'towels', 'included', 0, 0, '')`).run(hotelId);
db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, party, status, rules_ack_at, terms_ack_at, risk_ack_at)
  VALUES ('HDC-PAGE01', ?, ?, ?, 1, 40, 40, 'Alex Citizen', 'alex@example.com', '0412345678', 2, 'confirmed', datetime('now'), datetime('now'), datetime('now'))`).run(hotelId, passId, later);
db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, party, status)
  VALUES ('HDC-PAGE02', ?, ?, ?, 1, 40, 40, 'Alex Citizen', 'alex@example.com', '0412345678', 2, 'cancelled')`).run(hotelId, passId, later);
const pageBookingId = db.prepare("SELECT id FROM bookings WHERE code='HDC-PAGE01'").get().id;
const feeAddon = db.prepare("INSERT INTO addons (hotel_id, code, name, price, daily_cap, enabled, sort) VALUES (?, 'fitness', 'Fitness centre access', 25, 20, 1, 1)").run(hotelId).lastInsertRowid;
const carAddon = db.prepare("INSERT INTO addons (hotel_id, code, name, price, daily_cap, enabled, sort) VALUES (?, 'parking', 'Parking', 18, 5, 1, 2)").run(hotelId).lastInsertRowid;
db.prepare('INSERT INTO booking_addons (booking_id, addon_id, name, qty, unit_price, total) VALUES (?, ?, ?, 2, 25, 50)').run(pageBookingId, feeAddon, 'Fitness centre access');
db.prepare('INSERT INTO booking_addons (booking_id, addon_id, name, qty, unit_price, total) VALUES (?, ?, ?, 1, 18, 18)').run(pageBookingId, carAddon, 'Parking');
db.close();

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function mainText(html) {
  const start = html.indexOf('<main>');
  const end = html.indexOf('</main>');
  const main = start >= 0 && end > start ? html.slice(start, end) : html;
  return main.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
}

(async () => {
  const port = 3402;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'booking-page-admin', DEMO_HOTEL_PASSWORD: 'booking-page-hotel' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', chunk => { log += chunk; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
  try {
    const page = await get(port, '/booking/HDC-PAGE01');
    assert.strictEqual(page.status, 200);
    const body = mainText(page.body);
    assert.ok(body.includes('<h1>Your demo booking</h1>'));
    assert.ok(/<span class="tk-ok">Confirmed<\/span>/.test(body));
    assert.ok(body.includes('class="tk-ticket"'));
    assert.ok(body.includes('Harbour Hotel (Demo)'));
    assert.ok(/<dt>Date<\/dt><dd>[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}<\/dd>/.test(body));
    assert.ok(body.includes('<dt>Access</dt><dd>9am\u20135pm</dd>'));
    assert.ok(body.includes('<dt>Pass</dt><dd>Sun lounger</dd>'));
    assert.ok(body.includes('<dt>Guests</dt><dd>2</dd>'));
    assert.ok(/class="tk-dir" href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=/.test(body));
    assert.ok(body.includes('>Directions</a>'));
    assert.ok(body.includes('<span>Fitness centre access \u00d7 2</span><b>$50 (demo)</b>'));
    assert.ok(body.includes('<span>Parking</span><b>$18 (demo)</b>'));
    assert.ok(!/Parking \u00d7 1/.test(body));
    assert.ok(body.includes('Example QR (demo)'));
    assert.ok(body.includes('alt="QR code for booking HDC-PAGE01"'));
    assert.ok(/<img class="qr" src="data:image\/png;base64,/.test(body));
    assert.ok(/data-copy="HDC-[A-Z0-9-]+"/.test(body));
    assert.ok(body.includes('Copy booking ref'));
    assert.ok(body.includes('role="status"'));
    assert.ok(page.body.includes('out.textContent = \'\''), 'copied status clears');
    assert.ok(page.body.includes('}, 3000)'), 'copied status clears after 3s');
    assert.strictEqual((body.match(/class="tk-btn"/g) || []).length, 1, 'one filled primary button');
    assert.ok(body.includes('/booking/HDC-PAGE01/calendar.ics'));
    assert.ok(body.includes('>Add to calendar<') || body.includes('Add to calendar</a>'));
    assert.ok(body.includes('Swimwear') && body.includes('Sunscreen and hat'));
    assert.ok(!body.includes('Photo ID<'), 'Photo ID chip only when the hotel requires it');
    assert.ok(body.includes('Towels: 2 provided'));
    assert.strictEqual(body.split(FOOD_RULE).length - 1, 1);
    assert.ok(/<p class="tk-cx">Free cancellation until \d{1,2} am, .+\(hotel time\)\.<\/p>/.test(body));
    assert.ok(body.includes('Manage or cancel'));
    assert.ok(body.includes('Demo: nothing is charged or refunded.'));
    assert.ok(body.includes('<summary><span>At reception</span>'));
    assert.ok(body.includes(esc(GuestCheckIn.line())));
    assert.ok(body.includes('Safety and your details: No lifeguard on duty. Supervise children at all times.') || body.includes('Safety and your details: Lifeguard cover is not stated on this listing. Supervise children at all times.'));
    assert.ok(/<details class="tk-dd">(?!<summary><span>Parking)/.test(body));
    assert.ok(!/<details[^>]* open/.test(body), 'detail rows are collapsed');
    assert.ok(body.includes('We share your name, email, mobile and booking details with Harbour Hotel (Demo) so it can check you in and contact you about this booking.'));
    assert.ok(/accepted at checkout \d{1,2} \w+ \d{4}, \d{1,2}:\d{2} (am|pm)\./.test(body));
    assert.ok(body.includes('Before you swim:'));
    assert.ok(body.includes('href="/privacy"') && body.includes('>Privacy policy</a>'));
    assert.ok(!body.includes('What happens next'));
    assert.ok(!body.includes('Getting there'));
    assert.ok(!body.includes('Print or save as PDF'));
    assert.ok(!body.includes('Expected arrival'));
    assert.ok(!body.includes('Alex Citizen') && !body.includes('alex@example.com'));
    assert.ok(!body.includes('(draft)'));
    assert.ok(!/\u2014/.test(body.replace(/<[^>]+>/g, '')), 'no em-dashes');
    const copy = body.replace(/\s(?:href|src)="[^"]*"/gi, '');
    assert.ok(!/commission|%/i.test(copy));
    assert.ok(!body.includes('Sydney'));
    assert.ok(!/food and drink included/i.test(body));

    const cancelled = await get(port, '/booking/HDC-PAGE02');
    assert.strictEqual(cancelled.status, 200);
    const off = mainText(cancelled.body);
    assert.ok(off.includes('This demo booking is cancelled.'));
    assert.ok(off.includes('Cancelled'));
    assert.ok(!/<img[^>]*class="qr"/.test(off));
    assert.ok(!off.includes('data:image'));
    assert.ok(off.includes('no longer shown'));
    assert.ok(/<span class="tk-ok is-off">Cancelled<\/span>/.test(off));
    assert.ok(!off.includes('Add to calendar'));

    const missing = await get(port, '/booking/HDC-MISSING');
    assert.strictEqual(missing.status, 404);
    const lost = mainText(missing.body);
    assert.ok(lost.includes("We can't find that booking"));
    assert.ok(lost.includes('HDC-7Q4K-2M9X'));
    assert.ok(lost.includes('hello@hoteldayclub.com.au'));
    assert.ok(!lost.includes('HDC-MISSING'));
    assert.strictEqual(TicketView.addonName({ name: 'Parking', qty: 1 }), 'Parking');
    assert.strictEqual(TicketView.addonName({ name: 'Fitness centre access', qty: 2 }), 'Fitness centre access \u00d7 2');
    assert.strictEqual(TicketView.addonPrice({ total: 50 }, true), '$50 (demo)');
    assert.strictEqual(TicketView.towelChip([{ name: 'Towels', qty: 2 }]), 'Towels: 2 provided');
    assert.strictEqual(TicketView.towelChip([]), '');
    assert.deepStrictEqual(TicketView.bringChips({ id_required: 0 }, []).map(c => c.text), ['Swimwear', 'Sunscreen and hat']);
    assert.deepStrictEqual(TicketView.bringChips({ id_required: 1 }, []).map(c => c.text), ['Photo ID', 'Swimwear', 'Sunscreen and hat']);
    assert.strictEqual(TicketView.isLate("This booking is inside 24 hours of the start, so it can't be cancelled for free."), true);
    assert.strictEqual(TicketView.isLate('Free cancellation until 10 am, Sat 14 Nov (hotel time).'), false);
    console.log('booking page checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
