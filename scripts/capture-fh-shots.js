#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const sharp = require('sharp');

const outDir = path.join(__dirname, '..', 'public', 'golden', 'img');
const TARGET_W = 1600;
const TARGET_H = 735;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-fh-shots-'));
const dbPath = path.join(dir, 'app.db');
const port = 3720 + Math.floor(Math.random() * 100);
const debugPort = 9500 + Math.floor(Math.random() * 100);
const hotelPass = process.env.DEMO_HOTEL_PASSWORD || 'fh-shot-hotel';

function chromeBin() {
  for (const bin of ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
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
        HDC_NOW: '2026-11-12T10:00:00.000Z',
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

async function waitStyled(ws) {
  await wsSend(ws, { method: 'Runtime.evaluate', params: { expression: 'document.fonts.ready', awaitPromise: true } });
  await new Promise(r => setTimeout(r, 600));
  const probe = await wsSend(ws, {
    method: 'Runtime.evaluate',
    params: {
      returnByValue: true,
      expression: `(() => {
        const ff = getComputedStyle(document.body).fontFamily || '';
        const dash = !!document.querySelector('link[rel="stylesheet"]');
        const bad = /Times New Roman/i.test(ff) && !/Inter|Fraunces|system-ui/i.test(ff);
        return { ff, dash, bad };
      })()`,
    },
  });
  const v = probe.result.value;
  if (v.bad || !v.dash) throw new Error('page looks unstyled: ' + JSON.stringify(v));
}

async function stopLiveList(ws) {
  await wsSend(ws, {
    method: 'Runtime.evaluate',
    params: {
      expression: `(() => {
        document.querySelectorAll('[data-live]').forEach(el => el.removeAttribute('data-live'));
        return true;
      })()`,
    },
  });
}

function prepGuestData(db) {
  const h = db.prepare("SELECT * FROM hotels WHERE slug='saltwater-terrace'").get();
  if (!h) throw new Error('saltwater-terrace missing');
  const { HotelClock } = require('../calendar');
  const { addDays, ymd } = require('../util');
  const clock = process.env.HDC_NOW ? new Date(process.env.HDC_NOW) : new Date();
  const day = HotelClock.today(h, clock);
  const bump = ymd(addDays(new Date(`${day}T12:00:00`), 1));
  const rows = db.prepare('SELECT id FROM bookings WHERE hotel_id=? AND date=? ORDER BY id').all(h.id, day);
  const names = ['Jordan P.', 'Casey L.', 'Riley M.'];
  const keep = new Set();
  rows.forEach((row, i) => {
    if (i < names.length) {
      keep.add(row.id);
      db.prepare("UPDATE bookings SET guest_name=?, email='', phone='', party=1, qty=1 WHERE id=?").run(names[i], row.id);
      db.prepare('DELETE FROM booking_guests WHERE booking_id=?').run(row.id);
    }
  });
  const move = rows.filter(r => !keep.has(r.id)).map(r => r.id);
  if (move.length) {
    const q = move.map(() => '?').join(',');
    db.prepare(`UPDATE bookings SET date=? WHERE id IN (${q})`).run(bump, ...move);
  }
  const left = db.prepare('SELECT COUNT(*) n FROM bookings WHERE hotel_id=? AND date=?').get(h.id, day).n;
  console.log('fh-shot data:', day, 'bookings', left);
  if (left > names.length) throw new Error(`expected at most ${names.length} today bookings, got ${left}`);
  return { day, hotelId: h.id };
}

async function saveViewportJpeg(buf, outBase) {
  const jpg = path.join(outDir, `${outBase}.jpg`);
  const webp = path.join(outDir, `${outBase}.webp`);
  const pipeline = sharp(buf).resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'top' }).jpeg({ quality: 90 });
  await pipeline.toFile(jpg);
  const meta = await sharp(jpg).metadata();
  if (meta.width !== TARGET_W || meta.height !== TARGET_H) {
    throw new Error(`${outBase} is ${meta.width}x${meta.height}, expected ${TARGET_W}x${TARGET_H}`);
  }
  await sharp(jpg).webp({ quality: 82 }).toFile(webp);
  console.log('wrote', jpg, `${meta.width}x${meta.height}`);
}

async function captureViewport(ws, url, { viewportW, clipH = TARGET_H, beforeShot } = {}) {
  const w = viewportW || TARGET_W;
  const viewH = Math.max(clipH + 120, 900);
  await wsSend(ws, { method: 'Emulation.setDeviceMetricsOverride', params: { width: w, height: viewH, deviceScaleFactor: 1, mobile: w < 800 } });
  await wsSend(ws, { method: 'Page.navigate', params: { url } });
  await waitStyled(ws);
  await stopLiveList(ws);
  if (beforeShot) {
    await wsSend(ws, { method: 'Runtime.evaluate', params: { expression: beforeShot, awaitPromise: true } });
    await new Promise(r => setTimeout(r, 500));
  }
  const cap = await wsSend(ws, {
    method: 'Page.captureScreenshot',
    params: {
      format: 'jpeg',
      quality: 92,
      fromSurface: true,
      clip: { x: 0, y: 0, width: w, height: clipH, scale: 1 },
    },
  });
  return Buffer.from(cap.data, 'base64');
}

const loginJs = `(function(){
  return fetch('/hotel/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'user=demo-saltwater&pass='+encodeURIComponent('${hotelPass.replace(/'/g, "\\'")}'),credentials:'include'}).then(r=>r.status);
})()`;

(async () => {
  process.env.HDC_NOW = '2026-11-12T10:00:00.000Z';
  process.env.DB_PATH = dbPath;
  delete process.env.DATA_DIR;
  const db = require('../db');
  const { seed, ensureSchedules } = require('../seed');
  seed(db);
  ensureSchedules(db);
  db.pragma('wal_checkpoint(FULL)');
  db.close();
  const server = await startServer();
  const Database = require('better-sqlite3');
  const dbShot = new Database(dbPath);
  prepGuestData(dbShot);
  dbShot.pragma('wal_checkpoint(FULL)');
  dbShot.close();
  const chrome = spawn(chromeBin(), [
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
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

  const dashBuf = await captureViewport(ws, `${base}/hotel`, {
    beforeShot: 'window.scrollTo(0,0);',
  });
  await saveViewportJpeg(dashBuf, 'fh-dashboard');

  const checkinBuf = await captureViewport(ws, `${base}/hotel/checkin`, {
    beforeShot: 'window.scrollTo(0,0);',
  });
  await saveViewportJpeg(checkinBuf, 'fh-checkin');

  const listBuf = await captureViewport(ws, `${base}/hotel/checkin`, {
    beforeShot: `(() => {
      const el = document.getElementById('today');
      if (!el) throw new Error('missing #today');
      const head = el.querySelector('h2') || el;
      const y = head.getBoundingClientRect().top + window.scrollY - 16;
      window.scrollTo(0, Math.max(0, y));
      const top = head.getBoundingClientRect().top;
      if (top < 0 || top > 240) throw new Error('guest list not in frame');
      return true;
    })()`,
  });
  await saveViewportJpeg(listBuf, 'fh-guestlist');

  ws.close();
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
})().catch(err => {
  console.error(err);
  process.exit(1);
});