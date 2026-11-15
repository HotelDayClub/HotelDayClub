const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = process.env.PROOF_DIR || '/opt/cursor/artifacts/after';
const beforeRef = process.env.HOME_BEFORE_REF || 'b12efd27';
fs.mkdirSync(outDir, { recursive: true });

const viewports = [
  [1024, 800, '1024x800'],
  [1280, 800, '1280x800'],
  [1440, 900, '1440x900'],
];

function chromeBin() {
  for (const bin of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('no chrome');
}

function startServer(cwd, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-home-proof-'));
  const dbPath = path.join(dir, 'app.db');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'proof-admin', DEMO_HOTEL_PASSWORD: 'proof-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server timeout\n' + log)), 45000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve({ child, dir }); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

function wsSend(ws, obj) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = raw => {
      const msg = JSON.parse(raw);
      if (msg.id === id) {
        ws.removeListener('message', handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ ...obj, id }));
  });
}

const prep = `(() => {
  document.querySelectorAll('[data-rv]').forEach(el => el.classList.add('in'));
  window.scrollTo(0, 0);
})()`;

async function captureSet(label, cwd) {
  const port = 3800 + Math.floor(Math.random() * 200);
  const debugPort = 9500 + Math.floor(Math.random() * 200);
  const { child } = await startServer(cwd, port);
  const bin = chromeBin();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-home-chrome-'));
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${prof}`,
    'about:blank',
  ], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const list = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${debugPort}/json`, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    }).on('error', reject);
  });
  const WebSocket = require('ws');
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await wsSend(ws, { method: 'Emulation.setEmulatedMedia', params: { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] } });
  const base = `http://127.0.0.1:${port}/`;
  for (const [w, h, tag] of viewports) {
    await wsSend(ws, { method: 'Emulation.setDeviceMetricsOverride', params: { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 } });
    await wsSend(ws, { method: 'Page.navigate', params: { url: base } });
    await new Promise(r => setTimeout(r, 1200));
    await wsSend(ws, { method: 'Runtime.evaluate', params: { expression: prep, returnByValue: true } });
    await new Promise(r => setTimeout(r, 400));
    const cap = await wsSend(ws, { method: 'Page.captureScreenshot', params: { format: 'png', fromSurface: true, captureBeyondViewport: false } });
    const name = `home-${label}-${tag}.png`;
    fs.writeFileSync(path.join(outDir, name), Buffer.from(cap.data, 'base64'));
    console.log('wrote', name);
  }
  ws.close();
  chrome.kill('SIGTERM');
  child.kill('SIGTERM');
}

(async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-home-before-'));
  execSync(`git worktree add --detach "${worktree}" ${beforeRef}`, { cwd: root, stdio: 'inherit' });
  const nm = path.join(root, 'node_modules');
  if (fs.existsSync(nm)) {
    const link = path.join(worktree, 'node_modules');
    if (!fs.existsSync(link)) fs.symlinkSync(nm, link, 'junction');
  }
  try {
    await captureSet('before', worktree);
    await captureSet('after', root);
  } finally {
    execSync(`git worktree remove --force "${worktree}"`, { cwd: root, stdio: 'inherit' });
  }
  console.log('home comparison proofs in', outDir);
})().catch(err => {
  console.error(err);
  process.exit(1);
});