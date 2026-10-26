const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

process.env.ADMIN_PASSWORD = 'security-admin-test';
process.env.DEMO_HOTEL_PASSWORD = 'security-hotel-test';
process.env.NODE_ENV = '';

const passwords = require('../passwords');
const session = require('../session');

function ymd(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
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
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
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
  const raw = res.headers['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}
function sharedOpenDate(dbFile) {
  const live = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const hotels = [
      { slug: 'saltwater-terrace', pass: 'lounger' },
      { slug: 'skyline-rooftop', pass: 'chair' },
    ].map(spec => {
      const h = live.prepare('SELECT id FROM hotels WHERE slug=?').get(spec.slug);
      const p = live.prepare('SELECT id, daily_cap FROM pass_types WHERE hotel_id=? AND code=?').get(h.id, spec.pass);
      return { id: h.id, passId: p.id, cap: p.daily_cap };
    });
    for (let i = 1; i < 45; i++) {
      const when = new Date();
      when.setDate(when.getDate() + i);
      const date = ymd(when);
      const open = hotels.every(h => {
        const hours = live.prepare('SELECT open FROM hotel_hours WHERE hotel_id=? AND weekday=?').get(h.id, when.getDay());
        if (!hours || !hours.open) return false;
        if (live.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?').get(h.id, date)) return false;
        const sold = live.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(h.passId, date).n;
        return sold < h.cap;
      });
      if (open) return date;
    }
    throw new Error('no shared open date');
  } finally {
    live.close();
  }
}
function start(port, dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: path.join(dir, 'daypass.db'),
        DATA_DIR: '',
        ADMIN_PASSWORD: 'security-admin-test',
        DEMO_HOTEL_PASSWORD: 'security-hotel-test',
        NODE_ENV: '',
        GA_MEASUREMENT_ID: '',
        WAITLIST_WEBHOOK_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 30000);
    child.stdout.on('data', c => {
      log += c;
      if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve({ child, log: () => log }); }
    });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

function unit() {
  assert.strictEqual(passwords.safeEqual('jason', 'jason'), true);
  assert.strictEqual(passwords.safeEqual('jason', 'jason '), false);
  assert.strictEqual(passwords.safeEqual('short', 'longer-value'), false);
  assert.strictEqual(passwords.maskName('Persis Guest'), 'Persis G.');
  assert.strictEqual(passwords.maskName('Cher'), 'Cher');
  assert.strictEqual(passwords.maskEmail('persist-guest@example.com'), 'p***@example.com');
  assert.strictEqual(passwords.maskEmail('j@gmail.com'), 'j***@gmail.com');

  const hash = passwords.hashPassword('plain-pass');
  assert.ok(hash.startsWith('scrypt$'));
  assert.ok(passwords.isHashedPassword(hash));
  assert.ok(passwords.verifyPassword('plain-pass', hash));
  assert.ok(!passwords.verifyPassword('other-pass', hash));
  assert.ok(!passwords.verifyPassword('plain-pass', 'plain-pass'));

  const db = new Database(':memory:');
  db.exec('CREATE TABLE hotels(id INTEGER PRIMARY KEY, login TEXT, password TEXT)');
  db.prepare('INSERT INTO hotels(login, password) VALUES (?,?)').run('demo-saltwater', 'old-demo');
  db.prepare('INSERT INTO hotels(login, password) VALUES (?,?)').run('independent', 'plain-pass');
  passwords.migrateHotelPasswords(db, 'current-demo');
  const demo = db.prepare("SELECT password FROM hotels WHERE login='demo-saltwater'").get().password;
  const indie = db.prepare("SELECT password FROM hotels WHERE login='independent'").get().password;
  assert.ok(passwords.isHashedPassword(demo));
  assert.ok(passwords.verifyPassword('current-demo', demo));
  assert.ok(!passwords.verifyPassword('old-demo', demo));
  assert.ok(passwords.verifyPassword('plain-pass', indie));
  passwords.migrateHotelPasswords(db, 'current-demo');
  assert.strictEqual(db.prepare("SELECT password FROM hotels WHERE login='demo-saltwater'").get().password, demo);
  assert.strictEqual(db.prepare("SELECT password FROM hotels WHERE login='independent'").get().password, indie);
  passwords.migrateHotelPasswords(db, 'rotated-demo');
  const rotated = db.prepare("SELECT password FROM hotels WHERE login='demo-saltwater'").get().password;
  assert.notStrictEqual(rotated, demo);
  assert.ok(passwords.verifyPassword('rotated-demo', rotated));
  assert.strictEqual(db.prepare("SELECT password FROM hotels WHERE login='independent'").get().password, indie);
  db.close();

  const previous = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const dev = session.staffCookieOptions();
  assert.strictEqual(dev.httpOnly, true);
  assert.strictEqual(dev.secure, false);
  assert.strictEqual(dev.sameSite, 'lax');
  assert.strictEqual(dev.maxAge, 12 * 60 * 60 * 1000);
  process.env.NODE_ENV = 'production';
  assert.strictEqual(session.staffCookieOptions().secure, true);
  if (previous == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
}

async function main() {
  unit();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-sec-'));
  const dbFile = path.join(dir, 'daypass.db');
  const port = 3337;
  const started = await start(port, dir);
  const child = started.child;
  try {
    const date = sharedOpenDate(dbFile);
    const book = (hotel, name, email, phone) => post(port, '/book', {
      hotel, date, qty: '1', pass: hotel === 'skyline-rooftop' ? 'chair' : 'lounger',
      name, email, phone, rules: '1', terms: '1', risk: '1',
    }, { 'X-Forwarded-For': '203.0.113.10' });
    const salt = await book('saltwater-terrace', 'Persis Guest', 'persist-guest@example.com', '0412000111');
    assert.strictEqual(salt.status, 303, salt.body);
    assert.match(salt.headers.location, /^\/booking\/HDC-[0-9A-F]{32}$/);
    const sky = await book('skyline-rooftop', 'Onlysky Guest', 'onlysky-unique@example.com', '0499111222');
    assert.strictEqual(sky.status, 303, sky.body);
    const skyCode = sky.headers.location.split('/').pop();

    const page = await get(port, salt.headers.location, { 'X-Forwarded-For': '203.0.113.11' });
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('Persis G.'));
    assert.ok(page.body.includes('p***@example.com'));
    assert.ok(!page.body.includes('Persis Guest'));
    assert.ok(!page.body.includes('persist-guest@example.com'));
    assert.ok(!page.body.includes('0412000111'));
    assert.ok(page.body.includes('Saltwater'));
    assert.ok(page.body.includes('Sun lounger'));
    assert.ok(page.body.includes('Confirmed'));
    assert.ok(page.body.includes('Add to calendar'));
    assert.ok(page.body.includes('Directions'));
    assert.ok(page.body.includes('openstreetmap.org'));
    assert.ok(page.body.includes('content="noindex, nofollow"'));
    assert.ok(String(page.headers['x-robots-tag']).includes('noindex'));
    assert.ok(String(page.headers['cache-control']).includes('no-store'));

    const live = new Database(dbFile);
    const pass = live.prepare("SELECT p.id, h.id hotel FROM pass_types p JOIN hotels h ON h.id=p.hotel_id WHERE h.slug='saltwater-terrace' LIMIT 1").get();
    live.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status)
      VALUES ('HDC-12345',?,?,?,1,10,10,'Legacy Person','legacy.person@example.com','0499000111','confirmed')`).run(pass.hotel, pass.id, date);
    const stored = live.prepare("SELECT password FROM hotels WHERE login='demo-saltwater'").get().password;
    assert.ok(stored.startsWith('scrypt$'));
    assert.ok(!stored.includes('security-hotel-test'));
    live.close();

    const legacy = await get(port, '/booking/HDC-12345', { 'X-Forwarded-For': '203.0.113.12' });
    assert.strictEqual(legacy.status, 200);
    assert.ok(legacy.body.includes('Legacy P.'));
    assert.ok(legacy.body.includes('l***@example.com'));
    assert.ok(!legacy.body.includes('Legacy Person'));
    assert.ok(!legacy.body.includes('legacy.person@example.com'));

    const ics = await get(port, salt.headers.location + '/calendar.ics', { 'X-Forwarded-For': '203.0.113.13' });
    assert.strictEqual(ics.status, 200);
    assert.ok(String(ics.headers['content-type']).includes('text/calendar'));
    assert.ok(ics.body.includes('BEGIN:VEVENT'));
    assert.ok(!ics.body.includes('persist-guest@example.com'));
    assert.ok(!ics.body.includes('Persis Guest'));

    const ip = { 'X-Forwarded-For': '203.0.113.40' };
    for (let i = 0; i < 30; i++) {
      const res = await get(port, '/booking/HDC-NOPE', ip);
      assert.strictEqual(res.status, 404);
    }
    const limited = await get(port, '/booking/HDC-NOPE', ip);
    assert.strictEqual(limited.status, 429);
    assert.ok(limited.body.includes('Too many booking lookups'));

    const login = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'security-hotel-test' }, { 'X-Forwarded-For': '203.0.113.20' });
    assert.strictEqual(login.status, 302);
    const jar = cookie(login);
    const setCookie = (login.headers['set-cookie'] || []).join(';');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Max-Age=43200/i);
    assert.ok(!/;\s*Secure/i.test(setCookie));
    const own = await get(port, '/hotel?q=' + encodeURIComponent('Persis Guest'), { Cookie: jar });
    assert.strictEqual(own.status, 200);
    assert.ok(own.body.includes('persist-guest@example.com'));
    assert.ok(own.body.includes('0412000111'));
    assert.ok(!own.body.includes('onlysky-unique@example.com'));
    assert.ok(!own.body.includes('0499111222'));
    const other = await get(port, '/hotel?q=' + encodeURIComponent('Onlysky Guest'), { Cookie: jar });
    assert.ok(other.body.includes('0 results'));
    assert.ok(!other.body.includes('onlysky-unique@example.com'));
    const check = await post(port, '/hotel/checkin', { code: skyCode, r: '/hotel/checkin' }, { Cookie: jar });
    assert.strictEqual(check.status, 303);
    assert.ok(check.headers.location.includes('st=missing'));
    const checkPage = await get(port, check.headers.location, { Cookie: jar });
    assert.ok(checkPage.body.includes('No booking'));
    assert.ok(!checkPage.body.includes('Onlysky Guest'));
    assert.ok(!checkPage.body.includes('onlysky-unique@example.com'));
    const settings = await get(port, '/hotel/settings', { Cookie: jar });
    assert.ok(!settings.body.includes('scrypt$'));
    assert.ok(!settings.body.includes('security-hotel-test'));

    const badIp = { 'X-Forwarded-For': '203.0.113.50' };
    for (let i = 0; i < 4; i++) {
      const res = await post(port, '/admin/login', { user: 'jason', pass: 'wrong' }, badIp);
      assert.ok(res.headers.location.includes('e=1'), res.headers.location);
    }
    const fifth = await post(port, '/admin/login', { user: 'jason', pass: 'wrong' }, badIp);
    assert.ok(fifth.headers.location.includes('e=lock'));
    const blocked = await post(port, '/admin/login', { user: 'jason', pass: 'security-admin-test' }, badIp);
    assert.ok(blocked.headers.location.includes('e=lock'));
    assert.ok(!(blocked.headers['set-cookie'] || []).join('').includes('admin='));
    const admin = await post(port, '/admin/login', { user: 'jason', pass: 'security-admin-test' }, { 'X-Forwarded-For': '203.0.113.60' });
    assert.strictEqual(admin.status, 302);
    assert.ok(admin.headers.location.endsWith('/admin'));
    const adminJar = cookie(admin);
    const adminCookie = (admin.headers['set-cookie'] || []).join(';');
    assert.match(adminCookie, /HttpOnly/i);
    assert.match(adminCookie, /SameSite=Lax/i);
    const adminPage = await get(port, '/admin', { Cookie: adminJar });
    assert.ok(!adminPage.body.includes('scrypt$'));
    assert.ok(!adminPage.body.includes('security-hotel-test'));
    const hotels = await get(port, '/admin/export/hotels.csv', { Cookie: adminJar });
    assert.ok(!hotels.body.includes('scrypt$'));
    assert.ok(!hotels.body.includes('security-hotel-test'));
    assert.ok(!hotels.body.toLowerCase().includes('password'));
  } finally {
    child.kill();
  }
  const log = started.log();
  assert.ok(!log.includes('security-hotel-test'));
  assert.ok(!log.includes('scrypt$'));
  console.log('security checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
