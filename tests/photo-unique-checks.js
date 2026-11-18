// Every rendered guest page: no photo source shown twice, and every demo slot uses the file in demoPhotos.js.
// Counts every <img> in the page HTML, without de-duplicating, after removing the mirror copies of a slot
// (gallery thumbs and lightbox, booking-panel pass tiles, Explore details sheet).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { sourceForSrc, sourceKey } = require('../photoSources');

const root = path.join(__dirname, '..');
const SLUGS = ['saltwater-terrace', 'skyline-rooftop', 'harbourside-lido', 'palm-court', 'manly-sands', 'bayview-spa'];
const DESTS = ['sydney', 'bondi', 'manly', 'north-sydney', 'eastern-suburbs', 'parramatta'];
const MIRRORS = [
  /<button type="button" class="g-thumb"[\s\S]*?<\/button>/g,
  /<dialog class="g-lb"[\s\S]*?<\/dialog>/g,
  /<label class="d2-pt[\s\S]*?<\/label>/g,
  /<li class="d2-ex-sheet-item">[\s\S]*?<\/li>/g,
  /<noscript>[\s\S]*?<\/noscript>/g,
];

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function tracked(src) {
  const raw = String(src || '').split('?')[0];
  if (/^\/golden\/img\/fh-(dashboard|checkin|guestlist)\./.test(raw)) return false; // product screenshots, not stock photos
  return raw.startsWith('/assets/photos/') || raw.startsWith('/golden/img/') || raw.startsWith('/photos/seats/');
}
function slotSrcs(html) {
  let body = html;
  for (const re of MIRRORS) body = body.replace(re, '');
  const out = [];
  const re = /<img[^>]+src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(body))) if (tracked(m[1])) out.push(m[1]);
  return out; // no Set: every slot counts
}
function fileOf(src) { return String(src).split('?')[0].split('/').pop().replace(/\.webp$/, '.jpg'); }
function assertPageUnique(label, html) {
  const srcs = slotSrcs(html);
  const seen = new Map();
  for (const src of srcs) {
    assert.ok(!/\/seats\//.test(src), `${label} uses a tropical seat fallback: ${src}`);
    assert.ok(!/rooftop-city/.test(src), `${label} shows rooftop-city (Dallas): ${src}`);
    const entry = sourceForSrc(src);
    assert.ok(entry, `${label} image missing photo-sources map: ${src}`);
    const k = sourceKey(entry);
    assert.ok(!seen.has(k), `${label} shows ${k} twice (${seen.get(k)} and ${src})`);
    seen.set(k, src);
  }
  return srcs;
}
function section(html, startRe, endRe) {
  const s = html.search(startRe);
  if (s < 0) return '';
  const rest = html.slice(s);
  const e = rest.search(endRe);
  return e < 0 ? rest : rest.slice(0, e);
}
function assertListingMap(slug, html, map) {
  let body = html;
  for (const re of MIRRORS) body = body.replace(re, '');
  const gallery = [...section(body, /<div class="g-track"/, /<\/div>/).matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => fileOf(m[1]));
  assert.deepStrictEqual(gallery, map.gallery, `${slug} gallery`);
  for (const [code, want] of Object.entries(map.passes)) {
    const card = (body.match(new RegExp(`<a class="d2-card[^"]*"[^>]*data-pass="${code}"[\\s\\S]*?</a>`)) || [''])[0];
    assert.ok(card, `${slug} pass ${code} card missing`);
    const img = card.match(/<img[^>]+src="([^"]+)"/);
    if (want) assert.strictEqual(img && fileOf(img[1]), want, `${slug} pass ${code}`);
    else {
      assert.ok(!img, `${slug} pass ${code} must have no photo`);
      assert.ok(card.includes('class="d2-noph"'), `${slug} pass ${code} no-photo tile`);
    }
  }
  const cards = [...body.matchAll(/<article class="d2-ex-card[^"]*"[\s\S]*?<\/article>/g)].map(m => m[0]);
  for (const [name, want] of Object.entries(map.explore)) {
    const card = cards.find(c => c.includes(`<h3>${name.replace('&', '&amp;')}</h3>`));
    assert.ok(card, `${slug} explore card ${name} missing`);
    const img = card.match(/<img[^>]+src="([^"]+)"/);
    if (want) assert.strictEqual(img && fileOf(img[1]), want, `${slug} explore ${name}`);
    else assert.ok(!img && card.includes('d2-ex-nophoto'), `${slug} explore ${name} must be a no-photo card`);
  }
}

(async () => {
  const { DEMO_PHOTOS } = require('../demoPhotos');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-photo-uniq-'));
  const port = 3820 + Math.floor(Math.random() * 120);
  const child = process.env.PHOTO_BASE_PORT ? null : spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'daypass.db'), DATA_DIR: '', ADMIN_PASSWORD: 'photo-uniq-admin', DEMO_HOTEL_PASSWORD: 'photo-uniq-hotel' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const P = process.env.PHOTO_BASE_PORT ? Number(process.env.PHOTO_BASE_PORT) : port;
  try {
    if (child) await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('server timeout')), 45000);
      child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', c => { log += c; });
    });
    const failures = [];
    const check = async (label, fn) => { try { await fn(); } catch (e) { failures.push(e.message); } };
    const date = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    for (const u of ['/', '/search', '/for-hotels', ...DESTS.map(d => '/destinations/' + d)]) {
      await check(u, async () => { const r = await get(P, u); assert.strictEqual(r.status, 200, u); assertPageUnique(u, r.body); });
    }
    await check('/ day slot', async () => {
      const r = await get(P, '/');
      assert.ok(!r.body.includes('Daybed by the pool'), '/ day slot still says Daybed by the pool');
    });
    for (const slug of SLUGS) {
      await check(slug, async () => {
        const r = await get(P, '/h/' + slug);
        assert.strictEqual(r.status, 200, slug);
        assertPageUnique('/h/' + slug, r.body);
        assertListingMap(slug, r.body, DEMO_PHOTOS[slug]);
      });
      for (const code of Object.keys(DEMO_PHOTOS[slug].passes)) {
        const u = `/checkout?hotel=${slug}&pass=${code}&date=${date}&qty=1`;
        await check(u, async () => { const r = await get(P, u); assertPageUnique(u, r.body); });
      }
    }
    if (failures.length) throw new Error('photo-unique-checks failed:\n- ' + failures.join('\n- '));
    console.log('photo-unique-checks passed');
  } finally {
    if (child) child.kill('SIGTERM');
  }
})().catch(err => { console.error(err.message || err); process.exit(1); });
