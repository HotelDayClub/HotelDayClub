const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-park-'));
const unitPath = path.join(dir, 'unit.db');
process.env.DB_PATH = unitPath;
process.env.DATA_DIR = '';
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const db = require('../db');
const notices = require('../notices');
const { ensureAddons } = require('../seed');
const { ensureArrival } = require('../arrival');
const { ymd, addDays, nice } = require('../util');

const LINE = 'Show your booking code at the entrance';
const ENTRANCE = 'The demo car park entrance is on Demo Lane, behind the building.';
const STREET = '99 Secret Lane, Sydney NSW 2000';

function minSold(cap) {
  let n = 0;
  while (n * 100 < cap * 80) n += 1;
  return n;
}

async function unit() {
  const cols = new Set(db.prepare('PRAGMA table_info(hotels)').all().map(c => c.name));
  assert.ok(cols.has('parking_entrance') && cols.has('day_entrance') && cols.has('transit_note'));

  const saltId = db.prepare(`INSERT INTO hotels (slug, name, area, login, is_demo, lifeguard, hours, lat, lng)
    VALUES ('saltwater-terrace', 'The Saltwater Terrace (Demo)', 'Eastern Beaches', 'demo-saltwater', 1, 0, 'Daily · 10am–4pm', -33.8915, 151.2767)`).run().lastInsertRowid;
  const plainId = db.prepare(`INSERT INTO hotels (slug, name, login, lifeguard) VALUES ('plain-hotel', 'Plain Hotel', 'plain', 0)`).run().lastInsertRowid;
  ensureAddons(db);
  ensureAddons(db);
  const plain = db.prepare(`SELECT code, name, per, price, daily_cap FROM addons WHERE hotel_id=? AND code='parking'`).get(plainId);
  assert.deepStrictEqual(plain, { code: 'parking', name: 'Parking', per: 'booking', price: 20, daily_cap: 25 });
  assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM addons WHERE hotel_id=? AND code='parking'`).get(plainId).n, 1);
  const saltAddon = db.prepare(`SELECT name, per, enabled FROM addons WHERE hotel_id=? AND code='parking'`).get(saltId);
  assert.strictEqual(saltAddon.name, 'Parking');
  assert.strictEqual(saltAddon.per, 'booking');
  assert.strictEqual(saltAddon.enabled, 1);

  ensureArrival(db);
  const seeded = db.prepare('SELECT address, transit_note, parking_entrance, day_entrance FROM hotels WHERE slug=?').get('saltwater-terrace');
  assert.ok(seeded.address);
  assert.strictEqual(seeded.parking_entrance, ENTRANCE);
  assert.ok(seeded.transit_note.includes('Bondi Junction'));
  assert.ok(seeded.day_entrance.includes('pool reception'));
  db.prepare(`UPDATE hotels SET address=?, parking_entrance=?, day_entrance=NULL, transit_note='' WHERE id=?`).run('1 Custom St', 'Keep this entrance', saltId);
  ensureArrival(db);
  const kept = db.prepare('SELECT address, transit_note, parking_entrance, day_entrance FROM hotels WHERE id=?').get(saltId);
  assert.strictEqual(kept.address, '1 Custom St');
  assert.strictEqual(kept.parking_entrance, 'Keep this entrance');
  assert.ok(kept.transit_note.includes('Bondi Junction'));
  assert.ok(kept.day_entrance.includes('pool reception'));

  const bare = notices.bookingNotice({
    demo: true, to: 'guest@example.com', code: 'HDC-NONE', hotelName: 'Plain Hotel', area: 'Sydney',
    dateLabel: 'Wed 4 Nov', hours: '10am–4pm', passLabel: 'Sun lounger × 1', guests: '1', addons: [],
    totalLabel: '$45', cancel: 'Free cancellation until the day before.', risk: 'Before you swim: No lifeguard on duty.',
    contact: 'hello@hoteldayclub.com.au', link: 'https://www.hoteldayclub.com.au/booking/HDC-NONE', guest: 'Alex C.',
    address: STREET, phone: '0412999000',
  });
  assert.ok(!bare.html.includes(LINE) && !bare.text.includes(LINE));
  assert.ok(!bare.html.includes('park-details') && !bare.text.includes('Parking entrance'));
  assert.ok(!bare.html.includes(STREET) && !bare.text.includes(STREET));
  assert.ok(!/\bcommission\b/i.test(bare.html + bare.text));
  assert.ok(!/stripe/i.test(bare.html + bare.text));

  const parked = notices.bookingNotice({
    demo: true, to: 'guest@example.com', code: 'HDC-PARK', hotelName: 'Plain Hotel', area: 'Sydney',
    dateLabel: 'Wed 4 Nov', hours: '10am–4pm', passLabel: 'Sun lounger × 1', guests: '1', addons: [],
    totalLabel: '$65', cancel: 'Free cancellation until the day before.', risk: 'Before you swim: No lifeguard on duty.',
    contact: 'hello@hoteldayclub.com.au', link: 'https://www.hoteldayclub.com.au/booking/HDC-PARK', guest: 'Alex C.',
    parking: true,
    parkingEntrance: 'Gate A & B',
    directionsUrl: 'https://www.openstreetmap.org/?mlat=-33.8&mlon=151.2#map=17/-33.8/151.2',
  });
  assert.ok(parked.html.includes('park-details'));
  assert.ok(parked.html.includes('Gate A &amp; B'));
  assert.ok(parked.html.includes('>Directions</a>'));
  assert.ok(parked.html.includes('openstreetmap.org'));
  assert.ok(parked.html.includes(LINE) && parked.text.includes(LINE));
  assert.ok(parked.text.includes('Parking entrance: Gate A & B'));
  assert.ok(parked.text.includes('Directions: https://www.openstreetmap.org/'));
  assert.ok(!/\bcommission\b/i.test(parked.html + parked.text));

  const when = new Date(2026, 10, 4);
  const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, holds, daily_cap) VALUES (?, 'lounger', 'Sun lounger', 45, 1, 24)`).run(saltId).lastInsertRowid;
  db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)').run(saltId, when.getDay(), '10:00', '16:00');
  db.prepare(`UPDATE hotels SET parking_entrance=? WHERE id=?`).run(ENTRANCE, saltId);
  const parkAddon = db.prepare(`SELECT id FROM addons WHERE hotel_id=? AND code='parking'`).get(saltId).id;
  function book(code, withParking) {
    const id = db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, party, cancel_note)
      VALUES (?, ?, ?, '2026-11-04', 1, 45, 45, 'Alex Citizen', ?, '0412000111', 1, 'Free cancellation until the day before.')`).run(code, saltId, passId, code.toLowerCase() + '@example.com').lastInsertRowid;
    if (withParking) db.prepare(`INSERT INTO booking_addons (booking_id, addon_id, name, qty, unit_price, total) VALUES (?, ?, 'Parking', 1, 18, 18)`).run(id, parkAddon);
    return id;
  }
  book('HDC-MAILPARK', true);
  book('HDC-MAILWALK', false);
  const withMail = await notices.bookingMessage(db, 'HDC-MAILPARK');
  assert.ok(withMail.html.includes(LINE) && withMail.text.includes(LINE));
  assert.ok(withMail.html.includes(ENTRANCE) && withMail.text.includes(ENTRANCE));
  assert.ok(withMail.html.includes('>Directions</a>') && withMail.text.includes('Directions: https://www.openstreetmap.org/'));
  assert.ok(!withMail.html.includes(STREET) && !withMail.text.includes('0412000111'));
  assert.ok(!/\bcommission\b/i.test(withMail.html + withMail.text));
  const walkMail = await notices.bookingMessage(db, 'HDC-MAILWALK');
  assert.ok(!walkMail.html.includes(LINE) && !walkMail.text.includes(LINE));
  assert.ok(!walkMail.html.includes(ENTRANCE));

  db.prepare(`INSERT INTO inclusions (hotel_id, code, mode, price, daily_cap, note) VALUES (?, 'parking', 'included', 0, 0, 'On site')`).run(plainId);
  const plainPass = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, holds, daily_cap) VALUES (?, 'lounger', 'Sun lounger', 35, 1, 10)`).run(plainId).lastInsertRowid;
  db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)').run(plainId, when.getDay(), '10:00', '16:00');
  db.prepare(`UPDATE hotels SET parking_entrance=?, lat=?, lng=? WHERE id=?`).run('Included gate', -33.8, 151.2, plainId);
  db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, party, cancel_note)
    VALUES ('HDC-INCLUDED', ?, ?, '2026-11-04', 1, 35, 35, 'Alex Citizen', 'included@example.com', '0412000222', 1, 'Free cancellation until the day before.')`).run(plainId, plainPass);
  const includedMail = await notices.bookingMessage(db, 'HDC-INCLUDED');
  assert.ok(includedMail.html.includes(LINE) && includedMail.text.includes('Included gate'));
  const includedId = db.prepare(`SELECT id FROM bookings WHERE code='HDC-INCLUDED'`).get().id;
  assert.strictEqual(notices.bookingHasParking(db, includedId, plainId), true);
  assert.strictEqual(notices.bookingHasParking(db, db.prepare(`SELECT id FROM bookings WHERE code='HDC-MAILWALK'`).get().id, saltId), false);
  console.log('parking unit checks passed');
}

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function post(port, urlPath, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function cookie(res) {
  return (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}
function start(port, dbPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'parking-admin', DEMO_HOTEL_PASSWORD: 'parking-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 30000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function section(html, id) {
  const at = html.indexOf(`id="${id}"`);
  assert.ok(at >= 0, id);
  const next = html.indexOf('<section', at + 10);
  return html.slice(at, next === -1 ? html.length : next);
}
function chunk(html, code) {
  const plain = code.startsWith('Booking ') ? code.slice('Booking '.length) : code;
  let at = html.indexOf('/booking/' + plain);
  if (at < 0) at = html.indexOf(code);
  assert.ok(at >= 0, 'missing ' + code);
  const ends = [html.indexOf('</tr>', at), html.indexOf('</article>', at)].filter(n => n >= 0);
  const end = ends.length ? Math.min(...ends) : html.length;
  const start = Math.max(html.lastIndexOf('<tr>', at), html.lastIndexOf('<article', at));
  return html.slice(start < 0 ? at : start, end);
}
function warn(html) {
  const at = html.indexOf('id="sold-warn"');
  if (at < 0) return '';
  return html.slice(at, html.indexOf('</div>', at));
}
function clearDay(live, hotelId, date) {
  const ids = live.prepare('SELECT id FROM bookings WHERE hotel_id=? AND date=?').all(hotelId, date).map(row => row.id);
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(',');
  live.prepare(`DELETE FROM booking_addons WHERE booking_id IN (${marks})`).run(...ids);
  live.prepare(`DELETE FROM guest_notes WHERE booking_id IN (${marks})`).run(...ids);
  live.prepare(`DELETE FROM bookings WHERE id IN (${marks})`).run(...ids);
}
function bookSpots(live, hotelId, passId, date, n, prefix) {
  const ins = live.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,party)
    VALUES (?,?,?,?,1,35,35,?,?,?,'confirmed',1)`);
  for (let i = 0; i < n; i++) ins.run(prefix + String(i).padStart(2, '0'), hotelId, passId, date, 'Cap Guest ' + i, prefix.toLowerCase() + i + '@example.com', '0412555000');
}
async function openDates(port, n) {
  const found = [];
  for (let i = 1; i < 14 && found.length < n; i++) {
    const date = ymd(addDays(new Date(), i));
    const res = await get(port, '/api/availability?hotel=saltwater-terrace&date=' + date, { 'X-Forwarded-For': '203.0.113.40' });
    const data = JSON.parse(res.body);
    const row = (data.passes || []).find(p => p.code === 'lounger');
    if (row && !row.blocked && !row.past && row.cap > 0) found.push(date);
  }
  assert.ok(found.length >= n, 'need open dates in the next 14 days');
  return found;
}
async function bookGuest(port, fields) {
  const res = await post(port, '/book', {
    qty: '1', name: 'Alex Citizen', email: 'park-guest@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    ...fields,
  }, { 'X-Forwarded-For': '203.0.113.41' });
  assert.strictEqual(res.status, 303, res.body.slice(0, 300));
  return res.headers.location;
}

