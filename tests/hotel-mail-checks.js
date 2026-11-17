const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { HotelClock } = require('../calendar');
const HotelMail = require('../hotelMail');
const mailer = require('../mailer');
const { displayName } = require('../hotelName');
const { share } = require('../analytics');
const { hashPassword } = require('../passwords');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-hmail-'));
const dbPath = path.join(dir, 'mail.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
delete process.env.HOTEL_MAIL_ENABLED;
delete process.env.HOTEL_MAIL_TEST_TO;
delete process.env.CRON_SECRET;
delete process.env.RESEND_API_KEY;

const db = require('../db');

assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hotel_mail_log'").get(), 'hotel_mail_log table');

function insertHotel({ slug, name, login, email, demo = 0, password = 'hm-hotel' }) {
  const id = db.prepare(`INSERT INTO hotels (slug, name, area, login, password, contact_email, status, is_demo, timezone, photos, hours)
    VALUES (?, ?, 'Sydney', ?, ?, ?, 'active', ?, 'Australia/Sydney', '[]', 'Daily')`)
    .run(slug, name, login, hashPassword(password), email, demo).lastInsertRowid;
  const pass = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds) VALUES (?, 'chair', 'Pool chair', 40, 10, 1)`).run(id).lastInsertRowid;
  return { id, pass };
}

function insertBooking({ hotelId, passId, date, total, party, name }) {
  const code = 'HDC-HM' + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, party, status)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'g@example.com', '0400000000', ?, 'confirmed')`)
    .run(code, hotelId, passId, date, total, total, name, party);
  return code;
}

assert.strictEqual(HotelMail.cronSecret(), '');
assert.strictEqual(HotelMail.verifyCronSecret('probe').missing, true);

assert.strictEqual(HotelMail.enabled(), false);
process.env.HOTEL_MAIL_ENABLED = 'true';
assert.strictEqual(HotelMail.enabled(), true);
delete process.env.HOTEL_MAIL_ENABLED;

const liveHotel = insertHotel({ slug: 'live-pool', name: 'Harbour House', login: 'live-pool', email: 'ops@live-pool.test', demo: 0 });
const demoHotel = insertHotel({ slug: 'demo-pool', name: 'Skyline Rooftop (Demo)', login: 'demo-sky', email: 'ops@demo.test', demo: 1 });

const now = new Date('2026-11-12T07:30:00Z');
const tomorrow = HotelClock.offset({ timezone: 'Australia/Sydney' }, 1, now);
insertBooking({ hotelId: liveHotel.id, passId: liveHotel.pass, date: tomorrow, total: 80, party: 2, name: 'Sam Guest' });
insertBooking({ hotelId: demoHotel.id, passId: demoHotel.pass, date: tomorrow, total: 40, party: 1, name: 'Demo Guest' });

const liveRow = db.prepare('SELECT * FROM hotels WHERE id=?').get(liveHotel.id);
const nb = HotelMail.nightBeforeFor(db, liveRow, now, { signOps: p => 'tok-' + p.a });
assert.strictEqual(nb.visitDate, tomorrow);
assert.strictEqual(nb.bookings, 1);
assert.strictEqual(nb.spots, 1);
assert.ok(nb.subject.includes(displayName(liveRow)));
assert.ok(!nb.text.includes('%'));
assert.ok(!/\u2014/.test(nb.text + nb.html));
assert.ok(!/\bcommission\b/i.test(nb.text + nb.html));
assert.ok(nb.text.includes('Sam Guest'));
assert.ok(nb.pauseToken);

const month = '2026-10';
insertBooking({ hotelId: liveHotel.id, passId: liveHotel.pass, date: '2026-10-05', total: 100, party: 2, name: 'Oct Guest' });
const st = HotelMail.statementFor(db, liveRow, month, now);
assert.strictEqual(st.bookings, 1);
assert.strictEqual(st.guests, 2);
assert.strictEqual(st.payout, share(100).payout);
assert.ok(!st.text.includes('Gross'));
assert.ok(!st.html.includes('Gross'));
assert.ok(st.text.includes('Your payout'));
assert.ok(!/%/.test(st.text + st.html));
assert.ok(!/\bcommission\b/i.test(st.text + st.html));

const demoRow = db.prepare('SELECT * FROM hotels WHERE id=?').get(demoHotel.id);
assert.strictEqual(HotelMail.skipsHotel(demoRow), true);
assert.strictEqual(HotelMail.skipsHotel(liveRow), false);

