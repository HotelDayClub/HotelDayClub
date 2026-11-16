// Booking sheet hours follow the season for the date picked by tapping the calendar.
// Clocks are pinned with HDC_NOW so 15 Dec and 15 June both sit inside the 90-day window.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

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

function startServer(port, dbPath, now) {
  const env = { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', HDC_NOW: now };
  delete env.HDC_DEMO_TODAY;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
  });
}

const CASES = [
  { now: '2026-11-05T01:00:00.000Z', date: '2026-12-15', month: 'December 2026', hours: 'Hours 8am\u20137pm' },
  { now: '2027-04-06T01:00:00.000Z', date: '2027-06-15', month: 'June 2027', hours: 'Hours 9am\u20136pm' },
];

(async () => {
  const WS = socketCtor();
  const bin = chromeBin();
  if (!WS || !bin) {
    if (process.env.CI) throw new Error('Chrome is required in CI for the season sheet check');
    console.log('season sheet: browser check skipped (no WebSocket/Chrome)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-season-sheet-'));
  const debugPort = 9351;
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(dir, 'chrome')}`, 'about:blank',
  ], { stdio: 'ignore' });
  let session;
  let server;
  try {
    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    session = await cdp(WS, version.webSocketDebuggerUrl);
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => session.send(method, params, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [i, c] of CASES.entries()) {
      const port = 3365 + i;
      server = await startServer(port, path.join(dir, `daypass-${i}.db`), c.now);
      for (const [width, height] of [[390, 844], [1440, 900]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
        await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/harbourside-lido?pass=lounger&qty=1` });
        await new Promise(r => setTimeout(r, 1200));
        const res = await send('Runtime.evaluate', {
          awaitPromise: true,
          returnByValue: true,
          expression: `(async () => {
            const wait = ms => new Promise(r => setTimeout(r, ms));
            const btn = [...document.querySelectorAll('.d2-bar-btn, .d2-bookbar .d2-btn')].find(el => el.getBoundingClientRect().height > 0);
            if (btn) btn.click();
            await wait(500);
            const sheet = document.getElementById('d2-sheet');
            const hrs = () => sheet && sheet.querySelector('#d2-hrs');
            const before = hrs() ? { hidden: hrs().hidden, text: hrs().textContent } : null;
            document.getElementById('d2-more').click();
            await wait(300);
            const cal = document.getElementById('d2-calbox');
            for (let n = 0; n < 12 && !(cal.querySelector('b') && cal.querySelector('b').textContent.includes(${JSON.stringify(c.month)})); n++) {
              cal.querySelector('[data-nav="1"]').click();
              await wait(150);
            }
            const day = cal.querySelector('.cd[data-date=${JSON.stringify(c.date)}]');
            if (day) day.click();
            await wait(700);
            const el = hrs();
            return {
              open: !!(sheet && sheet.open),
              month: cal.querySelector('b') ? cal.querySelector('b').textContent : '',
              found: !!day,
              before,
              inSheet: !!(el && sheet.contains(el)),
              hidden: el ? el.hidden : true,
              shown: el ? el.getBoundingClientRect().height > 0 : false,
              text: el ? el.textContent.trim() : '',
              go: document.getElementById('d2-go').textContent.trim(),
            };
          })()`,
        });
        const v = res.result.value;
        const tag = `${c.date} at ${width}: ${JSON.stringify(v)}`;
        assert.ok(v.open && v.found, 'calendar reached the date ' + tag);
        assert.deepStrictEqual(v.before, { hidden: true, text: '' }, 'no hours before a date is picked ' + tag);
        assert.ok(v.inSheet && !v.hidden && v.shown, 'hours line shown inside the sheet ' + tag);
        assert.strictEqual(v.text, c.hours, 'season hours in the sheet ' + tag);
        assert.match(v.go, /^Book · \$[\d,.]+$/, 'Book label with price, no (demo) suffix ' + tag);
      }
      server.kill('SIGTERM');
      server = null;
      await new Promise(r => setTimeout(r, 300));
    }
    console.log('season sheet checks passed');
  } finally {
    if (session) session.ws.close();
    chrome.kill('SIGTERM');
    if (server) server.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
