const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'policy-fixes-needed.md'), 'utf8');
const privacyMd = fs.readFileSync(path.join(__dirname, '..', 'legal', 'privacy-policy.md'), 'utf8');

assert.ok(
  doc.includes('### 1. Payment provider (fixed in code, 17 Nov 2026)'),
  'policy-fixes item 1 marked fixed',
);
assert.ok(
  doc.includes('### 7. Two-factor authentication (fixed in code, 17 Nov 2026)'),
  'policy-fixes two-factor item marked fixed',
);
assert.ok(
  doc.includes('no longer mentions two-factor authentication'),
  'policy-fixes notes two-factor removed from privacy',
);
assert.ok(!privacyMd.includes('Stripe'), 'privacy markdown does not mention Stripe');
assert.ok(!privacyMd.toLowerCase().includes('two-factor'), 'privacy markdown does not mention two-factor');
assert.ok(privacyMd.includes('we do not take payment on this site yet'), 'privacy states demo payments');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function startServer(port, dbPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server timeout\n' + log)), 25000);
    child.stdout.on('data', c => {
      log += c;
      if (log.includes('Hotel Day Club demo')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-policy-'));
  const port = 3677 + Math.floor(Math.random() * 40);
  const child = await startServer(port, path.join(dir, 'policy.db'));
  try {
    const privacy = await get(port, '/privacy');
    assert.strictEqual(privacy.status, 200);
    assert.ok(!/two-factor/i.test(privacy.body), 'rendered /privacy must not mention two-factor');
    console.log('policy-fixes-checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});