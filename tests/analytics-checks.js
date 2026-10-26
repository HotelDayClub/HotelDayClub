const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-analytics-'));
const dbPath = path.join(dir, 'daypass.db');
process.env.DB_PATH = dbPath;
process.env.ADMIN_PASSWORD = 'analytics-admin';
process.env.DEMO_HOTEL_PASSWORD = 'analytics-hotel';

const db = require('../db');
const { seed, ensureSchedules, seedPerformance } = require('../seed');
const {
  buildAnalytics, renderAnalytics, recordListingView, normalRange, share, HOTEL_SHARE,
} = require('../analytics');
const offering = require('../offering');

seed(db);
ensureSchedules(db);
seedPerformance(db);

const ymdOf = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = ymdOf(new Date());
const salt = db.prepare("SELECT * FROM hotels WHERE slug='saltwater-terrace'").get();
assert.ok(salt && salt.login === 'demo-saltwater');

const cols = db.prepare('PRAGMA table_info(listing_views)').all().map(c => c.name).sort();
assert.deepStrictEqual(cols, ['day', 'hotel_id', 'seeded', 'views']);

const r7 = buildAnalytics(db, salt, { days: 7, today });
const r30 = buildAnalytics(db, salt, { days: 30, today });
const r90 = buildAnalytics(db, salt, { days: 90, today });
assert.strictEqual(r30.days.length, 30);
assert.strictEqual(r7.range, 7);
assert.strictEqual(r30.example, true);
assert.strictEqual(r30.demo, true);
assert.ok(r30.bookings > 0 && r30.gross > 0, 'demo hotel should have sample bookings');
assert.ok(r90.bookings >= r30.bookings && r30.bookings >= r7.bookings);
assert.ok(r7.cancellations > 0 && r7.refunds > 0 && r7.refunds <= r7.cancellations);
assert.ok(r7.refundValue <= r7.cancellationValue);
assert.ok(r7.noShows > 0, 'last 7 days should include a sample no-show');
assert.ok(r30.views > r30.bookings);
assert.ok(r30.conversion > 0 && r30.conversion < 1);
assert.ok(r30.seededViews > 0 && r30.seededBookings > 0);
assert.ok(Math.abs(r30.payout + r30.fee - r30.gross) < 0.001);
assert.strictEqual(r30.payout, share(r30.gross).payout);
assert.strictEqual(HOTEL_SHARE, 0.75);
assert.strictEqual(r30.days.reduce((s, d) => s + d.gross, 0), r30.gross);
assert.strictEqual(r30.days.reduce((s, d) => s + d.bookings, 0), r30.bookings);
assert.strictEqual(r30.byPass.reduce((s, p) => s + p.bookings, 0), r30.bookings);
assert.strictEqual(r30.byWeekday.reduce((s, p) => s + p.bookings, 0), r30.bookings);
const grossSql = db.prepare("SELECT COALESCE(SUM(total),0) n FROM bookings WHERE hotel_id=? AND status!='cancelled' AND date>=? AND date<=?").get(salt.id, r30.start, r30.end).n;
assert.strictEqual(r30.gross, grossSql);
for (const day of r30.days) {
  if (!day.open) assert.strictEqual(day.fill, null);
  else if (day.cap > 0) assert.ok(Math.abs(day.fill - day.spots / day.cap) < 1e-9);
  else assert.strictEqual(day.fill, null);
}
assert.ok(r30.fill.openDays > 0 && r30.fill.rate > 0);
const recentStart = r90.days[r90.days.length - 14].date;
const earlier = r90.days.filter(d => d.open && d.fill != null && d.date < recentStart);
const recent = r90.days.filter(d => d.open && d.fill != null && d.date >= recentStart);
const avgFill = rows => rows.reduce((sum, day) => sum + day.fill, 0) / rows.length;
assert.ok(recent.length >= 3 && earlier.length >= 20);
assert.ok(Math.min(...recent.map(d => d.fill)) >= 0.35, recent.map(d => `${d.date} ${d.fill.toFixed(2)}`).join(', '));
assert.ok(avgFill(recent) >= avgFill(earlier) * 0.8, `${avgFill(recent)} vs ${avgFill(earlier)}`);
assert.ok(avgFill(recent) <= 0.9);
for (const day of r90.days) if (!day.open) assert.strictEqual(day.spots, 0, day.date);
const weekend = r90.days.filter(d => d.open && (d.weekday === 0 || d.weekday === 6));
const midweek = r90.days.filter(d => d.open && d.weekday >= 1 && d.weekday <= 4);
assert.ok(weekend.length >= 8 && midweek.length >= 20);
assert.ok(avgFill(weekend) > avgFill(midweek), `${avgFill(weekend)} vs ${avgFill(midweek)}`);
assert.ok(Math.min(...weekend.map(d => d.fill)) > avgFill(midweek));
assert.ok(Math.max(...weekend.map(d => d.fill)) < 0.95);
const palm = db.prepare("SELECT * FROM hotels WHERE slug='palm-court'").get();
const palm90 = buildAnalytics(db, palm, { days: 90, today });
for (const day of palm90.days.filter(d => d.weekday === 1)) {
  assert.strictEqual(day.open, false, day.date);
  assert.strictEqual(day.spots, 0, day.date);
}
const sky = db.prepare("SELECT id FROM hotels WHERE slug='skyline-rooftop'").get();
const skyHours = db.prepare('SELECT weekday, open FROM hotel_hours WHERE hotel_id=?').all(sky.id);
assert.strictEqual(skyHours.find(row => row.weekday === 5).open, 0);
assert.strictEqual(skyHours.find(row => row.weekday === 6).open, 1);
assert.strictEqual(skyHours.find(row => row.weekday === 0).open, 1);
const chair = db.prepare("SELECT id, daily_cap FROM pass_types WHERE hotel_id=? AND code='chair'").get(sky.id);
const chairSold = db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(chair.id, today).n;
assert.ok(chair.daily_cap - chairSold >= 2, `skyline chair left ${chair.daily_cap - chairSold}`);
assert.strictEqual(normalRange('nope'), 30);
assert.strictEqual(normalRange('90'), 90);

