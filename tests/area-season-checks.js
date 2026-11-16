const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { DESTINATIONS, guestAreaName } = require('../destinations');
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

// Two pinned clocks: one 90-day booking window can't hold both 15 Dec and 15 June.
const DEC_NOW = '2026-11-05T01:00:00.000Z'; // 12pm, Thu 5 Nov 2026 (Sydney)
const JUN_NOW = '2027-04-06T01:00:00.000Z'; // 11am, Tue 6 Apr 2027 (Sydney)
const DEC = '2026-12-15';
const JUN = '2027-06-15';

function start(port, dbPath, now) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', HDC_NOW: now };
    delete env.HDC_DEMO_TODAY;
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env,
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

function sheetBlock(html) {
  const a = html.indexOf('<section class="d2-book" id="book"');
  assert.ok(a >= 0, 'booking sheet section present');
  const b = html.indexOf('</section>', a);
  return html.slice(a, b);
}

function sheetHours(html) {
  const m = sheetBlock(html).match(/<p class="d2-hrs" id="d2-hrs"( hidden)?>([^<]*)<\/p>/);
  return m ? { hidden: Boolean(m[1]), text: m[2] } : null;
}

function dayHoursMap(html) {
  const m = sheetBlock(html).match(/data-day-hours="([^"]*)"/);
  return m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : {};
}

function exploreBlock(html) {
  return html.slice(html.indexOf('id="explore"'), html.indexOf('id="details"'));
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;');
}

function destinationForArea(area) {
  return DESTINATIONS.find(d => (d.areas || []).includes(area));
}

function listingAreaSnippet(html) {
  const m = html.match(/class="d2-loc"[^>]*>([^<]+)</);
  return m ? m[1].replace(/&amp;/g, '&').trim() : '';
}

