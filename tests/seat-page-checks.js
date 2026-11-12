const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { SeatPage } = require('../seatPage');
const { seatPhoto } = require('../inclusions');
const { FOOD_RULE } = require('../offering');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-seat-'));
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

function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'seat-admin', DEMO_HOTEL_PASSWORD: 'seat-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

(async () => {
  const port = 3224;
  const child = await start(port);
  try {
    const Sqlite = require('better-sqlite3');
    const db = new Sqlite(dbPath, { readonly: true });
    const passes = db.prepare(`SELECT h.slug, p.code, p.kind, p.photo, p.holds FROM pass_types p JOIN hotels h ON h.id=p.hotel_id ORDER BY h.id, p.sort`).all();
    assert.ok(passes.length >= 6);
    for (const pass of passes) {
      const res = await get(port, `/h/${pass.slug}/seat/${encodeURIComponent(pass.code)}`);
      assert.strictEqual(res.status, 200, `${pass.slug}/${pass.code}`);
      assert.ok(res.body.includes('content="noindex, follow"'), pass.slug);
      assert.ok(res.body.includes(`href="https://www.hoteldayclub.com.au/h/${pass.slug}/seat/${pass.code}"`), pass.slug);
      assert.ok(!res.body.includes(`href="https://www.hoteldayclub.com.au/h/${pass.slug}/seat/${pass.code}?`), pass.slug);
      assert.strictEqual((res.body.match(/class="seat-photo"/g) || []).length, 1, pass.slug);
      assert.ok(!res.body.includes('Previous photo'), pass.slug);
      assert.ok(!res.body.includes('Next photo'), pass.slug);
      assert.ok(!res.body.includes('Photo not yet added'), pass.slug);
      assert.ok(!res.body.includes('\u2014'), pass.slug);
      assert.ok(res.body.includes(FOOD_RULE), pass.slug);
      assert.ok(!res.body.includes('Food and drink are not included in the pass.'), pass.slug);
      assert.ok(!/commission/i.test(res.body), pass.slug);
      assert.ok(!/pay online|stripe/i.test(res.body), pass.slug);
      const file = String(pass.photo || '');
      if (!file) assert.ok(res.body.includes(`src="${seatPhoto(pass.kind)}"`), pass.slug + ' ' + pass.kind);
    }

    const missingHotel = await get(port, '/h/not-a-hotel/seat/lounger');
    assert.strictEqual(missingHotel.status, 404);
    assert.ok(missingHotel.body.includes('Page not found'));
    const missingCode = await get(port, '/h/saltwater-terrace/seat/no-such-seat');
    assert.strictEqual(missingCode.status, 404);
    assert.ok(missingCode.body.includes('Page not found'));

    const bare = await get(port, '/h/saltwater-terrace/seat/daybed');
    assert.ok(bare.body.includes('Pick a date'));
    assert.ok(bare.body.includes('id="seat-go" type="submit" disabled'));
    assert.ok(bare.body.includes('href="/h/saltwater-terrace?qty=1#seating"'));
    assert.strictEqual(bare.body.split('href="/h/saltwater-terrace?qty=1#seating"').length - 1, 3);
    assert.ok(bare.body.includes('2 × Towels'));
    assert.ok(bare.body.includes('Example photo (demo)'));
    assert.ok(bare.body.includes('Example photo of a daybed (demo)'));
    assert.ok(bare.body.includes('name="hotel" value="saltwater-terrace"'));
    assert.ok(bare.body.includes('name="pass" value="daybed"'));
    assert.ok(bare.body.includes('name="date"'));
    assert.ok(bare.body.includes('name="qty"'));
    assert.ok(bare.body.includes('for="seat-qty">Spots'));
    assert.ok(bare.body.includes('Select · Continue to booking'));
    assert.ok(bare.body.includes('>Check</button>'));
    assert.ok(bare.body.includes('formaction="/h/saltwater-terrace/seat/daybed"'));
    assert.ok(bare.body.includes('action="/checkout"'));
    assert.ok(bare.body.includes('method="get"'));
    assert.ok(bare.body.includes('<h1>Daybed</h1>'));
    assert.ok(bare.body.includes('Daybed · The Saltwater Terrace (Demo)'));
    assert.ok(bare.body.includes('Demo site: listings are examples, no real bookings or payments.'));
    assert.ok(bare.body.includes('>←</span> Back to The Saltwater Terrace (Demo)'));
    assert.ok(bare.body.includes('View all seating at The Saltwater Terrace (Demo) →'));
    assert.ok(bare.body.includes('1 spot = 2 guests'));
    assert.ok(bare.body.includes('Fits 2'));
    const dayList = bare.body.slice(bare.body.indexOf('<ul class="pass-inc-list'), bare.body.indexOf('</ul>', bare.body.indexOf('<ul class="pass-inc-list')));
    assert.ok(!/\d+ × (?!Towels)/.test(dayList));
    const bad = await get(port, '/h/saltwater-terrace/seat/lounger?date=nope&qty=9');
    assert.strictEqual(bad.status, 200);
    assert.ok(bad.body.includes('Pick a date'));
    assert.ok(bad.body.includes('href="/h/saltwater-terrace?qty=1#seating"'));
    const past = await get(port, '/h/saltwater-terrace/seat/lounger?date=2020-01-01');
    assert.ok(past.body.includes('Pick a date'));

    const hotel = db.prepare("SELECT id, name FROM hotels WHERE slug='saltwater-terrace'").get();
    const lounger = db.prepare("SELECT id, daily_cap FROM pass_types WHERE hotel_id=? AND code='lounger'").get(hotel.id);
    let openDate = '';
    for (let i = 1; i < 40 && !openDate; i++) {
      const day = new Date();
      day.setDate(day.getDate() + i);
      const iso = ymd(day);
      if (db.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?').get(hotel.id, iso)) continue;
      openDate = iso;
    }
    assert.ok(openDate);
    const used = db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(lounger.id, openDate).n;
    const left = lounger.daily_cap - used;
    assert.ok(left > 0, 'expected loungers left on ' + openDate);
    const open = await get(port, `/h/saltwater-terrace/seat/lounger?date=${openDate}&qty=2`);
    assert.strictEqual(open.status, 200);
    const label = SeatPage.dayLabel(openDate);
    assert.ok(open.body.includes(`${left} left on ${label}`), open.body.slice(open.body.indexOf('id="avl"'), open.body.indexOf('id="avl"') + 180));
    assert.ok(open.body.includes(`value="${openDate}"`));
    assert.ok(open.body.includes('value="2" selected'));
    assert.ok(open.body.includes(`href="/h/saltwater-terrace?date=${openDate}&amp;qty=2#seating"`));
    assert.ok(open.body.includes('>Continue to booking</a>'));
    assert.ok(!/id="seat-go"[^>]*disabled/.test(open.body));
    assert.ok(open.body.includes('<link rel="canonical" href="https://www.hoteldayclub.com.au/h/saltwater-terrace/seat/lounger">'));

    const blocked = db.prepare('SELECT date, reason FROM blocked_dates WHERE hotel_id=? ORDER BY date').get(hotel.id);
    assert.ok(blocked);
    const shut = await get(port, `/h/saltwater-terrace/seat/lounger?date=${blocked.date}&qty=1`);
    assert.strictEqual(shut.status, 200);
    assert.ok(shut.body.includes(`is closed on ${SeatPage.dayLabel(blocked.date)} (${blocked.reason}).`));
    assert.ok(shut.body.includes('>Closed on this date</button>'));
    assert.ok(/id="seat-go"[^>]*disabled/.test(shut.body));

    const listing = await get(port, `/h/saltwater-terrace?pass=lounger&date=${openDate}`);
    assert.strictEqual(listing.status, 200);
    assert.ok(!listing.headers.location);
    assert.ok(listing.body.includes('id="seating"'));
    assert.ok(listing.body.includes('id="passes"'));
    assert.ok(listing.body.includes('seatFromHash'));
    assert.ok(listing.body.includes('location.replace'));
    assert.ok(listing.body.includes('#pass-detail-'));
    assert.ok(listing.body.includes(`href="/h/saltwater-terrace/seat/lounger?date=${openDate}&amp;qty=1"`));
    assert.ok(listing.body.includes('class="pass-card is-sel" id="pass-card-lounger"'));
    const kept = await get(port, '/h/saltwater-terrace?pass=daybed');
    assert.strictEqual(kept.status, 200);
    assert.ok(!kept.headers.location);
    assert.ok(kept.body.includes('class="pass-card is-sel" id="pass-card-daybed"'));

    db.close();
    const write = new Sqlite(dbPath);
    write.prepare('UPDATE pass_types SET daily_cap=0 WHERE id=?').run(lounger.id);
    write.close();
    const sold = await get(port, `/h/saltwater-terrace/seat/lounger?date=${openDate}&qty=1`);
    const soldText = sold.body.replace(/<[^>]+>/g, '');
    assert.ok(soldText.includes('Sold out on this date. Try another date. This seat is still shown so you can compare.'));
    assert.ok(sold.body.includes('>Sold out on this date</button>'));
    assert.ok(/id="seat-go"[^>]*disabled/.test(sold.body));
    assert.ok(sold.body.includes('>Change date</a>'));
    assert.ok(sold.body.includes('>Sold out</b>'));

    const chair = await get(port, '/h/palm-court/seat/chair');
    assert.ok(chair.body.includes(`src="${seatPhoto('chair')}"`));
    assert.ok(chair.body.includes('alt="Example photo of a pool chair (demo)"'));
    assert.ok(!chair.body.includes('Photo not yet added'));

    console.log('seat page checks passed');
  } finally {
    child.kill();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
