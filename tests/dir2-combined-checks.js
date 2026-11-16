const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { FOOD_RULE, FREE_CANCEL, cancelNote, GuestCheckIn } = require('../offering');
const { ListingD2, LATE_NOTE } = require('../listingDir2');
const { HomeQuick } = require('../homeQuick');
const { SearchQuery } = require('../search');
const { HotelClock } = require('../calendar');
const { ymd, addDays } = require('../util');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-dir2-'));
const dbPath = path.join(dir, 'daypass.db');
const root = path.join(__dirname, '..');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function post(port, urlPath, fields) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(fields).toString();
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

function start(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'dir2-admin', DEMO_HOTEL_PASSWORD: 'dir2-hotel', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

function count(body, text) {
  return body.split(text).length - 1;
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function cardNames(html) {
  const start = html.indexOf('class="list results"');
  const block = start >= 0 ? html.slice(start, html.indexOf('class="note"', start)) : html;
  return [...block.matchAll(/<a class="ex[^"]*" href="\/h\/([a-z0-9-]+)/g)].map(m => m[1]);
}

// A1-A2: pure helpers and home quick buttons.
assert.strictEqual(ListingD2.label('2026-11-14'), 'Sat 14 Nov');
assert.strictEqual(ListingD2.shift('2026-11-30', 1), '2026-12-01');
assert.strictEqual(ListingD2.maxDate('2026-11-14'), '2027-02-12');
assert.strictEqual(LATE_NOTE, "This booking is inside 24 hours of the start, so it can't be cancelled for free.");
assert.strictEqual(ListingD2.childrenLine({ kids_hours: 'All open hours, shallow end' }), '');
assert.strictEqual(ListingD2.childrenLine({ kids_hours: 'No children' }), 'No children');
assert.strictEqual(ListingD2.childrenLine({ kids_hours: 'All open hours' }), '');
assert.strictEqual(ListingD2.childrenLine({ kids_hours: '' }), '');
assert.strictEqual(ListingD2.hourGroups([{ day: 'Mon', time: '9am' }, { day: 'Tue', time: '9am' }, { day: 'Wed', time: 'Closed' }]).length, 2);

function contrastRatio(fg, bg) {
  const hex = s => {
    const h = s.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const lum = ([r, g, b]) => {
    const ch = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const L1 = lum(hex(fg));
  const L2 = lum(hex(bg));
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}


function chromeBin() {
  for (const bin of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(bin)) return bin;
  }
  return '';
}
function socketCtor() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    const ws = require('ws');
    return ws.WebSocket || ws;
  } catch (err) {
    return null;
  }
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
async function waitJson(url) {
  const started = Date.now();
  for (;;) {
    try { return await getJson(url); } catch (err) {
      if (Date.now() - started > 20000) throw new Error('timeout ' + url);
      await new Promise(r => setTimeout(r, 200));
    }
  }
}
function cdp(WS, wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { ok, bad } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) bad(new Error(JSON.stringify(msg.error)));
      else ok(msg.result);
    });
    ws.addEventListener('open', () => resolve({
      ws,
      send(method, params = {}, sessionId) {
        return new Promise((ok, bad) => {
          const msgId = ++id;
          pending.set(msgId, { ok, bad });
          const msg = { id: msgId, method, params };
          if (sessionId) msg.sessionId = sessionId;
          ws.send(JSON.stringify(msg));
        });
      },
    }));
    ws.addEventListener('error', reject);
  });
}

