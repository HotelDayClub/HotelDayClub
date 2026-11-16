const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ymd, addDays } = require('../util');
const { spotsCount, spotsLabel, passSpotsLabel } = require('../listingScarcity');

const root = path.join(__dirname, '..');
const listingJs = fs.readFileSync(path.join(root, 'listingDir2.js'), 'utf8');
assert.ok(!/['"`]\s*\d+\s+spots left/i.test(listingJs), 'no hard-coded "N spots left" in listing templates');
assert.ok(!/\b3 spots left\b/i.test(listingJs));
assert.ok(!/\b5 spots left\b/i.test(listingJs));

assert.strictEqual(spotsLabel(3), '3 spots left');
assert.strictEqual(spotsLabel(1), '1 spot left');
assert.strictEqual(spotsLabel(5), '5 spots left');
assert.strictEqual(spotsLabel(0), '');
assert.strictEqual(spotsLabel(6), '');
assert.strictEqual(spotsLabel(null), '');

const av3 = [{ code: 'lounger', remaining: 3, blocked: null, past: false }];
av3.day_left = 3;
assert.strictEqual(spotsLabel(spotsCount(av3, '2026-12-01')), '3 spots left');
assert.strictEqual(passSpotsLabel(av3, '2026-12-01', 'lounger'), '3 spots left');

const av6 = [{ code: 'lounger', remaining: 6, blocked: null, past: false }];
assert.strictEqual(spotsLabel(spotsCount(av6, '2026-12-02')), '');
assert.strictEqual(spotsLabel(spotsCount(av6, '')), '');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-scarcity-'));
const dbPath = path.join(dir, 'scarcity.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
delete process.env.RESEND_API_KEY;

const db = require('../db');
const { hashPassword } = require('../passwords');
const start = ymd(new Date());
const d = ymd(addDays(new Date(start + 'T12:00:00'), 5));

const hid = db.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo, timezone, state, cutoff_hours, opens, closes)
  VALUES ('scarcity-demo', 'Scarcity Demo', 'Test', 'scarcity-demo', ?, 'active', 1, 'Australia/Sydney', 'NSW', 24, '09:00', '18:00')`)
  .run(hashPassword('x')).lastInsertRowid;
for (let w = 0; w < 7; w++) {
  db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)').run(hid, w, '09:00', '18:00');
}
const pid = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds, kind) VALUES (?, 'lounger', 'Sun lounger', 45, 10, 1, 'lounger')`).run(hid).lastInsertRowid;

function book(qty) {
  const total = 45 * qty;
  db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, status)
    VALUES (?, ?, ?, ?, ?, 45, ?, 'T', 't@example.com', '0412345678', 'confirmed')`)
    .run(`HDC-SC-${qty}-${Date.now()}`, hid, pid, d, qty, total);
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'sc-admin', DEMO_HOTEL_PASSWORD: 'sc-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('timeout\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

(async () => {
  const port = 3727;
  const child = await startServer(port);
  try {
    const none = await get(port, '/h/scarcity-demo');
    assert.ok(!none.body.includes('spots left'), 'no date: no indicator');

    book(7);
    const left = 10 - 7;
    assert.strictEqual(left, 3);
    const page = await get(port, `/h/scarcity-demo?date=${d}&pass=lounger&qty=1`);
    assert.ok(page.body.includes('3 spots left'), 'shows computed 3 spots left');
    assert.ok(!page.body.includes('4 spots left'));

    const api = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/availability?hotel=scarcity-demo&date=${d}&pass=lounger&qty=1`, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      }).on('error', reject);
    });
    assert.strictEqual(api.spots_banner, '3 spots left');

    db.prepare("DELETE FROM bookings WHERE hotel_id=? AND date=?").run(hid, d);
    book(10);
    const sold = await get(port, `/h/scarcity-demo?date=${d}`);
    assert.ok(!sold.body.match(/[1-5] spots left/), '0 left: hidden');

    db.prepare("DELETE FROM bookings WHERE hotel_id=? AND date=?").run(hid, d);
    book(4);
    const plenty = await get(port, `/h/scarcity-demo?date=${d}`);
    assert.ok(!plenty.body.match(/[1-5] spots left/), '6 left: hidden');
  } finally {
    child.kill('SIGTERM');
    db.close();
  }
  console.log('listing-scarcity-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});