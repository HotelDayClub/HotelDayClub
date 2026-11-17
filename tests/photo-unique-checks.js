const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { sourceForSrc, sourceKey } = require('../photoSources');

const root = path.join(__dirname, '..');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function trackedSrc(src) {
  const raw = String(src || '').split('?')[0].split('#')[0];
  return raw.startsWith('/assets/photos/')
    || raw.startsWith('/golden/img/')
    || raw.startsWith('/photos/seats/');
}

function visibleImageSrcs(html) {
  const out = [];
  const re = /<img[^>]+src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (src.startsWith('data:')) continue;
    if (!trackedSrc(src)) continue;
    out.push(src);
  }
  return [...new Set(out)];
}

function assertPageUnique(label, html) {
  const srcs = visibleImageSrcs(html);
  const seen = new Set();
  for (const src of srcs) {
    const entry = sourceForSrc(src);
    assert.ok(entry, `${label} image missing photo-sources map: ${src}`);
    const k = sourceKey(entry);
    assert.ok(!seen.has(k), `${label} duplicate source ${k} (${src})`);
    seen.add(k);
  }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-photo-uniq-'));
  const dbPath = path.join(dir, 'daypass.db');
  const port = 3820 + Math.floor(Math.random() * 120);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'photo-uniq-admin', DEMO_HOTEL_PASSWORD: 'photo-uniq-hotel' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('server timeout')), 45000);
      child.stdout.on('data', c => {
        log += c;
        if (log.includes('Hotel Day Club demo')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on('data', c => { log += c; });
    });
    const home = await get(port, '/');
    assert.strictEqual(home.status, 200);
    assertPageUnique('/', home.body);
    const slugs = ['saltwater-terrace', 'skyline-rooftop', 'harbourside-lido', 'palm-court', 'manly-sands', 'bayview-spa'];
    for (const slug of slugs) {
      const page = await get(port, '/h/' + slug);
      assert.strictEqual(page.status, 200, slug);
      assertPageUnique('/h/' + slug, page.body);
    }
    console.log('photo-unique-checks passed');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});