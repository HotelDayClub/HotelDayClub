const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

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
      env: { ...process.env, PORT: String(port), DATA_DIR: '', ADMIN_PASSWORD: 'about-admin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('timeout\n' + log)), 25000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

const port = 3840 + Math.floor(Math.random() * 40);

(async () => {
  const child = await start(port);
  try {
    const page = await get(port, '/about');
    assert.strictEqual(page.status, 200);
    const prose = page.body.replace(/<footer[\s\S]*/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    assert.ok(prose.includes('founding hotels'));
    assert.ok(prose.includes('Australia'));
    assert.ok(!/\bcommission\b/i.test(prose));
    assert.ok(!/\u2014/.test(prose));
    assert.ok(!/Jason/i.test(prose));
    assert.ok(page.body.includes('href="/about"'));
    const home = await get(port, '/');
    assert.ok(home.body.includes('href="/about"'), 'footer About link');
    const map = await get(port, '/sitemap.xml');
    assert.ok(map.body.includes('/about'), 'sitemap');
    console.log('about checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});