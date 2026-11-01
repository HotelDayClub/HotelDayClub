const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ymd, addDays } = require('../util');
const { BookingCancel } = require('../cancelBooking');
const { cancelNote } = require('../offering');

const sydney = { timezone: 'Australia/Sydney', state: 'NSW', address: '1 Demo St, Sydney NSW 2000' };
const brisbane = { timezone: 'Australia/Brisbane', state: 'QLD', address: '1 Demo St, Brisbane QLD 4000' };
const perth = { timezone: 'Australia/Perth', state: 'WA', address: '1 Demo St, Perth WA 6000' };
const beforeFallback = new Date('2026-04-01T00:00:00Z');
const afterFallback = new Date('2026-04-04T02:00:00Z');

// 5 Apr 2026 is the Sydney fallback. 10:00 that morning is standard time, so 24 hours
// earlier is 11:00 the previous afternoon, still on daylight time.
const sydneyFree = BookingCancel.window(sydney, '2026-04-05', '10:00', beforeFallback);
assert.strictEqual(sydneyFree.free, true);
assert.ok(sydneyFree.when.startsWith('11am'), sydneyFree.when);
assert.ok(/4 Apr/.test(sydneyFree.when), sydneyFree.when);
assert.strictEqual(BookingCancel.window(sydney, '2026-04-05', '10:00', afterFallback).free, false);

const brisbaneFree = BookingCancel.window(brisbane, '2026-04-05', '10:00', beforeFallback);
assert.strictEqual(brisbaneFree.free, true);
assert.ok(brisbaneFree.when.startsWith('10am'), brisbaneFree.when);
assert.ok(/4 Apr/.test(brisbaneFree.when), brisbaneFree.when);