const html30 = renderAnalytics(r30);
assert.ok(html30.includes('Example data'));
assert.ok(html30.includes('Your payout'));
assert.ok(html30.includes('What you receive'));
assert.ok(!/commission/i.test(html30));
assert.ok(!/75% of|hotel share|before commission|platform commission/i.test(html30));
assert.ok(html30.includes('Fill rate'));
assert.ok(html30.includes('No-shows'));
assert.ok(html30.includes('Listing views'));
assert.ok(html30.includes('aria-current="page">Last 30 days'));
assert.ok(!/guest rating|average rating|star rating/i.test(html30));
assert.ok(html30.includes('Names, email addresses, phone numbers and IP addresses are not'));
const hostile = renderAnalytics(buildAnalytics(db, salt, { days: '<script>alert(1)</script>', today }));
assert.ok(!hostile.includes('<script>alert'));
assert.ok(hostile.includes('Last 30 days'));

const daybed = db.prepare("SELECT id, daily_cap FROM pass_types WHERE hotel_id=? AND code='daybed'").get(salt.id);
let soldDay = null;
for (let i = 1; i < 12 && !soldDay; i++) {
  const d = new Date();
  d.setDate(d.getDate() + i);
  if (d.getDay() < 1 || d.getDay() > 5) continue;
  const date = ymdOf(d);
  if (db.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?').get(salt.id, date)) continue;
  soldDay = date;
}
const sold = db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(daybed.id, soldDay).n;
assert.strictEqual(sold, daybed.daily_cap, 'future daybed sell-out is unchanged');

const before = r7.bookings;
const pass = db.prepare('SELECT * FROM pass_types WHERE hotel_id=? ORDER BY sort LIMIT 1').get(salt.id);
db.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,seeded,refunded)
  VALUES ('HDC-REAL1',?,?,?,1,?,?, 'Real Guest','real@example.com','0412345678','confirmed',0,0)`).run(salt.id, pass.id, today, pass.price, pass.price);
const afterReal = buildAnalytics(db, salt, { days: 7, today });
assert.strictEqual(afterReal.bookings, before + 1);
assert.strictEqual(afterReal.gross, r7.gross + pass.price);
assert.strictEqual(afterReal.example, true);

const id = db.prepare(`INSERT INTO hotels(slug,name,area,tagline,blurb,photos,amenities,hours,rating,login,password,status)
  VALUES ('independent-pool','Independent Pool','CBD','A quiet pool','','[]','[]','',null,'independent','x','active')`).run().lastInsertRowid;
for (let wd = 0; wd < 7; wd++) db.prepare('INSERT INTO hotel_hours(hotel_id,weekday,open,opens,closes) VALUES (?,?,1,?,?)').run(id, wd, '10:00', '16:00');
const pid = db.prepare(`INSERT INTO pass_types(hotel_id,code,name,description,price,daily_cap,sort,holds,kind)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(id, 'lounger', 'Sun lounger', '', 80, 10, 0, 1, 'lounger').lastInsertRowid;
db.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,seeded,refunded)
  VALUES ('HDC-OWN1',?,?,?,1,80,80,'Alex Lee','alex@example.com','0412000000','confirmed',0,0)`).run(id, pid, today);
db.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,seeded,refunded)
  VALUES ('HDC-OWN2',?,?,?,1,40,40,'Sam Lee','sam@example.com','0412000001','cancelled',0,1)`).run(id, pid, today);