async function live() {
  const port = 3391;
  const dbPath = path.join(dir, 'live.db');
  const child = await start(port, dbPath);
  const Database = require('better-sqlite3');
  const liveDb = new Database(dbPath);
  try {
    const demo = liveDb.prepare(`SELECT slug, transit_note, parking_entrance, day_entrance FROM hotels WHERE COALESCE(is_demo,0)=1 ORDER BY slug`).all();
    assert.ok(demo.length >= 6);
    for (const hotel of demo) {
      assert.ok(hotel.transit_note, hotel.slug + ' transit');
      assert.ok(hotel.parking_entrance, hotel.slug + ' parking entrance');
      assert.ok(hotel.day_entrance, hotel.slug + ' day entrance');
    }
    const palmPark = liveDb.prepare(`SELECT a.name, a.per, a.price, a.daily_cap FROM addons a JOIN hotels h ON h.id=a.hotel_id WHERE h.slug='palm-court' AND a.code='parking'`).get();
    assert.deepStrictEqual(palmPark, { name: 'Parking', per: 'booking', price: 20, daily_cap: 25 });
    const saltPark = liveDb.prepare(`SELECT a.name, a.per, a.enabled FROM addons a JOIN hotels h ON h.id=a.hotel_id WHERE h.slug='saltwater-terrace' AND a.code='parking'`).get();
    assert.deepStrictEqual(saltPark, { name: 'Parking', per: 'booking', enabled: 1 });

    const listing = await get(port, '/h/saltwater-terrace', { 'X-Forwarded-For': '203.0.113.42' });
    assert.strictEqual(listing.status, 200);
    assert.ok(!listing.body.includes(ENTRANCE));
    assert.ok(!listing.body.includes(LINE));
    assert.ok(!listing.body.includes('id="sold-warn"'));
    assert.ok(!/\bcommission\b/i.test(listing.body));

    const [visit] = await openDates(port, 1);
    const checkout = await get(port, '/checkout?hotel=saltwater-terrace&date=' + visit + '&pass=lounger&qty=1', { 'X-Forwarded-For': '203.0.113.43' });
    assert.ok(checkout.body.includes('Confirm booking'));
    assert.ok(checkout.body.includes('(demo)'));
    assert.ok(!/stripe/i.test(checkout.body));

    const walk = await bookGuest(port, { hotel: 'saltwater-terrace', date: visit, pass: 'lounger', email: 'walk@example.com' });
    const walkPage = await get(port, walk, { 'X-Forwarded-For': '203.0.113.44' });
    assert.ok(!walkPage.body.includes('class="park-details"'));
    assert.ok(!walkPage.body.includes(LINE));
    assert.ok(!walkPage.body.includes(ENTRANCE));
    assert.ok(walkPage.body.includes('Directions'));
    assert.ok(walkPage.body.includes('(demo, no charge)'));
    assert.ok(!walkPage.body.includes('id="sold-warn"'));
    assert.ok(!/\bcommission\b/i.test(walkPage.body));

    const parked = await bookGuest(port, { hotel: 'saltwater-terrace', date: visit, pass: 'lounger', addon: 'parking', email: 'parked@example.com' });
    const parkedPage = await get(port, parked, { 'X-Forwarded-For': '203.0.113.45' });
    const parkBox = parkedPage.body.slice(parkedPage.body.indexOf('class="park-details"'), parkedPage.body.indexOf('</div>', parkedPage.body.indexOf('class="park-details"')));
    assert.ok(parkBox.includes(ENTRANCE));
    assert.ok(parkBox.includes('>Directions</a>'));
    assert.ok(parkBox.includes('openstreetmap.org'));
    assert.ok(parkBox.includes(LINE));
    assert.ok(parkedPage.body.includes('(demo, no charge)'));
    assert.ok(!/\bcommission\b/i.test(parkedPage.body));

    const palmDate = await (async () => {
      for (let i = 1; i < 21; i++) {
        const date = ymd(addDays(new Date(), i));
        const res = await get(port, '/api/availability?hotel=palm-court&date=' + date, { 'X-Forwarded-For': '203.0.113.46' });
        const row = (JSON.parse(res.body).passes || []).find(p => p.code === 'lounger');
        if (row && !row.blocked && !row.past && row.remaining > 0) return date;
      }
      throw new Error('no palm date');
    })();
    const included = await bookGuest(port, { hotel: 'palm-court', date: palmDate, pass: 'lounger', email: 'palm@example.com' });
    const includedPage = await get(port, included, { 'X-Forwarded-For': '203.0.113.47' });
    assert.ok(includedPage.body.includes('class="park-details"'));
    assert.ok(includedPage.body.includes('Enter from Demo Avenue'));
    assert.ok(includedPage.body.includes(LINE));
    assert.ok(!includedPage.body.includes('addon=parking'));

    const salt = liveDb.prepare(`SELECT * FROM hotels WHERE slug='saltwater-terrace'`).get();
    const palm = liveDb.prepare(`SELECT id FROM hotels WHERE slug='palm-court'`).get();
    const pass = liveDb.prepare(`SELECT id, daily_cap FROM pass_types WHERE hotel_id=? AND code='lounger'`).get(salt.id);
    const palmPass = liveDb.prepare(`SELECT id FROM pass_types WHERE hotel_id=? AND code='lounger'`).get(palm.id).id;
    const addon = liveDb.prepare(`SELECT id, price FROM addons WHERE hotel_id=? AND code='parking'`).get(salt.id);
    const tagDay = ymd(new Date());
    const ins = liveDb.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,party)
      VALUES (?,?,?,?,1,45,45,?,?,?,'confirmed',1)`);
    const parkId = ins.run('HDC-PARK01', salt.id, pass.id, tagDay, 'Park Guest', 'park.guest@example.com', '0412000101').lastInsertRowid;
    liveDb.prepare(`INSERT INTO booking_addons(booking_id,addon_id,name,qty,unit_price,total) VALUES (?,?,'Parking',1,?,?)`).run(parkId, addon.id, addon.price, addon.price);
    ins.run('HDC-NOPARK', salt.id, pass.id, tagDay, 'Walk Guest', 'walk.guest@example.com', '0412000102');
    ins.run('HDC-PALM01', palm.id, palmPass, tagDay, 'Palm Guest', 'palm.guest@example.com', '0412000103');

    const login = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'parking-hotel' }, { 'X-Forwarded-For': '203.0.113.48' });
    assert.strictEqual(login.status, 302);
    const jar = cookie(login);
    const dash = await get(port, '/hotel', { Cookie: jar });
    const today = section(dash.body, 'today');
    assert.ok(chunk(today, 'HDC-PARK01').includes('class="pill park-tag">Parking</span>'));
    assert.ok(!chunk(today, 'HDC-NOPARK').includes('park-tag'));
    const lookPark = await get(port, '/hotel?q=HDC-PARK01', { Cookie: jar });
    assert.ok(chunk(section(lookPark.body, 'lookup'), 'HDC-PARK01').includes('park-tag'));
    const lookWalk = await get(port, '/hotel?q=HDC-NOPARK', { Cookie: jar });
    assert.ok(!chunk(section(lookWalk.body, 'lookup'), 'HDC-NOPARK').includes('park-tag'));
    const checkPark = await get(port, '/hotel/checkin?code=HDC-PARK01', { Cookie: jar });
    assert.ok(chunk(checkPark.body, 'Booking HDC-PARK01').includes('park-tag'));
    assert.ok(!checkPark.body.includes('id="sold-warn"'));
    const checkWalk = await get(port, '/hotel/checkin?code=HDC-NOPARK', { Cookie: jar });
    assert.ok(!chunk(checkWalk.body, 'Booking HDC-NOPARK').includes('park-tag'));

    const palmLogin = await post(port, '/hotel/login', { user: 'demo-palmcourt', pass: 'parking-hotel' }, { 'X-Forwarded-For': '203.0.113.49' });
    const palmJar = cookie(palmLogin);
    const palmDash = await get(port, '/hotel?q=HDC-PALM01', { Cookie: palmJar });
    assert.ok(chunk(section(palmDash.body, 'lookup'), 'HDC-PALM01').includes('park-tag'));
    const palmCheck = await get(port, '/hotel/checkin?code=HDC-PALM01', { Cookie: palmJar });
    assert.ok(chunk(palmCheck.body, 'Booking HDC-PALM01').includes('park-tag'));

    const [passDate, dayDate] = await openDates(port, 2);
    const goal = minSold(pass.daily_cap);
    clearDay(liveDb, salt.id, passDate);
    liveDb.prepare('DELETE FROM day_caps WHERE hotel_id=? AND date=?').run(salt.id, passDate);
    bookSpots(liveDb, salt.id, pass.id, passDate, goal - 1, 'HDC-LOW');
    const under = await get(port, '/hotel', { Cookie: jar });
    assert.ok(!warn(under.body).includes(`on ${nice(passDate)}`));
    assert.ok(!warn(under.body).includes(`${nice(passDate)} is`));
    bookSpots(liveDb, salt.id, pass.id, passDate, 1, 'HDC-TOP');
    const over = await get(port, '/hotel', { Cookie: jar });
    const passLine = `Sun lounger is ${Math.round(goal * 100 / pass.daily_cap)}% sold on ${nice(passDate)}.`;
    assert.ok(warn(over.body).includes(passLine), warn(over.body));
    const home = await get(port, '/', { 'X-Forwarded-For': '203.0.113.50' });
    const analytics = await get(port, '/hotel/analytics', { Cookie: jar });
    const hotels = await get(port, '/for-hotels', { 'X-Forwarded-For': '203.0.113.51' });
    assert.ok(!home.body.includes('id="sold-warn"'));
    assert.ok(!analytics.body.includes('id="sold-warn"'));
    assert.ok(!hotels.body.includes('id="sold-warn"'));
    assert.ok(!walkPage.body.includes(passLine));

    clearDay(liveDb, salt.id, dayDate);
    liveDb.prepare('INSERT OR REPLACE INTO day_caps(hotel_id,date,cap) VALUES (?,?,?)').run(salt.id, dayDate, 10);
    bookSpots(liveDb, salt.id, pass.id, dayDate, 7, 'HDC-DAY');
    const dayUnder = await get(port, '/hotel', { Cookie: jar });
    assert.ok(!warn(dayUnder.body).includes(`${nice(dayDate)} is`));
    bookSpots(liveDb, salt.id, pass.id, dayDate, 1, 'HDC-DAYX');
    const dayOver = await get(port, '/hotel', { Cookie: jar });
    assert.ok(warn(dayOver.body).includes(`${nice(dayDate)} is 80% sold.`), warn(dayOver.body));
    assert.ok(!warn(dayOver.body).includes(`sold on ${nice(dayDate)}`));
    const checkinAfter = await get(port, '/hotel/checkin', { Cookie: jar });
    assert.ok(!checkinAfter.body.includes('id="sold-warn"'));
    assert.ok(!checkinAfter.body.includes(`${nice(dayDate)} is 80% sold.`));
    console.log('parking live checks passed');
  } finally {
    liveDb.close();
    child.kill('SIGTERM');
  }
}

unit().then(live).catch(err => { console.error(err); process.exit(1); });
