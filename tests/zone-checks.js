const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-zone-'));
const dbPath = path.join(dir, 'daypass.db');
process.env.DB_PATH = dbPath;
delete process.env.DATA_DIR;
assert.ok(!process.env.TZ, 'tests must not set process.env.TZ');

const db = require('../db');
const { dayClosure, arrivalOptions, cancelNote } = require('../offering');
const { HotelClock, hotelToday } = require('../calendar');
const { bookingsCsv } = require('../dataExport');

function addHotel(slug, timezone) {
  const id = db.prepare(`INSERT INTO hotels (slug, name, area, timezone, state, status, is_demo, cutoff_hours, opens, closes, photos)
    VALUES (?, ?, 'Perth', ?, ?, 'active', 1, 2, '09:00', '18:00', '[]')`).run(
    slug,
    slug === 'zone-perth' ? 'Perth Pool (Demo)' : 'Sydney Pool (Demo)',
    timezone,
    timezone === 'Australia/Perth' ? 'WA' : 'NSW',
  ).lastInsertRowid;
  const hours = db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)');
  for (let weekday = 0; weekday < 7; weekday++) hours.run(id, weekday, '09:00', '18:00');
  const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds, kind)
    VALUES (?, 'lounger', 'Sun lounger', 40, 10, 1, 'lounger')`).run(id).lastInsertRowid;
  return { hotel: db.prepare('SELECT * FROM hotels WHERE id=?').get(id), passId };
}

const perth = addHotel('zone-perth', 'Australia/Perth');
const sydney = addHotel('zone-sydney', 'Australia/Sydney');
const stamp = '2026-11-11 00:15:00';

assert.strictEqual(HotelClock.parse(stamp).toISOString(), '2026-11-11T00:15:00.000Z');
assert.strictEqual(HotelClock.parse(stamp).getTime(), Date.parse('2026-11-11T00:15:00.000Z'));
assert.strictEqual(HotelClock.clock(perth.hotel, stamp), '8:15 am');
assert.strictEqual(HotelClock.clock(sydney.hotel, stamp), '11:15 am');
assert.strictEqual(HotelClock.guestCheckedIn(perth.hotel, stamp), 'Checked in 8:15 am, Wed 11 Nov (hotel time)');
assert.strictEqual(HotelClock.guestCheckedIn(sydney.hotel, stamp), 'Checked in 11:15 am, Wed 11 Nov (hotel time)');
assert.strictEqual(HotelClock.iso(stamp), '2026-11-11T00:15:00.000Z');
assert.strictEqual(HotelClock.iso('2026-11-11T00:15:00.000Z'), '2026-11-11T00:15:00.000Z');

const split = new Date('2026-11-11T15:30:00.000Z');
assert.strictEqual(hotelToday(perth.hotel, split), '2026-11-11');
assert.strictEqual(HotelClock.today(perth.hotel, split), '2026-11-11');
assert.strictEqual(hotelToday(sydney.hotel, split), '2026-11-12');
assert.strictEqual(HotelClock.today(sydney.hotel, split), '2026-11-12');

const afternoon = new Date('2026-11-11T08:15:00.000Z');
assert.strictEqual(dayClosure(db, perth.hotel, '2026-11-11', afternoon), 'Same-day booking has closed');
assert.strictEqual(dayClosure(db, sydney.hotel, '2026-11-11', afternoon), 'Day passes have closed for today');
const mid = new Date('2026-11-11T05:30:00.000Z');
assert.strictEqual(dayClosure(db, perth.hotel, '2026-11-11', mid), null);
assert.strictEqual(dayClosure(db, sydney.hotel, '2026-11-11', mid), 'Same-day booking has closed');
assert.strictEqual(dayClosure(db, perth.hotel, '2026-11-12', afternoon), null);

const filterNow = new Date('2026-11-11T06:00:00.000Z');
const perthOpts = arrivalOptions(db, perth.hotel, hotelToday(perth.hotel, filterNow), filterNow).map(option => option.value);
const sydneyOpts = arrivalOptions(db, sydney.hotel, hotelToday(sydney.hotel, filterNow), filterNow).map(option => option.value);
assert.ok(!perthOpts.includes('13:00'), 'Perth same-day filter drops a window that has already ended');
assert.ok(perthOpts.includes('14:00'), 'Perth same-day filter keeps the later window');
assert.ok(!sydneyOpts.includes('16:00'), 'Sydney same-day filter uses Sydney time, not Perth');
assert.ok(sydneyOpts.includes('17:00'));

assert.ok(/Free cancellation until /.test(cancelNote(db, sydney.hotel, '2026-11-12', '2026-11-10 21:00:00')));
assert.ok(/can't be cancelled for free/.test(cancelNote(db, sydney.hotel, '2026-11-12', '2026-11-10 22:30:00')));

const csv = bookingsCsv([{
  code: 'HDC-Z',
  created_at: stamp,
  checked_in_at: stamp,
  rules_ack_at: stamp,
  terms_ack_at: '',
  risk_ack_at: null,
  consent_at: '2026-11-11T00:15:00.000Z',
}]);
assert.ok(csv.includes('2026-11-11T00:15:00.000Z'));
assert.ok(!csv.includes('2026-11-11 00:15:00'));

const bookingSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'").get().sql;
const noteSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='guest_notes'").get().sql;
assert.ok(!bookingSql.includes('localtime'));
assert.ok(!noteSql.includes('localtime'));
assert.ok(bookingSql.includes("datetime('now')"));
assert.ok(noteSql.includes("datetime('now')"));
const freshId = db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone)
  VALUES ('HDC-ZDEF', ?, ?, '2026-11-11', 1, 40, 40, 'Ada', 'ada@example.com', '0400000000')`).run(perth.hotel.id, perth.passId).lastInsertRowid;
