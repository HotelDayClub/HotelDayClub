const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-legal-'));
const dbPath = path.join(dir, 'daypass.db');
process.env.DB_PATH = dbPath;
process.env.ADMIN_PASSWORD = 'legal-admin-test';
process.env.DEMO_HOTEL_PASSWORD = 'legal-hotel-test';
delete process.env.SHOW_ABN;

const db = require('../db');
const { seed, ensureSchedules } = require('../seed');
const offering = require('../offering');

seed(db);
ensureSchedules(db);

const ymd = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function nextOpen(slug, start = 1) {
  const h = db.prepare('SELECT * FROM hotels WHERE slug=?').get(slug);
  for (let i = start; i < 21; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const date = ymd(d);
    const plan = offering.dayPlan(db, h, date);
    if (plan && plan.open && !db.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?').get(h.id, date)) return { h, date, plan };
  }
  throw new Error('no open day for ' + slug);
}

const sky = nextOpen('skyline-rooftop');
assert.strictEqual(sky.plan.effective, '16:00', 'day pass ends when room guests only starts');
assert.strictEqual(sky.plan.closes, '17:00', 'facility still closes at 5pm');
const [y, m, d] = sky.date.split('-').map(Number);
assert.ok(offering.dayClosure(db, sky.h, sky.date, new Date(y, m - 1, d, 16, 0, 0)), 'not sellable at room-only start');
assert.ok(!offering.dayClosure(db, sky.h, sky.date, new Date(y, m - 1, d, 10, 0, 0)), 'morning is still sellable');
const win = offering.lateWindow(db, sky.h, sky.date);
assert.ok(win && win.until === '17:00' && win.end === '16:00');

const salt = nextOpen('saltwater-terrace');
const freeSky = nextOpen('skyline-rooftop', 3);
assert.ok(/^Free cancellation until 11am /.test(offering.cancelNote(db, freeSky.h, freeSky.date)), offering.cancelNote(db, freeSky.h, freeSky.date));
assert.strictEqual(offering.lateWindow(db, salt.h, salt.date), null);
assert.strictEqual(offering.hotelLatePossible(db, salt.h), false);
assert.strictEqual(offering.hotelLatePossible(db, sky.h), true);
const lateRows = db.prepare("SELECT h.slug, a.enabled FROM addons a JOIN hotels h ON h.id=a.hotel_id WHERE a.code='late' ORDER BY h.slug").all();
for (const row of lateRows) assert.strictEqual(row.enabled, row.slug === 'skyline-rooftop' ? 1 : 0, row.slug);

const earlyRoom = offering.readForm({
  hotel_name: 'Test', area: 'CBD', spot_name: 'Sun lounger', kind: 'lounger', holds: '1', price: '40', cap: '10',
  day_open: '1', cutoff_hours: '2', opens_1: '10:00', closes_1: '16:00', room_only_from: '09:00', room_only_to: '12:00',
});
assert.ok(earlyRoom.err && /can't be sold past/.test(earlyRoom.err), earlyRoom.err);

const blockedLate = offering.saveOffering(db, sky.h.id, {
  hotel_name: sky.h.name, area: sky.h.area, spot_name: 'Pool chair', kind: 'chair', holds: '1', price: '55', cap: '20',
  day_open: ['1', '2', '3', '4'], cutoff_hours: '1', heated: '1', setting: 'outdoor', age_policy: '18+', towels: '1', id_required: '1', lifeguard: '0',
  opens_1: '11:00', closes_1: '17:00', opens_2: '11:00', closes_2: '17:00', opens_3: '11:00', closes_3: '17:00', opens_4: '11:00', closes_4: '17:00',
});
assert.ok(blockedLate.err && /Late access/.test(blockedLate.err), blockedLate.err);
assert.strictEqual(db.prepare('SELECT room_only_from FROM hotels WHERE id=?').get(sky.h.id).room_only_from, '16:00');

const freeAt = new Date(y, m - 1, d, 10, 0, 0);
freeAt.setDate(freeAt.getDate() - 2);
const future = offering.cancelNote(db, sky.h, sky.date, freeAt);
assert.ok(/^Free cancellation until 11am /.test(future), future);
const inside = offering.cancelNote(db, sky.h, sky.date, new Date(y, m - 1, d, 10, 0, 0));
assert.ok(/can't be cancelled for free/.test(inside), inside);
assert.ok(!/hotel terms apply/.test(offering.rulesText(sky.h)));
assert.ok(offering.riskText(sky.h).includes('No lifeguard is on duty'));
assert.ok(offering.riskText(db.prepare("SELECT * FROM hotels WHERE slug='palm-court'").get()).includes('A lifeguard is on duty'));
assert.ok(!db.prepare("SELECT blurb FROM hotels WHERE slug='harbourside-lido'").get().blurb.includes('rain or shine'));

db.close();

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function post(port, urlPath, form) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function start(port, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...extra, PORT: String(port), DB_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 15000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

(async () => {
  const port = 3191;
  const child = await start(port);
  try {
    const home = await get(port, '/');
    assert.strictEqual(home.status, 200);
    assert.ok(home.body.includes('All of Australia'));
    assert.ok(!home.body.includes('All of Sydney') && !home.body.includes('around Sydney') && !home.body.includes('across Sydney'));
    assert.ok(home.body.includes('href="/faq"'));
    assert.ok(!home.body.includes('ABN: to be added'));
    assert.ok(!/usually sells out|partners with Sydney hotels|star rating/i.test(home.body));

    const faq = await get(port, '/faq');
    assert.strictEqual(faq.status, 200);
    assert.ok(faq.body.includes('at least 3 years'));
    assert.ok(faq.body.includes('5-pass pack is not offered'));
    assert.ok(faq.body.includes('24 hours before'));

    const terms = await get(port, '/terms');
    assert.strictEqual(terms.status, 200);
    assert.ok(terms.body.includes('Customer terms (draft)'));
    assert.ok(terms.body.includes('We are a booking agent.'));
    const risk = await get(port, '/risk');
    assert.strictEqual(risk.status, 200);
    assert.ok(risk.body.includes('Risk warning (draft)'));
    assert.ok(risk.body.includes('NOT LEGAL ADVICE'));
    assert.ok(risk.body.includes('no liability exclusion'));

    const avail = await get(port, `/api/availability?hotel=skyline-rooftop&date=${freeSky.date}`);
    const data = JSON.parse(avail.body);
    assert.ok(data.addons.some(a => a.code === 'late' && a.name === 'Late access until 5pm'), JSON.stringify(data.addons));
    assert.ok(/Free cancellation until 11am /.test(data.cancel), data.cancel);
    const soon = JSON.parse((await get(port, `/api/availability?hotel=skyline-rooftop&date=${sky.date}`)).body);
    assert.ok(/can't be cancelled for free/.test(soon.cancel), soon.cancel);
    const saltAvail = JSON.parse((await get(port, `/api/availability?hotel=saltwater-terrace&date=${salt.date}`)).body);
    assert.ok(!saltAvail.addons.some(a => a.code === 'late'));

    const checkout = await get(port, `/checkout?hotel=skyline-rooftop&date=${freeSky.date}&pass=chair&qty=1`);
    assert.strictEqual(checkout.status, 200);
    assert.ok(checkout.body.includes('name="terms"') && checkout.body.includes('href="/terms"'));
    assert.ok(checkout.body.includes('name="risk"') && checkout.body.includes('Risk warning'));
    assert.ok(checkout.body.includes('name="rules"'));
    assert.ok(checkout.body.includes('No lifeguard is on duty'));
    assert.ok(!checkout.body.includes('hotel terms apply'));
    assert.ok(checkout.body.includes(data.cancel));

    const missing = await post(port, '/book', { hotel: 'skyline-rooftop', date: freeSky.date, pass: 'chair', qty: '1', name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1' });
    assert.strictEqual(missing.status, 409);
    assert.ok(missing.body.includes('customer terms'));

    const live = new Database(dbPath);
    live.prepare("UPDATE addons SET enabled=1 WHERE code='late' AND hotel_id=(SELECT id FROM hotels WHERE slug='saltwater-terrace')").run();
    live.close();
    const lateBook = await post(port, '/book', { hotel: 'saltwater-terrace', date: salt.date, pass: 'lounger', qty: '1', addon: 'late', name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1' });
    assert.strictEqual(lateBook.status, 409);
    assert.ok(/closing time/.test(lateBook.body), lateBook.body.slice(0, 400));

    const booked = await post(port, '/book', { hotel: 'skyline-rooftop', date: freeSky.date, pass: 'chair', qty: '1', addon: 'late', name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1' });
    assert.strictEqual(booked.status, 303, booked.body.slice(0, 300));
    const loc = booked.headers.location;
    const page = await get(port, loc);
    assert.ok(page.body.includes('Late access until 5pm'));
    assert.ok(page.body.includes(data.cancel));
    assert.ok(page.body.includes(', Australia'));
    assert.ok(!page.body.includes(', Sydney'));
    assert.ok(page.body.includes('Before you swim'));
    assert.ok(page.body.includes('Terms') && page.body.includes('Accepted'));
  } finally {
    child.kill('SIGTERM');
  }

  const abnPort = 3192;
  const abn = await start(abnPort, { SHOW_ABN: '1' });
  try {
    const home = await get(abnPort, '/');
    assert.ok(home.body.includes('ABN: to be added'));
  } finally {
    abn.kill('SIGTERM');
  }
  console.log('legal checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
