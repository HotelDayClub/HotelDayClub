// Chrome layout smoke tests: pass-row height and desktop search cards (B1-38).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

function chromeBin() {
  for (const bin of ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
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
  const limit = process.env.CI ? 60000 : 20000;
  for (;;) {
    try { return await getJson(url); } catch (err) {
      if (Date.now() - started > limit) throw new Error('timeout ' + url);
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
    if (process.env.CI) throw new Error('Chrome is required in CI for layout checks');
    console.log('layout-checks: skipped (no WebSocket/Chrome)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-layout-'));
  const port = 3544;
  const debugPort = 9354;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'daypass.db'), DATA_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check',
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

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/harbourside-lido` });
    await new Promise(r => setTimeout(r, 1500));
    const passRow = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const card = document.querySelector('html.pass-b .d2-card.d2-row, .d2-card.d2-row');
        const r = card ? card.getBoundingClientRect() : null;
        return { h: r ? r.height : 0, wide: matchMedia('(min-width:1024px)').matches };
      })()`,
    });
    const pr = passRow.result.value;
    assert.ok(pr.wide, 'pass-b desktop width');
    assert.ok(pr.h > 80 && pr.h <= 180, 'pass row card height ' + pr.h);

    await send('Page.navigate', { url: `http://127.0.0.1:${port}/search?area=Eastern+Beaches&mood=pool` });
    await new Promise(r => setTimeout(r, 1500));
    const searchCard = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const card = document.querySelector('.search-page a.ex');
        const r = card ? card.getBoundingClientRect() : null;
        return { h: r ? r.height : 0 };
      })()`,
    });
    const sc = searchCard.result.value;
    assert.ok(sc.h > 60 && sc.h <= 145, 'search result card height ' + sc.h);

    console.log('layout-checks passed (pass ' + Math.round(pr.h) + 'px, search ' + Math.round(sc.h) + 'px)');
  } finally {
    try { session && session.ws.close(); } catch (err) { /* ignore */ }
    chrome.kill('SIGTERM');
    server.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});