const fresh = db.prepare('SELECT created_at FROM bookings WHERE id=?').get(freshId);
assert.match(fresh.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
assert.ok(Math.abs(Date.now() - HotelClock.parse(fresh.created_at).getTime()) < 5000);
db.prepare("INSERT INTO guest_notes (booking_id, hotel_id, kind, note) VALUES (?, ?, 'no_show', '')").run(freshId, perth.hotel.id);
const noted = db.prepare('SELECT created_at FROM guest_notes WHERE booking_id=?').get(freshId);
assert.match(noted.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
assert.ok(Math.abs(Date.now() - HotelClock.parse(noted.created_at).getTime()) < 5000);

for (const file of ['server.js', 'db.js', 'offering.js', 'calendar.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.ok(!src.includes('localtime'), file);
  assert.ok(!src.includes('process.env.TZ'), file);
}

function insertVisit(code, row) {
  db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, status, checked_in_at)
    VALUES (?, ?, ?, '2026-11-11', 1, 40, 40, 'Alex Citizen', 'alex@example.com', '0412345678', 'confirmed', ?)`).run(code, row.hotel.id, row.passId, stamp);
}
insertVisit('HDC-PERTH1', perth);
insertVisit('HDC-SYDNEY1', sydney);
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

(async () => {
  const port = 3461;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
      child.stdout.on('data', chunk => {
        log += chunk;
        if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on('data', chunk => { log += chunk; });
      child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
    });
    const perthPage = await get(port, '/booking/HDC-PERTH1');
    const sydneyPage = await get(port, '/booking/HDC-SYDNEY1');
    assert.strictEqual(perthPage.status, 200);
    assert.strictEqual(sydneyPage.status, 200);
    assert.ok(perthPage.body.includes('Checked in 8:15 am, Wed 11 Nov (hotel time)'));
    assert.ok(sydneyPage.body.includes('Checked in 11:15 am, Wed 11 Nov (hotel time)'));
    assert.ok(!perthPage.body.includes('2026-11-11 00:15:00'));
    assert.ok(!sydneyPage.body.includes('2026-11-11 00:15:00'));
    console.log('zone checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
