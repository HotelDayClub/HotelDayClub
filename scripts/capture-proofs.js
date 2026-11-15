const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const outDir = process.env.PROOF_DIR || '/opt/cursor/artifacts/after';
fs.mkdirSync(outDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-proofs-'));
const dbPath = path.join(dir, 'app.db');
const port = 3710 + Math.floor(Math.random() * 200);
const debugPort = 9400 + Math.floor(Math.random() * 200);

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
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'proof-admin', DEMO_HOTEL_PASSWORD: 'proof-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server timeout\n' + log)), 30000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
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

async function shot(ws, { url, width, height, name, prep, full, awaitMs = 1400 }) {
  let h = height;
  if (full) h = Math.max(height, 1200);
  await wsSend(ws, { method: 'Emulation.setDeviceMetricsOverride', params: { width, height: h, deviceScaleFactor: 1, mobile: width < 800 } });
  await wsSend(ws, { method: 'Emulation.setEmulatedMedia', params: { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] } });
  await wsSend(ws, { method: 'Page.navigate', params: { url } });
  await new Promise(r => setTimeout(r, awaitMs));
  if (prep) {
    await wsSend(ws, { method: 'Runtime.evaluate', params: { expression: prep, awaitPromise: true, returnByValue: true } });
    await new Promise(r => setTimeout(r, 600));
  }
  if (full) {
    const layout = await wsSend(ws, { method: 'Page.getLayoutMetrics' });
    h = Math.min(Math.ceil(layout.contentSize.height) + 20, 14000);
    await wsSend(ws, { method: 'Emulation.setDeviceMetricsOverride', params: { width, height: h, deviceScaleFactor: 1, mobile: width < 800 } });
    await new Promise(r => setTimeout(r, 300));
  }
  const cap = await wsSend(ws, { method: 'Page.captureScreenshot', params: { format: 'png', fromSurface: true, captureBeyondViewport: !!full } });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(cap.data, 'base64'));
  console.log('wrote', name);
}

const SHEET_PAINT = `(function(){
 var s=document.getElementById('d2-sheet');
 if(!s) return;
 if(!s.open&&s.showModal) s.showModal();
 document.documentElement.classList.add('d2-lock');
})()`;

const CLOSE_SHEET = `(function(){
 var s=document.getElementById('d2-sheet');
 if(s&&s.open) s.close();
 document.documentElement.classList.remove('d2-lock');
 if(location.hash) history.replaceState(null,'',location.pathname+location.search);
})()`;

const OPEN_SHEET = `new Promise(function(done){
 window.scrollTo(0,0);
 var tries=0;
 function step(){
  tries++;
  var link=document.querySelector('.d2-bar-btn,a.d2-btn[href="#book"][data-open],#d2-pill,a[data-open="date"]');
  if(link) link.click();
  setTimeout(function(){
   if(location.hash!=='#book') location.hash='#book';
   var d=document.getElementById('d2-sheet');
   if(!d&&tries<30){setTimeout(step,150);return;}
   if(d&&!d.open&&d.showModal) d.showModal();
   ${SHEET_PAINT}
   if(d&&d.open) done(1);
   else if(tries<30) setTimeout(step,150);
   else done(0);
  },220);
 }
 setTimeout(step,500);
})`;

