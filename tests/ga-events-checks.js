const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const repo = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-ga-events-'));
const dbPath = path.join(dir, 'daypass.db');

const helper = require('../public/track.js');

assert.strictEqual(typeof helper.track, 'function');
assert.strictEqual(typeof helper.sanitizeParams, 'function');

const cleaned = helper.sanitizeParams({
  item_id: 'saltwater-terrace',
  seat_type: 'lounger',
  value: 45,
  currency: 'AUD',
  email: 'guest@example.com',
  name: 'Alex Citizen',
  phone: '0412345678',
  booking_code: 'HDC-7Q4K-2M9X',
  note: 'Call me on 0412345678',
  guest: 'Alex',
  page: '/h/saltwater-terrace',
});
assert.deepStrictEqual(cleaned, {
  item_id: 'saltwater-terrace',
  seat_type: 'lounger',
  value: 45,
  currency: 'AUD',
  page: '/h/saltwater-terrace',
});

const bounced = helper.sanitizeParams({
  search_term: 'hello@hoteldayclub.com.au',
  item_id: 'HDC-ABCD-1234',
});
assert.deepStrictEqual(bounced, {});

const search = helper.searchParamsFrom(new URLSearchParams('destination=sydney&date=2026-12-02&guests=2&want=pool'));
assert.strictEqual(search.search_term, 'sydney pool');
assert.strictEqual(search.destination, 'sydney');
assert.strictEqual(search.date, '2026-12-02');
assert.strictEqual(search.guests, 2);
assert.strictEqual(search.want, 'pool');
assert.strictEqual(search.page, '/search');

const emptySearch = helper.searchParamsFrom(new URLSearchParams(''));
assert.strictEqual(emptySearch.search_term, '(all)');

const calls = [];
globalThis.gtag = function () { calls.push(Array.from(arguments)); };
function stubNav(key, value) {
  const nav = globalThis.navigator || {};
  Object.defineProperty(nav, key, { value, configurable: true, writable: true });
}
stubNav('doNotTrack', '0');
stubNav('globalPrivacyControl', false);
assert.strictEqual(helper.reducedTracking(), false);
assert.ok(helper.track('select_seating', {
  item_id: 'saltwater-terrace',
  seat_type: 'daybed',
  value: 95,
  currency: 'AUD',
  email: 'hidden@example.com',
}));
const first = calls[0];
assert.strictEqual(first[0], 'event');
assert.strictEqual(first[1], 'select_seating');
assert.strictEqual(first[2].item_id, 'saltwater-terrace');
assert.strictEqual(first[2].value, 95);
assert.strictEqual(first[2].currency, 'AUD');
assert.ok(!Object.prototype.hasOwnProperty.call(first[2], 'email'));

calls.length = 0;
assert.strictEqual(helper.track('not ok!'), false);
assert.strictEqual(calls.length, 0);

stubNav('doNotTrack', '1');
assert.strictEqual(helper.reducedTracking(), true);
assert.strictEqual(helper.track('search', { search_term: 'sydney' }), false);
assert.strictEqual(calls.length, 0);

stubNav('doNotTrack', '0');
stubNav('globalPrivacyControl', true);
assert.strictEqual(helper.reducedTracking(), true);
assert.strictEqual(helper.track('view_item', { item_id: 'saltwater-terrace' }), false);

delete globalThis.gtag;
stubNav('globalPrivacyControl', false);
assert.strictEqual(helper.track('view_item', { item_id: 'saltwater-terrace' }), false);

const trackSrc = fs.readFileSync(path.join(repo, 'public/track.js'), 'utf8');
assert.ok(!trackSrc.includes('\u2014'), 'track.js must not add em dashes');
assert.ok(!trackSrc.includes('gtag(') || trackSrc.includes("root.gtag('event'"), 'helper talks to gtag only through the safe wrapper');

const bookingPageSrc = fs.readFileSync(path.join(repo, 'bookingPage.js'), 'utf8');
assert.ok(!bookingPageSrc.includes('googletagmanager'));
assert.ok(!bookingPageSrc.includes('gtag('));
assert.ok(!bookingPageSrc.includes('track.js'));
assert.ok(!bookingPageSrc.includes('G-9F5ZH1T4YN'));
assert.ok(!bookingPageSrc.includes('data-hdc-event'));

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    }).on('error', reject);
  });
}

