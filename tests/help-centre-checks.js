const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { esc } = require('../util');
const { GuestCheckIn, FOOD_RULE, FREE_CANCEL } = require('../offering');
const { HelpCentre, RAW_CATEGORIES } = require('../helpCentre');
const seo = require('../seo');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'tmp-help-centre.db');

function get(port, pathName) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathName }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

function titleOf(html) {
  const m = html.match(/<title>([^<]+)<\/title>/);
  return m ? m[1] : '';
}

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  const port = 3847 + Math.floor(Math.random() * 200);
  const env = { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'hc-admin' };
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let boot = '';
  child.stderr.on('data', d => { boot += d; });
  const ready = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server timeout\n' + boot)), 30000);
    const iv = setInterval(async () => {
      try {
        const h = await get(port, '/healthz');
        if (h.status === 200) { clearInterval(iv); clearTimeout(t); resolve(); }
      } catch (_) { /* wait */ }
    }, 120);
    child.on('exit', code => { clearInterval(iv); clearTimeout(t); reject(new Error('exit ' + code + '\n' + boot)); });
  });
  void ready;

  try {
    const mail = '<a href="mailto:hello@hoteldayclub.com.au">hello@hoteldayclub.com.au</a>';
    const hiw = await get(port, '/how-it-works');
    assert.strictEqual(hiw.status, 200);
    assert.ok(hiw.body.includes('id="hc-q"'));
    assert.ok(hiw.body.includes('label[for=hc-q]') || hiw.body.includes('for="hc-q"'));
    assert.ok(hiw.body.includes('Browse by topic'));
    assert.ok(hiw.body.includes('class="hc-art"'));
    assert.ok(hiw.body.includes('id="guests"'));
    assert.ok(hiw.body.includes('id="partners"'));
    assert.ok(hiw.body.includes('href="/for-hotels"'));
    assert.ok(!hiw.body.includes('Your share is set out in your hotel agreement'));
    assert.ok(!/\bshare\b/i.test(hiw.body.replace(/<footer[\s\S]*/i, '')));
    assert.ok(!/%|commission/i.test(hiw.body.replace(/<footer[\s\S]*/i, '')));
    for (const banned of ['While free cancellation is open', 'Nothing is returned to a card']) {
      assert.ok(!hiw.body.includes(banned), 'banned: ' + banned);
    }
    assert.ok(hiw.body.includes(FOOD_RULE));
    assert.strictEqual(titleOf(hiw.body), 'Help centre: how hotel day passes work · Hotel Day Club');
    assert.ok(!hiw.body.includes('FAQPage'));
    const ids = HelpCentre.articleIds();
    const seen = new Set();
    for (const id of ids) {
      assert.ok(hiw.body.includes('id="' + id + '"'), id);
      assert.ok(!seen.has(id), 'dup ' + id);
      seen.add(id);
    }
    assert.strictEqual(seen.size, (hiw.body.match(/class="hc-art"/g) || []).length);

    for (const cat of RAW_CATEGORIES) {
      const slice = hiw.body.slice(hiw.body.indexOf('id="' + cat.id + '"'), hiw.body.indexOf('</details>', hiw.body.indexOf('id="' + cat.id + '"')));
      assert.ok(slice.includes('class="hc-sec-n">' + cat.articles.length + '</span>'), cat.id);
    }

    const deep = await get(port, '/how-it-works#can-i-cancel-for-free');
    assert.ok(deep.body.includes('id="can-i-cancel-for-free"'));
    assert.ok(hiw.body.includes('id="do-i-need-a-towel"'));
    assert.ok(hiw.body.includes('id="cant-find-booking-email"'));
    assert.ok(hiw.body.includes('No, towels are included unless the listing says to bring your own.'));

    const faqBefore = await get(port, '/faq');
    const faqAfter = faqBefore.body;
    assert.ok(faqAfter.includes('FAQPage') || faqAfter.includes('@type":"FAQPage"'));

    const guide = await get(port, '/guides/day-pass-hotel-stay-or-day-spa');
    assert.strictEqual(guide.status, 200);
    assert.ok(guide.body.includes('gd-cmp'));
    assert.ok(!guide.body.includes('\u2014'));
    const map = await get(port, '/sitemap.xml');
    assert.ok(map.body.includes('/guides/day-pass-hotel-stay-or-day-spa'));

    const guides = await get(port, '/guides');
    assert.ok(guides.body.includes('/guides/day-pass-hotel-stay-or-day-spa'));

    const a12 = esc(GuestCheckIn.line());
    const guests = hiw.body.slice(hiw.body.indexOf('id="guests"'), hiw.body.indexOf('Browse by topic'));
    assert.strictEqual(guests.split(a12).length - 1, 1);
    assert.ok(guests.includes('Tick one box to accept the terms.'));
    assert.ok(guests.includes('The full risk warning, hotel rules and group rules are in a dropdown above it.'));
    assert.ok(guests.includes('Hot-day alerts and offers by email are optional, in a separate box left unticked.'));
    assert.ok(!guests.includes('. is optional'));
    assert.ok(!/sharing consent/i.test(hiw.body));
    assert.ok(!guests.includes('tick the risk warning, hotel rules, group and children'));

    for (const p of ['/', '/search', '/how-it-works', '/faq', '/h/saltwater-terrace']) {
      const page = p === '/how-it-works' ? hiw : await get(port, p);
      const prose = visibleText(page.body).toLowerCase();
      assert.ok(!prose.includes('24 hours to cancel'), p);
      assert.ok(!prose.includes('you have 24 hours to cancel'), p);
    }

    const search = await get(port, '/search');
    assert.ok(!search.body.includes('class="ex-note">Demo</p>'));
    assert.ok(search.body.includes('class="book-pill"'));
    assert.ok(search.body.includes('>Book<span'));
    assert.ok(!search.body.includes('View details'));

    const far = ymdAdd(20);
    const listing = await get(port, '/h/saltwater-terrace?date=' + encodeURIComponent(far));
    const datesBlock = listing.body.slice(listing.body.indexOf('id="d2-dates"'), listing.body.indexOf('</div>', listing.body.indexOf('id="d2-dates"')));
    const extraOn = datesBlock.indexOf('value="' + far + '"');
    const todayOn = datesBlock.indexOf('>Today<');
    assert.ok(extraOn > todayOn, 'out-of-range chip after the 14 chips');

    for (const art of RAW_CATEGORIES.flatMap(c => c.articles)) {
      if (!art.from || !art.from.startsWith('faq:')) continue;
      const q = art.from.slice(4);
      const faqHtml = seo.faqItems(mail).find(i => i.q === q).html;
      const resolved = HelpCentre.resolveHtml(art, mail);
      assert.strictEqual(resolved, faqHtml, q);
    }
  } finally {
    child.kill('SIGTERM');
  }
  console.log('help-centre checks passed');
}

function ymdAdd(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

main().catch(err => { console.error(err); process.exit(1); });