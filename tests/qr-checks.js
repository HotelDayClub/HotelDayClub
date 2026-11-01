const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const { ymd, addDays } = require('../util');

process.env.QR_SECRET = 'qr-check-secret';
const { qrToken, codeFromQrToken } = require('../qr');

const code = 'HDC-QRPAGE1';
const token = qrToken(code);
assert.strictEqual(codeFromQrToken(token), code);
assert.strictEqual(qrToken(code), token);
const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
assert.strictEqual(codeFromQrToken(tampered), '');
assert.ok(!token.includes(code));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-qr-'));
const dbPath = path.join(dir, 'app.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
process.env.ADMIN_PASSWORD = 'qr-admin';
process.env.DEMO_HOTEL_PASSWORD = 'qr-hotel';
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const db = require('../db');
const { hashPassword } = require('../passwords');
const later = ymd(addDays(new Date(), 20));
const hotelId = db.prepare(`INSERT INTO hotels (slug, name, area, login, password, status, is_demo, timezone, state, photos)
  VALUES ('qr-pool', 'QR Hotel (Demo)', 'Brisbane', 'qr-pool', ?, 'active', 1, 'Australia/Brisbane', 'QLD', '[]')`).run(hashPassword('qr-hotel')).lastInsertRowid;
const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds, kind) VALUES (?, 'lounger', 'Sun lounger', 40, 10, 1, 'lounger')`).run(hotelId).lastInsertRowid;
function book(id, status) {
  db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, status)
    VALUES (?, ?, ?, ?, 1, 40, 40, 'Alex Citizen', 'alex@example.com', ?)`).run(id, hotelId, passId, later, status);
}
book(code, 'confirmed');
book('HDC-QRCANCEL', 'cancelled');
db.close();

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  const port = 3403;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      DATA_DIR: '',
      QR_SECRET: 'qr-check-secret',
      ADMIN_PASSWORD: 'qr-admin',
      DEMO_HOTEL_PASSWORD: 'qr-hotel',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', chunk => { log += chunk; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('exit', status => reject(new Error('server exited ' + status + '\n' + log)));
  });
  try {
    const urlPath = '/qr/' + token + '.png';
    assert.ok(!urlPath.includes(code));
    const image = await get(port, urlPath);
    assert.strictEqual(image.status, 200);
    assert.ok(String(image.headers['content-type']).includes('image/png'));
    assert.ok(String(image.headers['cache-control']).includes('immutable'));
    assert.ok(String(image.headers['x-robots-tag']).includes('noindex'));
    assert.ok(String(image.headers['content-disposition']).includes('inline'));
    const headerText = JSON.stringify(image.headers);
    assert.ok(!headerText.includes(code));
    assert.strictEqual(image.body[0], 0x89);
    assert.strictEqual(image.body[1], 0x50);
    assert.strictEqual(image.body[2], 0x4e);
    assert.strictEqual(image.body[3], 0x47);
    const png = PNG.sync.read(image.body);
    const hit = jsQR(Uint8ClampedArray.from(png.data), png.width, png.height);
    assert.ok(hit);
    assert.strictEqual(hit.data, 'https://www.hoteldayclub.com.au/hotel/checkin?code=' + code);

    const bad = await get(port, '/qr/' + tampered + '.png');
    assert.strictEqual(bad.status, 404);
    assert.strictEqual(bad.body.length, 0);

    const cancelledToken = qrToken('HDC-QRCANCEL');
    const cancelled = await get(port, '/qr/' + cancelledToken + '.png');
    assert.strictEqual(cancelled.status, 404);
    assert.strictEqual(cancelled.body.length, 0);

    const robots = await get(port, '/robots.txt');
    assert.ok(robots.body.toString().includes('Disallow: /qr/'));
    console.log('qr checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
