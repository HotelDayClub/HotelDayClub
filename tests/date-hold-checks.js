const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ymd, addDays } = require('../util');
const { HotelClock } = require('../calendar');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-date-hold-'));
const dbPath = path.join(dir, 'app.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
process.env.ADMIN_PASSWORD = 'date-hold-admin';
process.env.DEMO_HOTEL_PASSWORD = 'date-hold-hotel';
delete process.env.RESEND_API_KEY;

const db = require('../db');
const { hashPassword } = require('../passwords');
const zone = { timezone: 'Australia/Sydney' };
const start = HotelClock.today(zone);
const past = ymd(addDays(new Date(start + 'T12:00:00'), -3));
const closed = ymd(addDays(new Date(start + 'T12:00:00'), 4));
const sold = ymd(addDays(new Date(start + 'T12:00:00'), 8));
const open = ymd(addDays(new Date(start + 'T12:00:00'), 2));

function addHotel(slug, name, cutoff, closes) {
  const id = db.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo, timezone, state, cutoff_hours, opens, closes)
    VALUES (?, ?, 'Eastern Beaches', ?, ?, 'active', 1, 'Australia/Sydney', 'NSW', ?, '00:00', ?)`).run(slug, name, slug, hashPassword('date-hold-hotel'), cutoff, closes).lastInsertRowid;
  for (let weekday = 0; weekday < 7; weekday++) {
    db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)').run(id, weekday, '00:00', closes);
  }
  const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds, kind) VALUES (?, 'lounger', 'Sun lounger', 45, 2, 1, 'lounger')`).run(id).lastInsertRowid;
  return { id, passId };
}
const hold = addHotel('hold-pool', 'Harbour Hold (Demo)', 0, '23:59');
const shut = addHotel('shut-pool', 'Shut Pool (Demo)', 0, '23:59');
const late = addHotel('late-pool', 'Late Pool (Demo)', 2, '00:01');
db.prepare('INSERT INTO blocked_dates (hotel_id, date, reason) VALUES (?, ?, ?)').run(hold.id, closed, 'Private event');
db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, status)
  VALUES ('HDC-SOLDFULL1', ?, ?, ?, 2, 45, 90, 'Sold Guest', 'sold@example.com', '0412000000', 'confirmed')`).run(hold.id, hold.passId, sold);
for (let i = 0; i < 91; i++) {
  const day = ymd(addDays(new Date(start + 'T12:00:00'), i));
  db.prepare('INSERT INTO blocked_dates (hotel_id, date, reason) VALUES (?, ?, ?)').run(shut.id, day, 'Pool maintenance');
}
db.close();

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function datesOf(html) {
  return [...html.matchAll(/class="date-alt" href="([^"]+)"/g)].map(match => new URL(match[1], 'http://127.0.0.1').searchParams.get('date'));
}
async function follow(port, urlPath) {
  const first = await get(port, urlPath);
  if (![301, 302, 303, 307, 308].includes(first.status)) return { status: first.status, location: '', page: first };
  const next = String(first.headers.location || '').split('#')[0];
  const page = await get(port, next);
  return { status: first.status, location: first.headers.location, page };
}
function expectDays(html, days) {
  assert.deepStrictEqual(datesOf(html), days);
  for (const day of days) assert.ok(html.includes(`date=${day}`));
}

(async () => {
  const port = 3511;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'date-hold-admin', DEMO_HOTEL_PASSWORD: 'date-hold-hotel' },
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
    const closedPage = await follow(port, `/checkout?hotel=hold-pool&date=${closed}&pass=lounger&qty=1`);
    assert.strictEqual(closedPage.status, 303);
    assert.ok(closedPage.location.includes('/h/hold-pool'));
    assert.ok(closedPage.location.includes('notice=1'));
    assert.ok(closedPage.page.body.includes('Harbour Hold (Demo) is closed on'));
    assert.ok(closedPage.page.body.includes('Private event'));
    assert.ok(closedPage.page.body.includes('id="date-alert"'));
    const closedNext = [1, 2, 3].map(n => ymd(addDays(new Date(closed + 'T12:00:00'), n)));
    expectDays(closedPage.page.body, closedNext);
    assert.ok(!datesOf(closedPage.page.body).includes(closed));

    const pastPage = await follow(port, `/checkout?hotel=hold-pool&date=${past}&pass=lounger&qty=1`);
    assert.strictEqual(pastPage.status, 303);
    assert.ok(pastPage.page.body.includes('That date has passed.'));
    expectDays(pastPage.page.body, [0, 1, 2].map(n => ymd(addDays(new Date(start + 'T12:00:00'), n))));

    const soldPage = await follow(port, `/checkout?hotel=hold-pool&date=${sold}&pass=lounger&qty=1`);
    assert.strictEqual(soldPage.status, 303);
    assert.ok(soldPage.page.body.includes('Sun lounger is sold out on'));
    expectDays(soldPage.page.body, [1, 2, 3].map(n => ymd(addDays(new Date(sold + 'T12:00:00'), n))));
    assert.ok(!datesOf(soldPage.page.body).includes(sold));

    const none = await follow(port, `/checkout?hotel=shut-pool&date=${open}&pass=lounger&qty=1`);
    assert.strictEqual(none.status, 303);
    assert.ok(none.page.body.includes('No open dates in the next 90 days.'));
    assert.strictEqual(datesOf(none.page.body).length, 0);
    assert.ok(none.page.body.includes('href="/h/shut-pool"'));

    const cutoff = await follow(port, `/checkout?hotel=late-pool&date=${start}&pass=lounger&qty=1`);
    assert.strictEqual(cutoff.status, 303);
    assert.ok(/closed for today|Same-day booking has closed/i.test(cutoff.page.body));

    const unknown = await get(port, `/checkout?hotel=missing-hotel&date=${open}&pass=lounger&qty=1`);
    assert.strictEqual(unknown.status, 404);

    const badPass = await get(port, `/checkout?hotel=hold-pool&date=${open}&pass=not-a-pass&qty=1`);
    assert.strictEqual(badPass.status, 409);
    assert.ok(badPass.body.includes('Pick a pass.'));
    assert.ok(!badPass.body.includes('date-alert'));

    const ready = await get(port, `/checkout?hotel=hold-pool&date=${open}&pass=lounger&qty=1`);
    assert.strictEqual(ready.status, 200);
    assert.ok(ready.body.includes('Book your day (demo)'));
    console.log('date hold checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
