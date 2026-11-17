const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const guestCss = [
  'public/listing-dir2.css',
  'public/base.css',
  'public/polish.css',
  'public/guest-d2.css',
];

const stickyChain = [
  /^body:has\(\.d2\) main\b/,
  /^body:has\(\.d2\)\b/,
  /^body\.guest\b/,
  /^main\b/,
  /\.d2-page\b/,
  /\.d2-layout\b/,
  /\.d2-side\b/,
];

function ruleBlocks(cssText) {
  const blocks = [];
  const re = /([^{]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(cssText))) blocks.push({ sel: m[1].trim(), body: m[2] });
  return blocks;
}

for (const rel of guestCss) {
  const cssText = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const { sel, body } of ruleBlocks(cssText)) {
  const overflow = body.match(/overflow(?:-x|-y)?:\s*([^;}\s]+)/g) || [];
    if (!overflow.length) continue;
    const hitsChain = stickyChain.some(re => sel.split(',').some(part => re.test(part.trim())));
    if (!hitsChain) continue;
    for (const decl of overflow) {
      const val = decl.replace(/overflow(-[xy])?:\s*/, '').trim();
      assert.ok(
        val === 'visible' || val === 'clip',
        `${rel} must not trap sticky (${sel}): ${decl}`,
      );
    }
  }
}

const listingCss = fs.readFileSync(path.join(root, 'public/listing-dir2.css'), 'utf8');
assert.match(listingCss, /body:has\(\.d2\) main\{overflow-x:clip\}/, 'listing main uses overflow-x clip');
assert.match(listingCss, /\.d2-side\{[^}]*top:calc\(var\(--d2-top,64px\) \+ var\(--d2-tabs-h,53px\) \+ 24px\)/s, 'sticky aside clears tabs bar');

function chromeBin() {
  for (const bin of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

const DATE_CLICK = `new Promise(function(done){
 window.scrollTo(0,0);
 var dateBtn=document.getElementById('d2-side-date');
 if(dateBtn){ dateBtn.click(); setTimeout(function(){done(1);},450); return; }
 done(0);
})`;

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

(async () => {
  const port = 3777;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: '', ADMIN_PASSWORD: 'stk-admin', DEMO_HOTEL_PASSWORD: 'stk-hotel' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout\n' + log)), 25000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(t); resolve(); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
  const bin = chromeBin();
  if (!bin) {
    child.kill('SIGTERM');
    console.log('d2-sticky-scroll-checks passed (CSS only, no Chrome)');
    return;
  }
  const debugPort = 9511;
  const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-stk-'));
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(chromeDir, 'chrome')}`, 'about:blank',
  ], { stdio: 'ignore' });
  const WS = require('ws');
  try {
    await new Promise(r => setTimeout(r, 800));
    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    const session = await cdpConnect(WS, version.webSocketDebuggerUrl);
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => session.send(method, params, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/saltwater-terrace` });
    await new Promise(r => setTimeout(r, 1600));
    await send('Runtime.evaluate', { awaitPromise: true, expression: DATE_CLICK });
    await new Promise(r => setTimeout(r, 500));
    for (const y of [800, 1000, 1600]) {
      await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${y})` });
      await new Promise(r => setTimeout(r, 350));
      const pos = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const side = document.getElementById('d2-side');
          const hdr = document.querySelector('.hdr');
          const tabs = document.querySelector('.d2-tabs');
          const from = document.getElementById('d2-sticky-from');
          if (!side || !hdr || !tabs) return { ok: false, why: 'missing nodes' };
          const sb = side.getBoundingClientRect();
          const hb = hdr.getBoundingClientRect();
          const tb = tabs.getBoundingClientRect();
          const cs = getComputedStyle(side);
          const root = getComputedStyle(document.querySelector('.d2') || document.body);
          const tabsH = parseFloat(root.getPropertyValue('--d2-tabs-h')) || tb.height;
          const expected = hb.bottom + tabsH + 24;
          let el = side.parentElement;
          while (el) {
            const st = getComputedStyle(el);
            const ox = st.overflowX;
            const oy = st.overflowY;
            const o = st.overflow;
            if (['hidden', 'auto', 'scroll'].includes(ox) || ['hidden', 'auto', 'scroll'].includes(oy) || ['hidden', 'auto', 'scroll'].includes(o)) {
              return { ok: false, why: 'ancestor overflow ' + (el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '')) + ' ' + o, scrollY: window.scrollY, top: sb.top, expected };
            }
            if (el === document.documentElement) break;
            el = el.parentElement;
          }
          const fb = from ? from.getBoundingClientRect() : null;
          const clearTabs = fb ? fb.top >= tb.bottom - 2 : true;
          const stickyOk = cs.position === 'sticky' && Math.abs(sb.top - expected) < 4;
          return { ok: stickyOk && clearTabs, top: sb.top, expected, tabsBottom: tb.bottom, fromTop: fb && fb.top, scrollY: window.scrollY, sticky: cs.position };
        })()`,
      });
      const v = pos.result.value;
      assert.ok(v.ok, `sticky at scroll ${y}: ` + JSON.stringify(v));
    }
    session.ws.close();
  } finally {
    chrome.kill('SIGTERM');
    child.kill('SIGTERM');
  }
  console.log('d2-sticky-scroll-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});