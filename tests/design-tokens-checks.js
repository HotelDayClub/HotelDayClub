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
];
const radiusStrict = new Set(['public/base.css', 'public/search.css', 'public/listing-dir2.css', 'public/help-centre.css']);
const tokenCss = fs.readFileSync(path.join(root, 'public/tokens.css'), 'utf8');
const brand = require('../brand');
const tokenHexes = new Set([...tokenCss.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map(m => m[0].toLowerCase()));
for (const hex of Object.values(brand)) tokenHexes.add(hex.toLowerCase());
['#fff', '#ffffff', '#000', '#000000', '#cfe0ee', '#dde3ec', '#d5dce8', '#243044', '#5a6478', '#c4b5a4',
  '#d0d5dd', '#e7eef5', '#e6f8f8', '#0b7f89', '#fff6e8', '#f5d7a1', '#fff1ef', '#f4f1ec', '#3c4a59',
  '#5c6b7a', '#f6efe6', '#546672', '#ffd0dc', '#ff7d6c', '#ffb5a3', '#8a3b12', '#fff1e4', '#627377',
  '#8a9a9f', '#8fb6b4', '#f3d5dc'].forEach(h => tokenHexes.add(h));

function walkCss(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) walkCss(abs, out);
    else if (name.endsWith('.css')) out.push(abs);
  }
  return out;
}

for (const rel of guestCss) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.ok(!/#0[Bb]2545/.test(text), rel + ' must not use #0B2545');
}

for (const rel of guestCss) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!radiusStrict.has(rel)) continue;
  for (const rule of text.match(/border-radius:\s*[^;]+/g) || []) {
    const val = rule.replace(/border-radius:\s*/, '').trim();
    if (val.includes('var(')) continue;
    for (const part of val.split(/\s+/)) {
      const num = parseFloat(part);
      if (!Number.isFinite(num)) continue;
      assert.ok([0, 2, 12, 20, 50, 99, 999].includes(num) || part === '50%', `${rel} border-radius ${val}`);
    }
  }
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    }).on('error', reject);
  });
}
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'app.db'), DATA_DIR: '', ADMIN_PASSWORD: 'dt-admin', DEMO_HOTEL_PASSWORD: 'dt-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('timeout\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-dt-'));
const port = 3820 + Math.floor(Math.random() * 40);

(async () => {
  const child = await start(port);
  try {
    const paths = ['/', '/search', '/h/saltwater-terrace', '/for-hotels', '/how-it-works', '/faq'];
    for (const p of paths) {
      const html = await get(port, p);
      assert.ok(html.includes('/base.css'), p + ' loads base.css');
      assert.ok(!html.includes('/styles.css'), p + ' must not load styles.css');
      assert.ok(!html.includes('/app.css'), p + ' must not load app.css');
      assert.ok(!html.includes('/golden/site.css'), p + ' must not load site.css');
      const hdr = html.match(/<header class="hdr"[\s\S]*?<\/header>/);
      assert.ok(hdr, p + ' header');
      assert.ok(html.includes('class="wrap'), p + ' wrap');
    }
  } finally {
    child.kill('SIGTERM');
  }
  console.log('design-tokens-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});