const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const guestCss = [
  'public/base.css',
  'public/golden/home.css',
  'public/search.css',
  'public/listing-dir2.css',
  'public/polish.css',
  'public/help-centre.css',
  'public/guest-d2.css',
  'public/pickers.css',
  'public/booking-ticket.css',
];
const allowHex = new Set(['#fff', '#ffffff', '#000', '#000000']);

for (const rel of guestCss) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.ok(!/#0[Bb]2545/.test(text), rel + ' must not use #0B2545');
  for (const m of text.matchAll(/#([0-9A-Fa-f]{3,8})\b/g)) {
    const raw = '#' + m[1].toLowerCase();
    const norm = raw.length === 4
      ? '#' + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3]
      : raw;
    const short = norm === '#ffffff' ? '#fff' : norm === '#000000' ? '#000' : norm;
    assert.ok(allowHex.has(short) || allowHex.has(norm), `${rel} off-token hex ${m[0]}`);
  }
}

const radiusNums = new Set([0, 12, 20, 50, 999]);
for (const rel of guestCss) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const rule of text.match(/border-radius:\s*[^;}]+/g) || []) {
    const val = rule.replace(/border-radius:\s*/, '').trim();
    if (val.includes('var(')) continue;
    for (const part of val.split(/[\s/]+/)) {
      if (part.endsWith('%')) continue;
      const num = parseFloat(part);
      if (!Number.isFinite(num)) continue;
      assert.ok(radiusNums.has(num), `${rel} border-radius ${val}`);
    }
  }
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
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DATA_DIR: '', ADMIN_PASSWORD: 'dt-admin', DEMO_HOTEL_PASSWORD: 'dt-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('timeout\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

const guestPages = [
  '/',
  '/search',
  '/h/saltwater-terrace',
  '/for-hotels',
  '/how-it-works',
  '/faq',
  '/contact',
  '/privacy',
  '/terms',
  '/refunds',
  '/guides',
  '/destinations/manly',
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-dt-'));
const port = 3820 + Math.floor(Math.random() * 40);

(async () => {
  const child = await start(port);
  try {
    for (const p of guestPages) {
      const html = await get(port, p);
      assert.strictEqual(html.status, 200, p);
      assert.ok(html.body.includes('/base.css'), p + ' loads base.css');
      assert.ok(!html.body.includes('/styles.css'), p + ' must not load styles.css');
      assert.ok(!html.body.includes('/app.css'), p + ' must not load app.css');
      assert.ok(!html.body.includes('/golden/site.css'), p + ' must not load site.css');
      const hdr = html.body.match(/<header class="hdr"[\s\S]*?<\/header>/);
      assert.ok(hdr, p + ' header');
      assert.ok(html.body.includes('Join the waitlist'), p + ' waitlist control');
      assert.ok(html.body.includes('class="wrap'), p + ' wrap');
      if (p === '/') {
        assert.ok(html.body.includes('guest-d2'), p + ' home guest-d2');
        assert.ok(!hdr[0].includes('is-solid'), p + ' home header starts transparent');
      } else {
        assert.ok(html.body.includes('class="hdr"'), p + ' white header shell');
      }
    }
    const hotelLogin = await get(port, '/hotel/login');
    assert.ok(hotelLogin.body.includes('/base.css'), 'hotel login loads base.css');
    assert.ok(!hotelLogin.body.includes('/styles.css'), 'hotel login drops legacy styles.css');
    const loginRes = await new Promise((resolve, reject) => {
      const body = 'user=demo-saltwater&pass=dt-hotel';
      const req = http.request({
        hostname: '127.0.0.1', port, path: '/hotel/login', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    const cookie = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'hotel login cookie');
    const dashRedirect = await get(port, '/hotel', { Cookie: cookie });
    const dashPath = dashRedirect.status === 302 && dashRedirect.headers && dashRedirect.headers.location
      ? String(dashRedirect.headers.location).replace(/^https?:\/\/[^/]+/, '')
      : '/hotel';
    const dash = dashRedirect.status === 200 ? dashRedirect : await get(port, dashPath || '/hotel', { Cookie: cookie });
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.body.includes('/base.css'), 'hotel dashboard loads base.css');
    assert.ok(!dash.body.includes('/styles.css'), 'hotel dashboard drops styles.css');
    assert.ok(dash.body.includes('/app.css'), 'hotel dashboard keeps app.css for layout');
  } finally {
    child.kill('SIGTERM');
  }
  console.log('design-tokens-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});