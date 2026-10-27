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
delete process.env.ABN;
delete process.env.CONTACT_EMAIL;

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
assert.strictEqual(offering.lateWindow(db, sky.h, sky.date), null, 'late access must not cover the 4–5pm room-guests-only hour');
assert.strictEqual(offering.latePossible({
  hours: [{ weekday: 1, open: 1, opens: '11:00', closes: '17:00' }],
  room_only_from: '16:00', room_only_to: '17:00',
}), false);
assert.strictEqual(offering.latePossible({
  hours: [{ weekday: 1, open: 1, opens: '11:00', closes: '20:00' }],
  room_only_from: '16:00', room_only_to: '17:00',
}), true, 'late access can start after room guests only ends');

const skyId = sky.h.id;
db.prepare('UPDATE hotel_hours SET closes=? WHERE hotel_id=? AND open=1').run('20:00', skyId);
const widened = offering.lateWindow(db, db.prepare('SELECT * FROM hotels WHERE id=?').get(skyId), sky.date);
assert.deepStrictEqual(widened, { end: '17:00', until: '20:00' });
db.prepare('UPDATE hotel_hours SET closes=? WHERE hotel_id=? AND open=1').run('17:00', skyId);
assert.strictEqual(offering.lateWindow(db, db.prepare('SELECT * FROM hotels WHERE id=?').get(skyId), sky.date), null);

const salt = nextOpen('saltwater-terrace');
const freeSky = nextOpen('skyline-rooftop', 3);
const insideDay = nextOpen('skyline-rooftop', 0);
const insideWindow = /can't be cancelled for free/.test(offering.cancelNote(db, insideDay.h, insideDay.date));
assert.ok(/^Free cancellation until 11am /.test(offering.cancelNote(db, freeSky.h, freeSky.date)), offering.cancelNote(db, freeSky.h, freeSky.date));
assert.strictEqual(offering.lateWindow(db, salt.h, salt.date), null);
assert.strictEqual(offering.hotelLatePossible(db, salt.h), false);
assert.strictEqual(offering.hotelLatePossible(db, sky.h), false);
const lateRows = db.prepare("SELECT h.slug, a.enabled FROM addons a JOIN hotels h ON h.id=a.hotel_id WHERE a.code='late' ORDER BY h.slug").all();
for (const row of lateRows) assert.strictEqual(row.enabled, 0, row.slug);
assert.ok(offering.hoursView(db, sky.h, sky.date).hoursLine.includes('Mon–Thu'), offering.hoursView(db, sky.h, sky.date).hoursLine);
assert.ok(offering.hoursView(db, salt.h, salt.date).hoursLine.includes('Daily · 10am–4pm'), offering.hoursView(db, salt.h, salt.date).hoursLine);
assert.ok(offering.hoursView(db, sky.h, sky.date).hoursLine.includes('Sat–Sun'), offering.hoursView(db, sky.h, sky.date).hoursLine);
const joinHours = offering.blankJoin().hours;
assert.ok(joinHours.find(r => r.weekday === 0).open && joinHours.find(r => r.weekday === 6).open, 'new hotels start with Saturday and Sunday open');

