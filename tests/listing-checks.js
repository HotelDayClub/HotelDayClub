const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-list-'));
const dbPath = path.join(dir, 'daypass.db');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function post(port, urlPath, fields, headers = {}) {
  const body = fields instanceof URLSearchParams ? fields.toString() : new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'list-admin', DEMO_HOTEL_PASSWORD: 'list-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

(async () => {
  const port = 3217;
  const child = await start(port);
  try {
    const home = await get(port, '/');
    assert.ok(home.body.includes('class="hdc-date"'));
    assert.ok(home.body.includes('class="hdc-pick"'));
    assert.ok(home.body.includes('name="want"'));
    assert.ok(home.body.includes('>What</label>'));
    assert.ok(!home.body.includes('Any seat'));
    assert.ok(home.body.includes('id="wl-dest"'));
    const pool = await get(port, '/?want=pool');
    assert.ok(pool.body.includes('Saltwater Terrace'));
    const spa = await get(port, '/?want=spa');
    assert.ok(spa.body.includes('Bayview Spa'));
    assert.ok(spa.body.includes('Harbourside Lido'));
    assert.ok(!spa.body.includes('Saltwater Terrace'));
    const gym = await get(port, '/?want=gym');
    assert.ok(gym.body.includes('Skyline Rooftop'));
    assert.ok(!gym.body.includes('Palm Court'));
    const both = await get(port, '/?want=pool-spa');
    assert.ok(both.body.includes('Bayview Spa'));
    assert.ok(!both.body.includes('Manly Sands'));

    const salt = await get(port, '/h/saltwater-terrace');
    assert.strictEqual(salt.status, 200);
    assert.ok(salt.body.includes('Your day at The Saltwater Terrace'));
    assert.ok(salt.body.includes('id="passes"'));
    assert.ok(!salt.body.includes('id="included"'));
    assert.ok(!salt.body.includes('class="inc-grid"'));
    assert.ok(salt.body.includes('class="pass-open"'));
    assert.ok(salt.body.includes('class="pass-filter"'));
    assert.ok(salt.body.includes('aria-pressed="true">All</button>'));
    assert.ok(salt.body.includes('aria-expanded="false"'));
    assert.ok(salt.body.includes('aria-controls="pass-detail-lounger"'));
    assert.ok(salt.body.includes('type="button"'));
    assert.ok(salt.body.includes("What's included"));
    assert.ok(salt.body.includes('From $'));
    assert.ok(!salt.body.includes('1 guest'));
    assert.ok(salt.body.includes('2 guests'));
    assert.ok(salt.body.includes('4 guests'));
    assert.ok(salt.body.includes('1 × Towels'));
    assert.ok(salt.body.includes('2 × Towels'));
    assert.ok(salt.body.includes('4 × Towels'));
    assert.ok(salt.body.includes('1 × Pool access'));
    assert.ok(salt.body.includes('Complimentary Wi-Fi'));
    assert.ok(salt.body.includes('id="pass-detail-lounger" data-code="lounger" role="region" aria-labelledby="pass-title-lounger" hidden'));
    assert.ok(salt.body.includes('<summary>Opening hours</summary>'));
    assert.ok(salt.body.includes('<summary>Guest policy</summary>'));
    assert.ok(salt.body.includes('<summary>Cancellation</summary>'));
    assert.ok(!salt.body.includes('<summary>Parking</summary>'));
    assert.ok(!salt.body.includes('Train and bus'));
    assert.ok(salt.body.includes('id="addons-list"'));
    assert.ok(salt.body.includes('id="addons-pick"'));
    assert.ok(salt.body.includes('name="addon"'));
    assert.ok(salt.body.includes('value="gym"'));
    assert.ok(salt.body.includes('value="food"'));
    assert.ok(salt.body.includes('value="parking"'));
    assert.ok(salt.body.includes('type="checkbox"'));
    assert.ok(salt.body.includes('Fitness centre access'));
    assert.ok(salt.body.includes('Food and beverage credit'));
    assert.ok(!salt.body.includes('extra-static'));
    assert.ok(salt.body.includes('Parking'));
    assert.ok(salt.body.includes('$18'));
    assert.ok(!salt.body.includes('Train and bus'));
    assert.ok(!salt.body.includes('Bondi Junction'));
    assert.ok(!salt.body.includes('Day guests check in'));
    assert.ok(!salt.body.includes('30 a day'));
    assert.ok(!/\b\d+ a day\b/.test(salt.body));
    assert.ok(salt.body.includes('id="hours"'));
    assert.ok(salt.body.includes('Daily · 10am–4pm'));
    assert.ok(salt.body.includes('id="policy"'));
    assert.ok(salt.body.includes('Guest policy'));
    assert.ok(salt.body.includes('id="getting-there"'));
    assert.ok(salt.body.includes('18 Demo Terrace'));
    assert.ok(!salt.body.includes('Get directions'));
    assert.ok(!salt.body.includes('Apple Maps'));
    assert.ok(salt.body.includes('Pick a date to see your free-cancellation deadline.'));
    assert.ok(!salt.body.includes("can't be cancelled for free"));
    assert.ok(salt.body.includes('>Lifeguard</dt><dd>Not on duty</dd>'));
    assert.ok(salt.body.includes('>Pool</dt><dd>Outdoor</dd>'));
    assert.ok(salt.body.includes('>Heated</dt><dd>Yes</dd>'));
    assert.ok(salt.body.includes('Example information for a fictional hotel.'));
    assert.ok(salt.body.includes('class="map-peek"'));
    assert.ok(salt.body.includes('View map'));
    assert.ok(salt.body.includes('data-lat="-33.8915"'));
    assert.ok(!salt.body.includes('<iframe'));
    assert.ok(!salt.body.includes('export/embed.html'));
    assert.ok(!salt.body.includes('<script src="/vendor/leaflet/leaflet.js">'));
    assert.ok(salt.body.includes('class="hdc-date"'));
    assert.ok(salt.body.includes('data-inline="1"'));
    assert.ok(salt.body.includes('Most popular'));
    assert.ok(salt.body.includes('Instant confirmation'));
    assert.ok(salt.body.includes('a confirmation email is sent to the address you give'));
    assert.ok(salt.body.includes('This demo does not take a payment and is not a reservation at a real hotel.'));
    assert.ok(salt.body.includes('class="assure assure-lite"'));
    assert.ok(salt.body.includes('24 hours to cancel'));
    assert.ok(salt.body.includes('Show your QR code at check-in.'));
    assert.ok(salt.body.includes('Help when you need it'));
    assert.ok(salt.body.includes('href="/contact"'));
    assert.ok(salt.body.includes('Book your day'));
    assert.ok(salt.body.includes('<option value="1" selected>1</option>'));
    assert.ok(salt.body.includes('select[name="qty"]'));
    assert.ok(!salt.body.includes("$('#qty').value"));
    assert.ok(!salt.body.includes('spots left'));
    assert.ok(!salt.body.includes('Wed ·'));
    assert.ok(!/>\s*Seat\s*</.test(salt.body));
    const popular = salt.body.split('Most popular').length - 1;
    assert.strictEqual(popular, 1);

    const bay = await get(port, '/h/bayview-spa');
    assert.ok(bay.body.includes('Adults only (18+).'));
    assert.ok(!bay.body.includes('18+ on weekdays'));
    assert.ok(bay.body.includes('Spa treatment credit'));
    assert.ok(bay.body.includes('$30'));
    assert.ok(!bay.body.includes('Spa treatment discount'));
    assert.ok(bay.body.includes('>Pool</dt><dd>Indoor and outdoor</dd>'));

    const palm = await get(port, '/h/palm-court');
    assert.ok(palm.body.includes('>Lifeguard</dt><dd>On duty</dd>'));
    assert.ok(palm.body.includes('>Heated</dt><dd>No</dd>'));
    assert.ok(!palm.body.includes('kids-float.jpg'));
    assert.ok(palm.body.includes('tropical-resort.jpg'));
    assert.ok(palm.body.includes('resort-palms.jpg'));
    assert.ok(palm.body.includes('thatched-umbrellas.jpg'));
    assert.strictEqual((palm.body.match(/class="g\d+"/g) || []).length, 3);
    assert.ok(palm.body.includes('<summary>Parking</summary>'));
    assert.ok(palm.body.includes('On-site parking is included'));
    assert.ok(!palm.body.includes('Parking is not offered'));
    assert.ok(palm.body.includes('id="getting-there"'));
    assert.ok(palm.body.includes('7 Demo Avenue'));

    const sky = await get(port, '/h/skyline-rooftop');
    assert.ok(sky.body.includes('Mon–Thu · 11am–4pm'));
    assert.ok(!sky.body.includes('Wed ·'));
    assert.ok(sky.body.includes('Parking'));
    assert.ok(sky.body.includes('$40'));
    assert.ok(!sky.body.includes('16 a day'));
    assert.ok(!/\b\d+ a day\b/.test(sky.body));

    const join = await get(port, '/hotel/join');
    assert.strictEqual(join.status, 302);

    const login = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'list-hotel' });
    assert.strictEqual(login.status, 302);
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const settings = await get(port, '/hotel/settings');
    // cookie not sent
    assert.ok(settings.status === 302 || settings.status === 200);
    const authed = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/hotel/settings', headers: { Cookie: cookie } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
    assert.strictEqual(authed.status, 200);
    assert.ok(authed.body.includes('Getting there'));
    assert.ok(authed.body.includes('name="address"'));
    assert.ok(authed.body.includes("What's included"));
    assert.ok(authed.body.includes('Most popular label'));
    assert.ok(authed.body.includes('name="cap_parking"'));

    const Database = require('better-sqlite3');
    const live = new Database(dbPath);
    const hotel = live.prepare("SELECT id FROM hotels WHERE slug='saltwater-terrace'").get();
    let when = '';
    for (let i = 1; i < 21 && !when; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!live.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?').get(hotel.id, iso)) when = iso;
    }
    live.close();
    const checkout = await get(port, `/checkout?hotel=saltwater-terrace&date=${encodeURIComponent(when)}&pass=lounger&qty=1`);
    assert.strictEqual(checkout.status, 200);
    assert.ok(checkout.body.includes('Add extras'));
    assert.ok(checkout.body.includes('(optional)'));
    assert.ok(!checkout.body.includes('Make it a day'));
    assert.ok(!/<details class="extras"[^>]*\sopen/.test(checkout.body));
    assert.ok(!checkout.body.includes('Spots left'));
    assert.ok(checkout.body.includes('>Pass</dt>'));
    assert.ok(checkout.body.includes('>Guests</dt>'));
    assert.ok(checkout.body.includes("What's included"));
    assert.ok(checkout.body.includes('1 × Towels'));
    assert.ok(checkout.body.includes('1 × Pool access'));
    assert.ok(checkout.body.includes('1 × Complimentary Wi-Fi'));
    assert.ok(checkout.body.includes('Parking'));
    assert.ok(!checkout.body.includes('30 a day'));
    assert.ok(!/\b\d+ a day\b/.test(checkout.body));
    const fields = new URLSearchParams({
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '2', price: '1',
      name: 'Alex Citizen', email: 'alex-extra@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    });
    fields.append('addon', 'gym');
    fields.append('addon', 'parking');
    const priced = await post(port, '/book', fields);
    assert.strictEqual(priced.status, 303, priced.body.slice(0, 400));
    const pricedDb = new Database(dbPath);
    const saved = pricedDb.prepare('SELECT id, total, code FROM bookings WHERE email=?').get('alex-extra@example.com');
    assert.strictEqual(saved.total, 158);
    const lines = pricedDb.prepare('SELECT name, qty, unit_price, total FROM booking_addons WHERE booking_id=? ORDER BY name').all(saved.id);
    assert.deepStrictEqual(lines, [
      { name: 'Fitness centre access', qty: 2, unit_price: 25, total: 50 },
      { name: 'Parking', qty: 1, unit_price: 18, total: 18 },
    ]);
    const hotelRow = pricedDb.prepare("SELECT * FROM hotels WHERE slug='saltwater-terrace'").get();
    const { eventWindow, formatUtc } = require('../calendar');
    const win = eventWindow(pricedDb, hotelRow, when);
    pricedDb.close();
    assert.ok(win && win.start < win.end);
    const confirm = await get(port, priced.headers.location);
    assert.ok(confirm.body.includes("What's included"));
    assert.ok(confirm.body.includes('2 × Towels'));
    assert.ok(confirm.body.includes('2 × Pool access'));
    assert.ok(confirm.body.includes('1 × Complimentary Wi-Fi'));
    assert.ok(confirm.body.includes('Cancellation'));
    assert.ok(confirm.body.includes('Fitness centre access'));
    assert.ok(confirm.body.includes('Parking'));
    assert.ok(confirm.body.includes('$158'));
    assert.ok(confirm.body.includes('Add to Google Calendar'));
    assert.ok(confirm.body.includes('https://calendar.google.com/calendar/render?'));
    assert.ok(confirm.body.includes('action=TEMPLATE'));
    assert.ok(confirm.body.includes(formatUtc(win.start)));
    assert.ok(confirm.body.includes(formatUtc(win.end)));
    assert.ok(confirm.body.includes(saved.code));
    const ics = await get(port, priced.headers.location + '/calendar.ics');
    assert.ok(String(ics.headers['content-type']).includes('text/calendar'));
    assert.ok(ics.body.includes('DTSTART:' + formatUtc(win.start)));
    assert.ok(ics.body.includes('DTEND:' + formatUtc(win.end)));
    assert.ok(!ics.body.includes('VALUE=DATE'));
    assert.ok(ics.body.includes('Booking ' + saved.code));
    assert.ok(ics.body.includes('18 Demo Terrace'));
    const unknown = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', addon: 'not-a-real-extra',
      name: 'Alex Citizen', email: 'alex-bad@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    });
    assert.strictEqual(unknown.status, 409, unknown.body.slice(0, 300));
    assert.ok(/not available/i.test(unknown.body));
    const live2 = new Database(dbPath);
    live2.prepare("UPDATE addons SET daily_cap=0 WHERE hotel_id=? AND code='parking'").run(hotel.id);
    live2.close();
    const book = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', addon: 'parking',
      name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    });
    assert.strictEqual(book.status, 409, book.body.slice(0, 300));
    assert.ok(/sold out/i.test(book.body), book.body.slice(0, 300));
  } finally {
    child.kill('SIGTERM');
  }
  console.log('listing checks passed');
})().catch(err => { console.error(err); process.exit(1); });
