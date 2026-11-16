const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { guestAreaName } = require('../destinations');
const { dayHoursText, cancelNote } = require('../offering');
const { BookingCancel } = require('../cancelBooking');

const root = path.join(__dirname, '..');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function start(port, dbPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('timeout\n' + log)), 25000);
    child.stdout.on('data', c => {
      log += c;
      if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-area-season-'));
const dbPath = path.join(dir, 'daypass.db');

const Sqlite = require('better-sqlite3');
const seedDb = new Sqlite(dbPath);
seedDb.close();

(async () => {
  const port = 3348;
  const child = await start(port, dbPath);
  try {
    const db = new Sqlite(dbPath, { readonly: true });
    const hotels = db.prepare('SELECT slug, area FROM hotels WHERE COALESCE(is_demo,0)=1 OR status=?').all('active');
    for (const h of hotels) {
      const label = guestAreaName(h.area);
      assert.strictEqual(label, guestAreaName(h.area), h.slug);
      if (h.area === 'Eastern Beaches') assert.strictEqual(label, 'Bondi & Eastern Beaches', h.slug);
      if (h.area === 'CBD & Harbour') assert.strictEqual(label, 'Sydney CBD', h.slug);
      const page = await get(port, '/h/' + h.slug);
      assert.ok(page.body.includes(escHtml(label)) || page.body.includes(label.replace(/&/g, '&amp;')), h.slug + ' card area');
    }

    const harb = db.prepare("SELECT * FROM hotels WHERE slug='harbourside-lido'").get();
    const dec = '2026-12-15';
    const jun = '2026-06-15';
    assert.strictEqual(dayHoursText(db, harb, dec), '8am\u20137pm');
    assert.ok(/9am/.test(dayHoursText(db, harb, jun)), 'june uses regular hours');
    const plan = require('../offering').dayPlan(db, harb, dec);
    const cancelAt = new Date('2026-12-14T20:00:00.000Z');
    assert.ok(/can't be cancelled for free/.test(cancelNote(db, harb, dec, cancelAt)), 'cancel cutoff uses seasonal open');
    const freeAt = new Date(BookingCancel.window(harb, dec, plan.opens, cancelAt).deadline.getTime() - 60 * 60 * 1000);
    assert.ok(/^Free cancellation until 8 ?am/i.test(cancelNote(db, harb, dec, freeAt)), cancelNote(db, harb, dec, freeAt));
    db.close();

    const decList = await get(port, `/h/harbourside-lido?date=${dec}&pass=lounger&qty=1`);
    assert.ok(decList.body.includes('8am\u20137pm'), 'december explore or hours show 8am-7pm');
    const exBlock = decList.body.slice(decList.body.indexOf('id="explore"'), decList.body.indexOf('id="details"'));
    assert.ok(exBlock.includes('8am\u20137pm'), 'explore cards december hours');

    const checkout = await get(port, `/checkout?hotel=harbourside-lido&date=${dec}&pass=lounger&qty=1`);
    assert.ok(checkout.body.includes('8am\u20137pm'), 'checkout included access december');
    assert.ok(checkout.body.includes('Sydney CBD'), 'checkout area name');

    const salt = await get(port, '/h/saltwater-terrace');
    assert.ok(salt.body.includes('Bondi &amp; Eastern Beaches') || salt.body.includes('Bondi & Eastern Beaches'), 'listing hero area name');

    console.log('area-season checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});