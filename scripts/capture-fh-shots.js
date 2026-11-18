#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const sharp = require('sharp');

const outDir = path.join(__dirname, '..', 'public', 'golden', 'img');
const TARGET_W = 1600;
const FH_PAIR_H = 922;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-fh-shots-'));
const dbPath = path.join(dir, 'app.db');
const port = 3720 + Math.floor(Math.random() * 100);
const debugPort = 9500 + Math.floor(Math.random() * 100);
const hotelPass = process.env.DEMO_HOTEL_PASSWORD || 'fh-shot-hotel';
const meta = {};

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
  const passTypes = db.prepare('SELECT id, code, price, holds FROM pass_types WHERE hotel_id=?').all(h.id);
  const passBy = Object.fromEntries(passTypes.map(p => [p.code, p]));
  const rows = db.prepare('SELECT id FROM bookings WHERE hotel_id=? AND date=? ORDER BY id').all(h.id, day);
  const keep = rows.slice(0, 3);
  for (const row of rows.slice(3)) purgeBooking(db, row.id);
  if (!keep.length) throw new Error('no bookings to style for fh shots');
  const sty = [
    { code: 'cabana', guest: 'Casey L.', party: 3, guests: ['Casey L.', 'Alex T.', 'Jordan R.'] },
    { code: 'lounger', guest: 'Jordan P.', party: 1, guests: ['Jordan P.'] },
    { code: 'daybed', guest: 'Riley M.', party: 2, guests: ['Riley M.', 'Sam K.'] },
  ];
  keep.forEach((row, i) => {
    const spec = sty[i] || sty[sty.length - 1];
    const pass = passBy[spec.code];
    if (!pass) throw new Error('missing pass ' + spec.code);
    const total = pass.price * 1;
    db.prepare('UPDATE bookings SET guest_name=?, pass_type_id=?, party=?, qty=1, unit_price=?, total=?, email=?, phone=? WHERE id=?')
      .run(spec.guest, pass.id, spec.party, pass.price, total, '', '', row.id);
    BookingGuests.save(db, row.id, spec.guests);
    db.prepare('UPDATE bookings SET checked_in_at=NULL, arrived_count=NULL WHERE id=?').run(row.id);
  });
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
  for (const row of db.prepare("SELECT id FROM bookings WHERE hotel_id=? AND date<>?").all(h.id, day)) purgeBooking(db, row.id);
  console.log('fh-shot data:', day, 'bookings', keep.length);
}

async function saveMainShot(buf, outBase, clipMeta, metaSource = 'dash-main') {
  const metaIn = await sharp(buf).metadata();
  const jpg = path.join(outDir, `${outBase}.jpg`);
  const webp = path.join(outDir, `${outBase}.webp`);
  const resizeH = FH_PAIR_H; // all three marketing shots are 1600x922
  // Fit, never crop: pad to the pair height with the page colour from the top-left pixel.
  const px = await sharp(buf).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  const background = { r: px[0], g: px[1], b: px[2] };
  const pipe = resizeH
    ? sharp(buf).resize(TARGET_W, resizeH, { fit: 'contain', position: 'top', background })
    : sharp(buf).resize(TARGET_W, null, { withoutEnlargement: false });
  await pipe.jpeg({ quality: 90 }).toFile(jpg);
  const final = await sharp(jpg).metadata();
  if (final.width !== TARGET_W) throw new Error(`${outBase} width ${final.width}`);
  const minH = resizeH || 420;
  if (final.height < minH || final.height > 1200) throw new Error(`${outBase} height ${final.height} out of range`);
  if (final.height === 735 && metaIn.height >= 700 && metaIn.height <= 750) {
    throw new Error(`${outBase} looks like a fixed viewport grab (${final.height}px)`);
  }
  await sharp(jpg).webp({ quality: 82 }).toFile(webp);
  meta[outBase] = { source: metaSource, width: final.width, height: final.height, ...clipMeta };
  console.log('wrote', jpg, `${final.width}x${final.height}`);
}

