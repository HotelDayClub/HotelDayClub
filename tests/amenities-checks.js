const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-amenities-'));
const dbPath = path.join(dir, 'daypass.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
process.env.ADMIN_PASSWORD = 'amenities-admin';
process.env.DEMO_HOTEL_PASSWORD = 'amenities-hotel';
delete process.env.RESEND_API_KEY;

const db = require('../db');
const { HotelAmenities, SENTENCE } = require('../hotelAmenities');

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function post(port, urlPath, fields, headers = {}) {
  const body = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function cookie(res) {
  return (res.headers['set-cookie'] || []).map(part => part.split(';')[0]).join('; ');
}
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'amenities-admin', DEMO_HOTEL_PASSWORD: 'amenities-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', chunk => {
      log += chunk;
      if (log.includes('Hotel Day Club demo')) {
        clearTimeout(timer);
        resolve({ child, log });
      }
    });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function group(html, cls) {
  const start = html.indexOf(`class="am-grp ${cls}"`);
  if (start < 0) return '';
  const next = html.indexOf('class="am-grp', start + 12);
  const end = next < 0 ? html.length : next;
  return html.slice(start, end);
}
function textOf(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

(async () => {
  const port = 3471;
  const started = await start(port);
  try {
    const foodAreas = db.prepare('SELECT a.name, a.hotel_id, h.slug FROM access_areas a JOIN hotels h ON h.id=a.hotel_id WHERE a.serves_food=1').all();
    assert.ok(foodAreas.length >= 4);
    for (const area of foodAreas) {
      const kind = HotelAmenities.classifyName(area.name);
      const label = HotelAmenities.cleanLabel(area.name, { trimTo: 60 });
      const row = db.prepare('SELECT * FROM hotel_amenities WHERE hotel_id=? AND category=? AND label=?').get(area.hotel_id, kind.category, label);
      assert.ok(row, `${area.slug} ${area.name}`);
      assert.strictEqual(row.included, 0, area.name);
      assert.strictEqual(row.hidden, 0, area.name);
    }
    const salt = db.prepare("SELECT id FROM hotels WHERE slug='saltwater-terrace'").get();
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM hotel_amenities WHERE hotel_id=? AND label='Pool bar'").get(salt.id).n, 1);
    const before = db.prepare('SELECT COUNT(*) n FROM hotel_amenities').get().n;
    const again = HotelAmenities.seed(db);
    assert.strictEqual(again.added.length, 0);
    assert.ok(again.skipped >= foodAreas.length);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM hotel_amenities').get().n, before);
    assert.ok(again.unmapped.some(row => row.slug === 'manly-sands' && row.name === 'Kiosk' && row.category === 'restaurant'));
    assert.strictEqual(again.ambiguous.length, 0);
    const systemAdds = db.prepare("SELECT COUNT(*) n FROM hotel_amenities_log WHERE actor='system' AND action='add'").get().n;
    assert.strictEqual(systemAdds, before);

    db.prepare(`INSERT INTO access_areas (hotel_id, name, blurb, photo, hours, serves_food, sort) VALUES (?, 'Cafe bar', '', '', '', 1, 9)`).run(salt.id);
    const mixed = HotelAmenities.seed(db);
    assert.ok(mixed.ambiguous.some(row => row.name === 'Cafe bar'));
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM hotel_amenities WHERE hotel_id=? AND label='Cafe bar'").get(salt.id).n, 1);
    const mixedAgain = HotelAmenities.seed(db);
    assert.strictEqual(mixedAgain.added.length, 0);
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM hotel_amenities WHERE hotel_id=? AND label='Cafe bar'").get(salt.id).n, 1);

    const lab = db.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo, timezone)
      VALUES ('amenity-lab', 'Amenity Lab (Demo)', 'Perth', 'amenity-lab', 'x', 'active', 1, 'Australia/Perth')`).run().lastInsertRowid;
    assert.strictEqual(HotelAmenities.listingHtml(db, { id: lab, slug: 'amenity-lab', name: 'Amenity Lab (Demo)', is_demo: 1 }), '');
    assert.throws(() => db.prepare(`INSERT INTO hotel_amenities (hotel_id, category, label, included, hidden, sort, updated_at)
      VALUES (?, 'restaurant', 'Included grill', 1, 0, 0, ?)`).run(lab, new Date().toISOString()));
    assert.throws(() => db.prepare(`INSERT INTO hotel_amenities (hotel_id, category, label, included, hidden, sort, updated_at)
      VALUES (?, 'lounge', 'Example lounge', 0, 0, 0, ?)`).run(lab, new Date().toISOString()));

    const ignored = HotelAmenities.save(db, lab, { add: '1', new_cat: 'restaurant', new_name: 'Example restaurant', included: '1' }, 'hotel:' + lab);
    assert.strictEqual(ignored.ok, true);
    const restaurant = db.prepare('SELECT * FROM hotel_amenities WHERE hotel_id=? AND label=?').get(lab, 'Example restaurant');
    assert.strictEqual(restaurant.included, 0);
    assert.strictEqual(HotelAmenities.save(db, lab, { add: '1', new_cat: 'lounge', new_name: 'Example lounge' }, 'hotel:' + lab).err, 'Choose a category from the list.');
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM hotel_amenities WHERE label='Example lounge'").get().n, 0);
    assert.ok(HotelAmenities.save(db, lab, { add: '1', new_cat: 'bar', new_name: '' }, 'hotel:' + lab).err);
    assert.ok(HotelAmenities.save(db, lab, { add: '1', new_cat: 'bar', new_name: 'a'.repeat(61) }, 'hotel:' + lab).err);
    const tagged = HotelAmenities.save(db, lab, { add: '1', new_cat: 'bar', new_name: '<script>alert(1)</script>Example bar' }, 'hotel:' + lab);
    assert.strictEqual(tagged.ok, true);
    const stripped = db.prepare('SELECT label FROM hotel_amenities WHERE hotel_id=? AND category=? ORDER BY id DESC').get(lab, 'bar');
    assert.strictEqual(stripped.label, 'alert(1)Example bar');
    assert.ok(!stripped.label.includes('<'));
    const spaced = HotelAmenities.save(db, lab, { add: '1', new_cat: 'cafe', new_name: '  Cafe\u0001 bar  ' }, 'hotel:' + lab);
    assert.strictEqual(spaced.ok, true);
    assert.strictEqual(db.prepare('SELECT label FROM hotel_amenities WHERE hotel_id=? AND category=?').get(lab, 'cafe').label, 'Cafe bar');
    const sixty = HotelAmenities.save(db, lab, { add: '1', new_cat: 'spa', new_name: 's'.repeat(60) }, 'hotel:' + lab);
    assert.strictEqual(sixty.ok, true);

    db.prepare(`INSERT INTO inclusions (hotel_id, code, mode, price, daily_cap, note) VALUES (?, 'pool', 'included', 0, 0, '')`).run(lab);
    db.prepare(`INSERT INTO inclusions (hotel_id, code, mode, price, daily_cap, note) VALUES (?, 'towels', 'included', 0, 0, '')`).run(lab);
    db.prepare(`INSERT INTO inclusions (hotel_id, code, mode, price, daily_cap, note) VALUES (?, 'gym', 'addon', 10, 5, '')`).run(lab);
    HotelAmenities.save(db, lab, { add: '1', new_cat: 'pool', new_name: 'Example pool' }, 'hotel:' + lab);
    const poolRow = db.prepare("SELECT included FROM hotel_amenities WHERE hotel_id=? AND label='Example pool'").get(lab);
    assert.strictEqual(poolRow.included, 1);
    const page = HotelAmenities.listingHtml(db, { id: lab, slug: 'amenity-lab', name: 'Amenity Lab (Demo)', is_demo: 1 }, { people: 2 });
    const included = group(page, 'am-y');
    const optional = group(page, 'am-x');
    const onsite = group(page, 'am-os');
    assert.ok(included.includes('Example pool'));
    assert.ok(included.includes('2 towels'));
    assert.ok(!included.includes('Example restaurant'));
    assert.ok(!included.includes('alert(1)Example bar'));
    assert.ok(!/\d+\s*×/.test(included));
    assert.ok(optional.includes('Fitness centre access'));
    assert.ok(optional.includes('Optional extra'));
    assert.ok(onsite.includes('Example restaurant'));
    assert.ok(onsite.includes('Pay the venue'));
    assert.ok(textOf(onsite).includes(SENTENCE));
    assert.ok(!page.includes('<script>'));
    assert.ok(page.includes('&lt;script&gt;') === false);
    db.prepare(`UPDATE hotel_amenities SET label=? WHERE hotel_id=? AND category='bar'`).run('Bar <script>alert(1)</script>', lab);
    const escaped = HotelAmenities.listingHtml(db, { id: lab, slug: 'amenity-lab', name: 'Amenity Lab (Demo)', is_demo: 1 });
    assert.ok(escaped.includes('Bar &lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!escaped.includes('<script>'));

    const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
    for (const name of names) HotelAmenities.save(db, lab, { add: '1', new_cat: 'restaurant', new_name: 'Venue ' + name }, 'hotel:' + lab);
    const long = HotelAmenities.listingHtml(db, { id: lab, slug: 'amenity-lab', name: 'Amenity Lab (Demo)', is_demo: 1 });
    const longOn = group(long, 'am-os');
    assert.ok(longOn.includes('Show all ('));
    assert.ok(/Show all \(\d+\)/.test(longOn));
    assert.ok(longOn.includes('<details class="am-more">'));
    assert.ok(longOn.includes('Venue Seven'));
    const seat = HotelAmenities.seatHtml(db, { id: lab, slug: 'amenity-lab', name: 'Amenity Lab (Demo)', is_demo: 1 }, { people: 1 });
    assert.ok(seat.includes('class="chips-c"'));
    assert.ok(seat.includes('See all amenities'));
    assert.ok(textOf(seat).includes(SENTENCE));
    assert.ok(seat.includes('href="/h/amenity-lab#am-h"'));
    const form = HotelAmenities.form(db, { id: lab, name: 'Amenity Lab (Demo)', is_demo: 1, timezone: 'Australia/Perth' });
    const select = form.slice(form.indexOf('name="new_cat"'), form.indexOf('</select>', form.indexOf('name="new_cat"')));
    assert.ok(!/lounge/i.test(select));
    assert.ok(select.includes('Steam room'));
    assert.ok(form.includes('Venues like this are always shown as not included in the pass.'));
    assert.ok(form.includes('Included in pass (from your inclusions)'));
    assert.ok(!form.includes('name="included"'));
    assert.ok(!/%/.test(form));

    const hide = HotelAmenities.adminToggle(db, { id: String(restaurant.id) }, 'admin:jason');
    assert.strictEqual(hide.ok, true);
    const afterAdmin = db.prepare('SELECT hidden, hidden_by FROM hotel_amenities WHERE id=?').get(restaurant.id);
    assert.strictEqual(afterAdmin.hidden, 1);
    assert.strictEqual(afterAdmin.hidden_by, 'admin');
    const blocked = HotelAmenities.save(db, lab, { toggle: String(restaurant.id) }, 'hotel:' + lab);
    assert.strictEqual(blocked.err, 'An admin hid this venue. The hotel cannot show it.');
    assert.strictEqual(db.prepare('SELECT hidden FROM hotel_amenities WHERE id=?').get(restaurant.id).hidden, 1);
    const hiddenHtml = HotelAmenities.listingHtml(db, { id: lab, slug: 'amenity-lab', name: 'Amenity Lab (Demo)', is_demo: 1 });
    assert.ok(!hiddenHtml.includes('Example restaurant'));
    const removed = HotelAmenities.save(db, lab, { remove: String(db.prepare("SELECT id FROM hotel_amenities WHERE hotel_id=? AND label='Venue Seven'").get(lab).id) }, 'hotel:' + lab);
    assert.strictEqual(removed.ok, true);
    assert.ok(!HotelAmenities.listingHtml(db, { id: lab, slug: 'amenity-lab', name: 'Amenity Lab (Demo)', is_demo: 1 }).includes('Venue Seven'));

    const flagHotel = db.prepare("SELECT id FROM hotels WHERE slug='palm-court'").get();
    const beforeFlag = HotelAmenities.listingHtml(db, db.prepare('SELECT * FROM hotels WHERE id=?').get(flagHotel.id));
    db.prepare('UPDATE access_areas SET serves_food=0 WHERE hotel_id=? AND name=?').run(flagHotel.id, 'Café');
    const afterFlag = HotelAmenities.listingHtml(db, db.prepare('SELECT * FROM hotels WHERE id=?').get(flagHotel.id));
    assert.ok(beforeFlag.includes('>Café</span>'));
    assert.strictEqual(afterFlag.includes('>Café</span>'), true);
    db.prepare(`INSERT INTO access_areas (hotel_id, name, blurb, photo, hours, serves_food, sort) VALUES (?, 'New kiosk', '', '', '', 1, 8)`).run(flagHotel.id);
    const untouched = HotelAmenities.listingHtml(db, db.prepare('SELECT * FROM hotels WHERE id=?').get(flagHotel.id));
    assert.ok(!untouched.includes('New kiosk'));

    const listing = await get(port, '/h/saltwater-terrace');
    assert.strictEqual(listing.status, 200);
    assert.ok(listing.body.includes('id="am-h"'));
    assert.ok(listing.body.includes('Example amenities (demo)'));
    assert.ok(textOf(listing.body).includes(SENTENCE));
    assert.ok(!group(listing.body, 'am-y').includes('Pool bar'));
    assert.ok(group(listing.body, 'am-os').includes('>Pool bar</span>'));
    assert.ok(!listing.body.includes('Pool access'));
    const seatPage = await get(port, '/h/saltwater-terrace/seat/lounger');
    assert.ok(seatPage.body.includes('class="chips-c"'));
    assert.ok(seatPage.body.includes('See all amenities'));
    assert.ok(textOf(seatPage.body).includes(SENTENCE));
    assert.strictEqual(seatPage.body.split('Food and drink are not sold through Hotel Day Club. You buy and pay for them at the venue.').length - 1, 1);

    const loggedOut = await post(port, '/hotel/amenities', { add: '1', new_cat: 'bar', new_name: 'Nope' });
    assert.strictEqual(loggedOut.status, 302);
    assert.ok(String(loggedOut.headers.location).includes('/hotel/login'));
    const hotelLogin = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'amenities-hotel' });
    assert.strictEqual(hotelLogin.status, 302);
    const hotelCookie = cookie(hotelLogin);
    const cross = await post(port, '/hotel/amenities', { add: '1', new_cat: 'bar', new_name: 'Cross site' }, { Cookie: hotelCookie, Origin: 'https://evil.test' });
    assert.strictEqual(cross.status, 403);
    const added = await post(port, '/hotel/amenities', { add: '1', new_cat: 'bar', new_name: 'Example pool bar' }, { Cookie: hotelCookie });
    assert.strictEqual(added.status, 303);
    assert.ok(db.prepare("SELECT included FROM hotel_amenities WHERE label='Example pool bar'").get().included === 0);
    const settings = await get(port, '/hotel/settings', { Cookie: hotelCookie });
    assert.strictEqual(settings.status, 200);
    assert.ok(settings.body.includes('Amenities and on-site venues (demo)'));
    assert.ok(!/lounge/i.test(settings.body.slice(settings.body.indexOf('name="new_cat"'), settings.body.indexOf('</select>', settings.body.indexOf('name="new_cat"')))));

    const adminOut = await post(port, '/admin/venues/hide', { id: '1' });
    assert.strictEqual(adminOut.status, 302);
    assert.ok(String(adminOut.headers.location).includes('/admin/login'));
    const adminLogin = await post(port, '/admin/login', { user: 'jason', pass: 'amenities-admin' });
    const adminCookie = cookie(adminLogin);
    const adminCross = await post(port, '/admin/venues/hide', { id: '1' }, { Cookie: adminCookie, Origin: 'https://evil.test' });
    assert.strictEqual(adminCross.status, 403);
    const adminPage = await get(port, '/admin', { Cookie: adminCookie });
    assert.strictEqual(adminPage.status, 200);
    assert.ok(adminPage.body.includes('Venues ·'));
    assert.ok(adminPage.body.includes('Hide venue'));
    assert.ok(adminPage.body.includes('action="/admin/venues/hide"'));

    console.log(HotelAmenities.reportLine(again));
    console.log('amenities checks passed');
  } finally {
    started.child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