function searchCardAreaSnippet(html, slug) {
  const needle = `href="/h/${slug}"`;
  const i = html.indexOf(needle);
  if (i < 0) return '';
  const slice = html.slice(i, i + 2500);
  const m = slice.match(/class="ex-area"[^>]*>([^<]+)</);
  if (!m) return '';
  return m[1].replace(/&amp;/g, '&').split(' · ')[0].trim();
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-area-season-'));
const dbPath = path.join(dir, 'daypass.db');

const Sqlite = require('better-sqlite3');
const seedDb = new Sqlite(dbPath);
seedDb.close();

(async () => {
  const port = 3348;
  const child = await start(port, dbPath, DEC_NOW);
  try {
    const db = new Sqlite(dbPath, { readonly: true });
    const hotels = db.prepare('SELECT slug, area FROM hotels WHERE COALESCE(is_demo,0)=1 OR status=?').all('active');
    const searchPage = await get(port, '/search');
    for (const h of hotels) {
      const dest = destinationForArea(h.area);
      assert.ok(dest, `${h.slug} area ${h.area} maps to a destination`);
      const expected = dest.name;
      assert.strictEqual(guestAreaName(h.area), expected, h.slug);
      const page = await get(port, '/h/' + h.slug);
      const heroLoc = listingAreaSnippet(page.body);
      assert.strictEqual(heroLoc, expected, `${h.slug} listing hero area`);
      const cardArea = searchCardAreaSnippet(searchPage.body, h.slug);
      assert.strictEqual(cardArea, expected, `${h.slug} search card area`);
      if (h.area !== expected) {
        assert.notStrictEqual(heroLoc, h.area, `${h.slug} listing shows raw area`);
        assert.notStrictEqual(cardArea, h.area, `${h.slug} search shows raw area`);
      }
    }

    const harb = db.prepare("SELECT * FROM hotels WHERE slug='harbourside-lido'").get();
    assert.strictEqual(dayHoursText(db, harb, DEC), '8am\u20137pm');
    assert.strictEqual(dayHoursText(db, harb, JUN), '9am\u20136pm', 'june uses regular hours');
    // Cancel cutoff is 24 hours before opening. 15 Dec opens 8am AEDT (UTC+11): cutoff 14 Dec 8am = 13 Dec 21:00Z.
    // A 9am open would move it to 22:00Z, so 21:30Z (8:30am) tells the two apart.
    assert.ok(/^Free cancellation until 8 ?am/i.test(cancelNote(db, harb, DEC, new Date('2026-12-13T20:30:00.000Z'))), 'dec free at 7:30am the day before');
    assert.ok(/can't be cancelled for free/.test(cancelNote(db, harb, DEC, new Date('2026-12-13T21:30:00.000Z'))), 'dec cutoff is 8am, not 9am');
    // 15 June opens 9am AEST (UTC+10): cutoff 14 June 9am = 13 June 23:00Z. An 8am open would be 22:00Z.
    assert.ok(/^Free cancellation until 9 ?am/i.test(cancelNote(db, harb, JUN, new Date('2027-06-13T22:30:00.000Z'))), 'june still free at 8:30am the day before');
    assert.ok(/can't be cancelled for free/.test(cancelNote(db, harb, JUN, new Date('2027-06-13T23:30:00.000Z'))), 'june cutoff is 9am');
    db.close();

    // December page, clock pinned to 5 Nov 2026.
    const decList = await get(port, `/h/harbourside-lido?date=${DEC}&pass=lounger&qty=1`);
    assert.strictEqual(decList.status, 200);
    assert.deepStrictEqual(sheetHours(decList.body), { hidden: false, text: 'Hours 8am\u20137pm' }, 'booking sheet shows december hours');
    assert.strictEqual(dayHoursMap(decList.body)[DEC], '8am\u20137pm', 'sheet day hours map for december');
    assert.strictEqual(dayHoursMap(decList.body)['2026-11-20'], '9am\u20136pm', 'sheet day hours map outside the season');
    assert.ok(exploreBlock(decList.body).includes('8am\u20137pm'), 'explore cards december hours');
    assert.ok(!exploreBlock(decList.body).includes('9am\u20136pm'), 'no regular hours on december explore cards');
    const decCheckout = await get(port, `/checkout?hotel=harbourside-lido&date=${DEC}&pass=lounger&qty=1`);
    assert.ok(decCheckout.body.includes('8am\u20137pm'), 'checkout included access december');
    assert.ok(decCheckout.body.includes('Sydney CBD'), 'checkout area name');
    const decApi = JSON.parse((await get(port, `/api/availability?hotel=harbourside-lido&date=${DEC}&qty=1&pass=lounger`)).body);
    assert.ok(/^Free cancellation until 8 ?am, .*14 Dec/i.test(decApi.cancel), 'december cancel note uses 8am open: ' + decApi.cancel);
    const noDate = await get(port, '/h/harbourside-lido');
    assert.deepStrictEqual(sheetHours(noDate.body), { hidden: true, text: '' }, 'no hours line in the sheet without a date');
    const junEarly = await get(port, `/h/harbourside-lido?date=${JUN}`);
    assert.ok(!dayHoursMap(junEarly.body)[JUN], 'june is outside the november booking window');

    const salt = await get(port, '/h/saltwater-terrace');
    assert.ok(salt.body.includes('Bondi &amp; Eastern Beaches') || salt.body.includes('Bondi & Eastern Beaches'), 'listing hero area name');

  } finally {
    child.kill('SIGTERM');
  }
  await new Promise(r => setTimeout(r, 300));

  // June page, clock pinned to 6 Apr 2027.
  const junPort = 3349;
  const junChild = await start(junPort, dbPath, JUN_NOW);
  try {
    const junList = await get(junPort, `/h/harbourside-lido?date=${JUN}&pass=lounger&qty=1`);
    assert.strictEqual(junList.status, 200);
    assert.deepStrictEqual(sheetHours(junList.body), { hidden: false, text: 'Hours 9am\u20136pm' }, 'booking sheet shows june hours');
    assert.strictEqual(dayHoursMap(junList.body)[JUN], '9am\u20136pm', 'sheet day hours map for june');
    assert.ok(exploreBlock(junList.body).includes('9am\u20136pm'), 'explore cards june hours');
    assert.ok(!exploreBlock(junList.body).includes('8am\u20137pm'), 'no seasonal hours on june explore cards');
    assert.ok(/class="d2-time">9am\u20136pm</.test(junList.body), 'hours band june');
    const junCheckout = await get(junPort, `/checkout?hotel=harbourside-lido&date=${JUN}&pass=lounger&qty=1`);
    assert.ok(junCheckout.body.includes('9am\u20136pm'), 'checkout included access june');
    assert.ok(!/Today[^<]*8am\u20137pm|Hours[^<]*8am\u20137pm/.test(junCheckout.body.replace(/Seasonal hours[^<]*/g, '')), 'checkout june only mentions 8am-7pm in the seasonal note');
    const junApi = JSON.parse((await get(junPort, `/api/availability?hotel=harbourside-lido&date=${JUN}&qty=1&pass=lounger`)).body);
    assert.ok(/^Free cancellation until 9 ?am, .*14 Jun/i.test(junApi.cancel), 'june cancel note uses 9am open: ' + junApi.cancel);
    console.log('area-season checks passed');
  } finally {
    junChild.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});