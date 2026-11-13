const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const phrase = ['Long', 'lunch'].join(' ');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'vendor') continue;
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const textExt = new Set(['.js', '.css', '.html', '.md']);
for (const file of walk(root)) {
  if (file.startsWith(path.join(root, 'tests'))) continue;
  if (!textExt.has(path.extname(file))) continue;
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.toLowerCase().includes(phrase.toLowerCase()), path.relative(root, file));
}

for (const rel of ['public/app.css', 'public/pickers.css', 'public/golden/site.css']) {
  const css = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.ok(!/#FF6B57/i.test(css), rel);
  assert.ok(!/#0A1428/i.test(css), rel);
}

const homeCss = fs.readFileSync(path.join(root, 'public/golden/home.css'), 'utf8');
const headerCss = fs.readFileSync(path.join(root, 'public/header.css'), 'utf8');
assert.ok(homeCss.includes('animation:force-in .01s .24s forwards'));
assert.ok(/@media\(max-width:600px\)\{[\s\S]*\.clock\{display:none\}/.test(homeCss));
assert.ok(homeCss.includes('.dest-go{margin-top:auto;font-size:14px;font-weight:600;text-decoration:underline;text-underline-offset:3px;color:var(--hdc-deep)}'));
assert.ok(headerCss.includes('.ftr-toggle{display:flex') && headerCss.includes('min-height:44px'));
assert.ok(headerCss.includes('aria-expanded="true"') || headerCss.includes('[aria-expanded="true"]'));
const whereRule = homeCss.match(/\.search \.seg:first-child \.pk-btn \.pk-txt\{[^}]*\}/);
assert.ok(whereRule, 'where segment text rule');
assert.ok(whereRule[0].includes('overflow:visible'));
assert.ok(whereRule[0].includes('text-overflow:clip'));
assert.ok(!whereRule[0].includes('ellipsis'));
assert.ok(homeCss.includes('#627377'));
assert.ok(fs.readFileSync(path.join(root, 'public/pickers.css'), 'utf8').includes('#627377'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-b8-'));
const dbPath = path.join(dir, 'daypass.db');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
function text(res) {
  const enc = res.headers['content-encoding'];
  if (enc === 'gzip') return zlib.gunzipSync(res.body).toString();
  if (enc === 'br') return zlib.brotliDecompressSync(res.body).toString();
  return res.body.toString();
}
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'b8-admin', DEMO_HOTEL_PASSWORD: 'b8-hotel', GA_MEASUREMENT_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 15000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

(async () => {
  const port = 3418;
  const child = await start(port);
  try {
    const home = text(await get(port, '/'));
    const footer = home.slice(home.indexOf('<footer'));
    const year = new Date().getFullYear();
    assert.ok(footer.includes(`© ${year} Hotel Day Club`));
    assert.ok(!/\bABN\b/i.test(footer));
    assert.ok(!/\d{2}\s?\d{3}\s?\d{3}\s?\d{3}/.test(footer));
    assert.ok(footer.includes('aria-expanded="false"'));
    assert.ok(footer.includes('aria-controls="ftr-dest"'));
    assert.ok((footer.match(/class="ftr-toggle"/g) || []).length === 3);
    assert.ok(home.includes('Demo site: listings are examples, no real bookings or payments.'));
    assert.ok(!home.includes('>Long lunch<'));
    assert.ok(home.includes('>Swim &amp; gym</button><button type="button" data-i="1" aria-pressed="false">Spa afternoon</button><button type="button" data-i="2" aria-pressed="false">Golden hour</button>'));

    const faq = text(await get(port, '/faq'));
    const faqMain = faq.slice(faq.indexOf('<main>'), faq.indexOf('<footer'));
    assert.ok(!/<details\b[^>]*\bopen\b/.test(faqMain), 'faq items start collapsed');
    assert.ok((faqMain.match(/<details\b/g) || []).length > 1);

    const listing = text(await get(port, '/h/saltwater-terrace'));
    assert.ok(listing.includes("location.hash!=='#details'"));
    assert.ok(listing.includes("getElementById('inclusions')"));
    assert.ok(listing.includes('hashchange'));
    assert.ok(listing.includes('replaceState'));
    assert.ok(listing.includes('id="inclusions"'));
    assert.ok(!listing.includes('id="details"'));
    const listingFooter = listing.slice(listing.indexOf('<footer'));
    assert.ok(listingFooter.includes(`© ${year} Hotel Day Club`));
    assert.ok(!/\bABN\b/i.test(listingFooter));
  } finally {
    child.kill();
  }
  console.log('b8 checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
