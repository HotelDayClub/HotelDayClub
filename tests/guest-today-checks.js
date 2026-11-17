const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { guestSiteDateBounds } = require('../calendar');

const root = path.join(__dirname, '..');
const pinned = new Date('2026-11-16T21:30:00.000Z');

const bounds = guestSiteDateBounds(pinned);
assert.strictEqual(bounds.min, '2026-11-17', 'Sydney morning uses local today, not UTC yesterday');
assert.strictEqual(bounds.max, '2027-02-15', 'max is min + 90 days');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: '',
        ADMIN_PASSWORD: 'gt-admin',
        DEMO_HOTEL_PASSWORD: 'gt-hotel',
        HDC_NOW: '2026-11-16T21:30:00.000Z',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('timeout\n' + log)), 25000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-gt-'));
const port = 3840 + Math.floor(Math.random() * 40);

(async () => {
  const child = await start(port);
  try {
    const home = (await get(port, '/')).body;
    assert.ok(home.includes(`min="${bounds.min}"`), 'home date min');
    assert.ok(home.includes(`max="${bounds.max}"`), 'home date max');
    const search = (await get(port, '/search')).body;
    assert.ok(search.includes(`min="${bounds.min}"`), 'search date min');
    assert.ok(search.includes(`max="${bounds.max}"`), 'search date max');
  } finally {
    child.kill('SIGTERM');
  }
  console.log('guest-today-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});