const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-login-'));
const dbPath = path.join(dir, 'daypass.db');
const repo = path.join(__dirname, '..');
const secret = 'login-hotel-secret';

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
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: repo,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'login-admin', DEMO_HOTEL_PASSWORD: secret },
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
  const port = 3371;
  const child = await start(port);
  try {
    const hotels = await get(port, '/for-hotels');
    assert.strictEqual(hotels.status, 200);
    assert.ok(hotels.body.includes('Hotel partner login'));
    assert.ok(hotels.body.includes('For hotels we have invited'));
    assert.ok(hotels.body.includes('no sign-up'));
    assert.ok(hotels.body.includes('Hotels are invited.'));
    assert.ok(hotels.body.includes('There is no sign-up form.'));
    assert.ok(hotels.body.includes('action="/hotel/login"'));
    assert.ok(hotels.body.includes('name="return" value="/for-hotels"'));
    assert.ok(hotels.body.includes('Forgot password?'));
    assert.ok(hotels.body.includes('mailto:hello@hoteldayclub.com.au'));
    assert.ok(hotels.body.includes('A short pilot'));
    assert.ok(hotels.body.includes('Talk to us'));
    assert.ok(hotels.body.includes('Australia'));
    assert.ok(!hotels.body.includes(secret));
    assert.ok(!hotels.body.includes('demo-logins'));
    assert.ok(!hotels.body.includes('demo-saltwater'));
    assert.ok(!hotels.body.includes('href="/hotel/join"'));
    assert.strictEqual((hotels.body.match(/<h1/g) || []).length, 1);
    assert.ok(hotels.body.includes('href="/hotel/login">Hotel login</a>'));

    const home = await get(port, '/');
    assert.ok(home.body.includes('href="/hotel/login">Hotel login</a>'));

    const login = await get(port, '/hotel/login');
    assert.strictEqual(login.status, 200);
    assert.ok(login.body.includes('content="noindex, nofollow"'));
    assert.ok(login.body.includes('<h1>Hotel partner login</h1>'));
    assert.ok(!login.body.includes('name="return"'));
    assert.ok(!login.body.includes(secret));
    assert.ok(!login.body.includes('demo-logins'));
    assert.ok(!login.body.includes('demo-saltwater'));

    const map = await get(port, '/sitemap.xml');
    assert.ok(!map.body.includes('/hotel/login'));
    assert.ok(!map.body.includes('/hotel"'));
    const robots = await get(port, '/robots.txt');
    assert.ok(robots.body.includes('Disallow: /hotel'));

    const bad = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'nope', return: '/for-hotels' }, { 'X-Forwarded-For': '203.0.113.71' });
    assert.strictEqual(bad.status, 302);
    assert.strictEqual(bad.headers.location, '/for-hotels?e=1#login');
    const shown = await get(port, '/for-hotels?e=1');
    assert.ok(shown.body.includes('Wrong username or password.'));
    assert.ok(!shown.body.includes(secret));

    const offsite = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'nope', return: 'https://evil.example/phish' }, { 'X-Forwarded-For': '203.0.113.72' });
    assert.strictEqual(offsite.headers.location, '/hotel/login?e=1');

    const pageBad = await post(port, '/hotel/login', { user: 'nope', pass: 'nope' }, { 'X-Forwarded-For': '203.0.113.73' });
    assert.strictEqual(pageBad.headers.location, '/hotel/login?e=1');

    const lockIp = { 'X-Forwarded-For': '203.0.113.74' };
    for (let i = 0; i < 4; i++) {
      const res = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'wrong', return: '/for-hotels' }, lockIp);
      assert.strictEqual(res.headers.location, '/for-hotels?e=1#login', 'try ' + i);
    }
    const fifth = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'wrong', return: '/for-hotels' }, lockIp);
    assert.strictEqual(fifth.headers.location, '/for-hotels?e=lock#login');
    const locked = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: secret, return: '/for-hotels' }, lockIp);
    assert.strictEqual(locked.headers.location, '/for-hotels?e=lock#login');
    assert.ok(!(locked.headers['set-cookie'] || []).join('').includes('hotel='));
    const lockedPage = await get(port, '/for-hotels?e=lock');
    assert.ok(lockedPage.body.includes('Too many tries. Wait 15 minutes, then try again.'));

    const ok = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: secret }, { 'X-Forwarded-For': '203.0.113.75' });
    assert.strictEqual(ok.status, 302);
    assert.strictEqual(ok.headers.location, '/hotel');
    const jar = (ok.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const dash = await get(port, '/hotel', { Cookie: jar });
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.body.includes('content="noindex, nofollow"'));
    assert.ok(!dash.body.includes(secret));

    const evilLogin = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: secret }, { Origin: 'https://evil.example', 'X-Forwarded-For': '203.0.113.91' });
    assert.strictEqual(evilLogin.status, 403);
    assert.ok(!(evilLogin.headers['set-cookie'] || []).join('').includes('hotel='));
    const evilAdmin = await post(port, '/admin/login', { user: 'jason', pass: 'login-admin' }, { Origin: 'https://evil.example' });
    assert.strictEqual(evilAdmin.status, 403);

    const admin = await post(port, '/admin/login', { user: 'jason', pass: 'login-admin' });
    assert.strictEqual(admin.status, 302);
    const adminJar = (admin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const Database = require('better-sqlite3');
    const live = new Database(dbPath);
    const realId = live.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo)
      VALUES ('real-pool', 'Real Pool', 'Perth', 'real-pool', 'old-plain', 'active', 0)`).run().lastInsertRowid;
    const adminPage = await get(port, '/admin', { Cookie: adminJar });
    assert.ok(adminPage.body.includes('Demo password is set on the server.'));
    assert.ok(adminPage.body.includes('New password for Real Pool'));
    const evilSet = await post(port, '/admin/hotel-password', { id: String(realId), password: 'new-secret' }, { Cookie: adminJar, Origin: 'https://evil.example' });
    assert.strictEqual(evilSet.status, 403);
    const set = await post(port, '/admin/hotel-password', { id: String(realId), password: 'new-secret' }, { Cookie: adminJar });
    assert.strictEqual(set.status, 302);
    assert.ok(decodeURIComponent(set.headers.location || '').includes('Password set for Real Pool.'));
    const demoId = live.prepare("SELECT id FROM hotels WHERE login='demo-saltwater'").get().id;
    const refused = await post(port, '/admin/hotel-password', { id: String(demoId), password: 'nope-nope' }, { Cookie: adminJar });
    assert.ok(decodeURIComponent(refused.headers.location || '').includes('set on the server'));
    const stillDemo = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: secret }, { 'X-Forwarded-For': '203.0.113.92' });
    assert.strictEqual(stillDemo.status, 302);
    const realIn = await post(port, '/hotel/login', { user: 'real-pool', pass: 'new-secret' }, { 'X-Forwarded-For': '203.0.113.93' });
    assert.strictEqual(realIn.status, 302);
    const realJar = (realIn.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const cross = await post(port, '/hotel/pause', { when: 'today' }, { Cookie: realJar, Origin: 'https://evil.example' });
    assert.strictEqual(cross.status, 403);
    const preview = await get(port, '/hotel/email-preview', { Cookie: realJar });
    assert.ok(preview.body.includes('36 hours'));
    assert.ok(preview.body.includes('They do not sign you in.'));
    const token = (preview.body.match(/href="\/hotel\/go\/([^"]+)"/) || [])[1];
    assert.ok(token);
    await get(port, '/hotel/logout', { Cookie: realJar });
    const link = await get(port, '/hotel/go/' + token);
    assert.strictEqual(link.status, 200);
    assert.ok(!(link.headers['set-cookie'] || []).join('').includes('hotel='));
    assert.ok(!link.body.includes('staff'));
    const lockedDash = await get(port, '/hotel');
    assert.strictEqual(lockedDash.status, 302);
    assert.ok(String(lockedDash.headers.location).includes('/hotel/login'));
    live.close();
  } finally {
    child.kill('SIGTERM');
  }
  console.log('hotel login checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
