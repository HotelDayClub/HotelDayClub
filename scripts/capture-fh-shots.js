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

function purgeBooking(db, id) {
  db.prepare('DELETE FROM booking_addons WHERE booking_id=?').run(id);
  db.prepare('DELETE FROM guest_notes WHERE booking_id=?').run(id);
  db.prepare('DELETE FROM booking_guests WHERE booking_id=?').run(id);
  db.prepare('DELETE FROM bookings WHERE id=?').run(id);
}

function prepGuestData(db) {
  const h = db.prepare("SELECT * FROM hotels WHERE slug='saltwater-terrace'").get();
  if (!h) throw new Error('saltwater-terrace missing');
  const { HotelClock } = require('../calendar');
  const BookingGuests = require('../bookingGuests');
  const clock = process.env.HDC_NOW ? new Date(process.env.HDC_NOW) : new Date();
  const day = HotelClock.today(h, clock);
  const rows = db.prepare('SELECT id FROM bookings WHERE hotel_id=? AND date=? ORDER BY id').all(h.id, day);
  const keep = rows.slice(0, 3);
  for (const row of rows.slice(3)) purgeBooking(db, row.id);
  if (!keep.length) throw new Error('no bookings to style for fh shots');
  const names = ['Jordan P.', 'Riley M.'];
  keep.forEach((row, i) => {
    if (i === 0) {
      db.prepare("UPDATE bookings SET guest_name=?, email='', phone='', party=3, qty=1 WHERE id=?").run('Casey L.', row.id);
      BookingGuests.save(db, row.id, ['Casey L.', 'Alex T.', 'Jordan R.']);
    } else {
      db.prepare("UPDATE bookings SET guest_name=?, email='', phone='', party=1, qty=1 WHERE id=?").run(names[i - 1] || 'Guest', row.id);
      db.prepare('DELETE FROM booking_guests WHERE booking_id=?').run(row.id);
    }
    db.prepare('UPDATE bookings SET checked_in_at=NULL, arrived_count=NULL WHERE id=?').run(row.id);
  });
  const left = db.prepare('SELECT COUNT(*) n FROM bookings WHERE hotel_id=? AND date=?').get(h.id, day).n;
  const { addDays, ymd } = require('../util');
  const passes = db.prepare('SELECT id, daily_cap FROM pass_types WHERE hotel_id=?').all(h.id);
  for (let offset = 0; offset < 14; offset++) {
    const date = ymd(addDays(new Date(`${day}T12:00:00`), offset));
    for (const pass of passes) {
      const warnAt = Math.max(0, Math.floor(pass.daily_cap * 0.72));
      let sold = db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(pass.id, date).n;
      while (sold > warnAt) {
        const row = db.prepare("SELECT id, qty FROM bookings WHERE hotel_id=? AND pass_type_id=? AND date=? AND status!='cancelled' ORDER BY id DESC LIMIT 1").get(h.id, pass.id, date);
        if (!row) break;
        purgeBooking(db, row.id);
        sold -= row.qty;
      }
    }
  }
  const others = db.prepare("SELECT id FROM bookings WHERE hotel_id=? AND date<>?").all(h.id, day);
  for (const row of others) purgeBooking(db, row.id);
  console.log('fh-shot data:', day, 'bookings', left);
  return { day, hotelId: h.id };
}

async function firstContentRow(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const colStart = Math.floor(info.width * 0.16);
  for (let y = 0; y < info.height; y++) {
    let hits = 0;
    for (let x = colStart; x < info.width; x += 28) {
      const i = (y * info.width + x) * 3;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) hits++;
    }
    if (hits > 8) return y;
  }
  return 0;
}

async function saveViewportJpeg(buf, outBase, { trimTop = false } = {}) {
  const jpg = path.join(outDir, `${outBase}.jpg`);
  const webp = path.join(outDir, `${outBase}.webp`);
  let input = sharp(buf);
  if (trimTop) {
    const row = await firstContentRow(buf);
    if (row > 200) throw new Error(`${outBase} capture has large blank band (${row}px)`);
    const top = Math.max(0, row - 120);
    const meta = await sharp(buf).metadata();
    input = sharp(buf).extract({ left: 0, top, width: meta.width, height: Math.min(meta.height - top, TARGET_H + 200) });
  }
  const pipeline = input.resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'top' }).jpeg({ quality: 90 });
  await pipeline.toFile(jpg);
  const meta = await sharp(jpg).metadata();
  if (meta.width !== TARGET_W || meta.height !== TARGET_H) {
    throw new Error(`${outBase} is ${meta.width}x${meta.height}, expected ${TARGET_W}x${TARGET_H}`);
  }
  if (fs.statSync(jpg).size < 30_000) throw new Error(`${outBase}.jpg looks blank (${fs.statSync(jpg).size} bytes)`);
  await sharp(jpg).webp({ quality: 82 }).toFile(webp);
  console.log('wrote', jpg, `${meta.width}x${meta.height}`);
}