const earlyRoom = offering.readForm({
  hotel_name: 'Test', area: 'CBD', spot_name: 'Sun lounger', kind: 'lounger', holds: '1', price: '40', cap: '10',
  day_open: '1', cutoff_hours: '2', opens_1: '10:00', closes_1: '16:00', room_only_from: '09:00', room_only_to: '12:00',
});
assert.ok(earlyRoom.err && /can't be sold past/.test(earlyRoom.err), earlyRoom.err);

db.prepare("UPDATE addons SET enabled=1 WHERE code='late' AND hotel_id=?").run(sky.h.id);
const blockedLate = offering.saveOffering(db, sky.h.id, {
  hotel_name: sky.h.name, area: sky.h.area, spot_name: 'Pool chair', kind: 'chair', holds: '1', price: '55', cap: '20',
  day_open: ['1', '2', '3', '4'], cutoff_hours: '1', heated: '1', setting: 'outdoor', age_policy: '18+', towels: '1', id_required: '1', lifeguard: '0',
  opens_1: '11:00', closes_1: '17:00', opens_2: '11:00', closes_2: '17:00', opens_3: '11:00', closes_3: '17:00', opens_4: '11:00', closes_4: '17:00',
  room_only_from: '16:00', room_only_to: '17:00',
});
assert.ok(blockedLate.err && /overlap room guests only/.test(blockedLate.err), blockedLate.err);
assert.strictEqual(db.prepare('SELECT room_only_from FROM hotels WHERE id=?').get(sky.h.id).room_only_from, '16:00');
db.prepare("UPDATE addons SET enabled=0 WHERE code='late' AND hotel_id=?").run(sky.h.id);

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

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
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
      env: { ...process.env, ...extra, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '' },
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
    assert.ok(home.body.includes('Hotel Day Club · ABN 98 227 458 028'));
    assert.ok(home.body.includes('Demo site — listings are examples, no real bookings or payments.'));
    assert.ok(!home.body.includes('ABN: to be added'));
    assert.ok(!home.body.includes('Jason Baranov') && !home.body.includes('registration pending'));
    assert.ok(!/usually sells out|partners with Sydney hotels|star rating/i.test(home.body));

    const faq = await get(port, '/faq');
    assert.strictEqual(faq.status, 200);
    assert.ok(faq.body.includes('at least 3 years'));
    assert.ok(faq.body.includes('5-pass pack is not offered'));
    assert.ok(faq.body.includes('24 hours before'));
    assert.ok(faq.body.includes('A free date change may be available once, subject to availability.'));
    assert.ok(faq.body.includes('content="index, follow"'));
    assert.ok(!faq.body.includes('noindex'));

    const robots = await get(port, '/robots.txt');
    assert.strictEqual(robots.status, 200);
    assert.ok(/^User-agent:\s*\*/m.test(robots.body), robots.body);
    assert.ok(/^Allow:\s*\/$/m.test(robots.body), robots.body);
    for (const line of ['Disallow: /admin', 'Disallow: /hotel', 'Disallow: /checkout', 'Disallow: /api', 'Disallow: /booking/', 'Disallow: /healthz']) {
      assert.ok(robots.body.includes(line), robots.body);
    }
    assert.ok(robots.body.includes('Sitemap: https://www.hoteldayclub.com.au/sitemap.xml'), robots.body);
    assert.ok(!/^Disallow:\s*\/\s*$/m.test(robots.body), robots.body);

    const draft = 'Draft terms for demo purposes, pending legal review.';
    for (const pathName of ['/terms', '/privacy', '/refunds', '/risk']) {
      const doc = await get(port, pathName);
      assert.strictEqual(doc.status, 200, pathName);
      assert.ok(doc.body.includes(draft), pathName);
      assert.ok(doc.body.includes('Hotel Day Club · ABN 98 227 458 028'), pathName);
      assert.ok(doc.body.includes('content="noindex, follow"'), pathName);
      assert.ok(!doc.body.includes('noindex, nofollow'), pathName);
      assert.ok(doc.body.includes('rel="canonical" href="https://www.hoteldayclub.com.au' + pathName + '"'), pathName);
      assert.ok(!doc.body.includes('DRAFT: NOT FOR PUBLICATION'), pathName);
      assert.ok(!/LAWYER/.test(doc.body), pathName);
      assert.ok(!/partner hotels?/i.test(doc.body), pathName);
      assert.ok(!doc.body.includes('">http'), pathName);
      assert.ok(!doc.body.includes('Jason Baranov') && !doc.body.includes('registration pending'), pathName);
      assert.ok(!doc.body.includes('{{ABN}}') && !doc.body.includes('{{CONTACT_EMAIL}}'), pathName);
      const visible = doc.body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '');
      assert.ok(!/\[[^\]]+\]/.test(visible), pathName + ' still has a placeholder');
    }
    const terms = await get(port, '/terms');
    assert.ok(terms.body.includes('Customer terms (draft)'));
    assert.ok(terms.body.includes('We are a booking agent.'));
    assert.ok(terms.body.includes('Hotel Day Club is a registered business name (ABN 98 227 458 028). In these terms, &#39;we&#39; means the owner of that business name.'));
    assert.ok(terms.body.includes('ticking the boxes'));
    assert.ok(terms.body.includes('A free date change may be available once, subject to availability.'));
    assert.ok(terms.body.includes('href="https://www.legislation.gov.au/C2004A00109/latest/text"'));
    assert.ok(terms.body.includes('14. Complaints'));
    assert.ok(!terms.body.includes('Gift cards') && !terms.body.includes('Referrals') && !/>\s*14\. Reviews/.test(terms.body));
    const risk = await get(port, '/risk');
    assert.ok(risk.body.includes('Risk warning (draft)'));
    assert.ok(!risk.body.includes('NOT LEGAL ADVICE'));
    const privacy = await get(port, '/privacy');
    assert.ok(privacy.body.includes('In this policy, &#39;we&#39; means the owner of that business name.'));
    assert.ok(privacy.body.includes('participating hotels'));
    assert.ok(privacy.body.includes('Some of our service providers store data overseas, including in the United States.'));
    assert.ok(privacy.body.includes('Last updated: 23 October 2026'));
    assert.ok(privacy.body.includes('We use Google Analytics to understand how visitors use the public pages of this site'));
    assert.ok(privacy.body.includes('which pages are viewed, and the approximate location, device and browser'));
    assert.ok(privacy.body.includes('Google Analytics uses cookies'));
    assert.ok(privacy.body.includes('may store it overseas, including in the United States'));
    assert.ok(privacy.body.includes('We do not send your name, email, phone number or booking code to Google Analytics.'));
    assert.ok(privacy.body.includes('href="https://tools.google.com/dlpage/gaoptout"'));
    assert.ok(privacy.body.includes('blocking cookies in your browser'));
    assert.ok(privacy.body.includes('If you join the waitlist we collect your email address.'));
    assert.ok(privacy.body.includes('a destination you want to hear about'));
    assert.ok(privacy.body.includes('We do not sell this information.'));
    assert.ok(privacy.body.includes('delete your waitlist details'));
    assert.ok(privacy.body.includes('lead event with no name, email or other personal details'));
    assert.ok(privacy.body.includes('That event does not include your name, email or other personal details.'));
    assert.ok(!home.body.includes('googletagmanager.com'));
    const mail = 'mailto:hello@hoteldayclub.com.au';
    function onlyThisMail(body, where) {
      const found = [...body.matchAll(/mailto:([^"'?\s]+)/g)].map(m => m[1]);
      assert.ok(found.length >= 1 && found.every(m => m === 'hello@hoteldayclub.com.au'), where + ' ' + found.join(','));
    }
    const link = '<a href="' + mail + '">hello@hoteldayclub.com.au</a>';
    onlyThisMail(terms.body, 'terms');
    assert.ok(terms.body.includes('14. Complaints') && terms.body.includes('Contact us at ' + link));
    onlyThisMail(privacy.body, 'privacy');
    assert.ok(privacy.body.includes('Access, correction and complaints') && privacy.body.includes('contacting us at ' + link) && privacy.body.includes('email ' + link));
    const refunds = await get(port, '/refunds');
    onlyThisMail(refunds.body, 'refunds');
    assert.ok(refunds.body.includes('Contact and complaints') && refunds.body.includes('contact us at ' + link));
    onlyThisMail(faq.body, 'faq');
    assert.ok(faq.body.includes('How do I contact you?') && faq.body.includes('Email ' + link));
    assert.ok(!faq.body.includes('Jason Baranov') && !faq.body.includes('registration pending'));
    onlyThisMail(home.body, 'home');
    const forHotels = await get(port, '/for-hotels');
    assert.strictEqual(forHotels.status, 200);
    onlyThisMail(forHotels.body, 'for-hotels');
    assert.ok(forHotels.body.includes('mailto:hello@hoteldayclub.com.au?subject=Hotel%20Day%20Club%20-%20partnership%20enquiry'));
    assert.ok(!/commission|75%|25%/i.test(forHotels.body));
    const join = await get(port, '/hotel/join');
    assert.strictEqual(join.status, 302);
    assert.strictEqual(join.headers.location, '/for-hotels');
    assert.ok(home.body.includes('Contact ' + link));
    assert.ok(!risk.body.includes('{{CONTACT_EMAIL}}'));

    const listing = await get(port, `/h/skyline-rooftop?date=${freeSky.date}`);
    assert.ok(listing.body.includes('Mon–Thu · 11am–4pm'), listing.body.slice(listing.body.indexOf('l-meta'), listing.body.indexOf('l-meta') + 180));
    assert.ok(!listing.body.includes('Wed ·'));
    const saltListing = await get(port, `/h/saltwater-terrace?date=${salt.date}`);
    assert.ok(saltListing.body.includes('Daily · 10am–4pm'));

    const avail = await get(port, `/api/availability?hotel=skyline-rooftop&date=${freeSky.date}`);
    const data = JSON.parse(avail.body);
    assert.ok(!data.addons.some(a => a.code === 'late'), JSON.stringify(data.addons));
    assert.ok(/Free cancellation until 11am /.test(data.cancel), data.cancel);
    if (insideWindow) {
      const soon = JSON.parse((await get(port, `/api/availability?hotel=skyline-rooftop&date=${insideDay.date}`)).body);
      assert.ok(/can't be cancelled for free/.test(soon.cancel), soon.cancel);
    }
    const saltAvail = JSON.parse((await get(port, `/api/availability?hotel=saltwater-terrace&date=${salt.date}`)).body);
    assert.ok(!saltAvail.addons.some(a => a.code === 'late'));

    const checkout = await get(port, `/checkout?hotel=skyline-rooftop&date=${freeSky.date}&pass=chair&qty=1`);
    assert.strictEqual(checkout.status, 200);
    assert.ok(checkout.body.includes('name="terms"') && checkout.body.includes('href="/terms"'));
    assert.ok(checkout.body.includes('href="/refunds"') && checkout.body.includes('href="/privacy"'));
    assert.ok(checkout.body.includes('cancellation and refund policy'));
    assert.ok(checkout.body.includes('name="risk"') && checkout.body.includes('Risk warning'));
    assert.ok(checkout.body.includes('name="rules"'));
    assert.ok(checkout.body.includes('No lifeguard is on duty'));
    assert.ok(!checkout.body.includes('hotel terms apply'));
    assert.ok(checkout.body.includes(data.cancel));
    assert.ok(checkout.body.includes("Demo site, please don't enter real personal or payment details"));
    assert.ok(checkout.body.includes('Some providers store data overseas.'));
    assert.ok(checkout.body.includes('noindex'));

    const missing = await post(port, '/book', { hotel: 'skyline-rooftop', date: freeSky.date, pass: 'chair', qty: '1', name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1' });
    assert.strictEqual(missing.status, 409);
    assert.ok(missing.body.includes('customer terms'));

    const live = new Database(dbPath);
    live.prepare("UPDATE addons SET enabled=1 WHERE code='late' AND hotel_id IN (SELECT id FROM hotels WHERE slug IN ('saltwater-terrace','skyline-rooftop'))").run();
    live.close();
    const lateBook = await post(port, '/book', { hotel: 'saltwater-terrace', date: salt.date, pass: 'lounger', qty: '1', addon: 'late', name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1' });
    assert.strictEqual(lateBook.status, 409);
    assert.ok(/closing time/.test(lateBook.body), lateBook.body.slice(0, 400));

    const skyLate = await post(port, '/book', { hotel: 'skyline-rooftop', date: freeSky.date, pass: 'chair', qty: '1', addon: 'late', name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1' });
    assert.strictEqual(skyLate.status, 409, skyLate.body.slice(0, 300));
    assert.ok(/room guests|closing time/.test(skyLate.body), skyLate.body.slice(0, 400));

    const { sign } = require('cookie-signature');
    const liveHotel = new Database(dbPath);
    const skyRow = liveHotel.prepare("SELECT id FROM hotels WHERE slug='skyline-rooftop'").get();
    const lateAddon = liveHotel.prepare("SELECT id FROM addons WHERE hotel_id=? AND code='late'").get(skyRow.id);
    liveHotel.close();
    const hotelCookie = 'hotel=' + encodeURIComponent('s:' + sign(String(skyRow.id), 'hdc-demo-secret'));
    const addonSave = await new Promise((resolve, reject) => {
      const body = new URLSearchParams({ on: String(lateAddon.id), ['aprice_' + lateAddon.id]: '40', ['acap_' + lateAddon.id]: '10' }).toString();
      const req = http.request({ hostname: '127.0.0.1', port, path: '/hotel/addons', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), Cookie: hotelCookie } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end(body);
    });
    assert.strictEqual(addonSave.status, 303, addonSave.body.slice(0, 200));
    assert.ok(decodeURIComponent(addonSave.headers.location || '').includes("can't overlap room guests only"));
    const preview = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/hotel/email-preview', headers: { Cookie: hotelCookie } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
    assert.strictEqual(preview.status, 200);
    assert.ok(preview.body.includes("Tonight's email"));
    assert.ok(!preview.body.includes('Jason Baranov') && !preview.body.includes('registration pending'));
    const stillOff = new Database(dbPath, { readonly: true });
    assert.strictEqual(stillOff.prepare("SELECT enabled FROM addons WHERE id=?").get(lateAddon.id).enabled, 0);
    stillOff.close();

    const booked = await post(port, '/book', { hotel: 'skyline-rooftop', date: freeSky.date, pass: 'chair', qty: '1', name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1' });
    assert.strictEqual(booked.status, 303, booked.body.slice(0, 300));
    const loc = booked.headers.location;
    const page = await get(port, loc);
    assert.ok(!page.body.includes('Late access until'));
    assert.ok(page.body.includes(data.cancel));
    assert.ok(page.body.includes(', Australia'));
    assert.ok(!page.body.includes(', Sydney'));
    assert.ok(page.body.includes('Before you swim'));
    assert.ok(page.body.includes('A confirmation email is sent to the address you gave.'));
    assert.ok(page.body.includes('This is a demo booking. No payment was taken and no real booking exists.'));
    assert.ok(!page.body.includes('No email is sent'));
    assert.ok(page.body.includes('Terms') && page.body.includes('Accepted'));
    assert.ok(page.body.includes('Hotel Day Club · ABN 98 227 458 028'));
    assert.ok(!page.body.includes('Jason Baranov') && !page.body.includes('registration pending'));
    assert.ok(!page.body.includes('googletagmanager.com'));
  } finally {
    child.kill('SIGTERM');
  }

  const abnPort = 3192;
  const abn = await start(abnPort, { ABN: '11222333444', CONTACT_EMAIL: 'desk@example.com' });
  try {
    const home = await get(abnPort, '/');
    assert.ok(home.body.includes('Hotel Day Club · ABN 11 222 333 444'));
    assert.ok(!home.body.includes('98 227 458 028'));
    assert.ok(home.body.includes('mailto:desk@example.com'));
    assert.ok(!home.body.includes('hello@hoteldayclub.com.au'));
    const terms = await get(abnPort, '/terms');
    const found = [...terms.body.matchAll(/mailto:([^"'?\s]+)/g)].map(m => m[1]);
    assert.ok(found.length >= 2 && found.every(m => m === 'desk@example.com'), found.join(','));
    assert.ok(terms.body.includes('ABN 11 222 333 444'));
    assert.ok(!terms.body.includes('{{CONTACT_EMAIL}}') && !terms.body.includes('{{ABN}}'));
    assert.ok(!terms.body.includes('Jason Baranov'));
  } finally {
    abn.kill('SIGTERM');
  }
  const badPort = 3193;
  const bad = await start(badPort, { ABN: 'not-an-abn' });
  try {
    const home = await get(badPort, '/');
    assert.ok(home.body.includes('Hotel Day Club · ABN 98 227 458 028'));
  } finally {
    bad.kill('SIGTERM');
  }
  const gaSnippet = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-9F5ZH1T4YN"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'G-9F5ZH1T4YN\');</script>';
  const gaPort = 3194;
  const ga = await start(gaPort, { NODE_ENV: 'production' });
  try {
    const home = await get(gaPort, '/');
    assert.ok(home.body.includes(gaSnippet), 'homepage should include the standard gtag snippet');
    assert.ok(home.body.indexOf(gaSnippet) < home.body.indexOf('</head>'));
    const guestPages = ['/for-hotels', '/how-it-works', '/faq', '/contact', '/privacy', '/terms', '/refunds', '/risk', '/h/saltwater-terrace', '/checkout?hotel=skyline-rooftop&date=' + encodeURIComponent(freeSky.date) + '&pass=chair&qty=1'];
    for (const pathName of guestPages) {
      const doc = await get(gaPort, pathName);
      assert.strictEqual(doc.status, 200, pathName);
      assert.ok(doc.body.includes(gaSnippet), pathName);
    }
    const missing = await get(gaPort, '/booking/HDC-99999');
    const head = missing.body.slice(0, missing.body.indexOf('</head>'));
    assert.ok(head.includes("gtag('config','G-9F5ZH1T4YN',{page_path:'/booking',page_location:location.origin+'/booking',page_title:'Booking'});"));
    assert.ok(!head.includes('HDC-99999'));
    for (const pathName of ['/hotel/login', '/admin/login']) {
      const doc = await get(gaPort, pathName);
      assert.strictEqual(doc.status, 200, pathName);
      assert.ok(!doc.body.includes('googletagmanager.com'), pathName);
      assert.ok(!doc.body.includes('G-9F5ZH1T4YN'), pathName);
    }
    const joinRedirect = await get(gaPort, '/hotel/join');
    assert.strictEqual(joinRedirect.status, 302);
    assert.strictEqual(joinRedirect.headers.location, '/for-hotels');
    assert.ok(!String(joinRedirect.body || '').includes('googletagmanager.com'));
    const login = await post(gaPort, '/hotel/login', { user: 'demo-saltwater', pass: 'legal-hotel-test' });
    assert.strictEqual(login.status, 302);
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    for (const pathName of ['/hotel', '/hotel/analytics']) {
      const doc = await get(gaPort, pathName, { Cookie: cookie });
      assert.strictEqual(doc.status, 200, pathName);
      assert.ok(!doc.body.includes('googletagmanager.com'), pathName);
      assert.ok(!doc.body.includes('G-9F5ZH1T4YN'), pathName);
    }
  } finally {
    ga.kill('SIGTERM');
  }
  const offPort = 3195;
  const off = await start(offPort, { NODE_ENV: 'production', GA_MEASUREMENT_ID: '' });
  try {
    const home = await get(offPort, '/');
    assert.strictEqual(home.status, 200);
    assert.ok(!home.body.includes('googletagmanager.com'));
    assert.ok(!home.body.includes('G-9F5ZH1T4YN'));
  } finally {
    off.kill('SIGTERM');
  }
  console.log('legal checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
