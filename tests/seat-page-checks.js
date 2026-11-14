const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
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
    const passes = db.prepare('SELECT h.slug, p.code FROM pass_types p JOIN hotels h ON h.id=p.hotel_id ORDER BY h.id, p.sort, p.id').all();
    db.close();
    assert.ok(passes.length >= 6);
    for (const pass of passes) {
      const res = await get(port, `/h/${pass.slug}/seat/${encodeURIComponent(pass.code)}`);
      assert.strictEqual(res.status, 301, `${pass.slug}/${pass.code}`);
      assert.strictEqual(res.headers.location, `/h/${pass.slug}?pass=${encodeURIComponent(pass.code)}#book`);
      const dated = await get(port, `/h/${pass.slug}/seat/${encodeURIComponent(pass.code)}?date=2026-12-01&qty=2&utm=x`);
      assert.strictEqual(dated.status, 301);
      assert.strictEqual(dated.headers.location, `/h/${pass.slug}?pass=${encodeURIComponent(pass.code)}&date=2026-12-01&qty=2#book`);
    }
    const unknownPass = await get(port, '/h/saltwater-terrace/seat/no-such-seat');
    assert.strictEqual(unknownPass.status, 301);
    assert.strictEqual(unknownPass.headers.location, '/h/saltwater-terrace#passes');
    const unknownHotel = await get(port, '/h/not-a-hotel/seat/lounger');
    assert.strictEqual(unknownHotel.status, 404);

    const landed = await get(port, '/h/saltwater-terrace?pass=daybed&qty=2');
    assert.strictEqual(landed.status, 200);
    assert.ok(/<input type="radio" name="pass" value="daybed"[^>]*\schecked>/.test(landed.body));
    assert.ok(/id="d2-qty"[^>]* value="2"/.test(landed.body));
    assert.ok(landed.body.includes('id="book"'));

    const robots = await get(port, '/robots.txt');
    assert.ok(!/\/seat\//.test(robots.body) || /Disallow/.test(robots.body));
    const sitemap = await get(port, '/sitemap.xml');
    assert.ok(!sitemap.body.includes('/seat/'), 'seat URLs are not in the sitemap');
  } finally {
    child.kill('SIGTERM');
  }
  console.log('seat page checks passed');
})().catch(err => { console.error(err); process.exit(1); });