const indie = db.prepare('SELECT * FROM hotels WHERE id=?').get(id);
let indieReport = buildAnalytics(db, indie, { days: 7, today });
assert.strictEqual(indieReport.example, false);
assert.strictEqual(indieReport.bookings, 1);
assert.strictEqual(indieReport.gross, 80);
assert.strictEqual(indieReport.payout, 60);
assert.strictEqual(indieReport.fee, 20);
assert.strictEqual(indieReport.cancellations, 1);
assert.strictEqual(indieReport.refunds, 1);
assert.strictEqual(indieReport.refundValue, 40);
assert.strictEqual(indieReport.views, 0);
assert.strictEqual(indieReport.conversion, null);
assert.ok(!renderAnalytics(indieReport).includes('Example data'));
const closedWeekend = offering.saveOffering(db, id, {
  hotel_name: 'Independent Pool', area: 'CBD',
  spot_id: String(pid), code: 'lounger', spot_name: 'Sun lounger', kind: 'lounger', holds: '1', price: '80', cap: '10',
  day_open: ['1', '2', '3', '4', '5'], cutoff_hours: '2',
  opens_1: '10:00', closes_1: '16:00', opens_2: '10:00', closes_2: '16:00', opens_3: '10:00', closes_3: '16:00',
  opens_4: '10:00', closes_4: '16:00', opens_5: '10:00', closes_5: '16:00',
});
assert.ok(!closedWeekend.err, closedWeekend.err);
const chosen = buildAnalytics(db, db.prepare('SELECT * FROM hotels WHERE id=?').get(id), { days: 30, today });
for (const day of chosen.days.filter(d => d.weekday === 0 || d.weekday === 6)) {
  assert.strictEqual(day.open, false, day.date);
  assert.strictEqual(day.fill, null, day.date);
}
assert.ok(chosen.days.some(d => d.weekday === 1 && d.open));
db.prepare("UPDATE bookings SET seeded=1 WHERE code='HDC-OWN2'").run();
assert.strictEqual(buildAnalytics(db, indie, { days: 7, today }).example, true);
db.prepare("DELETE FROM bookings WHERE code='HDC-OWN2'").run();

const reqOf = headers => ({ get: name => headers[name] || '', signedCookies: headers.signedCookies || {} });
assert.strictEqual(recordListingView(db, id, today, reqOf({})), true);
assert.strictEqual(recordListingView(db, id, today, reqOf({ purpose: 'prefetch' })), false);
assert.strictEqual(recordListingView(db, id, today, reqOf({ 'sec-fetch-dest': 'image' })), false);
assert.strictEqual(recordListingView(db, id, today, reqOf({ signedCookies: { hotel: String(id) } })), false);
assert.strictEqual(recordListingView(db, id, today, reqOf({ signedCookies: { hotel: '999' } })), true);
assert.strictEqual(db.prepare('SELECT COALESCE(SUM(views),0) n FROM listing_views WHERE hotel_id=? AND seeded=0').get(id).n, 2);
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM listing_views WHERE hotel_id=? AND seeded=1').get(id).n, 0);
indieReport = buildAnalytics(db, indie, { days: 7, today });
assert.strictEqual(indieReport.views, 2);
assert.strictEqual(indieReport.conversion, 0.5);
assert.strictEqual(indieReport.example, false);
const bookingsBefore = db.prepare('SELECT COUNT(*) n FROM bookings WHERE hotel_id=?').get(id).n;
seedPerformance(db);
assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM bookings WHERE hotel_id=?').get(id).n, bookingsBefore);

