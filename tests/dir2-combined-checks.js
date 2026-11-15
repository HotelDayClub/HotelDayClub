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

function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'dir2-admin', DEMO_HOTEL_PASSWORD: 'dir2-hotel' },
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
  return [...html.matchAll(/<h3><a href="\/h\/([a-z-]+)[^"]*">/g)].map(m => m[1]);
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
assert.ok(/\.d2-hero-title\{[^}]*color:\s*#FFF8EE/i.test(d2css), 'hero title on deep band');
assert.ok(/\.d2-hours-band\{[^}]*color:\s*#FFF8EE/i.test(d2css), 'hours band text');
assert.ok(/\.d2-bookbar\{[^}]*color:\s*#fff/i.test(d2css), 'desktop book bar text');

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
      assert.strictEqual(count(text, FOOD_RULE), 1, slug + ' food rule once');
      assert.strictEqual(count(text, FREE_CANCEL), 1, slug + ' free cancellation once');
      assert.strictEqual(count(body, 'Photo ID at check-in'), 1, slug + ' ID line once');
      assert.ok(!text.includes('\u2014'), slug + ' no em-dashes');
      assert.ok(!/commission|stripe/i.test(text), slug);
      assert.ok(!/[\u2605\u2606]|\bstars?\b|aggregateRating|\bABN\b/.test(body), slug + ' no ratings or ABN');
      assert.ok(text.includes('(demo)'), slug + ' demo price labels');
      assert.ok(text.includes('Fictional demo listing'), slug);
      assert.ok(!text.includes('Pay later') && !text.includes('Best price'), slug);
      assert.ok(body.includes('<dialog'), slug + ' booking sheet is a dialog');
      assert.ok(body.includes('id="book"') && body.includes('id="passes"') && body.includes('id="details"'), slug);
      assert.ok(body.indexOf('id="passes"') < body.indexOf('id="book"') && body.indexOf('id="book"') < body.indexOf('id="details"'), slug);
      assert.ok(/href="\/refunds"/.test(body), slug);
      assert.ok(body.includes('Open in Google Maps') || body.includes('Map placeholder (demo)'), slug);
    }

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
    assert.ok(saltText.includes('Example amenities (demo)'));
    const saltDetails = pages['saltwater-terrace'].slice(pages['saltwater-terrace'].indexOf('id="details"'));
    assert.ok(saltDetails.includes('<h3>Extras</h3>'), 'extras heading');
    assert.ok(!saltDetails.includes('Extras (paid)'), 'no legacy extras label');
    assert.ok(saltDetails.includes('class="d2-extra-list"'), 'extras card list');
    assert.ok(saltDetails.includes('class="d2-extra"'), 'extra row/card');
    assert.ok(/class="d2-extra-pr">.*\(demo\)/.test(saltDetails), 'demo price label on extras');
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

    // A8: the late notice is only shown by the availability reply and matches the cancel note.
    assert.ok(!visibleText(sheet).includes("can't be cancelled for free"));
    const lateRes = await get(port, `/api/availability?hotel=saltwater-terrace&date=${today}`);
    const late = JSON.parse(lateRes.body);
    if (/can't be cancelled for free/.test(late.cancel)) assert.strictEqual(late.cancel, LATE_NOTE);
    assert.strictEqual(late.cancel, cancelSalt);
    const far = ymd(addDays(new Date(today + 'T12:00:00'), 30));
    const farRes = JSON.parse((await get(port, `/api/availability?hotel=saltwater-terrace&date=${far}`)).body);
    assert.ok(!/can't be cancelled for free/.test(farRes.cancel));

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
    assert.ok(home.body.includes('<div class="quick" role="group" aria-label="Quick dates">'));
    assert.strictEqual((home.body.match(/class="qb"/g) || []).length, 2);
    assert.ok(home.body.includes(`href="/search?date=${today}"`) || home.body.includes(`href="/search?date=${ymd(addDays(new Date(today + 'T12:00:00'), 1))}"`));
    assert.ok(home.body.indexOf('class="quick"') < home.body.indexOf('class="search'));

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
    const fields = {
      hotel: 'saltwater-terrace', date: far, pass: 'daybed', qty: '1', name: 'Alex Citizen', email: 'ticket@example.com', phone: '0412345678',
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

    // A15: the listing stylesheet and token additions exist.
    const tokens = fs.readFileSync(path.join(root, 'public/tokens.css'), 'utf8');
    assert.ok(/--cream:\s*#FFF8EE/i.test(tokens) && /--apricot:\s*#F6A55F/i.test(tokens) && /--field:\s*#8A9A9F/i.test(tokens));
  } finally {
    child.kill('SIGTERM');
  }
  console.log('dir2 combined checks passed');
})().catch(err => { console.error(err); process.exit(1); });