async function captureViewport(ws, url, { viewportW, clipH = TARGET_H, viewH: viewHOpt, beforeShot, clipExpr } = {}) {
  const w = viewportW || TARGET_W;
  const viewH = viewHOpt || Math.max(clipH + 160, 920);
  await wsSend(ws, { method: 'Emulation.setDeviceMetricsOverride', params: { width: w, height: viewH, deviceScaleFactor: 1, mobile: w < 800 } });
  await wsSend(ws, { method: 'Page.navigate', params: { url } });
  await waitStyled(ws);
  await stopLiveList(ws);
  if (beforeShot) {
    await wsSend(ws, { method: 'Runtime.evaluate', params: { expression: beforeShot, awaitPromise: true } });
    await new Promise(r => setTimeout(r, 800));
  }
  let clip = { x: 0, y: 0, width: w, height: clipH, scale: 1 };
  if (clipExpr) {
    const box = await wsSend(ws, {
      method: 'Runtime.evaluate',
      params: { expression: clipExpr, returnByValue: true, awaitPromise: true },
    });
    const v = box.result.value;
    if (!v || v.height < 400) throw new Error('clip region too small');
    clip = { x: Math.max(0, v.x), y: Math.max(0, v.y), width: Math.min(w, v.width), height: Math.min(clipH, v.height), scale: 1 };
  }
  const cap = await wsSend(ws, {
    method: 'Page.captureScreenshot',
    params: {
      format: 'jpeg',
      quality: 92,
      fromSurface: false,
      clip,
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-chrome-'));
  const chrome = spawn(chromeBin(), [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    'about:blank',
  ], { stdio: 'ignore' });
  const targets = await new Promise((resolve, reject) => {
    const started = Date.now();
    const tryOnce = () => {
      http.get(`http://127.0.0.1:${debugPort}/json`, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks))));
      }).on('error', () => {
        if (Date.now() - started > 25000) reject(new Error('chrome debug timeout'));
        else setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
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

  const dashClip = `(() => {
    const main = document.querySelector('.dash-main');
    if (!main) throw new Error('missing .dash-main');
    if (/\\b[Gg]ross\\b/.test(main.textContent)) throw new Error('dashboard still shows gross');
    const r = main.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, ${TARGET_H}) };
  })()`;
  const dashBuf = await captureViewport(ws, `${base}/hotel`, {
    viewportW: 1280,
    viewH: 1100,
    clipH: TARGET_H,
    beforeShot: 'window.scrollTo(0,0);',
    clipExpr: dashClip,
  });
  await saveViewportJpeg(dashBuf, 'fh-dashboard');

  const hotelClip = `(() => {
    const main = document.querySelector('.dash-main');
    if (!main) throw new Error('missing .dash-main');
    const r = main.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, ${TARGET_H}) };
  })()`;
  const checkinBuf = await captureViewport(ws, `${base}/hotel/checkin`, {
    viewportW: 1280,
    viewH: 1100,
    clipH: TARGET_H,
    beforeShot: 'window.scrollTo(0,0);',
    clipExpr: hotelClip,
  });
  await saveViewportJpeg(checkinBuf, 'fh-checkin');

  const listBuf = await captureViewport(ws, `${base}/hotel#today`, {
    viewportW: 1280,
    viewH: 1200,
    clipH: TARGET_H,
    beforeShot: `(() => {
      const el = document.getElementById('today');
      if (!el) throw new Error('missing #today');
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (r.top < 40 || r.top > 130) window.scrollBy(0, r.top - 96);
      const head = el.querySelector('h2');
      const top = head.getBoundingClientRect().top;
      if (top < 56 || top > 120) throw new Error('today section misaligned at ' + top);
      if (!el.querySelector('.guest-others')) throw new Error('missing B1-40 muted guest names');
      if (!el.textContent.includes('Casey L.') || !/\\+ 2 guests/.test(el.textContent)) throw new Error('missing Casey L. + 2 guests headline');
      return true;
    })()`,
    clipExpr: hotelClip,
  });
  const gap = await firstContentRow(listBuf);
  if (gap > 110) throw new Error(`guestlist capture has ${gap}px top gap`);
  await saveViewportJpeg(listBuf, 'fh-guestlist');

  ws.close();
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
})().catch(err => {
  console.error(err);
  process.exit(1);
});