async function captureDashMain(ws, url, { beforeShot, outBase, clipSelector, metaSource = 'dash-main' } = {}) {
  await wsSend(ws, { method: 'Emulation.setScrollbarsHidden', params: { hidden: true } });
  await wsSend(ws, { method: 'Emulation.setDeviceMetricsOverride', params: { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false } });
  await wsSend(ws, { method: 'Page.navigate', params: { url } });
  await waitStyled(ws);
  await stopLiveList(ws);
  if (beforeShot) {
    await wsSend(ws, { method: 'Runtime.evaluate', params: { expression: beforeShot, awaitPromise: true } });
    await new Promise(r => setTimeout(r, 600));
  }
  const masked = await wsSend(ws, { method: 'Runtime.evaluate', params: { returnByValue: true, expression: MASK_MONEY } });
  if (masked.exceptionDetails) throw new Error(outBase + ': ' + masked.exceptionDetails.text);
  const layout = await wsSend(ws, {
    method: 'Runtime.evaluate',
    params: {
      returnByValue: true,
      expression: `(() => {
        const main = document.querySelector('.dash-main');
        if (!main) throw new Error('missing .dash-main');
        if (/\\b[Gg]ross\\b/.test(main.textContent)) throw new Error('dashboard still shows gross');
        const r = main.getBoundingClientRect();
        const h = Math.min(main.scrollHeight, 920);
        return { x: r.left, y: r.top, width: r.width, height: h, scrollY: window.scrollY };
      })()`,
    },
  });
  const box = layout.result.value;
  if (!box || box.width < 400 || box.height < 400) throw new Error('dash-main box too small: ' + JSON.stringify(box));
  const viewW = Math.ceil(box.x + box.width + 8);
  const viewH = Math.ceil(box.y + box.height + 8);
  await wsSend(ws, {
    method: 'Emulation.setDeviceMetricsOverride',
    params: { width: viewW, height: viewH, deviceScaleFactor: 1, mobile: false },
  });
  const clipExpr = clipSelector
    ? `(() => {
        const main = document.querySelector('.dash-main');
        const el = document.querySelector(${JSON.stringify(clipSelector)});
        if (!main || !el) throw new Error('clip target missing');
        if (!main.contains(el)) throw new Error('clip outside dash-main');
        const pad = 16;
        const r = el.getBoundingClientRect();
        const th = el.querySelector('thead');
        const t = th ? th.getBoundingClientRect() : null;
        return {
          x: Math.max(0, r.left + window.scrollX - pad), y: Math.max(0, r.top + window.scrollY - pad),
          width: r.width + pad * 2, height: Math.min(r.height, 900) + pad * 2,
          theadTop: t ? t.top + window.scrollY : null, theadBottom: t ? t.bottom + window.scrollY : null,
          headerText: th ? [...th.querySelectorAll('th')].map(c => c.textContent.trim()).join(' | ') : '',
        };
      })()`
    : `(() => {
        const main = document.querySelector('.dash-main');
        const r = main.getBoundingClientRect();
        const h = Math.min(main.scrollHeight, Math.round(r.width * ${FH_PAIR_H} / ${TARGET_W}));
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: h };
      })()`;
  const layout2 = await wsSend(ws, {
    method: 'Runtime.evaluate',
    params: { returnByValue: true, expression: clipExpr },
  });
  const clip = layout2.result.value;
  const cap = await wsSend(ws, {
    method: 'Page.captureScreenshot',
    params: {
      format: 'jpeg',
      quality: 92,
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 },
    },
  });
  const buf = Buffer.from(cap.data, 'base64');
  const extra = clip.headerText !== undefined ? { clipY: Math.round(clip.y), theadTop: Math.round(clip.theadTop), theadBottom: Math.round(clip.theadBottom), headerText: clip.headerText } : {};
  await saveMainShot(buf, outBase, { clipWidth: Math.round(clip.width), clipHeight: Math.round(clip.height), moneyMasked: masked.result.value, ...extra }, metaSource);
}

// Hides every dollar amount inside .dash-main before capture (public marketing images show no prices or payouts).
const MASK_MONEY = `(() => {
  const main = document.querySelector('.dash-main');
  const re = /A?\\$\\s?\\d[\\d,]*(?:\\.\\d{1,2})?/g;
  const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let n; let hits = 0;
  while ((n = walk.nextNode())) {
    const next = n.nodeValue.replace(re, '$ ••');
    if (next !== n.nodeValue) { n.nodeValue = next; hits += 1; }
  }
  if (/\\$\\s?\\d/.test(main.textContent)) throw new Error('dollar amount still visible');
  return hits;
})()`;

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

  await captureDashMain(ws, `${base}/hotel`, {
    beforeShot: 'window.scrollTo(0,0);',
    outBase: 'fh-dashboard',
  });
  await captureDashMain(ws, `${base}/hotel/checkin`, {
    beforeShot: 'window.scrollTo(0,0);',
    outBase: 'fh-checkin',
  });
  await captureDashMain(ws, `${base}/hotel#today`, {
    beforeShot: `(() => {
      const el = document.getElementById('today');
      if (!el) throw new Error('missing #today');
      if (!el.querySelector('.guest-others')) throw new Error('missing guest names');
      if (!el.textContent.includes('Casey L.')) throw new Error('missing Casey L.');
      const tbl = el.querySelector('.tbl-wrap') || el.querySelector('table');
      if (!tbl) throw new Error('missing guest table');
      window.scrollTo(0, 0);
      return true;
    })()`,
    clipSelector: '#today',
    metaSource: 'dash-main#today-table',
    outBase: 'fh-guestlist',
  });

  fs.writeFileSync(path.join(outDir, 'fh-capture-meta.json'), JSON.stringify(meta, null, 2) + '\n');
  ws.close();
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
})().catch(err => {
  console.error(err);
  process.exit(1);
});