const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const { parseBookingCode } = require('../public/checkin-parse');
const { hotelToday } = require('../calendar');

assert.strictEqual(parseBookingCode('HDC:HDC-OLD99'), 'HDC-OLD99');
assert.strictEqual(parseBookingCode('https://www.hoteldayclub.com.au/hotel/checkin?code=HDC-URL01'), 'HDC-URL01');
assert.strictEqual(parseBookingCode('https://evil.example/steal?code=HDC-URL01'), 'HDC-URL01');
assert.strictEqual(parseBookingCode('not a code'), '');

(async () => {
  const url = 'https://www.hoteldayclub.com.au/hotel/checkin?code=HDC-QRCODE1';
  const buf = await QRCode.toBuffer(url, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
  const png = PNG.sync.read(buf);
  const hit = jsQR(Uint8ClampedArray.from(png.data), png.width, png.height);
  assert.ok(hit, 'jsQR did not read the URL QR');
  assert.strictEqual(hit.data, url);
  assert.strictEqual(parseBookingCode(hit.data), 'HDC-QRCODE1');
  const oldUrl = 'HDC:HDC-LEGACY1';
  const oldBuf = await QRCode.toBuffer(oldUrl, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
  const oldPng = PNG.sync.read(oldBuf);
  const oldHit = jsQR(Uint8ClampedArray.from(oldPng.data), oldPng.width, oldPng.height);
  assert.strictEqual(parseBookingCode(oldHit.data), 'HDC-LEGACY1');
  console.log('qr payload checks passed');
})().then(() => runServer()).catch(err => { console.error(err); process.exit(1); });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-checkin-'));
const dbPath = path.join(dir, 'daypass.db');

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
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'checkin-admin', DEMO_HOTEL_PASSWORD: 'checkin-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function shift(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function runServer() {
  const port = 3344;
  const child = await start(port);
  try {
    const Database = require('better-sqlite3');
    const live = new Database(dbPath);
    const salt = live.prepare("SELECT * FROM hotels WHERE slug='saltwater-terrace'").get();
    const sky = live.prepare("SELECT * FROM hotels WHERE slug='skyline-rooftop'").get();
    const pass = live.prepare('SELECT id FROM pass_types WHERE hotel_id=? LIMIT 1').get(salt.id).id;
    const skyPass = live.prepare('SELECT id FROM pass_types WHERE hotel_id=? LIMIT 1').get(sky.id).id;
    const day = hotelToday(salt);
    const ins = live.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,checked_in_at,party)
      VALUES (?,?,?,?,1,45,45,?,?,?,?,?,?)`);
    ins.run('HDC-TODAY01', salt.id, pass, day, 'Mina Shore', 'mina.shore@example.com', '0412 555 010', 'confirmed', null, 4);
    ins.run('HDC-FUTURE1', salt.id, pass, shift(day, 4), 'Future Guest', 'future.guest@example.com', '0412 555 222', 'confirmed', null, null);
    ins.run('HDC-PAST001', salt.id, pass, shift(day, -4), 'Past Guest', 'past.guest@example.com', '0412 555 333', 'confirmed', null, null);
    ins.run('HDC-CANCEL1', salt.id, pass, day, 'Cancelled Guest', 'cancelled.guest@example.com', '0412 555 444', 'cancelled', null, null);
    ins.run('HDC-USED001', salt.id, pass, day, 'Used Guest', 'used.guest@example.com', '0412 555 555', 'confirmed', day + ' 09:15:00', 4);
    ins.run('HDC-OTHER01', sky.id, skyPass, day, 'Other Guest', 'other.secret@example.com', '0499000000', 'confirmed', null, 2);
    ins.run('HDC-COUNT01', salt.id, pass, day, 'Count Guest', 'count.guest@example.com', '0412 555 777', 'confirmed', null, 4);
    ins.run('HDC-ZERO01', salt.id, pass, day, 'Zero Guest', 'zero.guest@example.com', '0412 555 888', 'confirmed', null, 4);
    live.close();

    const loggedOut = await get(port, '/hotel/checkin?code=HDC-TODAY01');
    assert.strictEqual(loggedOut.status, 302);
    assert.ok(loggedOut.headers.location.startsWith('/hotel/login?next='));
    const loginPage = await get(port, loggedOut.headers.location);
    assert.strictEqual(loginPage.status, 200);
    assert.ok(loginPage.body.includes('name="next"'));
    assert.ok(!loginPage.body.includes('Mina Shore'));
    assert.ok(!loginPage.body.includes('mina.shore@example.com'));
    const next = new URL('http://127.0.0.1' + loggedOut.headers.location).searchParams.get('next');
    const evil = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'checkin-hotel', next: 'https://evil.example/hotel/checkin?code=HDC-TODAY01' }, { 'X-Forwarded-For': '203.0.113.81' });
    assert.strictEqual(evil.status, 302);
    assert.strictEqual(evil.headers.location, '/hotel');
    const back = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'checkin-hotel', next }, { 'X-Forwarded-For': '203.0.113.82' });
    assert.strictEqual(back.status, 302);
    assert.ok(back.headers.location.includes('/hotel/checkin'));
    assert.ok(back.headers.location.includes('code=HDC-TODAY01'));
    const jar = cookie(back);
    const ready = await get(port, back.headers.location, { Cookie: jar });
    assert.strictEqual(ready.status, 200);
    assert.ok(ready.body.includes('Mina Shore'));
    assert.ok(ready.body.includes('Ready to check in'));
    assert.ok(ready.body.includes('People arrived'));
    assert.ok(ready.body.includes('name="arrived"'));
    assert.ok(ready.body.includes('value="4"'));
    assert.ok(ready.body.includes('max="8"'));
    assert.ok(ready.body.includes('class="btn btn-navy btn-checkin"'));
    assert.ok(ready.body.includes('name="confirm" value="1"'));
    assert.ok(!ready.body.includes('other.secret@example.com'));
    assert.ok(!ready.body.includes('Other Guest'));

    const page = await get(port, '/booking/HDC-TODAY01', { 'X-Forwarded-For': '203.0.113.83' });
    const dataUrl = (page.body.match(/src="(data:image\/png;base64,[^"]+)"/) || [])[1];
    assert.ok(dataUrl, 'confirmation QR missing');
    const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
    const decoded = jsQR(Uint8ClampedArray.from(png.data), png.width, png.height);
    assert.ok(decoded.data.startsWith('https://www.hoteldayclub.com.au/hotel/checkin?code='));
    assert.strictEqual(parseBookingCode(decoded.data), 'HDC-TODAY01');

    const byName = await get(port, '/hotel/checkin?q=' + encodeURIComponent('mina'), { Cookie: jar });
    assert.ok(byName.body.includes('Mina Shore'));
    const byEmail = await get(port, '/hotel/checkin?q=' + encodeURIComponent('MINA.SHORE@example.com'), { Cookie: jar });
    assert.ok(byEmail.body.includes('Mina Shore'));
    const byPhone = await get(port, '/hotel/checkin?q=' + encodeURIComponent('0412555010'), { Cookie: jar });
    assert.ok(byPhone.body.includes('Mina Shore'));
    const byCode = await get(port, '/hotel/checkin?q=' + encodeURIComponent('today01'), { Cookie: jar });
    assert.ok(byCode.body.includes('Mina Shore'));
    const otherSearch = await get(port, '/hotel/checkin?q=' + encodeURIComponent('other.secret@example.com'), { Cookie: jar });
    assert.ok(otherSearch.body.includes('No bookings match that search.'));
    assert.ok(!otherSearch.body.includes('Other Guest'));
    const none = await get(port, '/hotel/checkin?q=' + encodeURIComponent('zzzznone'), { Cookie: jar });
    assert.ok(none.body.includes('No bookings match that search.'));

    const future = await get(port, '/hotel/checkin?code=HDC-FUTURE1', { Cookie: jar });
    assert.ok(future.body.includes('not today'));
    assert.ok(future.body.includes('Future Guest'));
    const futureCard = future.body.split('HDC-FUTURE1')[1].split('</article>')[0];
    assert.ok(!futureCard.includes('name="confirm"'));
    const past = await get(port, '/hotel/checkin?code=HDC-PAST001', { Cookie: jar });
    assert.ok(past.body.includes('was for'));
    const pastCard = past.body.split('HDC-PAST001')[1].split('</article>')[0];
    assert.ok(!pastCard.includes('name="confirm"'));
    const cancelled = await get(port, '/hotel/checkin?code=HDC-CANCEL1', { Cookie: jar });
    assert.ok(cancelled.body.includes('Cancelled'));
    const used = await get(port, '/hotel/checkin?code=HDC-USED001', { Cookie: jar });
    const usedAt = used.body.indexOf('HDC-USED001');
    const usedCard = used.body.slice(usedAt, used.body.indexOf('</article>', usedAt));
    assert.ok(usedCard.includes('Checked in 09:15'));
    assert.ok(!usedCard.includes('arrived of'));
    assert.ok(used.body.includes('Used Guest'));
    const other = await get(port, '/hotel/checkin?code=HDC-OTHER01', { Cookie: jar });
    assert.ok(other.body.includes('This booking is for another hotel.'));
    assert.ok(!other.body.includes('Other Guest'));
    assert.ok(!other.body.includes('other.secret@example.com'));

    const early = await post(port, '/hotel/checkin', { code: 'HDC-FUTURE1', confirm: '1', r: '/hotel/checkin' }, { Cookie: jar });
    assert.strictEqual(early.status, 303);
    const still = new Database(dbPath).prepare("SELECT checked_in_at FROM bookings WHERE code='HDC-FUTURE1'").get();
    assert.ok(!still.checked_in_at);
    const cross = await post(port, '/hotel/checkin', { code: 'https://www.hoteldayclub.com.au/hotel/checkin?code=HDC-OTHER01', confirm: '1' }, { Cookie: jar, Origin: 'http://evil.example' });
    assert.strictEqual(cross.status, 403);
    const side = { Cookie: jar, 'X-Forwarded-For': '203.0.113.84' };
    const countPage = await get(port, '/hotel/checkin?code=HDC-COUNT01', side);
    assert.ok(countPage.body.includes('value="4"'));
    assert.ok(countPage.body.includes('max="8"'));
    for (const bad of ['9', '1.5', 'no', '-1']) {
      const res = await post(port, '/hotel/checkin', { code: 'HDC-COUNT01', confirm: '1', arrived: bad, r: '/hotel/checkin' }, side);
      assert.strictEqual(res.status, 303, bad);
      assert.ok(res.headers.location.includes('err=arrived'), bad);
    }
    const stillCount = new Database(dbPath).prepare("SELECT checked_in_at, arrived_count FROM bookings WHERE code='HDC-COUNT01'").get();
    assert.ok(!stillCount.checked_in_at);
    assert.strictEqual(stillCount.arrived_count, null);
    const badPage = await get(port, '/hotel/checkin?code=HDC-COUNT01&err=arrived', side);
    assert.ok(badPage.body.includes('Enter a whole number of people arrived, from 0 to 8.'));
    const custom = await post(port, '/hotel/checkin', { code: 'HDC-COUNT01', confirm: '1', arrived: '3', r: '/hotel/checkin' }, side);
    assert.strictEqual(custom.status, 303);
    assert.ok(custom.headers.location.includes('st=valid'));
    const customRow = new Database(dbPath).prepare("SELECT arrived_count FROM bookings WHERE code='HDC-COUNT01'").get();
    assert.strictEqual(customRow.arrived_count, 3);
    const customPage = await get(port, custom.headers.location, side);
    assert.ok(customPage.body.includes('3 arrived of 4'));
    const zero = await post(port, '/hotel/checkin', { code: 'HDC-ZERO01', confirm: '1', arrived: '0', r: '/hotel/checkin' }, side);
    assert.ok(zero.headers.location.includes('st=valid'));
    const zeroRow = new Database(dbPath).prepare("SELECT arrived_count FROM bookings WHERE code='HDC-ZERO01'").get();
    assert.strictEqual(zeroRow.arrived_count, 0);
    const zeroPage = await get(port, zero.headers.location, side);
    assert.ok(zeroPage.body.includes('0 arrived of 4'));
    const lookup = await get(port, '/hotel?q=' + encodeURIComponent('Count Guest'), side);
    assert.ok(lookup.body.includes('3 arrived of 4'));
    const dash = await get(port, '/hotel', side);
    assert.ok(dash.body.includes('arrived of'));
    assert.ok(dash.body.includes('booked'));
    const pub = await get(port, '/booking/HDC-COUNT01', { 'X-Forwarded-For': '203.0.113.85' });
    assert.ok(!pub.body.includes('arrived of'));
    assert.ok(!pub.body.includes('People arrived'));
    const admin = await post(port, '/admin/login', { user: 'jason', pass: 'checkin-admin' }, { 'X-Forwarded-For': '203.0.113.86' });
    const adminJar = cookie(admin);
    const adminPage = await get(port, '/admin?q=' + encodeURIComponent('Count Guest'), { Cookie: adminJar });
    assert.ok(adminPage.body.includes('3 arrived of 4'));
    const csv = await get(port, '/admin/export/bookings.csv', { Cookie: adminJar });
    const csvLines = csv.body.split(/\r?\n/);
    const arrivedCol = csvLines[0].split(',').indexOf('arrived_count');
    assert.ok(arrivedCol > 0);
    const cell = line => line.split(',').map(part => part.replace(/^"|"$/g, ''))[arrivedCol];
    const countLine = csvLines.find(line => line.includes('HDC-COUNT01'));
    const usedLine = csvLines.find(line => line.includes('HDC-USED001'));
    assert.strictEqual(cell(countLine), '3');
    assert.strictEqual(cell(usedLine), '');

    const done = await post(port, '/hotel/checkin', { code: 'HDC-TODAY01', confirm: '1', r: '/hotel/checkin' }, { Cookie: jar });
    assert.strictEqual(done.status, 303);
    assert.ok(done.headers.location.includes('st=valid'));
    const after = await get(port, done.headers.location, { Cookie: jar });
    assert.ok(after.body.includes('Checked in'));
    assert.ok(after.body.includes('4 arrived of 4'));
    const stamped = new Database(dbPath).prepare("SELECT checked_in_at, arrived_count FROM bookings WHERE code='HDC-TODAY01'").get();
    assert.ok(stamped.checked_in_at);
    assert.strictEqual(stamped.arrived_count, 4);

    const ip = { 'X-Forwarded-For': '203.0.113.90', Cookie: jar };
    for (let i = 0; i < 30; i++) {
      const res = await get(port, '/hotel/checkin?code=HDC-NOPE' + i, ip);
      assert.strictEqual(res.status, 200);
    }
    const limited = await get(port, '/hotel/checkin?code=HDC-NOPE99', ip);
    assert.strictEqual(limited.status, 429);
    assert.ok(limited.body.includes('Too many lookups'));
    assert.ok(!limited.body.includes('Mina Shore'));
    console.log('checkin checks passed');
  } finally {
    child.kill('SIGTERM');
  }
}
