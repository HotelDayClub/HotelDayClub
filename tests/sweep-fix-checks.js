const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { SearchQuery } = require('../search');
const { dayClosure } = require('../offering');
const { ymd, addDays } = require('../util');

assert.strictEqual(SearchQuery.maxUnits(2), 3);
assert.strictEqual(SearchQuery.maxUnits(4), 1);
assert.strictEqual(SearchQuery.bookingPeople(5, 2), 10);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-sweep-'));
const dbPath = path.join(dir, 'daypass.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
process.env.ADMIN_PASSWORD = 'sweep-admin';
process.env.DEMO_HOTEL_PASSWORD = 'sweep-hotel';
delete process.env.RESEND_API_KEY;

const db = require('../db');
const { seed } = require('../seed');
seed(db);

const skyline = db.prepare('SELECT * FROM hotels WHERE slug=?').get('skyline-rooftop');
const fri = '2026-11-20';
const reason = dayClosure(db, skyline, fri, new Date('2026-11-15T12:00:00+11:00'));
assert.ok(reason && /Friday/i.test(reason), 'closure uses weekday name: ' + reason);

function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error('server boot timeout\n' + out)), 20000);
    child.stdout.on('data', d => { out += d; if (out.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + out)));
  });
}
function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

(async () => {
  const port = 3877 + Math.floor(Math.random() * 200);
  const child = await start(port);
  try {
    const beyond = ymd(addDays(new Date(), 120));
    const checkout = await get(port, `/checkout?hotel=skyline-rooftop&date=${beyond}&pass=chair&qty=1`);
    assert.ok([302, 303].includes(checkout.status), 'checkout beyond 90 days redirects');
    const loc = checkout.headers.location || '';
    assert.ok(loc.includes('skyline-rooftop'), loc);
    const beyondListing = await get(port, loc.split('#')[0]);
    assert.ok(beyondListing.body.includes('You can book up to 90 days ahead.'), beyondListing.body.slice(0, 400));
    assert.ok(!beyondListing.body.includes('No open dates in the next 90 days.'), beyondListing.body.slice(0, 800));
    assert.ok(beyondListing.body.includes('id="d2-hold"'));
    assert.ok(beyondListing.body.includes('hidden.value<MIN||hidden.value>MAX'), 'out-of-range dates open the calendar on the current month');

    const noDate = await get(port, '/checkout?hotel=skyline-rooftop');
    assert.ok([302, 303].includes(noDate.status), 'missing date redirects to listing');
    assert.ok((noDate.headers.location || '').includes('#book'));

    const coPage = await get(port, '/checkout?hotel=skyline-rooftop&date=2026-11-22&pass=chair&qty=1');
    assert.ok(coPage.body.includes('Age: 18+'));
    assert.ok(coPage.body.includes('actively supervise any children at all times.'));
    assert.ok(!coPage.body.includes('Children must be actively supervised'));

    const listing = await get(port, '/h/skyline-rooftop');
    assert.ok(listing.body.includes('data-max-people'));
    assert.ok(listing.body.includes('data-holds'));
    assert.ok(listing.body.includes('Up to 6 people per booking'));

    const home = await get(port, '/');
    assert.ok(!home.body.includes('class="ex-note">Demo</p>'));
    assert.ok(home.body.includes('by email. I can unsubscribe'));
    assert.ok(!home.body.includes('email/SMS'));

    const daybedQty = await get(port, '/checkout?hotel=skyline-rooftop&date=2026-11-22&pass=daybed&qty=5');
    assert.ok([302, 303].includes(daybedQty.status), '5 daybeds redirect when over people cap');
    assert.ok((daybedQty.headers.location || '').includes('qty=3') || (daybedQty.headers.location || '').includes('notice=1'));
  } finally {
    child.kill('SIGTERM');
  }
  console.log('sweep-fix-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});