const perthFree = BookingCancel.window(perth, '2026-04-05', '09:00', beforeFallback);
assert.strictEqual(perthFree.free, true);
assert.ok(perthFree.when.startsWith('9am'), perthFree.when);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-cancel-'));
const dbPath = path.join(dir, 'app.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
process.env.ADMIN_PASSWORD = 'cancel-admin';
process.env.DEMO_HOTEL_PASSWORD = 'cancel-hotel';
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const db = require('../db');
const { hashPassword } = require('../passwords');
const today = ymd(new Date());
const later = ymd(addDays(new Date(), 30));
const hotelId = db.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo, timezone, state, address, photos)
  VALUES ('cancel-pool', 'Cancel Pool (Demo)', 'Brisbane', 'cancel-pool', ?, 'active', 1, 'Australia/Brisbane', 'QLD', '1 Demo St, Brisbane QLD 4000', '["hero-loungers.jpg"]')`).run(hashPassword('cancel-hotel')).lastInsertRowid;
for (let weekday = 0; weekday < 7; weekday++) {
  db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)').run(hotelId, weekday, '10:00', '16:00');
}
const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds, kind) VALUES (?, 'lounger', 'Sun lounger', 40, 10, 1, 'lounger')`).run(hotelId).lastInsertRowid;
const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(hotelId);
assert.ok(/^Free cancellation until 10 am, .+\(hotel time\)\.$/.test(cancelNote(db, hotel, later, beforeFallback)), cancelNote(db, hotel, later, beforeFallback));
assert.ok(/can't be cancelled for free/.test(cancelNote(db, hotel, '2026-04-05', afterFallback)));

function insertBooking(code, date, extra = {}) {
  db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, status, checked_in_at, party)
    VALUES (?, ?, ?, ?, 1, 40, 40, 'Alex Citizen', 'alex@example.com', '0412345678', 'confirmed', ?, 1)`).run(code, hotelId, passId, date, extra.checked || null);
}
insertBooking('HDC-CANCELFREE', later);
insertBooking('HDC-CANCELLATE', today);
insertBooking('HDC-CANCELUSED', later, { checked: later + ' 10:00' });
db.close();

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function post(port, urlPath, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'cancel-admin', DEMO_HOTEL_PASSWORD: 'cancel-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function cookieFrom(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

(async () => {
  const port = 3395;
  const child = await start(port);
  const live = require('better-sqlite3')(dbPath);
  try {
    const openPage = await get(port, '/booking/HDC-CANCELFREE');
    assert.strictEqual(openPage.status, 200);
    assert.ok(openPage.body.includes('Cancel this demo booking'));
    assert.ok(openPage.body.includes('Your demo booking'));
    assert.ok(!/stripe/i.test(openPage.body));

    const evil = await post(port, '/booking/HDC-CANCELFREE/cancel', {}, { Origin: 'https://evil.example' });
    assert.strictEqual(evil.status, 403);
    assert.strictEqual(live.prepare('SELECT status FROM bookings WHERE code=?').get('HDC-CANCELFREE').status, 'confirmed');

    const cancelled = await post(port, '/booking/HDC-CANCELFREE/cancel', {});
    assert.strictEqual(cancelled.status, 303);
    const after = live.prepare('SELECT status, refunded FROM bookings WHERE code=?').get('HDC-CANCELFREE');
    assert.strictEqual(after.status, 'cancelled');
    assert.strictEqual(after.refunded, 1);
    const sold = live.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(passId, later).n;
    assert.strictEqual(sold, 1, 'the checked-in booking still counts, the cancelled one does not');

    const done = await get(port, '/booking/HDC-CANCELFREE');
    assert.ok(done.body.includes('This demo booking is cancelled.'));
    assert.ok(done.body.includes('Cancelled'));
    assert.ok(!done.body.includes('Cancel this demo booking'));

    const latePage = await get(port, '/booking/HDC-CANCELLATE');
    assert.ok(!latePage.body.includes('Cancel this demo booking'));
    assert.ok(/be cancelled for free/.test(latePage.body), latePage.body.slice(latePage.body.indexOf('Cancellation'), 500));
    const latePost = await post(port, '/booking/HDC-CANCELLATE/cancel', {});
    assert.strictEqual(latePost.status, 303);
    assert.strictEqual(live.prepare('SELECT status, refunded FROM bookings WHERE code=?').get('HDC-CANCELLATE').status, 'confirmed');
    assert.strictEqual(live.prepare('SELECT refunded FROM bookings WHERE code=?').get('HDC-CANCELLATE').refunded, 0);

    const usedPost = await post(port, '/booking/HDC-CANCELUSED/cancel', {});
    assert.strictEqual(usedPost.status, 303);
    assert.strictEqual(live.prepare('SELECT status FROM bookings WHERE code=?').get('HDC-CANCELUSED').status, 'confirmed');

    const login = await post(port, '/admin/login', { user: 'jason', pass: 'cancel-admin' });
    assert.strictEqual(login.status, 302);
    const jar = cookieFrom(login);
    const admin = await get(port, '/admin', { Cookie: jar });
    assert.ok(admin.body.includes('action="/admin/booking/cancel"'));
    assert.ok(admin.body.includes('Cancel (demo)'));
    const adminCancel = await post(port, '/admin/booking/cancel', { code: 'HDC-CANCELLATE' }, { Cookie: jar });
    assert.strictEqual(adminCancel.status, 302);
    const lateRow = live.prepare('SELECT status, refunded FROM bookings WHERE code=?').get('HDC-CANCELLATE');
    assert.strictEqual(lateRow.status, 'cancelled');
    assert.strictEqual(lateRow.refunded, 1);

    const hotelLogin = await post(port, '/hotel/login', { user: 'cancel-pool', pass: 'cancel-hotel' });
    assert.strictEqual(hotelLogin.status, 302, hotelLogin.body.slice(0, 200));
    const hotelJar = cookieFrom(hotelLogin);
    const dash = await get(port, '/hotel', { Cookie: hotelJar });
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.body.includes('Cancelled'));
    assert.ok(!dash.body.includes('action="/admin/booking/cancel"'));
    assert.ok(!dash.body.includes('Cancel this demo booking'));
  } finally {
    live.close();
    child.kill('SIGTERM');
  }
  console.log('cancel checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
