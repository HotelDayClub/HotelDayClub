const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const BUILD = 'deadbeefcafe';
process.env.RENDER_GIT_COMMIT = BUILD;
const { StaticAssets } = require('../staticAssets');

function localCssJsUrls(html) {
  const out = [];
  const re = /(?:href|src)=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (!url.startsWith('/') || url.startsWith('//')) continue;
    if (!/\.(?:css|js)(?:\?|"|#|$)/i.test(url)) continue;
    out.push(url);
  }
  return out;
}

function assertVersioned(url, ctx) {
  assert.ok(/[?&]v=/.test(url), ctx + ' missing v= on ' + url);
}

function get(port, pathName) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathName }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

(async () => {
  assert.strictEqual(StaticAssets.assetUrl('/app.css'), '/app.css?v=' + BUILD);
  assert.strictEqual(StaticAssets.assetUrl('/app.css?v=1'), '/app.css?v=1&v=' + BUILD);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-cache-'));
  const dbPath = path.join(dir, 'daypass.db');
  const port = 3710 + Math.floor(Math.random() * 200);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      DATA_DIR: '',
      RENDER_GIT_COMMIT: BUILD,
      ADMIN_PASSWORD: 'cache-admin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('server start\n' + log)), 25000);
      server.stdout.on('data', chunk => {
        log += chunk;
        if (log.includes('Hotel Day Club demo')) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.stderr.on('data', chunk => { log += chunk; });
    });
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => get(port, '/healthz').then(h => {
        if (h.status === 200) resolve();
        else if (Date.now() - started > 20000) reject(new Error('healthz'));
        else setTimeout(tick, 150);
      }).catch(() => {
        if (Date.now() - started > 20000) reject(new Error('healthz timeout'));
        else setTimeout(tick, 150);
      });
      tick();
    });

    const busted = await get(port, StaticAssets.assetUrl('/tokens.css'));
    assert.strictEqual(busted.status, 200, 'static with query');
    assert.match(busted.headers['cache-control'] || '', /max-age=86400/, 'css cache header');

    const listing = await get(port, '/h/skyline-rooftop');
    assert.strictEqual(listing.status, 200);
    const home = await get(port, '/');
    assert.strictEqual(home.status, 200);

    const paths = [
      '/',
      '/search',
      '/h/saltwater-terrace',
      '/how-it-works',
      '/for-hotels',
      '/guides/what-is-a-hotel-day-pass',
      '/faq',
    ];
    const checkoutPath = '/checkout?hotel=skyline-rooftop&date=2026-11-16&pass=chair&qty=1';
    const checkout = await get(port, checkoutPath);
    if (checkout.status === 200) paths.push(checkoutPath);

    for (const p of paths) {
      const doc = await get(port, p);
      assert.strictEqual(doc.status, 200, p);
      const urls = localCssJsUrls(doc.body);
      assert.ok(urls.length, p + ' has local css/js');
      for (const url of urls) {
        assertVersioned(url, p);
        assert.ok(url.includes('v=' + BUILD), p + ' build id ' + url);
      }
    }
    console.log('cache bust checks passed');
  } finally {
    server.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});