const saltViews = buildAnalytics(db, salt, { days: 30, today }).views;
const css = fs.readFileSync(path.join(__dirname, '../public/app.css'), 'utf8');
assert.ok(css.includes('font-family:Inter'));
assert.ok(!css.includes('fonts.googleapis.com'));
assert.ok(css.includes('.example-badge{display:inline-flex') && css.includes('background:#0B2545;color:#fff'));
assert.ok(css.includes('@media(max-width:599px)'));

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
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function viewsOf(html) {
  const m = html.match(/Listing views<\/span><b>([^<]+)<\/b>/);
  assert.ok(m, 'listing views missing');
  return Number(m[1].replace(/,/g, ''));
}
function cookieFrom(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

(async () => {
  const port = 3198;
  const child = await start(port);
  try {
    const locked = await get(port, '/hotel/analytics');
    assert.strictEqual(locked.status, 302);
    assert.ok(String(locked.headers.location).startsWith('/hotel/login'));

    const login = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'analytics-hotel' });
    assert.strictEqual(login.status, 302);
    const cookie = cookieFrom(login);
    assert.ok(cookie.includes('hotel='));

    const page = await get(port, '/hotel/analytics', { Cookie: cookie });
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('Example data'));
    assert.ok(page.body.includes('How this listing is doing'));
    assert.ok(page.body.includes('aria-current="page">Last 30 days'));
    assert.ok(page.body.includes('href="/hotel/analytics?range=7"'));
    assert.ok(page.body.includes('href="/hotel/analytics?range=90"'));
    assert.ok(!/guest rating|average rating|star rating/i.test(page.body));
    assert.ok(page.body.includes('What you receive'));
    assert.ok(!/commission/i.test(page.body));
    assert.ok(!/75% of|hotel share|before commission|platform commission/i.test(page.body));
    const settings = await get(port, '/hotel/settings', { Cookie: cookie });
    assert.strictEqual(settings.status, 200);
    assert.ok(/name="day_open" value="6" checked/.test(settings.body));
    assert.ok(/name="day_open" value="0" checked/.test(settings.body));
    assert.strictEqual(viewsOf(page.body), saltViews);
    assert.ok(page.headers['cache-control'] === 'no-store');

    const dash = await get(port, '/hotel', { Cookie: cookie });
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.body.includes('href="/hotel/analytics"'));
    assert.ok(dash.body.includes('G\'day'));
    const checkin = await get(port, '/hotel/checkin', { Cookie: cookie });
    assert.strictEqual(checkin.status, 200);
    assert.ok(checkin.body.includes('Scan the guest'));

    const own = await get(port, '/h/saltwater-terrace', { Cookie: cookie, 'sec-fetch-dest': 'document' });
    assert.strictEqual(own.status, 200);
    const prefetched = await get(port, '/h/saltwater-terrace', { purpose: 'prefetch', 'sec-fetch-dest': 'document' });
    assert.strictEqual(prefetched.status, 200);
    const image = await get(port, '/h/saltwater-terrace', { 'sec-fetch-dest': 'image' });
    assert.strictEqual(image.status, 200);
    const still = await get(port, '/hotel/analytics?range=30', { Cookie: cookie });
    assert.strictEqual(viewsOf(still.body), saltViews);

    const counted = await get(port, '/h/saltwater-terrace', { 'sec-fetch-dest': 'document' });
    assert.strictEqual(counted.status, 200);
    const bumped = await get(port, '/hotel/analytics', { Cookie: cookie });
    assert.strictEqual(viewsOf(bumped.body), saltViews + 1);

    const week = await get(port, '/hotel/analytics?range=7', { Cookie: cookie });
    assert.ok(week.body.includes('aria-current="page">Last 7 days'));
    assert.ok(week.body.includes('Cancellations'));
    const quarter = await get(port, '/hotel/analytics?range=90', { Cookie: cookie });
    assert.ok(quarter.body.includes('aria-current="page">Last 90 days'));
    const junk = await get(port, '/hotel/analytics?range=' + encodeURIComponent('<script>alert(1)</script>'), { Cookie: cookie });
    assert.ok(!junk.body.includes('<script>alert'));
    assert.ok(junk.body.includes('aria-current="page">Last 30 days'));

    const avail = await get(port, '/api/availability?hotel=saltwater-terrace&date=' + soldDay);
    assert.strictEqual(avail.status, 200);
    const passes = JSON.parse(avail.body).passes;
    assert.strictEqual(passes.find(p => p.code === 'daybed').remaining, 0);

    const other = await post(port, '/hotel/login', { user: 'independent', pass: 'x' });
    const otherCookie = cookieFrom(other);
    const otherPage = await get(port, '/hotel/analytics?range=7', { Cookie: otherCookie });
    assert.strictEqual(otherPage.status, 200);
    assert.ok(!otherPage.body.includes('Example data'));
    assert.ok(otherPage.body.includes('>$80<'));
    assert.ok(otherPage.body.includes('>$60<'));
    assert.strictEqual(viewsOf(otherPage.body), 2);

    console.log('analytics checks passed', { bookings30: r30.bookings, gross30: r30.gross, views30: saltViews, soldDay });
  } finally {
    child.kill();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
