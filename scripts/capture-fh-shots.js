#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const outDir = path.join(__dirname, '..', 'public', 'golden', 'img');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-fh-shots-'));
const dbPath = path.join(dir, 'app.db');
const port = 3720 + Math.floor(Math.random() * 100);
const debugPort = 9500 + Math.floor(Math.random() * 100);
const hotelPass = process.env.DEMO_HOTEL_PASSWORD || 'fh-shot-hotel';

function chromeBin() {
  for (const bin of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('no chrome');
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: dbPath,
        DATA_DIR: '',
        ADMIN_PASSWORD: 'fh-shot-admin',
        DEMO_HOTEL_PASSWORD: hotelPass,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server timeout\n' + log)), 45000);
    child.stdout.on('data', c => {
      log += c;
      if (log.includes('Hotel Day Club demo')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

function wsSend(ws, obj) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = raw => {
      const msg = JSON.parse(raw);
      if (msg.id === id) {
        ws.removeListener('message', onMsg);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ ...obj, id }));
  });
}

async function navigateShot(ws, url, clipSelector, outBase) {
  await wsSend(ws, { method: 'Emulation.setDeviceMetricsOverride', params: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false } });
  await wsSend(ws, { method: 'Page.navigate', params: { url } });
  await new Promise(r => setTimeout(r, 2200));
  const box = await wsSend(ws, {
    method: 'Runtime.evaluate',
    params: {
      expression: `(function(){
        var el=document.querySelector(${JSON.stringify(clipSelector)});
        if(!el) return null;
        var r=el.getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};
      })()`,
      returnByValue: true,
    },
  });
  const clip = box && box.result && box.result.value;
  const cap = await wsSend(ws, {
    method: 'Page.captureScreenshot',
    params: {
      format: 'jpeg',
      quality: 88,
      fromSurface: true,
      clip: clip && clip.width > 80 ? clip : undefined,
    },
  });
  const buf = Buffer.from(cap.data, 'base64');
  const jpg = path.join(outDir, `${outBase}.jpg`);
  fs.writeFileSync(jpg, buf);
  console.log('wrote', jpg, buf.length);
  return buf;
}

function toWebp(jpgPath, webpPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['-e', `
      const fs=require('fs');
      const sharp=require('sharp');
      sharp(process.argv[1]).resize(1600,null,{withoutEnlargement:true}).webp({quality:82}).toFile(process.argv[2]).then(()=>console.log('webp ok')).catch(e=>{console.error(e);process.exit(1)});
    `, jpgPath, webpPath], { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
    child.on('exit', code => (code ? reject(new Error('webp fail')) : resolve()));
  });
}

const loginJs = `(function(){
  return fetch('/hotel/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'user=demo-saltwater&pass='+encodeURIComponent('${hotelPass.replace(/'/g, "\\'")}'),credentials:'include'}).then(r=>r.status);
})()`;

(async () => {
  process.env.DB_PATH = dbPath;
  delete process.env.DATA_DIR;
  const db = require('../db');
  const { seed, ensureSchedules } = require('../seed');
  seed(db);
  ensureSchedules(db);
  const server = await startServer();
  const chrome = spawn(chromeBin(), [
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const targets = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${debugPort}/json`, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks))));
    }).on('error', reject);
  });
  const page = targets.find(t => t.type === 'page');
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await wsSend(ws, { method: 'Page.enable' });
  const base = `http://127.0.0.1:${port}`;
  await wsSend(ws, { method: 'Page.navigate', params: { url: `${base}/hotel/login` } });
  await new Promise(r => setTimeout(r, 800));
  await wsSend(ws, { method: 'Runtime.evaluate', params: { expression: loginJs, awaitPromise: true } });
  await new Promise(r => setTimeout(r, 600));

  await navigateShot(ws, `${base}/hotel`, '.dash-main', 'fh-dashboard');
  await navigateShot(ws, `${base}/hotel/checkin`, '.checkin-page', 'fh-checkin');
  await navigateShot(ws, `${base}/hotel/today-list?view=checkin`, '#today,.guest-cards', 'fh-guestlist');

  ws.close();
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');

  for (const base of ['fh-dashboard', 'fh-checkin', 'fh-guestlist']) {
    try {
      await toWebp(path.join(outDir, `${base}.jpg`), path.join(outDir, `${base}.webp`));
    } catch (err) {
      console.warn('webp skip', base, err.message);
    }
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});