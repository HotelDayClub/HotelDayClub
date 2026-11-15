// Booking sheet on the D2 listing: the form inside the open sheet must render at every width.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ymd, addDays } = require('../util');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'listing-dir2.css'), 'utf8');

// Static check: the rule that shows the form in the open sheet must sit at the top level, not inside a media query.
function topLevelRules(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) out.push({ sel: text.slice(start, i).trim(), at: i });
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (ch === ';' && depth === 0) {
      start = i + 1;
    }
  }
  return out;
}
const showRule = topLevelRules(css.replace(/\/\*[\s\S]*?\*\//g, '')).find(r => /dialog\.d2-sheet\[open\] \.d2-book/.test(r.sel));
assert.ok(showRule, 'open sheet show rule is top level (not inside @media)');
assert.ok(/\.js dialog\.d2-sheet\[open\] \.d2-book/.test(showRule.sel), 'show rule beats .js .d2-book');
assert.ok(/\.js \.d2-book\{display:none\}/.test(css), 'inline form still hidden with JS');
const proofs = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'capture-proofs.js'), 'utf8');
assert.ok(!proofs.includes('proof-sheet-style'), 'proof script must not inject sheet CSS');
assert.ok(!/\.d2-book\{display:block!important/.test(proofs), 'proof script must not force the form visible');

function chromeBin() {
  for (const bin of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(bin)) return bin;
  }
  return '';
}
function socketCtor() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    const ws = require('ws');
    return ws.WebSocket || ws;
  } catch (err) {
    return null;
  }
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
async function waitJson(url) {
  const started = Date.now();
  for (;;) {
    try { return await getJson(url); } catch (err) {
      if (Date.now() - started > 20000) throw new Error('timeout ' + url);
      await new Promise(r => setTimeout(r, 200));
    }
  }
}
function cdp(WS, wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { ok, bad } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) bad(new Error(JSON.stringify(msg.error)));
      else ok(msg.result);
    });
    ws.addEventListener('open', () => resolve({
      ws,
      send(method, params = {}, sessionId) {
        return new Promise((ok, bad) => {
          const msgId = ++id;
          pending.set(msgId, { ok, bad });
          const msg = { id: msgId, method, params };
          if (sessionId) msg.sessionId = sessionId;
          ws.send(JSON.stringify(msg));
        });
      },
    }));
    ws.addEventListener('error', reject);
  });
}

