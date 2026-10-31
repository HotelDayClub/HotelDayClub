const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ymd, addDays } = require('../util');
const { PASS_FOOD_LINE } = require('../inclusions');

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
    assert.ok(body.includes('Show this at reception'));
    assert.ok(body.includes('HDC-PAGE01'));
    assert.ok(body.includes('alt="QR code for booking HDC-PAGE01"'));
    assert.ok(/<img class="qr" src="data:image\/png;base64,/.test(body));
    assert.ok(body.includes('Copy booking code'));
    assert.ok(body.includes('/booking/HDC-PAGE01/calendar.ics'));
    assert.ok(/Free cancellation until \d{1,2} am, .+\(hotel time\)\./.test(body));
    assert.ok(body.includes(PASS_FOOD_LINE));
    assert.ok(body.includes('Harbour Hotel (Demo)'));
    assert.ok(body.includes('Privacy policy (draft)'));
    assert.ok(body.includes('href="/privacy"'));
    const copy = body.replace(/\s(?:href|src)="[^"]*"/gi, '');
    assert.ok(!/commission|%/i.test(copy));
    assert.ok(!body.includes('Sydney'));
    assert.ok(!/food and drink included/i.test(body));
    assert.ok(!body.includes('Expected arrival'));

    const cancelled = await get(port, '/booking/HDC-PAGE02');
    assert.strictEqual(cancelled.status, 200);
    const off = mainText(cancelled.body);
    assert.ok(off.includes('This demo booking is cancelled.'));
    assert.ok(off.includes('Cancelled'));
    assert.ok(!/<img[^>]*class="qr"/.test(off));
    assert.ok(!off.includes('data:image'));
    assert.ok(off.includes('no longer shown'));

    const missing = await get(port, '/booking/HDC-MISSING');
    assert.strictEqual(missing.status, 404);
    const lost = mainText(missing.body);
    assert.ok(lost.includes("We can't find that booking"));
    assert.ok(lost.includes('HDC-7Q4K2'));
    assert.ok(lost.includes('hello@hoteldayclub.com.au'));
    assert.ok(!lost.includes('HDC-MISSING'));
    console.log('booking page checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
