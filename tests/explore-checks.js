const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { FOOD_RULE } = require('../offering');
const { HotelExplore, saveExplore } = require('../hotelExplore');
const MAX_CARDS = 4;
const { HotelClock } = require('../calendar');

const sydneyMidnight = new Date('2026-11-16T13:30:00.000Z');
assert.strictEqual(HotelClock.today({ timezone: 'Australia/Sydney' }, sydneyMidnight), '2026-11-17');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-explore-'));
const dbPath = path.join(dir, 'daypass.db');
const root = path.join(__dirname, '..');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function post(port, urlPath, fields, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(fields).toString();
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

function start(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'explore-admin', DEMO_HOTEL_PASSWORD: 'explore-hotel', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 25000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const css = fs.readFileSync(path.join(root, 'public/listing-dir2.css'), 'utf8');
assert.ok(css.includes('scroll-snap-type:x mandatory'), 'explore horizontal snap');
assert.ok(css.includes('.d2-ex-row'), 'explore cards row');
const proofsJs = fs.readFileSync(path.join(root, 'scripts/capture-proofs.js'), 'utf8');
assert.ok(!/createElement\('style'\)|\.d2-book\{display:\s*block!important/.test(proofsJs), 'no proof style injection in capture-proofs.js');

(async () => {
  const port = 3344;
  const sydneyDb = path.join(dir, 'sydney.db');
  const sydneyChild = await start(port + 1, { DB_PATH: sydneyDb, HDC_NOW: '2026-11-16T13:30:00.000Z' });
  try {
    const search = await get(port + 1, '/search');
    assert.ok(search.body.includes('17 Nov'), 'search cards use Sydney date after midnight');
  } finally {
    sydneyChild.kill('SIGTERM');
  }

  const child = await start(port);
  try {
    const slugs = ['saltwater-terrace', 'skyline-rooftop', 'harbourside-lido', 'palm-court', 'manly-sands', 'bayview-spa'];
    for (const slug of slugs) {
      const res = await get(port, '/h/' + slug);
      assert.strictEqual(res.status, 200, slug);
      const body = res.body;
      assert.ok(body.includes('id="explore"'), slug + ' explore section');
      assert.ok(body.indexOf('id="passes"') < body.indexOf('id="explore"'), slug + ' order passes');
      assert.ok(body.indexOf('id="explore"') < body.indexOf('id="details"'), slug + ' order details');
      const cards = (body.match(/class="d2-ex-card"/g) || []).length;
      assert.ok(cards >= 3 && cards <= 4, slug + ' card count ' + cards);
      assert.ok(body.includes('Example hotel details (demo)'), slug + ' demo tag');
      assert.ok(body.includes('Stock photos'), slug + ' stock label');
      assert.ok(!body.includes('class="d2-ex-intro"'), slug + ' no explore intro paragraph');
      const exSlice = body.slice(body.indexOf('id="explore"'), body.indexOf('id="d2-explore-sheet"', body.indexOf('id="explore"')));
      assert.ok(!/A short look at/i.test(visibleText(exSlice)), slug + ' no long explore intro copy');
      assert.ok(!/[\u2605\u2606]|\/5|aggregateRating/.test(body), slug + ' no ratings');
      assert.ok(!visibleText(body).includes('\u2014'), slug + ' no em-dashes in explore');
      assert.ok(body.includes('data-open-explore'), slug + ' see details control');
      assert.ok(body.includes('id="d2-explore-sheet"'), slug + ' explore sheet');
    }

    const salt = await get(port, '/h/saltwater-terrace');
    assert.ok(salt.body.includes('href="#explore">Pool bar'), 'pool bar chip link');
    assert.ok(salt.body.includes('10am\u20134pm'), 'pool bar hours');
    assert.ok(salt.body.includes('class="d2-ex-chip">Not included</span>'), 'Not included chip');
    assert.strictEqual((salt.body.match(/class="d2-ex-card"/g) || []).length, 4, 'four explore cards');
    const sheetStart = salt.body.indexOf('id="d2-explore-sheet"');
    const sheetEnd = salt.body.indexOf('</dialog>', sheetStart);
    const sheet = salt.body.slice(sheetStart, sheetEnd > sheetStart ? sheetEnd : undefined);
    assert.ok(sheet.includes('Have a drink by the pool. Cocktails, coffee and light bites.'), 'pool bar copy');
    assert.strictEqual(sheet.split(FOOD_RULE).length - 1, 0, 'no food rule in explore sheet');
    assert.ok(sheet.includes('Lunch with a view'), 'restaurant card copy');
    assert.ok(sheet.includes('Where to check in'), 'check-in footer');
    assert.ok(salt.body.includes('loungers-snacks.jpg'), 'bar photo');

    const hdr = salt.body.slice(salt.body.indexOf('<header'), salt.body.indexOf('<main>'));
    const logoImgs = (hdr.match(/<img[^>]+alt="Hotel Day Club"/g) || []).length;
    assert.strictEqual(logoImgs, 1, 'one header logo on listing');
    assert.ok(hdr.includes('hdc-lockup-dark.svg'), 'dark lockup on listing');
    assert.ok(!hdr.includes('hdc-lockup-light.svg'), 'no light lockup on listing');

    const palm = await get(port, '/h/palm-court?pass=chair#book');
    assert.ok(palm.body.includes('resort-palms.jpg') || palm.body.includes('assets/photos/resort-palms'), 'palm chair photo');

    let chrome = '';
    try {
      for (const bin of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/local/bin/google-chrome']) {
        if (fs.existsSync(bin)) { chrome = bin; break; }
      }
      if (chrome) {
        const WebSocket = require('ws');
        const debugPort = 9420;
        const prof = path.join(dir, 'chrome-explore');
        const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 900));
        const list = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${debugPort}/json`, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
          }).on('error', reject);
        });
        const ws = new WebSocket(list[0].webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
        const send = (obj) => new Promise((resolve, reject) => {
          const id = Math.floor(Math.random() * 1e9);
          const handler = raw => {
            const msg = JSON.parse(raw);
            if (msg.id === id) { ws.removeListener('message', handler); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
          };
          ws.on('message', handler);
          ws.send(JSON.stringify({ ...obj, id }));
        });
        await send({ method: 'Page.enable' });
        await send({ method: 'Emulation.setDeviceMetricsOverride', params: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } });
        await send({ method: 'Page.navigate', params: { url: `http://localhost:${port}/h/saltwater-terrace` } });
        await new Promise(r => setTimeout(r, 2000));
        const tabs390 = await send({
          method: 'Runtime.evaluate',
          params: {
            expression: `(function(){window.scrollTo(0,0);var t=document.getElementById('d2-tabs');return t?t.getBoundingClientRect().top:9999})()`,
            returnByValue: true,
          },
        });
        const tabsBottom = await send({
          method: 'Runtime.evaluate',
          params: {
            expression: `(function(){var t=document.getElementById('d2-tabs');return t?t.getBoundingClientRect().bottom:0})()`,
            returnByValue: true,
          },
        });
        assert.ok(Number(tabs390.result.value) >= 0 && Number(tabs390.result.value) < 844, 'tabs on 390x844 first screen top: ' + tabs390.result.value);
        assert.ok(Number(tabsBottom.result.value) > 0 && Number(tabsBottom.result.value) <= 844, 'tabs on 390x844 first screen bottom: ' + tabsBottom.result.value);

        for (const phoneW of [360, 390]) {
          await send({ method: 'Emulation.setDeviceMetricsOverride', params: { width: phoneW, height: 844, deviceScaleFactor: 1, mobile: true } });
          await send({ method: 'Page.navigate', params: { url: `http://localhost:${port}/h/saltwater-terrace` } });
          await new Promise(r => setTimeout(r, 2000));
          await send({
            method: 'Runtime.evaluate',
            params: {
              expression: `window.scrollTo(0, document.getElementById('explore').offsetTop - 48)`,
              returnByValue: true,
            },
          });
          await new Promise(r => setTimeout(r, 400));
          const photoMetrics = await send({
            method: 'Runtime.evaluate',
            params: {
              expression: `(function(){
                var card = document.querySelector('#explore .d2-ex-card');
                if (!card) return { gap: 999, h: 999 };
                var media = card.querySelector('picture') || (card.firstElementChild && card.firstElementChild.tagName === 'IMG' ? card.firstElementChild : null);
                var h3 = card.querySelector('.d2-ex-body h3');
                if (!media || !h3) return { gap: 999, h: 999 };
                return {
                  gap: h3.getBoundingClientRect().top - media.getBoundingClientRect().bottom,
                  h: media.getBoundingClientRect().height,
                };
              })()`,
              returnByValue: true,
            },
          });
          const m = photoMetrics.result.value;
          assert.ok(Number(m.gap) < 24, 'explore card photo-title gap at ' + phoneW + ': ' + m.gap);
          assert.ok(Number(m.h) <= 240, 'explore card photo height at ' + phoneW + ': ' + m.h);
        }

        proc.kill('SIGTERM');
        ws.close();
      }
    } catch (err) {
      if (!process.env.CI) throw err;
    }

    const hotelLogin = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'explore-hotel' });
    assert.strictEqual(hotelLogin.status, 302);
    const hotelCookie = (hotelLogin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const Sqlite = require('better-sqlite3');
    const db = new Sqlite(dbPath);
    const hotelId = db.prepare("SELECT id FROM hotels WHERE slug='saltwater-terrace'").get().id;
    while (db.prepare('SELECT COUNT(*) AS n FROM hotel_explore_areas WHERE hotel_id=?').get(hotelId).n < MAX_CARDS) {
      const added = saveExplore(db, hotelId, { add: '1' });
      assert.ok(added.ok, 'add explore card');
    }
    const settingsRes = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/hotel/settings', headers: { Cookie: hotelCookie } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
    assert.strictEqual(settingsRes.status, 200);
    assert.ok(settingsRes.body.includes('id="explore-edit"'), 'explore admin form');
    assert.match(settingsRes.body, /<button[^>]*\bdisabled\b[^>]*name="add"[^>]*value="1"|<button[^>]*name="add"[^>]*value="1"[^>]*\bdisabled\b/, 'add card disabled at cap');
    const cardCount = (settingsRes.body.match(/class="explore-edit"/g) || []).length;
    assert.strictEqual(cardCount, MAX_CARDS, 'explore admin shows four cards');
    const fifth = saveExplore(db, hotelId, { add: '1' });
    assert.strictEqual(fifth.err, 'Up to 4 cards only.');

    saveExplore(db, hotelId, {
      about_intro: 'Intro',
      card_name: ['Escape test'],
      card_line: ['Line'],
      card_details: ['Details here.'],
      card_hours: ['10am\u20134pm'],
      card_photo: ['hero-loungers.jpg'],
      card_kind: ['pool'],
      card_id: [''],
    });
    const withIntro = await get(port, '/h/saltwater-terrace');
    assert.ok(!withIntro.body.includes('class="d2-ex-intro"'), 'explore intro hidden after DB update');
    assert.ok(!withIntro.body.includes('>Intro<'), 'intro copy not on listing');
    db.close();
  } finally {
    child.kill('SIGTERM');
  }
  console.log('explore checks passed');
})().catch(err => { console.error(err); process.exit(1); });