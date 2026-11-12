const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { hotelPct, feePct } = require('../commission');

const repo = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-admin-'));
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
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: repo,
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: dbPath,
        DATA_DIR: '',
        ADMIN_PASSWORD: 'admin-checks-pass',
        DEMO_HOTEL_PASSWORD: 'admin-checks-hotel',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 30000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function tabNav(html) {
  const start = html.indexOf('<nav class="adm-tabs"');
  assert.ok(start >= 0, 'missing admin tabs');
  return html.slice(start, html.indexOf('</nav>', start));
}
function tabs(html) {
  return [...tabNav(html).matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)].map(m => ({
    href: m[1],
    attrs: m[2],
    text: m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    inner: m[3],
  }));
}
function assertShell(html, here) {
  const found = tabs(html);
  assert.deepStrictEqual(found.map(tab => tab.href), ['/admin', '/admin/bookings', '/admin/hotels', '/admin/messages', '/admin/backups']);
  assert.deepStrictEqual(found.map(tab => tab.text.replace(/\s+\d+$/, '')), ['Overview', 'Bookings', 'Hotels', 'Messages', 'Backups']);
  const current = html.match(/aria-current="page"/g) || [];
  assert.strictEqual(current.length, 1, here);
  assert.ok(found.find(tab => tab.href === here).attrs.includes('aria-current="page"'), here);
  assert.ok(html.includes('href="/admin/logout"'));
  assert.ok(html.includes('>Sign out</a>'));
  assert.ok(html.includes('id="adm-menu"'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('href="#adm-menu"'));
  assert.ok(!html.includes('/admin/listings'), here);
  assert.ok(!html.includes('/admin/pending'), here);
  assert.ok(!tabNav(html).includes('Listings'));
  assert.ok(!tabNav(html).includes('Pending'));
  assert.ok(html.includes('content="noindex'));
}
function tileLabels(html) {
  return [...html.matchAll(/class="k">([^<]+)</g)].map(m => m[1]);
}
function banned(html, where) {
  assert.ok(!/\bcommission\b/i.test(html), where + ' mentions commission');
  assert.ok(!/75% of|hotel share|before commission|platform commission/i.test(html), where + ' mentions a share or commission rate');
}

(async () => {
  assert.strictEqual(hotelPct(), 75);
  assert.strictEqual(feePct(), 25);
  const css = fs.readFileSync(path.join(repo, 'public', 'app.css'), 'utf8');
  assert.ok(css.includes('--adm-ink:#17323A'));
  assert.ok(css.includes('outline:3px solid #0A4F55'));
  assert.ok(css.includes('box-shadow:0 0 0 5px #F6A55F'));
  assert.ok(!/^\.adm\{[^}]*:root/.test(css));

  const port = 3417;
  const child = await start(port);
  try {
    const locked = await get(port, '/admin/bookings');
    assert.strictEqual(locked.status, 302);
    assert.ok(String(locked.headers.location).includes('/admin/login'));

    const login = await post(port, '/admin/login', { user: 'jason', pass: 'admin-checks-pass' });
    assert.strictEqual(login.status, 302);
    const jar = cookie(login);
    const auth = { Cookie: jar };

    const overview = await get(port, '/admin', auth);
    assert.strictEqual(overview.status, 200);
    assertShell(overview.body, '/admin');
    for (const text of [
      `Paid to hotels (${hotelPct()}%)`,
      `Platform commission (${feePct()}%)`,
      'Hotel Day Club revenue',
      `Commission stays at ${feePct()}% of that gross.`,
      'By hotel',
      `Hotel ${hotelPct()}%`,
      `Commission ${feePct()}%`,
    ]) assert.ok(overview.body.includes(text), text);
    const labels = tileLabels(overview.body);
    assert.deepStrictEqual(labels, [
      'Bookings',
      'Gross sales',
      `Paid to hotels (${hotelPct()}%)`,
      `Platform commission (${feePct()}%)`,
    ]);
    assert.ok(overview.body.includes('Nothing needs attention.'));
    assert.ok(overview.body.includes('Guest notes'));
    for (const tab of tabs(overview.body)) assert.ok(!tab.inner.includes('adm-count'), tab.href);

    const bookings = await get(port, '/admin/bookings', auth);
    assert.strictEqual(bookings.status, 200);
    assertShell(bookings.body, '/admin/bookings');
    for (const text of [
      `Paid to hotels (${hotelPct()}%)`,
      `Platform commission (${feePct()}%)`,
      'Hotel Day Club revenue',
      `Commission stays at ${feePct()}% of that gross.`,
    ]) assert.ok(bookings.body.includes(text), 'bookings ' + text);
    assert.deepStrictEqual(tileLabels(bookings.body), labels);
    assert.ok(!bookings.body.includes('<h2>By hotel</h2>'));
    const wide = bookings.body.split('class="guests-wide"')[1].split('class="guests-narrow"')[0];
    const tbody = wide.split('<tbody>')[1].split('</tbody>')[0];
    assert.strictEqual((tbody.match(/<tr>/g) || []).length, 10);
    const shown = bookings.body.match(/Showing 1\u201310 of (\d+)/);
    assert.ok(shown, 'missing Showing 1–10');
    assert.ok(Number(shown[1]) > 10);
    assert.match(bookings.body, /<span class="btn adm-btn" aria-disabled="true">Previous<\/span>/);

    const hotelId = (bookings.body.match(/<option value="(\d+)"/) || [])[1];
    assert.ok(hotelId);
    const filtered = await get(port, `/admin/bookings?q=e&hotel=${hotelId}&status=confirmed`, auth);
    const next = filtered.body.match(/<a class="btn adm-btn" href="([^"]+)">Next<\/a>/);
    assert.ok(next, filtered.body.slice(filtered.body.indexOf('adm-pager'), filtered.body.indexOf('adm-pager') + 500));
    const nextUrl = new URL(next[1].replace(/&amp;/g, '&'), 'http://127.0.0.1');
    assert.strictEqual(nextUrl.searchParams.get('q'), 'e');
    assert.strictEqual(nextUrl.searchParams.get('hotel'), hotelId);
    assert.strictEqual(nextUrl.searchParams.get('status'), 'confirmed');
    assert.strictEqual(nextUrl.searchParams.get('page'), '2');

    const far = await get(port, '/admin/bookings?page=99999', auth);
    const farShown = far.body.match(/Showing (\d+)\u2013(\d+) of (\d+)/);
    assert.ok(farShown, 'page past the end was not clamped');
    const total = Number(farShown[3]);
    const last = Math.ceil(total / 10);
    assert.strictEqual(Number(farShown[2]), total);
    assert.strictEqual(Number(farShown[1]), (last - 1) * 10 + 1);
    assert.match(far.body, /<span class="btn adm-btn" aria-disabled="true">Next<\/span>/);

    const none = await get(port, '/admin/bookings?q=' + encodeURIComponent('zzzznomatch'), auth);
    assert.ok(none.body.includes('No bookings match.'));
    assert.ok(none.body.includes('Clear filters.'));
    assert.match(none.body, /<span class="btn adm-btn" aria-disabled="true">Next<\/span>/);

    const live = new Database(dbPath);
    live.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo)
      VALUES ('pending-pool', 'Pending Pool', 'Perth', 'pending-pool', 'not-a-hash', 'pending', 0)`).run();
    live.prepare(`INSERT INTO contact_messages (name, email, topic, message)
      VALUES ('Ada Checks', 'ada.checks@example.com', 'other', 'Hello from the admin check')`).run();
    live.close();

    const counted = await get(port, '/admin', auth);
    assert.ok(counted.body.includes('Hotels awaiting approval'));
    assert.ok(counted.body.includes('New messages'));
    assert.ok(!counted.body.includes('Nothing needs attention.'));
    for (const tab of tabs(counted.body)) {
      const wantsCount = tab.href === '/admin/hotels' || tab.href === '/admin/messages';
      assert.strictEqual(tab.inner.includes('adm-count'), wantsCount, tab.href);
      if (wantsCount) assert.ok(tab.inner.includes('>1</span>'), tab.href);
    }

    const hotels = await get(port, '/admin/hotels', auth);
    assertShell(hotels.body, '/admin/hotels');
    assert.ok(hotels.body.includes('Demo password is set on the server.'));
    assert.ok(hotels.body.includes('Pending Pool'));
    assert.ok(hotels.body.includes('action="/admin/approve"'));

    const messages = await get(port, '/admin/messages', auth);
    assertShell(messages.body, '/admin/messages');
    assert.ok(messages.body.includes('id="messages"'));
    assert.ok(messages.body.includes('id="waitlist"'));
    assert.ok(messages.body.includes('Ada Checks'));
    assert.ok(messages.body.includes('No waitlist signups stored on this server.') || messages.body.includes('id="waitlist"'));

    const backups = await get(port, '/admin/backups', auth);
    assertShell(backups.body, '/admin/backups');
    assert.ok(backups.body.includes('Back up now'));
    assert.ok(String(backups.headers['cache-control']).includes('no-store'));
    const csv = await get(port, '/admin/export/bookings.csv', auth);
    assert.ok(String(csv.headers['cache-control']).includes('no-store'));
    assert.ok(String(csv.headers['x-robots-tag']).includes('noindex'));

    for (const pathName of ['/', '/how-it-works', '/for-hotels', '/faq', '/contact', '/guides', '/h/saltwater-terrace', '/privacy', '/terms', '/refunds', '/risk', '/hotel/login']) {
      const page = await get(port, pathName);
      assert.strictEqual(page.status, 200, pathName);
      banned(page.body, pathName);
    }
    const hotelLogin = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'admin-checks-hotel' });
    assert.strictEqual(hotelLogin.status, 302, hotelLogin.body.slice(0, 200));
    const hotelJar = { Cookie: cookie(hotelLogin) };
    for (const pathName of ['/hotel', '/hotel/analytics', '/hotel/settings', '/hotel/checkin']) {
      const page = await get(port, pathName, hotelJar);
      assert.strictEqual(page.status, 200, pathName);
      banned(page.body, pathName);
    }
  } finally {
    child.kill('SIGTERM');
  }
  console.log('admin checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
