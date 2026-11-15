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
  const homeCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'golden', 'home.css'), 'utf8');
  const slotPCss = homeCss.match(/body\.home \.slot p\{[^}]+\}/);
  assert.ok(slotPCss, 'body.home .slot p rule');
  assert.ok(!/-webkit-line-clamp|line-clamp/.test(slotPCss[0]), 'plan card copy must not clamp');
  assert.ok(!/text-overflow:\s*ellipsis/.test(slotPCss[0]), 'plan card copy must not ellipsis');
  assert.ok(/body\.home \.slot img\{[^}]*aspect-ratio:3\/2/.test(homeCss), 'plan card image aspect ratio');
  assert.ok(/body\.home \.slot img\{[^}]*min-height:/.test(homeCss), 'plan card image min-height');

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
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    for (const [width, height] of [[360, 844], [390, 844], [1024, 800], [1100, 800], [1280, 800], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
      await new Promise(resolve => setTimeout(resolve, 900));
      await send('Runtime.evaluate', {
        expression: `(() => {
          document.querySelectorAll('[data-rv]').forEach(el => el.classList.add('in'));
        })()`,
      });
      await new Promise(resolve => setTimeout(resolve, 200));
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
          const helpers = [...document.querySelectorAll('.assure b, .assure span')].map(el => ({
            text: el.textContent.trim(),
            clipped: el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 1,
          }));
          const assureEl = document.querySelector('.assure');
          const rectOf = el => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
          };
          const assureBox = rectOf(assureEl);
          const dayEl = document.querySelector('.day');
          const dayBox = rectOf(dayEl);
          const planSec = dayEl ? dayEl.closest('section') : null;
          const planSecW = planSec ? planSec.clientWidth : 0;
          const copyEl = document.querySelector('.hero .copy');
          const copyBox = rectOf(copyEl);
          const kicker = document.querySelector('#explore .kicker');
          const see = (document.querySelector('#explore .sec-action') || document.querySelector('#explore .see-all')).getBoundingClientRect();
          const kickerBox = kicker.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(kicker);
          let kickerClipped = false;
          for (const rect of range.getClientRects()) {
            if (rect.width < 1 || rect.height < 1) continue;
            if (rect.right > kickerBox.right + 1 || rect.bottom > kickerBox.bottom + 1 || rect.left < kickerBox.left - 1) kickerClipped = true;
          }
          const planCopy = document.querySelector('.day .slot p');
          const planImg = document.querySelector('.day .slot img');
          const planP = planCopy ? {
            text: planCopy.textContent.trim(),
            tall: planCopy.scrollHeight > planCopy.clientHeight + 2,
            style: getComputedStyle(planCopy),
          } : null;
          const planI = planImg ? {
            h: planImg.getBoundingClientRect().height,
            style: getComputedStyle(planImg),
          } : null;
          const helpEl = [...document.querySelectorAll('.assure b')].find(n => /help when you need it/i.test(n.textContent));
          const helpRight = helpEl ? helpEl.getBoundingClientRect().right : 0;
          const heroEl = document.querySelector('.hero');
          const phEl = document.querySelector('.hero .ph');
          const heroBox = rectOf(heroEl);
          const phBox = rectOf(phEl);
          const creditEl = document.querySelector('.hero .credit');
          const clockEl = document.querySelector('.hero .clock');
          const creditBox = rectOf(creditEl);
          const clockBox = rectOf(clockEl);
          const quickBtns = [...document.querySelectorAll('.copy .quick a.qb')].map(el => {
            const st = getComputedStyle(el);
            const bg = st.backgroundColor || '';
            const alpha = /rgba?\(([^)]+)\)/.exec(bg);
            let opaque = bg === 'transparent' || bg === '';
            if (alpha) {
              const bits = alpha[1].split(',').map(s => s.trim());
              opaque = bits.length < 4 || Number(bits[3]) > 0.05;
            } else if (/^#/.test(bg)) opaque = true;
            return {
              td: st.textDecorationLine,
              display: st.display,
              bg,
              opaque,
              h: el.getBoundingClientRect().height,
            };
          });
          const whatSeg = document.querySelector('#p') && document.querySelector('#p').closest('.seg');
          const whatPk = whatSeg && whatSeg.querySelector('.pk-btn');
          const whatTxt = whatPk && whatPk.querySelector('.pk-txt');
          const whatChev = whatPk && whatPk.querySelector('.pk-chev');
          const submitBtn = document.querySelector('.search button[type="submit"]');
          const overlaps = (a, b) => {
            if (!a || !b) return false;
            return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
          };
          const heroKickerEl = document.querySelector('.copy .kicker');
          const heroKickerBox = rectOf(heroKickerEl);
          const badgeKickerOverlap = overlaps(creditBox, heroKickerBox);
          const creditLineCount = creditEl ? ((creditEl.scrollHeight > creditEl.clientHeight + 2) ? 2 : 1) : 0;
          const whatBox = whatSeg ? rectOf(whatSeg) : null;
          const whatPickBox = whatPk ? rectOf(whatPk) : null;
          const submitBox = submitBtn ? rectOf(submitBtn) : null;
          const chevBox = whatChev ? rectOf(whatChev) : null;
          const whatTxtClip = whatTxt ? whatTxt.scrollWidth > whatTxt.clientWidth + 1 : false;
          const searchOverlap = submitBox && (whatBox && overlaps(submitBox, whatBox) || whatPickBox && overlaps(submitBox, whatPickBox) || chevBox && overlaps(submitBox, chevBox));
          const exploreH2 = document.querySelector('#explore h2');
          const exploreH2Top = exploreH2 ? exploreH2.getBoundingClientRect().top : 1e9;
          const wraps = [...document.querySelectorAll('.assure .ico-wrap')];
          const gridCols = getComputedStyle(document.querySelector('.assure ul')).gridTemplateColumns.split(/\s+/).filter(Boolean).length || 1;
          let iconTopSpread = 0;
          for (let i = 0; i < wraps.length; i += gridCols) {
            const tops = wraps.slice(i, i + gridCols).map(el => el.getBoundingClientRect().top);
            if (tops.length > 1) iconTopSpread = Math.max(iconTopSpread, Math.max(...tops) - Math.min(...tops));
          }
          const freeCancelSub = document.querySelector('.assure li:first-child span:not(.ico-wrap)');
          const freeCancelVisible = !!(freeCancelSub
            && getComputedStyle(freeCancelSub).display !== 'none'
            && freeCancelSub.getBoundingClientRect().height > 0
            && /24 hours before your access hours start/i.test(freeCancelSub.textContent));
          return {
            top: box.top,
            exploreH2Top,
            freeCancelVisible,
            iconTopSpread,
            inner: window.innerHeight,
            scroll: document.documentElement.scrollWidth,
            width: window.innerWidth,
            button: Math.min(button.width, button.height),
            fields,
            helpers,
            kicker: kicker.textContent.replace(/\\s+/g, ' ').trim(),
            kickerClipped,
            seeH: see.height,
            planP,
            planI,
            assureBox,
            dayBox,
            planSecW,
            copyBox,
            helpRight,
            heroBox,
            phBox,
            creditBox,
            clockBox,
            badgeKickerOverlap,
            creditLines: creditLineCount,
            quickBtns,
            searchOverlap,
            whatTxtClip,
          };
        })()`,
      });
      const data = result.result.value;
      assert.ok(data.scroll <= data.width, width + ' sideways scroll ' + data.scroll);
      assert.ok(data.scroll <= data.width + 1, width + ' page horizontal overflow');
      if (data.assureBox) {
        assert.ok(data.assureBox.right <= data.width + 2, width + ' assure overflow right ' + JSON.stringify(data.assureBox));
        assert.ok(data.assureBox.width <= data.width + 2, width + ' assure too wide ' + data.assureBox.width);
      }
      if (data.helpRight) assert.ok(data.helpRight <= data.width + 2, width + ' help link clipped ' + data.helpRight);
      if (data.dayBox && data.planSecW) {
        assert.ok(data.dayBox.width >= data.planSecW * 0.85, width + ' plan day narrow ' + data.dayBox.width + ' in ' + data.planSecW);
      }
      if (width >= 1024 && data.copyBox) {
        assert.ok(data.copyBox.width >= Math.min(420, data.width * 0.38), width + ' hero copy squeeze ' + data.copyBox.width);
      }
      assert.ok(data.planP, width + ' plan copy');
      assert.ok(data.planP.text.includes('gym session'), width + ' plan sample');
      assert.ok(!data.planP.tall, width + ' plan copy clipped ' + data.planP.text);
      assert.ok(data.planP.style.display !== '-webkit-box', width + ' line-clamp box');
      assert.ok(Number(data.planP.style.webkitLineClamp) !== 1, width + ' line-clamp');
      assert.ok(data.planP.style.textOverflow !== 'ellipsis', width + ' ellipsis');
      assert.ok(data.planI && data.planI.h >= 100, width + ' plan image height ' + (data.planI && data.planI.h));
      assert.ok(/object-fit:\s*cover/.test(homeCss), 'plan card image object-fit in CSS');
      assert.ok(data.button >= 44, width + ' search button ' + data.button);
      for (const field of data.fields) assert.ok(!field.clipped, width + ' clipped field ' + field.text);
      assert.ok(data.fields.some(field => field.text === 'All of Australia'), width + ' where');
      assert.ok(data.fields.some(field => field.text === 'Any day'), width + ' when');
      for (const helper of data.helpers) assert.ok(!helper.clipped, width + ' clipped helper ' + helper.text);
      assert.strictEqual(data.kicker, 'Example listings · not real hotels');
      assert.ok(!data.kickerClipped, width + ' kicker clipped');
      assert.ok(data.seeH >= 44, width + ' see all ' + data.seeH);
      if (width === 360 || width === 390) {
        assert.ok(data.exploreH2Top < data.inner * 1.2, width + ' explore h2 fold ' + data.exploreH2Top + ' vs ' + (data.inner * 1.2));
        assert.ok(data.freeCancelVisible, width + ' free cancellation subline');
      }
      if (width === 1024 || width === 1440) {
        assert.ok(data.iconTopSpread <= 2, width + ' assure icon top alignment ' + data.iconTopSpread);
      }
      if (width === 1024) {
        assert.ok(data.exploreH2Top < data.inner, width + ' explore h2 below fold ' + data.exploreH2Top + ' vs ' + data.inner);
      }
      if (width >= 1280) {
        assert.ok(data.top < data.inner, width + ' first listing below fold ' + data.top + ' vs ' + data.inner);
      }
      if (width === 1024 || width === 1100 || width === 1280 || width === 1440) {
        assert.ok(!data.searchOverlap, width + ' search overlaps what');
        assert.ok(!data.whatTxtClip, width + ' what field clipped');
      }
      if (width === 390 || width === 1280) {
        assert.ok(data.heroBox && data.phBox, width + ' hero ph boxes');
        assert.ok(Math.abs(data.phBox.height - data.heroBox.height) <= 2, width + ' hero ph fill ' + JSON.stringify({ hero: data.heroBox.height, ph: data.phBox.height }));
      }
      if (data.creditBox) {
        assert.ok(data.creditBox.width >= 20 && data.creditBox.height >= 10, width + ' credit visible ' + JSON.stringify(data.creditBox));
        assert.ok(data.creditBox.left >= -1 && data.creditBox.right <= data.width + 2, width + ' credit clipped');
      }
      if (width === 360 || width === 390) {
        assert.ok(!data.badgeKickerOverlap, width + ' credit overlaps kicker');
        assert.ok(data.creditLines <= 1, width + ' credit wraps ' + data.creditLines);
      }
      if (data.clockBox) {
        assert.ok(data.clockBox.width >= 20 && data.clockBox.height >= 10, width + ' clock visible ' + JSON.stringify(data.clockBox));
        assert.ok(data.clockBox.left >= -1 && data.clockBox.right <= data.width + 2, width + ' clock clipped');
      }
      if (data.quickBtns.length) {
        assert.strictEqual(data.quickBtns.length, 2, width + ' quick buttons');
        for (const qb of data.quickBtns) {
          assert.strictEqual(qb.td, 'none', width + ' quick underline ' + JSON.stringify(qb));
          assert.ok(qb.opaque, width + ' quick bg ' + qb.bg);
          assert.strictEqual(qb.display, 'flex', width + ' quick display ' + qb.display);
          assert.ok(qb.h >= 44, width + ' quick height ' + qb.h);
        }
      }
      console.log(width + 'x' + height + ' card top ' + Math.round(data.top) + ' explore h2 ' + Math.round(data.exploreH2Top) + ' of ' + data.inner);
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
