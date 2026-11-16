const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { galleryHtml } = require('../listingDir2');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'listing-dir2.css'), 'utf8');

assert.match(
  css,
  /html:not\(\[data-n="1"\]\):not\(\[data-n="2"\]\):not\(\[data-n="3"\]\) \.d2 \.g-all/s,
  'four-plus gallery overlays show-all on last thumb',
);

function demoHotel(photos) {
  return {
    slug: 'gallery-test',
    name: 'Gallery Test',
    is_demo: 1,
    photos,
    age_policy: 'All ages',
    setting: 'outdoor',
    heated: 1,
  };
}

for (const n of [2, 3, 4, 5]) {
  const html = galleryHtml(demoHotel(Array.from({ length: n }, (_, i) => `photo-${i}.jpg`)), null);
  assert.ok(html.includes('id="g-all"') && html.includes('Show all photos'), `show-all control for n=${n}`);
  assert.strictEqual((html.match(/class="g-thumb"/g) || []).length, Math.min(3, n - 1), `thumb count n=${n}`);
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function factItems(html) {
  const block = html.match(/<ul class="d2-facts"[^>]*>([\s\S]*?)<\/ul>/);
  if (!block) return [];
  return block[1].match(/<li>/g) || [];
}

const SEEDS = [
  'saltwater-terrace',
  'skyline-rooftop',
  'harbourside-lido',
  'palm-court',
  'manly-sands',
  'bayview-spa',
];

function socketCtor() {
  try {
    return require('ws');
  } catch {
    return null;
  }
}

function chromeBin() {
  const list = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const b of list) if (fs.existsSync(b)) return b;
  return null;
}

function waitJson(url, n = 0) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          if (n < 40) setTimeout(() => waitJson(url, n + 1).then(resolve, reject), 250);
          else reject(e);
        }
      });
    }).on('error', err => {
      if (n < 40) setTimeout(() => waitJson(url, n + 1).then(resolve, reject), 250);
      else reject(err);
    });
  });
}

function cdp(WS, url) {
  return new Promise((resolve, reject) => {
    const ws = new WS(url);
    const pending = new Map();
    let seq = 1;
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
    });
    ws.on('error', reject);
    ws.on('open', () => {
      resolve({
        ws,
        send(method, params = {}, sid) {
          const id = seq++;
          return new Promise((res, rej) => {
            pending.set(id, msg => (msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)));
            ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
          });
        },
      });
    });
  });
}

async function assertGalleryPill(port, slug, anchor, needIntersect) {
  const WS = socketCtor();
  const bin = chromeBin();
  if (!WS || !bin) return;
  const debugPort = 9358;
  const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-pgf-chrome-'));
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(chromeDir, 'chrome')}`, 'about:blank',
  ], { stdio: 'ignore' });
  let session;
  try {
    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    session = await cdp(WS, version.webSocketDebuggerUrl);
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => session.send(method, params, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/${slug}` });
    await new Promise(r => setTimeout(r, 1600));
    const res = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const n = Number(document.documentElement.getAttribute('data-n')) || 0;
        const all = document.getElementById('g-all');
        if (!all) return { n, ok: false, why: 'no g-all' };
        const anchorSel = ${JSON.stringify(anchor)};
        const host = anchorSel === 'track'
          ? document.getElementById('g-track')
          : document.querySelector('.g-thumb[data-i="' + anchorSel + '"]');
        if (!host) return { n, ok: false, why: 'no host ' + anchorSel };
        const ab = all.getBoundingClientRect();
        const hb = host.getBoundingClientRect();
        const pillNotTile = ab.width >= 44 && ab.height >= 40
          && !(ab.width > hb.width * 0.92 && ab.height > hb.height * 0.92);
        const intersects = pillNotTile
          && ab.right > hb.left + 8 && ab.left < hb.right - 8
          && ab.bottom > hb.top + 8 && ab.top < hb.bottom - 8;
        const grid = document.querySelector('.g-grid');
        const kids = grid ? [...grid.children].filter(el => {
          const cs = getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && el.classList.contains('g-all') === false;
        }) : [];
        let emptyTile = false;
        for (const el of kids) {
          const b = el.getBoundingClientRect();
          if (b.width < 8 || b.height < 8) continue;
          const hasPhoto = el.querySelector('img, picture');
          const isTrack = el.id === 'g-track';
          if (!hasPhoto && !isTrack && !el.classList.contains('d2-pill') && el.id !== 'g-count') emptyTile = true;
        }
        return {
          n,
          pillNotTile,
          intersects,
          emptyTile,
          allW: Math.round(ab.width),
          hostW: Math.round(hb.width),
          allH: Math.round(ab.height),
        };
      })()`,
    });
    const v = res.result.value;
    assert.ok(v.pillNotTile, `${slug} show-all is a pill not a tile: ` + JSON.stringify(v));
    if (needIntersect) assert.ok(v.intersects, `${slug} pill on photo (${anchor}): ` + JSON.stringify(v));
    assert.ok(!v.emptyTile, `${slug} no empty gallery tile: ` + JSON.stringify(v));
  } finally {
    if (session) session.ws.close();
    chrome.kill('SIGTERM');
  }
}

(async () => {
  const port = 3748;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: '', ADMIN_PASSWORD: 'pgf-admin', DEMO_HOTEL_PASSWORD: 'pgf-hotel' },
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
    for (const slug of SEEDS) {
      const page = await get(port, `/h/${slug}`);
      assert.strictEqual(page.status, 200, slug);
      assert.strictEqual(factItems(page.body).length, 4, `${slug} renders four key facts`);
      if (slug === 'harbourside-lido') {
        assert.ok(page.body.includes('d2-fact-val'), 'harbourside facility fact');
        assert.ok(
          /Heated indoor pool|Indoor heated pool/i.test(page.body),
          'harbourside main facility from listing data',
        );
      }
    }
    const galleryCases = [
      ['palm-court', 'track', false],
      ['harbourside-lido', '3', true],
      ['saltwater-terrace', '3', true],
      ['manly-sands', '3', true],
      ['skyline-rooftop', '3', true],
    ];
    for (const [slug, anchor, needIntersect] of galleryCases) {
      try {
        await assertGalleryPill(port, slug, anchor, needIntersect);
      } catch (e) {
        if (!chromeBin() || !socketCtor()) {
          console.log('phase2-gallery-facts: browser overlay check skipped (no Chrome)');
          break;
        }
        throw e;
      }
    }
  } finally {
    child.kill('SIGTERM');
  }
  console.log('phase2-gallery-facts-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});