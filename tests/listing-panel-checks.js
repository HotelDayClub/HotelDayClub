const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { FREE_CANCEL } = require('../offering');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'listing-dir2.css'), 'utf8');
assert.match(css, /\.d2-side\{[^}]*display:block[^}]*sticky/s, 'desktop sticky aside');
assert.match(css, /\.js \.d2-side \.d2-book\{[^}]*display:block/i);
assert.ok(!/\.d2-bookbar\{[^}]*display:flex/.test(css), 'no teal desktop bookbar');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

(async () => {
  const port = 3741;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: '', ADMIN_PASSWORD: 'lp-admin', DEMO_HOTEL_PASSWORD: 'lp-hotel' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout\n' + log)), 25000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(t); resolve(); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
  try {
    const page = await get(port, '/h/saltwater-terrace?pass=lounger&qty=2');
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('class="d2-head"'), 'cream title block');
    assert.ok(!page.body.includes('d2-hero-copy'), 'no teal hero copy panel');
    assert.ok(page.body.includes('class="d2-facts"'), 'key facts row');
    assert.ok(page.body.includes('id="d2-side"'), 'sticky aside');
    assert.ok(page.body.includes('id="d2-sticky-from"'), 'sticky price');
    assert.ok(page.body.includes('>Reserve<'), 'Reserve CTA');
    assert.ok(page.body.includes('Total before extras'), 'total line');
    assert.ok(page.body.includes(FREE_CANCEL) || page.body.includes('Free cancellation until'), 'cancel qualifier');
    assert.ok(page.body.includes('Food and drink are not sold through Hotel Day Club. You buy and pay for them at the venue.'));
    assert.ok(page.body.includes('class="d2-sel"'), 'pass select control');
    const row = page.body.match(/href="([^"]+)"[^>]*data-pass="lounger"/);
    assert.ok(row && row[1].includes('pass=lounger'), 'no-JS row href keeps pass');
    assert.ok(page.body.includes('Pass hours'), 'pass hours box');
  } finally {
    child.kill('SIGTERM');
  }
  console.log('listing-panel-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});