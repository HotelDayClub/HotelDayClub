const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const banned = /\bgross\b|gross[_\s-]sales|gross[_\s-]revenue|\d+\s*%|%\s*sold|\bsplit\b/i;

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-gross-'));
  const port = 3810;
  process.env.DEMO_HOTEL_PASSWORD = 'gross-ban-hotel';
  process.env.ADMIN_PASSWORD = 'gross-ban-admin';
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'daypass.db'), DATA_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let log = '';
    const t = setTimeout(() => reject(new Error('server timeout')), 30000);
    server.stdout.on('data', c => {
      log += c;
      if (log.includes('Hotel Day Club demo')) { clearTimeout(t); resolve(); }
    });
    server.stderr.on('data', c => { log += c; });
  });

  const login = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/hotel/login', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, res => {
      const cookies = res.headers['set-cookie'] || [];
      res.resume();
      res.on('end', () => resolve(cookies.join('; ')));
    });
    req.on('error', reject);
    req.write('user=demo-saltwater&pass=' + encodeURIComponent(process.env.DEMO_HOTEL_PASSWORD));
    req.end();
  });

  const paths = ['/hotel', '/hotel/analytics', '/hotel/statement?month=2026-10', '/hotel/email-preview', '/hotel/bookings.csv'];
  for (const p of paths) {
    const res = await get(port, p, { Cookie: login });
    assert.strictEqual(res.status, 200, p);
    let text = res.body.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/style="[^"]*"/gi, '');
    if (p.endsWith('.csv')) text = res.body;
    assert.ok(!banned.test(text), `${p} must not mention gross, revenue, % or split`);
  }

  const hotelSources = ['server.js', 'hotelMail.js', 'analytics.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8'));
  for (const src of hotelSources) {
    assert.ok(!/\bGross sales\b/.test(src), 'no Gross sales label in hotel source');
    assert.ok(!/\bGross revenue\b/.test(src), 'no Gross revenue label in hotel source');
  }

  server.kill('SIGTERM');
  console.log('hotel-gross-ban-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});