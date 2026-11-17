const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const BookingGuests = require('../bookingGuests');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-guests-'));
const dbPath = path.join(dir, 'daypass.db');
process.env.DB_PATH = dbPath;
const db = require('../db');
const { seed, ensureSchedules } = require('../seed');
seed(db);
ensureSchedules(db);

assert.ok(BookingGuests.validGuestName('Sarah Lee'));
assert.ok(!BookingGuests.validGuestName('Sarah'));
const errs = BookingGuests.fieldErrors({ name: 'Bob', guest_2: 'x' }, 2);
assert.ok(errs.guest_2);

function post(port, fields) {
  const body = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/book', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'g-admin', DEMO_HOTEL_PASSWORD: 'g-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('timeout\n' + log)), 25000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

(async () => {
  const h = db.prepare("SELECT slug FROM hotels WHERE slug='saltwater-terrace'").get();
  const port = 3361;
  const child = await start(port);
  try {
    const base = {
      hotel: h.slug,
      date: '2026-12-05',
      pass: 'lounger',
      qty: '2',
      name: 'Sarah Lee',
      guest_2: 'Tom Lee',
      email: 'sarah@example.com',
      phone: '0412345678',
      arrival: 'unsure',
      accept: '1',
    };
    const ok = await post(port, base);
    assert.strictEqual(ok.status, 303);
    const row = db.prepare('SELECT id, guest_name, party FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.strictEqual(row.guest_name, 'Sarah Lee');
    const names = BookingGuests.listForBooking(db, row.id);
    assert.deepStrictEqual(names, ['Sarah Lee', 'Tom Lee']);
    const consent = db.prepare('SELECT guest_names FROM consent_log WHERE booking_id=?').get(row.id);
    assert.ok(consent.guest_names && consent.guest_names.includes('Tom Lee'));
    const bad = await post(port, { ...base, guest_2: 'Tom' });
    assert.strictEqual(bad.status, 400);
  } finally {
    child.kill('SIGTERM');
  }
  console.log('booking-guests checks passed');
})();