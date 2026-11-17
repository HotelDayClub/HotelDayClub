const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const polish = fs.readFileSync(path.join(root, 'public', 'polish.css'), 'utf8');

assert.match(polish, /dest-tiles\.dt-n6 \.dt-big\{grid-row:span 3\}/, 'six-tile featured spans three rows');
assert.match(polish, /dest-tiles\.dt-n6 \.dt-tail\{grid-column:2 \/ -1;grid-row:3\}/, 'sixth tile on bottom row');

function destSixCells(cssText) {
  const occ = new Set();
  const mark = (c, r, cSpan = 1, rSpan = 1) => {
    for (let dc = 0; dc < cSpan; dc++) {
      for (let dr = 0; dr < rSpan; dr++) occ.add(`${c + dc},${r + dr}`);
    }
  };
  mark(0, 0, 1, 3);
  mark(1, 0);
  mark(2, 0);
  mark(1, 1);
  mark(2, 1);
  mark(1, 2, 2, 1);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      assert.ok(occ.has(`${c},${r}`), `dest 6-grid cell ${c},${r} covered in CSS plan`);
    }
  }
  assert.match(cssText, /dest-tiles\.dt-n6\{grid-template-rows:repeat\(3,200px\)\}/);
}
destSixCells(polish);

function chromeBin() {
  for (const b of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
    if (fs.existsSync(b)) return b;
  }
  return null;
}

function waitJson(url, n = 0) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) {
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

function cdpConnect(WS, url) {
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

async function assertDestGrid(port, width) {
  const WS = require('ws');
  const bin = chromeBin();
  if (!WS || !bin) return;
  const debugPort = 9200 + Math.floor(Math.random() * 400);
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-dm-')), 'chrome')}`, 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  try {
    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    const session = await cdpConnect(WS, version.webSocketDebuggerUrl);
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => session.send(method, params, sessionId);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height: width < 800 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 800 });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await new Promise(r => setTimeout(r, 1800));
    await send('Runtime.evaluate', { expression: 'window.scrollTo(0,(document.getElementById("destinations")||document.body).offsetTop-72)' });
    await new Promise(r => setTimeout(r, 400));
    const res = await send('Runtime.evaluate', {
      awaitPromise: false,
      returnByValue: true,
      expression: `(() => {
        const grid = document.querySelector('.dest-tiles.dt-n6');
        if (!grid) return { ok: false, why: 'no dt-n6' };
        const gr = grid.getBoundingClientRect();
        const tiles = [...grid.querySelectorAll('.dest-tile')];
        const cols = ${width < 800 ? 2 : 3};
        const rows = ${width < 800 ? 4 : 3};
        let holes = 0;
        const gap = 8;
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const x = gr.left + gap + ((gr.width - gap * 2) / cols) * (c + 0.5);
            const y = gr.top + gap + ((gr.height - gap * 2) / rows) * (r + 0.5);
            const hit = document.elementsFromPoint(x, y).find(el => el.classList && el.classList.contains('dest-tile'));
            if (!hit) holes++;
          }
        }
        const tiny = tiles.filter(t => t.getBoundingClientRect().height < 20);
        return { ok: holes === 0 && tiny.length === 0, holes, cols, rows, tiles: tiles.length, tiny: tiny.length };
      })()`,
    });
    const v = res.result.value;
    assert.strictEqual(v.tiles, 6, width + ' tile count');
    assert.ok(v.ok, width + ' dest mosaic has no empty cell holes: ' + JSON.stringify(v));
    session.ws.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

(async () => {
  const port = 3835;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: '', ADMIN_PASSWORD: 'dm-admin', DEMO_HOTEL_PASSWORD: 'dm-hotel' },
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
    await assertDestGrid(port, 1440);
    await assertDestGrid(port, 390);
  } finally {
    child.kill('SIGTERM');
  }
  console.log('home-dest-mosaic-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});