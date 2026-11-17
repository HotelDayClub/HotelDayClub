// Layout regression: confirmation stub, home, checkout, for-hotels (B1-38).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

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
  for (;;) {
    try { return await getJson(url); } catch (err) {
      if (Date.now() - started > 60000) throw new Error('timeout ' + url);
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
    if (process.env.CI) throw new Error('Chrome is required in CI for layout-regression-checks');
    console.log('layout-regression-checks: skipped (no WebSocket/Chrome)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-layout-reg-'));
  const port = 3551;
  const debugPort = 9361;
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
      const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 30000);
      server.stdout.on('data', chunk => {
        log += chunk;
        if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(); }
      });
      server.stderr.on('data', chunk => { log += chunk; });
    });
    const db = new Database(path.join(dir, 'daypass.db'), { readonly: true });
    const code = db.prepare("SELECT code FROM bookings WHERE status!='cancelled' ORDER BY id LIMIT 1").get();
    db.close();
    assert.ok(code && code.code, 'need a booking for confirmation layout');
    const bookUrl = `http://127.0.0.1:${port}/booking/${encodeURIComponent(code.code)}`;

    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    session = await cdp(WS, version.webSocketDebuggerUrl);
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => session.send(method, params, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');

    const ticketExpr = `(() => {
      const ticket = document.querySelector('.tk-ticket');
      const stub = document.querySelector('.tk-stub');
      const qr = document.querySelector('.tk-qrbox');
      const lbl = document.querySelector('.tk-stub-lbl');
      if (!ticket || !stub) return { ok: false, why: 'missing ticket or stub' };
      const t = ticket.getBoundingClientRect();
      const s = stub.getBoundingClientRect();
      const q = qr ? qr.getBoundingClientRect() : { width: 0 };
      return {
        ok: s.right <= t.right + 2 && s.left >= t.left && q.width >= 120,
        stubW: Math.round(s.width),
        qrW: Math.round(q.width),
        ticketR: Math.round(t.right),
        stubR: Math.round(s.right),
        label: lbl ? lbl.textContent.trim() : '',
      };
    })()`;

    for (const [width, height] of [[390, 844], [1024, 768], [1280, 900], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
      await send('Page.navigate', { url: bookUrl });
      await new Promise(r => setTimeout(r, 1200));
      const res = await send('Runtime.evaluate', { returnByValue: true, expression: ticketExpr });
      const v = res.result.value;
      assert.ok(v.ok, `stub inside ticket ${width}x${height} ` + JSON.stringify(v));
      if (width >= 1024) assert.strictEqual(v.label, 'SHOW AT RECEPTION', 'stub label ' + width);
    }

    for (const [path, width, height] of [['/', 390, 844], ['/', 1440, 900], ['/for-hotels', 390, 844], ['/for-hotels', 1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
      await send('Page.navigate', { url: `http://127.0.0.1:${port}${path}` });
      await new Promise(r => setTimeout(r, 1000));
      const res = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }))()`,
      });
      const v = res.result.value;
      assert.ok(v.sw <= v.vw + 2, `${path} ${width} horizontal overflow ${v.sw} > ${v.vw}`);
    }

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/saltwater-terrace` });
    await new Promise(r => setTimeout(r, 1200));
    const checkout = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth, hasTk: !!document.querySelector('.d2-book') }))()`,
    });
    const c = checkout.result.value;
    assert.ok(c.sw <= c.vw + 2, 'listing checkout width');

    console.log('layout-regression-checks passed');
  } finally {
    try { session && session.ws.close(); } catch (err) { /* ignore */ }
    chrome.kill('SIGTERM');
    server.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});