process.env.HOTEL_MAIL_TEST_TO = 'redirect@example.com';
assert.strictEqual(HotelMail.nightBeforeFor(db, liveRow, now).to, 'redirect@example.com');
delete process.env.HOTEL_MAIL_TEST_TO;

let sent = [];
const origSend = mailer.sendMail;
mailer.sendMail = async payload => {
  sent.push(payload);
  return { ok: true, skipped: false };
};

(async () => {
  const forceNow = new Date('2026-11-12T07:30:00Z');
  sent = [];
  const tick = await HotelMail.tick(db, { now: forceNow, force: true, signOps: () => 'cron-tok' });
  assert.ok(tick.sent >= 1, 'tick sent ' + JSON.stringify(tick));
  assert.ok(sent.some(m => m.subject.includes('Guest list')), 'night-before sent');
  assert.ok(sent.some(m => m.subject.includes('statement') || m.subject.includes('Statement')), 'statement sent');
  assert.ok(!sent.some(m => /@demo\.test/.test(m.to)), 'demo hotel not mailed');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM hotel_mail_log WHERE hotel_id=?').get(liveHotel.id).n, sent.length);

  mailer.sendMail = origSend;

  function post(port, urlPath, body, headers = {}) {
    const raw = body && typeof body === 'object' && !(body instanceof URLSearchParams)
      ? JSON.stringify(body)
      : String(body || new URLSearchParams(body || {}).toString());
    const json = String(headers['Content-Type'] || '').includes('json');
    const form = !json && urlPath.includes('/hotel/login');
    const payload = form ? new URLSearchParams(body || {}).toString() : raw;
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
        headers: {
          Origin: `http://127.0.0.1:${port}`,
          Referer: `http://127.0.0.1:${port}/`,
          'Content-Type': form ? 'application/x-www-form-urlencoded' : (json ? 'application/json' : 'application/json'),
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  function get(port, urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
  }
  function start(port) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          PORT: String(port),
          DB_PATH: dbPath,
          DATA_DIR: '',
          ADMIN_PASSWORD: 'hm-admin',
          DEMO_HOTEL_PASSWORD: 'hm-hotel',
          HOTEL_MAIL_ENABLED: '1',
          COOKIE_SECRET: 'hotel-mail-cookie-secret',
          HDC_NOW: '2026-11-12T07:30:00.000Z',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      const timer = setTimeout(() => reject(new Error('server start timeout\n' + log)), 25000);
      child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
      child.stderr.on('data', c => { log += c; });
      child.on('exit', code => reject(new Error('server exit ' + code + '\n' + log)));
    });
  }

  const port = 3480 + Math.floor(Math.random() * 40);
  process.env.CRON_SECRET = 'cron-test-secret';
  const child = await start(port);
  try {
    assert.strictEqual(HotelMail.verifyCronSecret('x').missing, false);
    const noHeader = await post(port, '/internal/cron/hotel-mail', {});
    assert.strictEqual(noHeader.status, 403);
    const bad = await post(port, '/internal/cron/hotel-mail', {}, { 'x-cron-secret': 'wrong' });
    assert.strictEqual(bad.status, 403);
    const ok = await post(port, '/internal/cron/hotel-mail', {}, { 'x-cron-secret': 'cron-test-secret' });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.body.includes('"sent"'));

    const login = await post(port, '/hotel/login', { user: 'live-pool', pass: 'hm-hotel' });
    assert.strictEqual(login.status, 302);
    const jar = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const dash = await get(port, '/hotel', { Cookie: jar });
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.body.includes('href="/hotel/statement"'));
    assert.ok(dash.body.includes('Statements'));
    const preview = await get(port, '/hotel/email-preview', { Cookie: jar });
    assert.ok(preview.body.includes('Sam Guest'));
    assert.ok(preview.body.includes('Tomorrow at the pool'));
    const statement = await get(port, '/hotel/statement?month=2026-10', { Cookie: jar });
    assert.ok(statement.body.includes('Your payout'));
    assert.ok(!statement.body.includes('Gross revenue'));
    assert.ok(!/%/.test(statement.body.replace(/<style[\s\S]*?<\/style>/gi, '')));
    assert.ok(!/\bcommission\b/i.test(statement.body));

    console.log('hotel-mail-checks passed');
  } finally {
    child.kill('SIGTERM');
    delete process.env.CRON_SECRET;
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});