(async () => {
  const server = await startServer();
  const bin = chromeBin();
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(dir, 'chrome')}`,
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

  const { ymd, addDays } = require('../util');
  const when = ymd(addDays(new Date(), 14));
  const today = ymd(new Date());
  const beyond = ymd(addDays(new Date(), 120));
  const scrollTop = 'window.scrollTo(0,0);';
  const listingPrep = `${CLOSE_SHEET};${scrollTop}`;
  const rv = "document.querySelectorAll('[data-rv]').forEach(el=>el.classList.add('in'));";
  const listing = 'saltwater-terrace';
  const base = `http://127.0.0.1:${port}`;

  for (const stale of ['booking-sheet-390.png', 'd2-saltwater-hero.png', 'listing-390.png', 'banner-90day-390.png', 'help-390.png', 'terms-390.png', 'home-fold-390.png']) {
    const p = path.join(outDir, stale);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const firstHeights = { 360: 844, 390: 844, 1024: 800, 1280: 800, 1440: 900 };
  for (const [w, h] of Object.entries(firstHeights)) {
    await shot(ws, { url: `${base}/h/${listing}`, width: +w, height: h, name: `d2-listing-first-${w}.png`, prep: listingPrep, awaitMs: 1600 });
    await shot(ws, { url: `${base}/h/${listing}`, width: +w, height: h, name: `d2-listing-full-${w}.png`, prep: scrollTop, full: true });
  }

  const pickPrep = OPEN_SHEET + `;var hid=document.querySelector('#book input[type="hidden"][name="date"]');if(hid)hid.value='';document.querySelectorAll('#d2-form .d2-d input').forEach(function(i){i.checked=false});['d2-late','d2-closed'].forEach(function(id){var el=document.getElementById(id);if(el){el.hidden=true;el.textContent='';}});var go=document.getElementById('d2-go');if(go)go.setAttribute('aria-disabled','true');${SHEET_PAINT}`;
  await shot(ws, { url: `${base}/h/${listing}`, width: 390, height: 844, name: 'd2-sheet-pick-390.png', prep: pickPrep, awaitMs: 2000 });

  const readyPrep = OPEN_SHEET + `;${SHEET_PAINT}`;
  await shot(ws, { url: `${base}/h/${listing}?pass=lounger&date=${when}&qty=1#book`, width: 390, height: 844, name: 'd2-sheet-ready-390.png', prep: readyPrep, awaitMs: 2000 });
  await shot(ws, { url: `${base}/h/${listing}?pass=lounger&date=${when}&qty=1#book`, width: 360, height: 844, name: 'd2-sheet-ready-360.png', prep: readyPrep, awaitMs: 2000 });
  await shot(ws, { url: `${base}/h/${listing}?pass=lounger&date=${when}&qty=1#book`, width: 1280, height: 800, name: 'd2-sheet-ready-1280.png', prep: readyPrep, awaitMs: 2000 });

  const closedPrep = OPEN_SHEET + `;new Promise(function(r){var chip=document.querySelector('.d2-d.cl[data-date],button.cd.cl[data-date]');if(chip) chip.click();var n=0;(function t(){var el=document.getElementById('d2-closed');if(el&&!el.hidden&&/closed/i.test(el.textContent)){${SHEET_PAINT};r(1);}else if(++n>60)setTimeout(function(){${SHEET_PAINT};r(0)},0);else setTimeout(t,150)})()})`;
  await shot(ws, { url: `${base}/h/skyline-rooftop?qty=1`, width: 390, height: 844, name: 'd2-sheet-closed-390.png', prep: closedPrep, awaitMs: 2200 });

  const latePrep = OPEN_SHEET + `;new Promise(function(r){
 var d='${today}';
 var chip=document.querySelector('.d2-d input[value="'+d+'"]');
 if(chip&&!chip.checked){chip.checked=true;chip.dispatchEvent(new Event('change',{bubbles:true}));}
 var pass=document.querySelector('input[name="pass"][value="lounger"]');
 if(pass&&!pass.checked){pass.checked=true;pass.dispatchEvent(new Event('change',{bubbles:true}));}
 var n=0;(function t(){
  var late=document.getElementById('d2-late');
  var hid=document.querySelector('#book input[type="hidden"][name="date"]');
  var tot=document.getElementById('d2-tot-p');
  if(late&&!late.hidden&&/can't be cancelled for free/i.test(late.textContent)&&hid&&hid.value===d&&tot&&/\\$/.test(tot.textContent)){
   late.scrollIntoView({block:'center'});
   ${SHEET_PAINT};
   r(1);
  }else if(++n<80)setTimeout(t,200);
  else r(0);
 })();
})`;
  await shot(ws, { url: `${base}/h/${listing}?pass=lounger&date=${today}&qty=1#book`, width: 390, height: 844, name: 'd2-sheet-late-390.png', prep: latePrep, awaitMs: 2800 });

  const morePrep = OPEN_SHEET + `;var m=document.getElementById('d2-more');if(m){m.hidden=false;m.click();}${SHEET_PAINT}`;
  await shot(ws, { url: `${base}/h/${listing}?pass=lounger&date=${when}&qty=1#book`, width: 390, height: 844, name: 'd2-sheet-more-390.png', prep: morePrep, awaitMs: 2000 });

  const kidsPrep = OPEN_SHEET + `;new Promise(r=>{var el=document.getElementById('d2-kids');if(el)el.scrollIntoView({block:'center'});${SHEET_PAINT};r(1)})`;
  await shot(ws, { url: `${base}/h/manly-sands?pass=daybed&date=${when}&qty=2#book`, width: 390, height: 844, name: 'd2-sheet-kids-390.png', prep: kidsPrep, awaitMs: 2000 });

  const adultsPrep = OPEN_SHEET + `;new Promise(r=>{var el=document.getElementById('d2-kids');if(el){el.scrollIntoView({block:'center'});}${SHEET_PAINT};r(1)})`;
  await shot(ws, { url: `${base}/h/skyline-rooftop?pass=chair&date=${when}&qty=1#book`, width: 390, height: 844, name: 'd2-sheet-adults-390.png', prep: adultsPrep, awaitMs: 2000 });

  const holdPrep = `${CLOSE_SHEET};window.scrollTo(0,0);var h=document.getElementById('d2-hold');if(h){h.hidden=false;h.scrollIntoView({block:'center'});}`;
  await shot(ws, { url: `${base}/h/skyline-rooftop?date=${beyond}&pass=chair&qty=1`, width: 390, height: 844, name: 'd2-banner-90day-390.png', prep: holdPrep, awaitMs: 2000 });

  await shot(ws, { url: `${base}/`, width: 390, height: 844, name: 'p2a-home-quick-390.png', prep: rv + scrollTop });
  await shot(ws, { url: `${base}/search?mood=family`, width: 390, height: 844, name: 'p2b-search-mood-family-390.png', prep: scrollTop });

  const exploreScroll = `window.scrollTo(0,document.getElementById('explore').offsetTop-80);`;
  for (const [w, h, hotel] of [[360, 844, listing], [390, 844, listing], [1024, 800, listing], [1440, 900, listing], [390, 844, 'harbourside-lido'], [1440, 900, 'harbourside-lido']]) {
    await shot(ws, { url: `${base}/h/${hotel}`, width: w, height: h, name: `d2-explore-section-${w}-${hotel === listing ? 'saltwater' : 'harbourside'}.png`, prep: exploreScroll, awaitMs: 1600 });
  }
  const exploreOpen = `new Promise(function(r){var b=document.querySelector('[data-open-explore]');if(b)b.click();setTimeout(r,500)})`;
  await shot(ws, { url: `${base}/h/${listing}`, width: 390, height: 844, name: 'd2-sheet-explore-390.png', prep: exploreOpen, awaitMs: 1800 });
  await shot(ws, { url: `${base}/h/${listing}`, width: 1280, height: 800, name: 'd2-sheet-explore-1280.png', prep: exploreOpen, awaitMs: 1800 });

  const palmOpen = OPEN_SHEET;
  await shot(ws, { url: `${base}/h/palm-court?pass=chair&date=${when}&qty=1#book`, width: 390, height: 844, name: 'd2-sheet-palm-chair-390.png', prep: palmOpen, awaitMs: 2000 });

  const loginPrep = `fetch('/hotel/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'login=demo-saltwater&password=proof-hotel',credentials:'include'}).then(function(){location.href='/hotel/settings#explore-edit'})`;
  await shot(ws, { url: `${base}/hotel/login`, width: 390, height: 844, name: 'd2-explore-admin-390.png', prep: loginPrep, awaitMs: 2600 });
  await shot(ws, { url: `${base}/hotel/login`, width: 1440, height: 900, name: 'd2-explore-admin-1440.png', prep: loginPrep, awaitMs: 2600 });

  const bookFields = new URLSearchParams({
    hotel: listing, date: when, pass: 'daybed', qty: '1', name: 'Proof Guest', email: 'proof@example.com', phone: '0412345678',
    rules: '1', terms: '1', risk: '1', group: '1', share: '1', accept: '1',
  });
  bookFields.append('addon', 'gym');
  bookFields.append('addon', 'parking');
  const booked = await new Promise((resolve, reject) => {
    const body = bookFields.toString();
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/book', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  const ticketPath = (booked.headers.location || '').replace(/^https?:\/\/[^/]+/, '');
  if (booked.status === 303 && ticketPath) {
    await shot(ws, { url: `${base}${ticketPath}`, width: 390, height: 844, name: 'p1-ticket-390.png', prep: scrollTop });
    await shot(ws, { url: `${base}${ticketPath}`, width: 1280, height: 900, name: 'p1-ticket-1280.png', prep: scrollTop });
  }

  ws.close();
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
  console.log('proofs in', outDir);
})().catch(err => {
  console.error(err);
  process.exit(1);
});