(async () => {
  const WS = socketCtor();
  const bin = chromeBin();
  if (!WS || !bin) {
    if (process.env.CI) throw new Error('Chrome is required in CI for the booking sheet check');
    console.log('d2 sheet: static checks passed, browser check skipped (no WebSocket/Chrome)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-sheet-'));
  const port = 3533;
  const debugPort = 9343;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'daypass.db'), DATA_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(dir, 'chrome')}`, 'about:blank',
  ], { stdio: 'ignore' });
  let session;
  try {
    await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
      server.stdout.on('data', chunk => {
        log += chunk;
        if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(); }
      });
      server.stderr.on('data', chunk => { log += chunk; });
    });
    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    session = await cdp(WS, version.webSocketDebuggerUrl);
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => session.send(method, params, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [width, height] of [[360, 780], [390, 844], [768, 1024], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/saltwater-terrace` });
      await new Promise(r => setTimeout(r, 1200));
      await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = [...document.querySelectorAll('.d2-bar-btn, .d2-bookbar .d2-btn')].find(el => el.getBoundingClientRect().height > 0);
          if (btn) btn.click();
        })()`,
      });
      await new Promise(r => setTimeout(r, 600));
      const res = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const sheet = document.getElementById('d2-sheet');
          const book = document.getElementById('book');
          const go = document.getElementById('d2-go');
          const sb = sheet ? sheet.getBoundingClientRect() : null;
          const bb = book ? book.getBoundingClientRect() : null;
          const gb = go ? go.getBoundingClientRect() : null;
          return {
            open: !!(sheet && sheet.open),
            inSheet: !!(sheet && book && sheet.contains(book)),
            bookDisplay: book ? getComputedStyle(book).display : '',
            bookH: bb ? bb.height : 0,
            sheetH: sb ? sb.height : 0,
            goH: gb ? gb.height : 0,
            dates: document.querySelectorAll('#d2-sheet input[name="chip"]').length,
          };
        })()`,
      });
      const d = res.result.value;
      assert.ok(d.open && d.inSheet, width + ' sheet open with form ' + JSON.stringify(d));
      assert.strictEqual(d.bookDisplay, 'block', width + ' form display ' + JSON.stringify(d));
      assert.ok(d.bookH > 300, width + ' form height ' + JSON.stringify(d));
      assert.ok(d.sheetH > 300, width + ' sheet height ' + JSON.stringify(d));
      assert.ok(d.goH >= 44, width + ' Book button visible ' + JSON.stringify(d));
      assert.ok(d.dates >= 7, width + ' date chips ' + JSON.stringify(d));
      console.log(width + ' booking sheet form ' + Math.round(d.bookH) + 'px');
    }

    const when = ymd(addDays(new Date(), 14));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/saltwater-terrace?pass=lounger&date=${when}&qty=1#book` });
    await new Promise(r => setTimeout(r, 1400));
    await send('Runtime.evaluate', {
      expression: `(() => {
        const sheet = document.getElementById('d2-sheet');
        if (sheet && !sheet.open) {
          const btn = [...document.querySelectorAll('.d2-bar-btn, .d2-bookbar .d2-btn')].find(el => el.getBoundingClientRect().height > 0);
          if (btn) btn.click();
        }
      })()`,
    });
    await new Promise(r => setTimeout(r, 700));
    const trim = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const passes = [...document.querySelectorAll('#d2-form .d2-pt')];
        const dateRow = document.querySelector('.d2-labrow > span');
        const go = document.getElementById('d2-go');
        return {
          fitLine: !!document.getElementById('d2-fit'),
          summary: !!document.querySelector('.d2-tot'),
          dateText: dateRow ? dateRow.textContent.trim() : '',
          dateHasHours: dateRow ? /hotel time|\\d+am|\\d+pm/i.test(dateRow.textContent) : true,
          fitsOnCards: passes.length >= 3 && passes.every(el => /Fits \\d+/.test(el.textContent)),
          passCount: passes.length,
          bookLabel: go ? go.textContent.trim() : '',
        };
      })()`,
    });
    const t = trim.result.value;
    assert.ok(!t.fitLine, 'no Fits line under pass cards');
    assert.ok(!t.summary, 'no summary above Book');
    assert.strictEqual(t.dateText, 'Date', 'Date label without hours ' + t.dateText);
    assert.ok(!t.dateHasHours, 'no hours next to Date');
    assert.ok(t.fitsOnCards, 'Fits N on every pass card: ' + t.passCount);
    assert.match(t.bookLabel, /^Book · \$[\d,.]+ \(demo\)$/, 'Book label shows pass total');

  const bookLive = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const go = document.getElementById('d2-go');
        const lounger = document.querySelector('input[name="pass"][value="lounger"]');
        const daybed = document.querySelector('input[name="pass"][value="daybed"]');
        const plus = document.getElementById('d2-qplus');
        if (lounger) {
          lounger.click();
          lounger.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 250));
        const one = go ? go.textContent.trim() : '';
        if (plus) {
          plus.click();
          await new Promise(r => setTimeout(r, 250));
        }
        const two = go ? go.textContent.trim() : '';
        if (daybed) {
          daybed.click();
          daybed.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 250));
        }
        const other = go ? go.textContent.trim() : '';
        return { one, two, other };
      })()`,
    });
    const live = bookLive.result.value;
    assert.match(live.one, /^Book · \$/, 'Book label with one spot');
    assert.match(live.two, /^Book · \$/, 'Book label with two spots');
    assert.notStrictEqual(live.one, live.two, 'Book label updates when spots change');
    if (live.other) assert.notStrictEqual(live.one, live.other, 'Book label updates when pass changes');

    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/skyline-rooftop` });
    await new Promise(r => setTimeout(r, 1200));
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = [...document.querySelectorAll('.d2-bar-btn, .d2-bookbar .d2-btn')].find(el => el.getBoundingClientRect().height > 0);
        if (btn) btn.click();
      })()`,
    });
    await new Promise(r => setTimeout(r, 700));
    const closedRes = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        return [...document.querySelectorAll('#d2-form .d2-d.cl, #d2-sheet .d2-d.cl')].map(el => ({
          disabled: el.getAttribute('aria-disabled') === 'true',
          label: el.getAttribute('aria-label') || '',
          visibleClosed: /\\bClosed\\b/.test(el.textContent.trim()),
        }));
      })()`,
    });
    const closedChips = closedRes.result.value || [];
    assert.ok(closedChips.length > 0, 'skyline has closed day chips');
    for (const chip of closedChips) {
      assert.ok(chip.disabled, 'closed chip disabled');
      assert.ok(/, closed$/i.test(chip.label), 'closed chip aria-label: ' + chip.label);
      assert.ok(!chip.visibleClosed, 'no visible Closed text on chip');
    }

    console.log('d2 sheet checks passed');
  } finally {
    if (session) session.ws.close();
    chrome.kill('SIGTERM');
    server.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
