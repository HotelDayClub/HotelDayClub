const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ymd, addDays } = require('../util');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-short-code-'));
const dbPath = path.join(dir, 'app.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
process.env.ADMIN_PASSWORD = 'short-code-admin';
process.env.DEMO_HOTEL_PASSWORD = 'short-code-hotel';
delete process.env.RESEND_API_KEY;

const { ShortCode } = require('../shortCode');
const db = require('../db');
const { hashPassword } = require('../passwords');
const notices = require('../notices');

assert.strictEqual(ShortCode.example(), 'HDC-7Q4K-2M9X');
assert.ok(ShortCode.is(ShortCode.example()));
assert.strictEqual(ShortCode.canonical('hdc 7q4k 2m9x'), 'HDC-7Q4K-2M9X');
assert.strictEqual(ShortCode.canonical('hdc-7q4k-2m9x'), 'HDC-7Q4K-2M9X');
assert.strictEqual(ShortCode.canonical('HDC7Q4K2M9X'), 'HDC-7Q4K-2M9X');
assert.strictEqual(ShortCode.canonical('7q4k-2m9x'), 'HDC-7Q4K-2M9X');
assert.strictEqual(ShortCode.canonical('HDC-10OL-2222'), '');
assert.strictEqual(ShortCode.canonical('HDC-' + 'A'.repeat(32)), '');

const seen = new Set();
for (let i = 0; i < 40; i++) {
  const code = ShortCode.fresh();
  assert.ok(ShortCode.is(code), code);
  assert.ok(!seen.has(code), code);
  seen.add(code);
  const body = code.replace(/-/g, '').slice(3);
  assert.strictEqual(body.length, 8);
  assert.ok(!/[01OIL]/.test(body), body);
}

const later = ymd(addDays(new Date(), 12));
const hotelId = db.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo, timezone, state)
  VALUES ('code-pool', 'Code Pool (Demo)', 'Brisbane', 'code-pool', ?, 'active', 1, 'Australia/Brisbane', 'QLD')`).run(hashPassword('short-code-hotel')).lastInsertRowid;
for (let weekday = 0; weekday < 7; weekday++) {
  db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)').run(hotelId, weekday, '09:00', '17:00');
}
const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds, kind) VALUES (?, 'lounger', 'Sun lounger', 40, 8, 1, 'lounger')`).run(hotelId).lastInsertRowid;
db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, status)
  VALUES ('HDC-OLDROW1', ?, ?, ?, 1, 40, 40, 'Old Guest', 'old@example.com', '0412000100', 'confirmed')`).run(hotelId, passId, later);
db.prepare(`INSERT INTO bookings (code, short_code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, status)
  VALUES ('HDC-LONGCODE00000000000000000001', 'HDC-7Q4K-2M9X', ?, ?, ?, 1, 40, 40, 'Mina Shore', 'mina.shore@example.com', '0412555010', 'confirmed')`).run(hotelId, passId, later);
ShortCode.backfill(db);
const old = db.prepare("SELECT short_code FROM bookings WHERE code='HDC-OLDROW1'").get();
assert.ok(ShortCode.is(old.short_code));
assert.notStrictEqual(old.short_code, 'HDC-7Q4K-2M9X');
const filled = db.prepare("SELECT COUNT(*) n FROM bookings WHERE short_code IS NULL OR short_code=''").get().n;
assert.strictEqual(filled, 0);
const codes = db.prepare('SELECT short_code FROM bookings').all().map(row => row.short_code);
assert.strictEqual(new Set(codes).size, codes.length);
assert.throws(() => {
  db.prepare(`INSERT INTO bookings (code, short_code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, status)
    VALUES ('HDC-DUPCODE00000000000000000001', 'HDC-7Q4K-2M9X', ?, ?, ?, 1, 40, 40, 'Dup', 'dup@example.com', '0412000101', 'confirmed')`).run(hotelId, passId, later);
});
const taken = ShortCode.take(db);
assert.ok(ShortCode.is(taken));
assert.ok(!codes.includes(taken));

(async () => {
  const mailed = await notices.bookingMessage(db, 'HDC-LONGCODE00000000000000000001');
  assert.ok(mailed.text.includes('Booking code: HDC-7Q4K-2M9X'));
  assert.ok(!mailed.text.includes('Booking code: HDC-LONGCODE00000000000000000001'));
  assert.ok(mailed.html.includes('HDC-7Q4K-2M9X'));
  assert.ok(mailed.text.includes('/booking/HDC-LONGCODE00000000000000000001'));
  assert.ok(mailed.text.includes('/hotel/checkin?code=HDC-LONGCODE00000000000000000001'));
  assert.ok(!mailed.html.includes('/booking/HDC-7Q4K-2M9X'));
  db.close();

  const port = 3512;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'short-code-admin', DEMO_HOTEL_PASSWORD: 'short-code-hotel' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', chunk => { log += chunk; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
  function get(urlPath, headers) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
  }
  function post(urlPath, fields) {
    const body = new URLSearchParams(fields).toString();
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  function cookie(res) {
    return (res.headers['set-cookie'] || []).map(row => row.split(';')[0]).join('; ');
  }
  try {
    const secret = await get('/booking/HDC-7Q4K-2M9X');
    assert.strictEqual(secret.status, 404);
    assert.ok(!secret.body.includes('Mina Shore'));
    const lower = await get('/booking/hdc-7q4k-2m9x');
    assert.strictEqual(lower.status, 404);
    const spaced = await get('/booking/' + encodeURIComponent('HDC 7Q4K 2M9X'));
    assert.strictEqual(spaced.status, 404);
    const real = await get('/booking/HDC-LONGCODE00000000000000000001');
    assert.strictEqual(real.status, 200);
    assert.ok(real.body.includes('HDC-7Q4K-2M9X'));
    assert.ok(real.body.includes('id="bk-code"'));
    const ics = await get('/booking/HDC-7Q4K-2M9X/calendar.ics');
    assert.strictEqual(ics.status, 404);

    const hotelLogin = await post('/hotel/login', { user: 'code-pool', pass: 'short-code-hotel' });
    const hotelJar = cookie(hotelLogin);
    for (const query of ['hdc 7q4k 2m9x', 'hdc7q4k2m9x', 'HDC-7Q4K-2M9X']) {
      const found = await get('/hotel/checkin?code=' + encodeURIComponent(query), { Cookie: hotelJar });
      assert.strictEqual(found.status, 200, query);
      assert.ok(found.body.includes('Mina Shore'), query);
    }
    const searched = await get('/hotel/checkin?q=' + encodeURIComponent('hdc-7q4k-2m9x'), { Cookie: hotelJar });
    assert.ok(searched.body.includes('Mina Shore'));
    const dash = await get('/hotel?q=' + encodeURIComponent('7q4k 2m9x'), { Cookie: hotelJar });
    assert.ok(dash.body.includes('Mina Shore'));

    const adminLogin = await post('/admin/login', { user: 'jason', pass: 'short-code-admin' });
    const adminJar = cookie(adminLogin);
    const admin = await get('/admin/bookings?q=' + encodeURIComponent('hdc 7q4k 2m9x'), { Cookie: adminJar });
    assert.strictEqual(admin.status, 200);
    assert.ok(admin.body.includes('Mina Shore'));
    console.log('short code checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