const listingCss = fs.readFileSync(path.join(root, 'public/listing-dir2.css'), 'utf8');
assert.match(listingCss, /body:has\(\.d2\) \.d2\.listing\{padding:0/);
assert.match(listingCss, /@media \(max-width:1023px\)[\s\S]*body:has\(\.d2\) \.d2-photos[\s\S]*padding-top:0/);
assert.match(listingCss, /\.d2 \.g-thumb img\{[\s\S]*object-fit:\s*cover/);
assert.match(listingCss, /\.d2 \.g-track img\{[\s\S]*object-fit:\s*cover/);
assert.match(listingCss, /\.g-lb-track img[\s\S]*object-fit:\s*contain/);
assert.match(listingCss, /\.d2 \.g-track > img,\s*\.d2 \.g-track > picture\{/);
assert.match(listingCss, /\.d2 \.g-track > \* \+ \*\{display:none!important\}/);
assert.match(listingCss, /html\.pass-b \.d2-card img,[\s\S]*object-fit:\s*cover/);
assert.ok(!/html\.pass-b[^{]*\.d2-card[^{]*\{[^}]*object-fit:\s*contain/.test(listingCss), 'pass-row thumbs use cover');
const guestCss = fs.readFileSync(path.join(root, 'public/guest-d2.css'), 'utf8');
assert.ok(guestCss.includes('search-page .ex .tag') && guestCss.includes('var(--hdc-sun-soft)') && guestCss.includes('var(--hdc-rose-ink)'));
assert.ok(!/search-page \.ex \.tag\{[^}]*background:transparent/.test(guestCss));
assert.ok(contrastRatio('#C63662', '#FFF6DC') >= 4.5, 'search Example tag contrast');

const wed = HomeQuick.build('2026-11-11');
assert.deepStrictEqual([wed.first.label, wed.first.sub, wed.first.href], ['Today', 'Wed 11 Nov', '/search?date=2026-11-11']);
assert.deepStrictEqual([wed.second.label, wed.second.sub, wed.second.href], ['This weekend', 'Sat 14\u2013Sun 15', '/search?from=2026-11-14&to=2026-11-15']);
const wedLate = HomeQuick.build('2026-11-11', { cutoff: true });
assert.deepStrictEqual([wedLate.first.label, wedLate.first.href], ['Tomorrow', '/search?date=2026-11-12']);
assert.strictEqual(wedLate.second.label, 'This weekend');
const sat = HomeQuick.build('2026-11-14');
assert.strictEqual(sat.first.label, 'Today');
assert.deepStrictEqual([sat.second.label, sat.second.href], ['This weekend', '/search?from=2026-11-14&to=2026-11-15']);
const satLate = HomeQuick.build('2026-11-14', { cutoff: true });
assert.deepStrictEqual([satLate.first.label, satLate.first.href], ['Tomorrow', '/search?date=2026-11-15']);
assert.deepStrictEqual([satLate.second.label, satLate.second.href], ['Next weekend', '/search?from=2026-11-21&to=2026-11-22']);
const sun = HomeQuick.build('2026-11-15');
assert.strictEqual(sun.first.label, 'Today');
assert.deepStrictEqual([sun.second.label, sun.second.href], ['Next weekend', '/search?from=2026-11-21&to=2026-11-22']);
const sunLate = HomeQuick.build('2026-11-15', { cutoff: true });
assert.deepStrictEqual([sunLate.first.label, sunLate.first.href], ['Tomorrow', '/search?date=2026-11-16']);
assert.strictEqual(sunLate.second.label, 'Next weekend');
assert.strictEqual(HomeQuick.build('nope'), null);
assert.ok(!/\u2014/.test(HomeQuick.html('2026-11-11')));

const d2css = fs.readFileSync(path.join(root, 'public/listing-dir2.css'), 'utf8');
assert.ok(/\.d2-head \.d2-title\{[^}]*color:\s*var\(--deep\)/i.test(d2css), 'title on cream block');
assert.ok(/\.d2-hours-band\{[^}]*color:\s*var\(--cream\)/i.test(d2css), 'hours band text');
assert.ok(!/\.d2-bookbar\{[^}]*display:\s*flex/.test(d2css), 'teal desktop bookbar removed');

// A3: moods.
assert.deepStrictEqual(SearchQuery.MOODS.map(m => m.label), ['Rooftop', 'Beachside', 'Quiet', 'Family friendly']);
assert.strictEqual(SearchQuery.kidsChip({ kids_hours: 'Children welcome until 2pm' }), 'Children until 2pm');
assert.strictEqual(SearchQuery.kidsChip({ kids_hours: 'All open hours' }), '');
assert.strictEqual(SearchQuery.kidsChip({ kids_hours: 'No children' }), '');
assert.strictEqual(SearchQuery.isFamily({ age_policy: 'All ages', kids_hours: 'All open hours' }), true);
assert.strictEqual(SearchQuery.isFamily({ age_policy: '18+', kids_hours: 'No children' }), false);

(async () => {
  const port = 3331;
  const child = await start(port);
  try {
    const Sqlite = require('better-sqlite3');
    const db = new Sqlite(dbPath, { readonly: true });
    const saltHotel = db.prepare("SELECT * FROM hotels WHERE slug='saltwater-terrace'").get();
    const today = HotelClock.today(saltHotel);
    const max = ymd(addDays(new Date(today + 'T12:00:00'), 90));
    const cancelSalt = cancelNote(db, saltHotel, today);
    db.close();

    // A4: listing copy rules.
    const slugs = ['saltwater-terrace', 'skyline-rooftop', 'harbourside-lido', 'palm-court', 'manly-sands', 'bayview-spa'];
    const pages = {};
    for (const slug of slugs) {
      const res = await get(port, '/h/' + slug);
      assert.strictEqual(res.status, 200, slug);
      pages[slug] = res.body;
      const body = res.body;
      const text = visibleText(body);
      const gtkSlice = body.slice(body.indexOf('id="before"'));
      assert.strictEqual(count(visibleText(gtkSlice), FOOD_RULE), 1, slug + ' food rule once in good to know');
      const exBlock = body.slice(body.indexOf('id="explore"'), body.indexOf('id="details"'));
      assert.strictEqual((body.match(new RegExp(FOOD_RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1, slug + ' food rule once on page');
      assert.strictEqual(count(visibleText(body.slice(body.indexOf('id="before"'))), FOOD_RULE), 1, slug + ' food rule in good to know');
      assert.strictEqual(count(exBlock, FOOD_RULE), 0, slug + ' no food rule in explore section');
      assert.ok(!/your pass|During pass hours|Hotel Day Club/i.test(visibleText(exBlock)), slug + ' place-only explore copy');
      assert.ok(count(text, FREE_CANCEL) >= 1 && count(text, FREE_CANCEL) <= 3, slug + ' free cancellation with qualifier, not duplicated ad nauseam');
      assert.strictEqual(count(body, 'Photo ID at check-in'), 1, slug + ' ID line once');
      assert.ok(!text.includes('\u2014'), slug + ' no em-dashes');
      assert.ok(!/commission|stripe/i.test(text), slug);
      assert.ok(!/[\u2605\u2606]|\bstars?\b|aggregateRating|\bABN\b/.test(body), slug + ' no ratings or ABN');
      assert.ok(!/\(demo\)/i.test(visibleText(body.slice(body.indexOf('<body')))), slug + ' no (demo) on displayed listing prices or heading, label is once per screen (SEO title keeps it)');
      assert.ok(body.includes('class="demo-banner"'), slug + ' demo banner stays');
      assert.ok(text.includes('Fictional demo listing'), slug);
      assert.ok(!text.includes('Pay later') && !text.includes('Best price'), slug);
      assert.ok(body.includes('<dialog'), slug + ' booking sheet is a dialog');
      assert.ok(body.includes('id="book"') && body.includes('id="passes"') && body.includes('id="explore"') && body.includes('id="details"'), slug);
      assert.ok(body.indexOf('id="passes"') < body.indexOf('id="explore"') && body.indexOf('id="explore"') < body.indexOf('id="details"'), slug + ' section order');
      assert.ok(body.indexOf('id="passes"') < body.indexOf('id="book"'), slug + ' book in passes');
      assert.ok(/href="\/refunds"/.test(body), slug);
      assert.ok(body.includes('Open in Google Maps') || body.includes('Map placeholder'), slug);
    }

    const harbTrack = pages['harbourside-lido'].match(/id="g-track"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(harbTrack, 'harbourside gallery track');
    assert.match(harbTrack[1], /^<picture>[\s\S]*glass-roof-pool/);
    assert.ok(harbTrack[1].includes('spa-steps.jpg'));
    assert.strictEqual((harbTrack[1].match(/<img\b/g) || []).length, 4, 'four track photos');

    // A5: included amenities omit per-guest towel counts; towel chip is on the listing header.
    const saltText = visibleText(pages['saltwater-terrace']);
    const incAt = pages['saltwater-terrace'].indexOf('class="d2-inc"');
    const incEnd = pages['saltwater-terrace'].indexOf('</ul>', incAt);
    const incRows = [...pages['saltwater-terrace'].slice(incAt, incEnd).matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
    assert.strictEqual(incRows.length, 6, incRows.join('|'));
    assert.strictEqual(incRows.filter(r => /\d/.test(r)).length, 0, 'no quantity labels in included list');
    assert.ok(incRows.some(r => /^Towels included/i.test(r)));
    assert.ok(pages['saltwater-terrace'].includes('Towels included'));
    assert.ok(!incRows.some(r => /Pool access/.test(r)));
    assert.ok(saltText.includes('Example amenities'));
    assert.ok(!saltText.includes('Example amenities (demo)'));
    const saltDetails = pages['saltwater-terrace'].slice(pages['saltwater-terrace'].indexOf('id="details"'));
    assert.ok(saltDetails.includes('<h3>Extras</h3>'), 'extras heading');
    assert.ok(!saltDetails.includes('Extras (paid)'), 'no legacy extras label');
    assert.ok(saltDetails.includes('class="d2-extra-list"'), 'extras card list');
    assert.ok(saltDetails.includes('class="d2-extra"'), 'extra row/card');
    assert.ok(/class="d2-extra-pr">[^<]*\$\d/.test(saltDetails) && !/class="d2-extra-pr">[^<]*\(demo\)/.test(saltDetails), 'extras show a price, no (demo) suffix (banner carries the label)');
    assert.ok(saltDetails.includes('<h3>On site (not included)</h3>'), 'on site heading');
    const onIdx = saltDetails.indexOf('<h3>On site (not included)</h3>');
    const extrasIdx = saltDetails.indexOf('<h3>Extras</h3>');
    const detailsClose = pages['saltwater-terrace'].indexOf('</section>', pages['saltwater-terrace'].indexOf('id="details"'));
    const hoursBandIdx = pages['saltwater-terrace'].indexOf('class="d2-hours-band"');
    assert.ok(onIdx > -1 && extrasIdx > onIdx && hoursBandIdx > detailsClose, 'section order');
    const onSlice = saltDetails.slice(onIdx, extrasIdx);
    assert.ok(onSlice.includes('class="d2-os-note"'), 'muted not-included line in on site block');
    assert.ok(!onSlice.includes('class="d2-muted">Not included:'), 'not-included not outside on site');

    // A6: seat URLs redirect and a pass link preselects.
    const seat = await get(port, '/h/saltwater-terrace/seat/daybed?date=' + today + '&qty=2');
    assert.strictEqual(seat.status, 301);
    assert.strictEqual(seat.headers.location, `/h/saltwater-terrace?pass=daybed&date=${today}&qty=2#book`);
    assert.strictEqual((await get(port, '/h/saltwater-terrace/seat/nope')).headers.location, '/h/saltwater-terrace#passes');
    assert.strictEqual((await get(port, '/h/no-such/seat/daybed')).status, 404);
    const noJs = await get(port, '/h/saltwater-terrace?pass=daybed&qty=2');
    assert.ok(/<input type="radio" name="pass" value="daybed"[^>]*\schecked>/.test(noJs.body));
    assert.ok(!/<input type="radio" name="pass" value="lounger"[^>]*\schecked>/.test(noJs.body));
    assert.ok(/id="d2-qty"[^>]* value="2"/.test(noJs.body));

    // A7: 14 date chips, More dates, no-JS fallback bounds.
    const sheet = pages['saltwater-terrace'];
    const chips = sheet.match(/<(?:label class|button type="button" class)="d2-d[ "]/g) || [];
    assert.strictEqual(chips.length, 14, 'fourteen date chips');
    assert.ok(sheet.includes('More dates'));
    assert.ok(sheet.includes('class="d2-mdb text-link"'), 'booking sheet inline links');
    assert.ok(sheet.includes('class="d2-rm text-link"'), 'read more uses text-link');
    assert.ok(sheet.includes(`max="${max}"`), 'More dates and the no-JS date field stop at today plus 90');
    assert.ok(sheet.includes(`min="${today}"`));
    assert.ok(/<noscript><form class="d2-nojs"[^>]*method="get"/.test(sheet), 'no-JS other date form');
    const chipDay = ymd(addDays(new Date(today + 'T12:00:00'), 20));
    const chipPage = await get(port, '/h/saltwater-terrace?date=' + chipDay);
    const chipDates = chipPage.body.slice(chipPage.body.indexOf('id="d2-dates"'), chipPage.body.indexOf('</div>', chipPage.body.indexOf('id="d2-dates"')));
    const chipPos = chipDates.indexOf('value="' + chipDay + '"');
    const todayPos = chipDates.indexOf('>Today<');
    assert.ok(chipPos > todayPos, 'out-of-range date chip follows the 14 chips');
    assert.ok(/<input[^>]*name="date"[^>]*required|required[^>]*name="date"/.test(sheet) || /name="date"[^>]*>/.test(sheet));

    // A8: late notice uses fixed clock; late and not-late are both asserted.
    assert.ok(!visibleText(sheet).includes("can't be cancelled for free"));
    const lateClockPort = port + 2;
    const lateClock = await start(lateClockPort, { HDC_NOW: '2026-11-17T01:00:00.000Z' });
    try {
      const fixedToday = '2026-11-17';
      const lateAvail = JSON.parse((await get(lateClockPort, `/api/availability?hotel=saltwater-terrace&date=${fixedToday}`)).body);
      assert.strictEqual(lateAvail.cancel, LATE_NOTE);
      const todayBook = await get(lateClockPort, `/h/saltwater-terrace?pass=lounger&date=${fixedToday}&qty=1`);
      assert.ok(todayBook.body.includes('id="d2-late"'));
      assert.ok(todayBook.body.includes('class="d2-note warn" id="d2-late"'));
      assert.ok(todayBook.body.includes('can&#39;t be cancelled for free'));
      const far = '2026-12-10';
      const farRes = JSON.parse((await get(lateClockPort, `/api/availability?hotel=saltwater-terrace&date=${far}`)).body);
      assert.ok(!/can't be cancelled for free/.test(farRes.cancel), farRes.cancel);
    } finally {
      lateClock.kill('SIGTERM');
    }
    const saltHoursBand = pages['saltwater-terrace'].slice(pages['saltwater-terrace'].indexOf('class="d2-hours-band"'), pages['saltwater-terrace'].indexOf('class="d2-hb-park"'));
    assert.ok(saltHoursBand.includes('<dt>Mon to Sun</dt><dd>10am\u20134pm</dd>'), 'Mon to Sun hours on listing');

    // A9: children line.
    for (const slug of ['manly-sands', 'skyline-rooftop', 'harbourside-lido']) {
      assert.ok(pages[slug].includes('id="d2-kids"'), slug + ' children line');
    }
    for (const slug of ['saltwater-terrace', 'palm-court']) {
      assert.ok(!pages[slug].includes('id="d2-kids"'), slug + ' no children line');
    }
    assert.ok(pages['manly-sands'].includes('<b>Children</b> Children welcome until 2pm'));

    // A10: closed dates and the hold alert.
    const pastDay = ymd(addDays(new Date(today + 'T12:00:00'), -3));
    const hold = await get(port, `/h/saltwater-terrace?date=${pastDay}&pass=lounger&qty=1&notice=1`);
    assert.ok(hold.body.includes('id="d2-hold" role="alert"'));
    assert.ok(hold.body.includes('That date has passed.'));
    assert.strictEqual(count(hold.body, 'id="d2-hold"'), 1);

    // A11: home quick buttons.
    const home = await get(port, '/');
    // Quick date buttons became the quiet "Popular" row under the search pill (design review mock-up 1).
    const popular = (home.body.match(/<nav class="popular" aria-label="Popular searches">[\s\S]*?<\/nav>/) || [''])[0];
    assert.ok(popular, 'popular searches row');
    assert.ok(!home.body.includes('class="qb"'), 'old quick date buttons removed');
    assert.strictEqual((popular.match(/<a /g) || []).length, 5);
    assert.ok(popular.includes(`href="/search?date=${today}"`) || popular.includes(`href="/search?date=${ymd(addDays(new Date(today + 'T12:00:00'), 1))}"`));
    assert.ok(popular.includes('href="/search?mood=rooftop"') && popular.includes('href="/search?want=spa"') && popular.includes('href="/search?mood=family"'));
    assert.ok(home.body.indexOf('class="search') < home.body.indexOf('class="popular"'));

    // A12: search moods, range, and the children chip.
    const family = await get(port, '/search?mood=family');
    assert.deepStrictEqual(cardNames(family.body).sort(), ['manly-sands', 'palm-court', 'saltwater-terrace']);
    assert.strictEqual(count(family.body, 'class="kidchip"'), 1, 'children chip on the part-day hotel only');
    const kidAt = family.body.indexOf('class="kidchip"');
    assert.ok(family.body.lastIndexOf('/h/manly-sands', kidAt) > family.body.lastIndexOf('/h/palm-court', kidAt));
    assert.ok(family.body.includes('aria-pressed="true" data-key="mood" data-value="family"'));
    const quiet = await get(port, '/search?mood=quiet');
    assert.deepStrictEqual(cardNames(quiet.body), ['bayview-spa']);
    const roof = await get(port, '/search?mood=rooftop');
    assert.deepStrictEqual(cardNames(roof.body), ['skyline-rooftop']);
    const beach = await get(port, '/search?mood=beachside');
    assert.deepStrictEqual(cardNames(beach.body).sort(), ['manly-sands', 'saltwater-terrace']);
    assert.ok(!(await get(port, '/search')).body.includes('class="kidchip"'));
    assert.ok(family.body.includes('data-key="mood" data-value="rooftop"'));
    assert.ok(family.body.includes('class="search-sum"'));
    assert.ok(family.body.includes('Anywhere in Australia · Any guests'));
    assert.strictEqual((family.body.match(/class="ichip mood"/g) || []).length, 4);
    assert.ok(!/class="chip"[^>]*>Family friendly/.test(family.body));
    const moodRow = family.body.match(/aria-label="Mood">([\s\S]*?)<\/div>/);
    assert.ok(moodRow && !/>Spa</.test(moodRow[1]));

    const from = ymd(addDays(new Date(today + 'T12:00:00'), 6));
    const to = ymd(addDays(new Date(today + 'T12:00:00'), 7));
    const range = await get(port, `/search?from=${from}&to=${to}`);
    assert.strictEqual(range.status, 200);
    assert.ok(cardNames(range.body).length >= 1);
    assert.ok(range.body.includes('name="from"') && range.body.includes('name="to"'));
    assert.ok(range.body.includes(`from=${from}`) || range.body.includes(`date=${from}`));
    const bad = await get(port, '/search?from=2020-01-01&to=2020-01-02');
    assert.strictEqual(bad.status, 200);

    // A13: ticket.
    const ticketDate = ymd(addDays(new Date(today + 'T12:00:00'), 30));
    const fields = {
      hotel: 'saltwater-terrace', date: ticketDate, pass: 'daybed', qty: '1', name: 'Alex Citizen', email: 'ticket@example.com', phone: '0412345678',
      rules: '1', terms: '1', risk: '1', group: '1', share: '1', accept: '1',
    };
    const params = new URLSearchParams(fields);
    params.append('addon', 'gym');
    params.append('addon', 'parking');
    const booked = await post(port, '/book', params);
    assert.strictEqual(booked.status, 303, booked.body.slice(0, 300));
    const ticket = await get(port, booked.headers.location);
    const t = ticket.body;
    const tt = visibleText(t);
    assert.ok(t.includes('<h1>Your demo booking</h1>'));
    assert.ok(t.includes('class="tk-ticket"'));
    assert.ok(/<span class="tk-ok">Confirmed<\/span>/.test(t));
    assert.ok(t.includes('id="tk-code"'));
    assert.ok(t.includes('<dt>Pass</dt><dd>Daybed</dd>'));
    assert.ok(t.includes('<dt>Guests</dt><dd>2</dd>'));
    assert.ok(/Fitness centre access \u00d7 2/.test(tt), tt);
    assert.ok(/<span>Parking<\/span>/.test(t));
    assert.ok(!/Parking \u00d7 1/.test(tt));
    assert.ok(t.includes('Towels included'));
    assert.ok(!t.includes('Towels: 2 provided'));
    assert.strictEqual(count(tt, FOOD_RULE), 1);
    assert.ok(tt.includes('Free cancellation until'));
    assert.strictEqual(count(t, 'class="tk-btn"'), 1, 'one filled button');
    assert.ok(tt.includes('Example QR (demo)'));
    assert.ok(tt.includes('Demo: nothing is charged or refunded.'));
    assert.ok(tt.includes('No payment was taken and no real booking exists.'));
    assert.ok(t.includes(GuestCheckIn.line().replace(/'/g, '&#39;')));
    assert.ok(t.includes('you can&#39;t charge anything to a room.'));
    assert.ok(tt.includes('accepted at checkout'));
    assert.ok(!tt.includes('Alex Citizen') && !tt.includes('ticket@example.com'));
    assert.ok(!tt.includes('\u2014'));
    assert.ok(t.includes('content="noindex'));
    assert.ok(t.includes('/booking-ticket.css'));
    const css = await get(port, '/booking-ticket.css');
    assert.strictEqual(css.status, 200);
    assert.ok(!/#F6A55F[^;}]*;[^}]*color:\s*var\(--apricot\)/i.test(css.body));

    // A14: apricot is a fill or border, never text colour.
    for (const file of ['public/listing-dir2.css', 'public/booking-ticket.css', 'public/golden/home.css', 'public/search.css']) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      for (const rule of source.match(/[^{}]+\{[^}]*\}/g) || []) {
        const body = rule.slice(rule.indexOf('{') + 1);
        assert.ok(!/(^|;)\s*color:\s*(var\(--apricot\)|#F6A55F)/i.test(body), file + ' ' + rule.slice(0, 80));
      }
      if (/listing-dir2|booking-ticket/.test(file)) assert.ok(!/font-size:\s*(1[0-3]|[0-9])px/.test(source), file + ' text floor is 14px');
    }

    // A15: Explore the hotel section and tokens.
    const tokens = fs.readFileSync(path.join(root, 'public/tokens.css'), 'utf8');
    assert.ok(/--cream:\s*#FFF8EE/i.test(tokens) && /--apricot:\s*#F6A55F/i.test(tokens) && /--field:\s*#8A9A9F/i.test(tokens));
    const saltExplore = pages['saltwater-terrace'];
    assert.ok(saltExplore.includes('href="#explore">Pool bar'), 'pool bar links to explore');
    assert.ok(saltExplore.includes('10am\u20134pm'), 'pool bar hours on explore card');
    assert.ok(saltExplore.includes('class="d2-ex-chip">Not included</span>'), 'Not included chip on bar');
    assert.strictEqual((saltExplore.match(/class="d2-ex-card"/g) || []).length, 4, 'saltwater four explore cards');
    const exSheetAt = saltExplore.indexOf('id="d2-explore-sheet"');
    const exSheetEnd = saltExplore.indexOf('</dialog>', exSheetAt);
    const exSheet = saltExplore.slice(exSheetAt, exSheetEnd > exSheetAt ? exSheetEnd : undefined);
    assert.strictEqual(exSheet.split(FOOD_RULE).length - 1, 0, 'no FOOD_RULE in explore sheet');
    assert.ok(!saltExplore.includes('id="overview"'), 'no duplicate overview block');
    assert.ok(!saltExplore.includes('Demo: no charge.'), 'no demo charge line in booking sheet');
    const saltHdr = saltExplore.slice(saltExplore.indexOf('<header'), saltExplore.indexOf('<main>'));
    assert.strictEqual((saltHdr.match(/<img[^>]+alt="Hotel Day Club"/g) || []).length, 1, 'one header logo');

    const WS = socketCtor();
    const bin = chromeBin();
    if (!WS || !bin) {
      if (process.env.CI) throw new Error('Chrome is required in CI for the listing gallery check');
      console.log('dir2 combined: gallery browser check skipped (no WebSocket/Chrome)');
    } else {
      const debugPort = 9357;
      const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-dir2-chrome-'));
      const chrome = spawn(bin, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
        `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(chromeDir, 'chrome')}`, 'about:blank',
      ], { stdio: 'ignore' });
      let session;
      try {
        const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
        session = await cdp(WS, version.webSocketDebuggerUrl);
        const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params = {}) => session.send(method, params, sessionId);
        await send('Page.enable');
        await send('Runtime.enable');
        for (const [width, height] of [[360, 780], [390, 844], [1440, 900]]) {
          await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
          await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/harbourside-lido` });
          await new Promise(r => setTimeout(r, 1400));
          const res = await send('Runtime.evaluate', {
            awaitPromise: true,
            returnByValue: true,
            expression: `(async () => {
              const firstImg = document.querySelector('#g-track img');
              if (firstImg && !(firstImg.complete && firstImg.naturalWidth)) {
                await Promise.race([
                  firstImg.decode ? firstImg.decode().catch(() => {}) : new Promise(r => {
                    firstImg.addEventListener('load', r, { once: true });
                    firstImg.addEventListener('error', r, { once: true });
                  }),
                  new Promise(r => setTimeout(r, 2000)),
                ]);
              }
              const track = document.getElementById('g-track');
              const slides = [...track.children].filter(el => el.tagName === 'PICTURE' || el.tagName === 'IMG');
              const tb = track.getBoundingClientRect();
              const vis = slides.filter(el => {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
                const b = el.getBoundingClientRect();
                const ox = Math.min(b.right, tb.right) - Math.max(b.left, tb.left);
                const oy = Math.min(b.bottom, tb.bottom) - Math.max(b.top, tb.top);
                return b.width > 0 && b.height > 0 && ox > Math.min(b.width, tb.width) * 0.5 && oy > Math.min(b.height, tb.height) * 0.5;
              });
              const first = vis[0] || null;
              const img = first && (first.tagName === 'PICTURE' ? first.querySelector('img') : first);
              return {
                slideCount: slides.length,
                visibleCount: vis.length,
                currentSrc: img ? (img.currentSrc || img.src || '') : '',
                firstTag: first ? first.tagName : '',
                dataN: document.documentElement.getAttribute('data-n'),
                firstW: first ? Math.round(first.getBoundingClientRect().width) : 0,
                trackW: Math.round(tb.width),
              };
            })()`,
          });
          const v = res.result.value;
          const tag = width + 'x' + height + ' ' + JSON.stringify(v);
          assert.strictEqual(v.slideCount, 4, 'four gallery slides ' + tag);
          assert.strictEqual(v.visibleCount, 1, 'one visible hero slide ' + tag);
          assert.strictEqual(v.dataN, '4', 'data-n is 4 ' + tag);
          assert.ok(/glass-roof-pool/.test(v.currentSrc), 'visible first slide is the hotel first photo ' + tag);
          assert.ok(!/spa-steps/.test(v.currentSrc), 'visible first slide is not the second photo ' + tag);
          assert.ok(v.firstW >= v.trackW - 2, 'first slide fills the track ' + tag);
        }
      } finally {
        if (session) session.ws.close();
        chrome.kill('SIGTERM');
      }
    }

  } finally {
    child.kill('SIGTERM');
  }
  console.log('dir2 combined checks passed');
})().catch(err => { console.error(err); process.exit(1); });
