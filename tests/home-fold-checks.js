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

function waitFor(url) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(url, res => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (Date.now() - started > 20000) reject(new Error('timeout ' + url));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function cdp(WS, wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { resolve: ok, reject: bad } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) bad(new Error(JSON.stringify(msg.error)));
      else ok(msg.result);
    });
    ws.addEventListener('open', () => {
      resolve({
        ws,
        send(method, params = {}, sessionId) {
          return new Promise((ok, bad) => {
            const msgId = ++id;
            pending.set(msgId, { resolve: ok, reject: bad });
            const msg = { id: msgId, method, params };
            if (sessionId) msg.sessionId = sessionId;
            ws.send(JSON.stringify(msg));
          });
        },
      });
    });
    ws.addEventListener('error', reject);
  });
}

(async () => {
  const WS = socketCtor();
  const bin = chromeBin();
  if (!WS || !bin) {
    console.log('skipped: no WebSocket/Chrome');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-fold-'));
  const dbPath = path.join(dir, 'daypass.db');
  const port = 3521;
  const debugPort = 9333;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(dir, 'chrome')}`,
    'about:blank',
  ], { stdio: 'ignore' });
  let session;
  try {
    await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
      server.stdout.on('data', chunk => {
        log += chunk;
        if (log.includes('Hotel Day Club demo')) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.stderr.on('data', chunk => { log += chunk; });
    });
    await waitFor(`http://127.0.0.1:${debugPort}/json/version`);
    const version = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${debugPort}/json/version`, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      }).on('error', reject);
    });
    session = await cdp(WS, version.webSocketDebuggerUrl);
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => session.send(method, params, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [width, height] of [[360, 844], [390, 844], [1280, 800]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
      await new Promise(resolve => setTimeout(resolve, 1200));
      const result = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const card = document.querySelector('#explore .ex');
          const box = card.getBoundingClientRect();
          const button = document.querySelector('.search button[type="submit"]').getBoundingClientRect();
          const fields = [...document.querySelectorAll('.search .pk-txt')].map(el => ({
            text: el.textContent.trim(),
            clipped: el.scrollWidth > el.clientWidth + 1,
          }));
          const helpers = [...document.querySelectorAll('.assure span')].map(el => ({
            text: el.textContent.trim(),
            clipped: el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 1,
          }));
          return {
            top: box.top,
            inner: window.innerHeight,
            scroll: document.documentElement.scrollWidth,
            width: window.innerWidth,
            button: Math.min(button.width, button.height),
            fields,
            helpers,
          };
        })()`,
      });
      const data = result.result.value;
      assert.ok(data.scroll <= data.width, width + ' sideways scroll ' + data.scroll);
      assert.ok(data.button >= 44, width + ' search button ' + data.button);
      for (const field of data.fields) assert.ok(!field.clipped, width + ' clipped field ' + field.text);
      assert.ok(data.fields.some(field => field.text === 'All of Australia'), width + ' where');
      assert.ok(data.fields.some(field => field.text === 'Any day'), width + ' when');
      for (const helper of data.helpers) assert.ok(!helper.clipped, width + ' clipped helper ' + helper.text);
      if (width !== 360) assert.ok(data.top < data.inner, width + ' first card top ' + data.top + ' is below ' + data.inner);
      console.log(width + 'x' + height + ' card top ' + Math.round(data.top) + ' of ' + data.inner);
    }
    console.log('home fold checks passed');
  } finally {
    if (session) session.ws.close();
    chrome.kill('SIGTERM');
    server.kill('SIGTERM');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
