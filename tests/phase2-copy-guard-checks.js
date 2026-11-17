const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const seo = require('../seo');
const { faqPlusDetail } = require('../faqUi');

const root = path.join(__dirname, '..');
const baseCss = fs.readFileSync(path.join(root, 'public/base.css'), 'utf8');
const mail = '<a href="mailto:hello@hoteldayclub.com.au">hello@hoteldayclub.com.au</a>';

assert.ok(baseCss.includes('--section:88px') || fs.readFileSync(path.join(root, 'public/tokens.css'), 'utf8').includes('--section:88px'), 'section rhythm token');
assert.ok(baseCss.includes('.faq-plus'), 'faq plus icon styles in base.css');
assert.ok(baseCss.includes('body.guest:not(.home) main > .wrap.sec:first-child'), 'inner page top rhythm');
assert.ok(baseCss.includes('.faq-page .l-title'), 'faq page title rhythm');

for (const item of seo.faqItems(mail)) {
  const row = faqPlusDetail(item.q, item.html);
  assert.ok(row.includes('class="faq-plus"'), item.q);
  assert.ok(row.includes('<summary><span>'), item.q + ' summary span');
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function start(port, dbPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'p2c-admin', DEMO_HOTEL_PASSWORD: 'p2c-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('timeout\n' + log)), 25000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('exit ' + code)));
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-p2c-'));
const port = 3910 + Math.floor(Math.random() * 40);

(async () => {
  const child = await start(port, path.join(dir, 'app.db'));
  try {
    const guests = ['/', '/search', '/for-hotels', '/how-it-works', '/faq', '/contact', '/about', '/guides'];
    for (const p of guests) {
      const { status, body } = await get(port, p);
      assert.strictEqual(status, 200, p);
      const prose = body.replace(/<footer[\s\S]*/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');
      assert.ok(!/\bcommission\b/i.test(prose), p + ' mentions commission');
      assert.ok(!/\u2014/.test(prose), p + ' em-dash');
    }
    const fhProse = (await get(port, '/for-hotels')).body.replace(/<footer[\s\S]*/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    assert.ok(!/\btrial\b/i.test(fhProse), '/for-hotels trial');
    assert.ok(!/\bpilot\b/i.test(fhProse), '/for-hotels pilot');

    const faq = (await get(port, '/faq')).body;
    const items = seo.faqItems(mail);
    assert.ok(faq.includes('faq-page'), '/faq rhythm wrapper');
    assert.ok(faq.includes('contact-kicker'), '/faq kicker');
    for (const item of items) {
      assert.ok(faq.includes(item.q), '/faq question ' + item.q);
    }
    const bring = items.find(item => item.q === 'What should I bring?');
    assert.ok(bring.html.includes('Towels are included with every pass by default'), '/faq towel default');
    assert.ok(bring.html.includes('Bring your own towel'), '/faq towel opt-out');
    assert.ok(!/listing says if a towel is included/i.test(bring.html), '/faq old towel wording');
    const plusCount = (faq.match(/class="faq-plus"/g) || []).length;
    assert.strictEqual(plusCount, items.length, 'faq plus icon count');

    const home = (await get(port, '/')).body;
    assert.ok((home.match(/class="faq-plus"/g) || []).length >= 4, 'home FAQ plus icons');

    const hiw = (await get(port, '/how-it-works')).body;
    assert.ok((hiw.match(/class="faq-plus"/g) || []).length >= HelpCentreArticleCount(hiw), 'help centre article plus icons');
    assert.ok(hiw.includes('<svg class="hc-ico"'), 'help centre category icons');
  } finally {
    child.kill('SIGTERM');
  }
  console.log('phase2-copy-guard-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

function HelpCentreArticleCount(html) {
  return (html.match(/class="hc-art"/g) || []).length;
}