function post(port, urlPath, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function start(port, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: repo,
      env: {
        ...process.env,
        ...extra,
        PORT: String(port),
        DB_PATH: dbPath,
        DATA_DIR: '',
        ADMIN_PASSWORD: 'ga-events-admin',
        DEMO_HOTEL_PASSWORD: 'ga-events-hotel',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => {
      log += c;
      if (log.includes('Hotel Day Club demo')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

function hasGa(body) {
  return body.includes('googletagmanager.com') || body.includes('G-9F5ZH1T4YN') || body.includes('gtag(');
}

function hasTrack(body) {
  return /\/track\.js(\?v=[\w]+)?/.test(body);
}

function noTracking(body, label) {
  assert.ok(!hasGa(body), label + ' must not include the GA tag');
  assert.ok(!hasTrack(body), label + ' must not include track.js');
  assert.ok(!body.includes('data-hdc-event'), label + ' must not include analytics data attributes');
}

(async () => {
  const offPort = 3348;
  const off = await start(offPort, { NODE_ENV: 'test', GA_MEASUREMENT_ID: '' });
  try {
    const home = await get(offPort, '/');
    assert.strictEqual(home.status, 200);
    noTracking(home.body, 'home without GA');
  } finally {
    off.kill('SIGTERM');
  }

  const port = 3349;
  const child = await start(port, { NODE_ENV: 'production' });
  try {
    const home = await get(port, '/');
    assert.strictEqual(home.status, 200);
    assert.ok(hasGa(home.body), 'home should load GA in production');
    assert.ok(hasTrack(home.body), 'home should load track.js with GA');
    assert.ok(home.body.includes("gtag('config','G-9F5ZH1T4YN')"));

    const listing = await get(port, '/h/saltwater-terrace');
    assert.strictEqual(listing.status, 200);
    assert.ok(hasGa(listing.body) && hasTrack(listing.body), 'listing');
    assert.ok(listing.body.includes('data-hdc-event-load="view_item"'));
    assert.ok(listing.body.includes('data-hdc-item-id="saltwater-terrace"'));
    assert.ok(/data-pass="lounger"[^>]*data-kind="lounger"/.test(listing.body) || /data-kind="lounger"[^>]*data-pass="lounger"/.test(listing.body));
    assert.ok(listing.body.includes('data-kind="daybed"'));
    assert.ok(listing.body.includes('data-kind="cabana"'));
    assert.ok(listing.body.includes('id="d2-form"') && listing.body.includes('data-hdc-event="book_click"'));
    assert.ok(!listing.body.includes('ga-guest@example.com'));

    const search = await get(port, '/search?destination=sydney&guests=2');
    assert.strictEqual(search.status, 200);
    assert.ok(hasGa(search.body) && hasTrack(search.body), 'search');
    assert.ok(search.body.includes('data-hdc-event-load="search"'));

    const hotels = await get(port, '/for-hotels?sent=1');
    assert.strictEqual(hotels.status, 200);
    assert.ok(hasGa(hotels.body) && hasTrack(hotels.body), 'for-hotels');
    assert.ok(hotels.body.includes('data-hdc-event-load="generate_lead"'));
    assert.ok(hotels.body.includes('data-hdc-lead-type="hotel_enquiry"'));
    assert.ok(hotels.body.includes('Thanks, we have your note.'));
    assert.ok(!hotels.body.includes("gtag('event','generate_lead')"));

    const contact = await get(port, '/contact');
    assert.strictEqual(contact.status, 200);
    assert.ok(hasGa(contact.body) && hasTrack(contact.body), 'contact');
    assert.ok(contact.body.includes('mailto:'));

    const dateMatch = listing.body.match(/name="date" value="(\d{4}-\d{2}-\d{2})"/);
    assert.ok(dateMatch, 'listing should offer a date');
    const date = dateMatch[1];
    const checkoutPath = `/checkout?hotel=saltwater-terrace&date=${encodeURIComponent(date)}&pass=lounger&qty=1`;
    const checkout = await get(port, checkoutPath);
    assert.strictEqual(checkout.status, 200, checkout.body.slice(0, 200));
    noTracking(checkout.body, 'checkout');
    assert.ok(checkout.body.includes('Checkout') || checkout.body.includes('co-card'));

    const booked = await post(port, '/book', {
      hotel: 'saltwater-terrace',
      date,
      pass: 'lounger',
      qty: '1',
      name: 'Alex Citizen',
      email: 'ga-events-guest@example.com',
      phone: '0412345678',
      rules: '1',
      terms: '1',
      risk: '1',
      group: '1',
      share: '1',
      accept: '1',
    });
    assert.strictEqual(booked.status, 303, booked.body.slice(0, 300));
    const confirmPath = booked.headers.location;
    assert.ok(confirmPath && confirmPath.startsWith('/booking/'), confirmPath);
    const confirm = await get(port, confirmPath);
    assert.strictEqual(confirm.status, 200);
    noTracking(confirm.body, 'booking confirmation');
    assert.ok(/You(?:&#39;|'|')re booked|Booking confirmed|Show at reception|SHOW AT RECEPTION/i.test(confirm.body), 'confirmation page');
    assert.ok(!confirm.body.includes('track.js'));
    assert.ok(!confirm.body.includes('googletagmanager.com'));

    const missing = await get(port, '/booking/HDC-MISSING');
    noTracking(missing.body, 'missing booking');

    for (const pathName of ['/hotel/login', '/admin/login']) {
      const doc = await get(port, pathName);
      assert.strictEqual(doc.status, 200, pathName);
      noTracking(doc.body, pathName);
    }
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
