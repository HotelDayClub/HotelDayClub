const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');
const { CheckoutFlow } = require('../checkout');
const { CheckoutConsent } = require('../consent');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-checkout-'));
const dbPath = path.join(dir, 'daypass.db');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function post(port, urlPath, fields) {
  const body = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'checkout-admin', DEMO_HOTEL_PASSWORD: 'checkout-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

function tickTag(body, name) {
  const found = body.match(new RegExp(`<input type="checkbox" name="${name}"[^>]*>`));
  assert.ok(found, name);
  return found[0];
}

function memorySandbox() {
  const bag = { keys: ['hdc-checkout:saltwater-terrace:2026-11-23:lounger:1', 'other'] };
  const sessionStorage = {
    get length() { return bag.keys.length; },
    key(i) { return bag.keys[i]; },
    removeItem(key) { bag.keys = bag.keys.filter(item => item !== key); },
  };
  const context = { sessionStorage, bag };
  vm.createContext(context);
  vm.runInContext(CheckoutFlow.storageApi(), context);
  return context;
}

function field(value) {
  return { value: value || '' };
}

function makeForm(opts = {}) {
  const addons = (opts.addons || []).map(row => ({ value: row.value, checked: !!row.checked, disabled: !!row.disabled }));
  const form = {
    name: field(opts.name),
    email: field(opts.email),
    phone: field(opts.phone),
    arrival: {
      value: opts.arrival || '',
      querySelector(sel) {
        const match = /option\[value="([^"]*)"\]/.exec(sel);
        return match && match[1] === '10:00' ? { value: '10:00' } : null;
      },
    },
    rules: { checked: false },
    terms: { checked: false },
    risk: { checked: false },
    group: { checked: false },
    share: { checked: false },
    marketing: { checked: false },
    querySelectorAll(sel) {
      if (sel === 'input[name=addon]:checked') return addons.filter(row => row.checked);
      return [];
    },
    querySelector(sel) {
      const match = /input\[name=addon\]\[value="([^"]*)"\]/.exec(sel);
      if (!match) return null;
      return addons.find(row => row.value === match[1]) || null;
    },
  };
  return { form, addons };
}

(async () => {
  assert.deepStrictEqual(CheckoutFlow.steps(true), { details: 1, arrival: 2, extras: 3, payment: 4, before: 5 });
  assert.deepStrictEqual(CheckoutFlow.steps(false), { details: 1, arrival: 2, extras: 0, payment: 3, before: 4 });
  assert.strictEqual(CheckoutFlow.reason(5), 'Tick the 5 boxes above to continue.');
  assert.strictEqual(CheckoutFlow.reason(2), 'Tick the 2 boxes above to continue.');
  assert.strictEqual(CheckoutFlow.reason(1), 'Tick the box above to continue.');
  assert.strictEqual(CheckoutFlow.reason(0), '');
  assert.strictEqual(CheckoutFlow.riskSlot(), '<div id="co-risk-slot" hidden></div>');
  assert.strictEqual(CheckoutFlow.extraValue([]), 'None');
  assert.strictEqual(CheckoutFlow.extraValue([{ name: 'Parking', qty: 1, line: 18 }]), 'Parking × 1 · $18 (demo)');
  assert.ok(CheckoutFlow.changeLink('#extras', 'extras').includes('aria-label="Change extras"'));

  const memory = memorySandbox();
  const filled = makeForm({ name: 'Alex', addons: [{ value: 'gym', checked: true }] });
  filled.form.rules.checked = true;
  filled.form.marketing.checked = true;
  const payload = memory.checkoutPayload(filled.form);
  assert.strictEqual(JSON.stringify(payload), JSON.stringify({ name: 'Alex', email: '', phone: '', arrival: '', addon: ['gym'] }));
  assert.strictEqual(payload.rules, undefined);
  assert.strictEqual(payload.marketing, undefined);

  const fresh = makeForm({ addons: [{ value: 'gym', checked: false }] });
  memory.applyCheckoutMemory(fresh.form, {
    name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', arrival: '10:00',
    rules: true, terms: true, risk: true, group: true, share: true, marketing: true, addon: ['gym'],
  });
  assert.strictEqual(fresh.form.name.value, 'Alex Citizen');
  assert.strictEqual(fresh.form.email.value, 'alex@example.com');
  assert.strictEqual(fresh.form.phone.value, '0412345678');
  assert.strictEqual(fresh.form.arrival.value, '10:00');
  assert.strictEqual(fresh.form.rules.checked, false);
  assert.strictEqual(fresh.form.terms.checked, false);
  assert.strictEqual(fresh.form.risk.checked, false);
  assert.strictEqual(fresh.form.group.checked, false);
  assert.strictEqual(fresh.form.share.checked, false);
  assert.strictEqual(fresh.form.marketing.checked, false);
  assert.strictEqual(fresh.addons[0].checked, true);
  for (let n = 0; n <= 5; n++) assert.strictEqual(memory.checkoutReason(n), CheckoutFlow.reason(n), 'reason ' + n);
  memory.clearCheckoutMemory();
  assert.deepStrictEqual(Array.from(memory.bag.keys), ['other']);

  const css = fs.readFileSync(path.join(__dirname, '../public/app.css'), 'utf8');
  assert.ok(css.includes('.co-before .tick{display:flex;align-items:flex-start;gap:12px;min-height:44px'));
  assert.ok(css.includes('.co-before .tick input[type="checkbox"]{width:22px;height:22px'));
  assert.ok(css.includes('#co-risk-slot{display:none}'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));

  const port = 3482;
  const child = await start(port);
  try {
    const Database = require('better-sqlite3');
    const live = new Database(dbPath);
    const hotel = live.prepare("SELECT id FROM hotels WHERE slug='saltwater-terrace'").get();
    let when = '';
    for (let i = 1; i < 21 && !when; i++) {
      const day = new Date();
      day.setDate(day.getDate() + i);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      if (!live.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?').get(hotel.id, iso)) when = iso;
    }
    live.close();
    assert.ok(when);

    const checkout = await get(port, `/checkout?hotel=saltwater-terrace&date=${encodeURIComponent(when)}&pass=lounger&qty=1`);
    assert.strictEqual(checkout.status, 200);
    const body = checkout.body;
    assert.ok(!body.includes('\u2014'));
    assert.ok(body.includes('<h1 class="l-title">Book your day (demo)</h1>'));
    assert.ok(body.includes('<span class="co-step">1</span> Your details'));
    assert.ok(body.includes('<span class="co-step">2</span> Arrival'));
    assert.ok(body.includes('<span class="co-step">3</span> Add extras'));
    assert.ok(body.includes('<span class="co-step">4</span> Payment'));
    assert.ok(body.includes('<span class="co-step">5</span> Before you book'));
    const label = 'Confirm booking · $45 (demo)';
    assert.strictEqual(body.split(label).length - 1, 3);
    assert.strictEqual((body.match(/class="btn btn-coral co-btn/g) || []).length, 3);
    assert.strictEqual((body.match(/aria-disabled="true"/g) || []).length, 3);
    assert.ok(body.includes('id="co-btn"'));
    assert.ok(body.includes('id="co-btn-form"'));
    assert.ok(body.includes('class="co-decide"'));
    assert.ok(body.includes('class="co-dock"'));
    assert.ok(body.includes('id="co-reason-live" aria-live="polite"'));
    assert.ok(body.split('Tick the 5 boxes above to continue.').length - 1 >= 4);
    assert.ok(body.includes('<span class="co-fact-val co-pass-line">Sun lounger × 1 · $45 (demo)</span>'));
    assert.ok(body.includes(`href="/h/saltwater-terrace/seat/lounger?date=${when}&amp;qty=1"`));
    assert.ok(body.includes(`href="/h/saltwater-terrace?date=${when}#book"`));
    assert.ok(body.includes('href="#extras"'));
    assert.ok(body.includes('aria-label="Change date"'));
    assert.ok(body.includes('aria-label="Change pass"'));
    assert.ok(body.includes('aria-label="Change extras"'));
    assert.ok(body.includes('id="co-extras-val">None</span>'));
    assert.ok(body.includes("extras.innerHTML=parts.length?parts.join(', '):'None'"));
    assert.ok(body.includes('>Pass</dt>'));
    assert.ok(body.includes('>Guests</dt>'));
    const pay = body.slice(body.indexOf('id="co-pay"'), body.indexOf('id="co-consent"'));
    assert.ok(pay.includes('Demo site. No card is collected and nothing is charged.'));
    assert.ok(!pay.includes('<svg'));
    assert.ok(!pay.includes('Demo payment'));
    assert.ok(!pay.includes('No card is needed'));
    assert.strictEqual(body.split('Demo site. No card is collected and nothing is charged.').length - 1, 1);
    assert.ok(!body.includes('saved.rules'));
    assert.ok(!body.includes('saved.terms'));
    assert.ok(!body.includes('saved.risk'));
    assert.ok(!body.includes('saved.marketing'));
    assert.ok(!body.includes('form.rules.checked='));
    assert.ok(body.includes('applyCheckoutMemory'));
    assert.ok(body.includes('checkoutPayload'));
    assert.ok(body.includes('Confirming'));

    const boxes = [...body.matchAll(/<input type="checkbox" name="(risk|rules|group|terms|share|marketing)"[^>]*>/g)];
    assert.strictEqual(boxes.length, 6);
    const requiredNames = boxes.filter(match => /(?:^|\s)required(?:\s|>)/.test(match[0])).map(match => match[1]).sort();
    assert.deepStrictEqual(requiredNames, ['group', 'risk', 'rules', 'share', 'terms']);
    assert.ok(!/(?:^|\s)required(?:\s|>)/.test(tickTag(body, 'marketing')));
    for (const name of CheckoutFlow.requiredTicks()) assert.ok(!tickTag(body, name).includes('checked'), name);
    assert.strictEqual(body.split(CheckoutConsent.riskHtml()).length - 1, 1);
    assert.strictEqual((body.match(/<h3>Risk warning<\/h3>/g) || []).length, 1);
    const slot = body.match(/<div id="co-risk-slot"[^>]*>[\s\S]*?<\/div>/);
    assert.ok(slot);
    assert.strictEqual(slot[0], '<div id="co-risk-slot" hidden></div>');
    for (const phrase of ['pending Legal', 'existing wording, unchanged', 'Demo payment', 'No card is needed', 'No money is taken', 'Tick the 3 boxes', 'Card number', '4242']) {
      assert.ok(!body.includes(phrase), phrase);
    }
    assert.ok(!/stripe/i.test(body));
    assert.ok(body.includes('I agree to Hotel Day Club sharing my name, email, mobile and booking details with The Saltwater Terrace (Demo) for this booking.'));
    assert.ok(body.includes('Send me hot-day alerts and offers by email/SMS. I can unsubscribe at any time.'));

    const token = (body.match(/name="book_token" value="([a-f0-9]+)"/) || [])[1];
    assert.ok(token);
    const partial = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', book_token: token,
      name: 'Alex Citizen', email: 'not-an-email', phone: '0412', risk: '1', rules: '1',
    });
    assert.strictEqual(partial.status, 409);
    assert.ok(partial.body.includes('Tick the 3 boxes above to continue.'));
    assert.ok(/name="risk"[^>]*\schecked/.test(partial.body));
    assert.ok(/name="rules"[^>]*\schecked/.test(partial.body));
    assert.ok(!/name="group"[^>]*\schecked/.test(partial.body));
    assert.ok(!/name="terms"[^>]*\schecked/.test(partial.body));
    assert.ok(!/name="share"[^>]*\schecked/.test(partial.body));
    assert.ok(!/name="marketing"[^>]*\schecked/.test(partial.body));
    assert.ok(partial.body.includes('value="Alex Citizen"'));
    assert.ok(partial.body.includes('aria-disabled="true"'));

    const again = (partial.body.match(/name="book_token" value="([a-f0-9]+)"/) || [])[1];
    assert.strictEqual(again, token);
    const ready = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', book_token: again,
      name: 'Alex Citizen', email: 'still-bad', phone: '0412345678',
      risk: '1', rules: '1', group: '1', terms: '1', share: '1',
    });
    assert.strictEqual(ready.status, 409);
    assert.ok(!ready.body.includes('aria-disabled="true"'));
    assert.strictEqual((ready.body.match(/class="co-reason"[^>]*hidden/g) || []).length, 3);
    const reasons = [...ready.body.matchAll(/<p class="co-reason"[^>]*>([^<]*)<\/p>/g)];
    assert.strictEqual(reasons.length, 3);
    assert.ok(reasons.every(match => match[1] === ''));
    assert.ok(!/>Tick the 5 boxes above to continue.</.test(ready.body));
    assert.ok(!/>Tick the box above to continue.</.test(ready.body));
    assert.ok(ready.body.includes('Enter a valid email.'));
    for (const name of CheckoutFlow.requiredTicks()) assert.ok(tickTag(ready.body, name).includes('checked'), name);
    assert.ok(!tickTag(ready.body, 'marketing').includes('checked'));

    const booked = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', book_token: again,
      name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678',
      risk: '1', rules: '1', group: '1', terms: '1', share: '1',
    });
    assert.strictEqual(booked.status, 303, booked.body.slice(0, 300));
    const done = await get(port, booked.headers.location);
    assert.strictEqual(done.status, 200);
    assert.ok(done.body.includes('<h1>Your demo booking</h1>'));
    assert.ok(done.body.includes('function clearCheckoutMemory()'));
    assert.ok(done.body.includes("indexOf('hdc-checkout:')"));
    assert.ok(done.body.includes('sessionStorage.removeItem(key)'));
    assert.ok(done.body.includes('clearCheckoutMemory();'));

    const write = new Database(dbPath);
    write.prepare('UPDATE addons SET enabled=0 WHERE hotel_id=?').run(hotel.id);
    write.close();
    const plain = await get(port, `/checkout?hotel=saltwater-terrace&date=${encodeURIComponent(when)}&pass=lounger&qty=1`);
    assert.strictEqual(plain.status, 200);
    const plainMarkup = plain.body.slice(plain.body.indexOf('class="wrap sec checkout"'), plain.body.indexOf('<script>', plain.body.indexOf('class="wrap sec checkout"')));
    assert.ok(plainMarkup.includes('<span class="co-step">1</span> Your details'));
    assert.ok(plainMarkup.includes('<span class="co-step">2</span> Arrival'));
    assert.ok(plainMarkup.includes('<span class="co-step">3</span> Payment'));
    assert.ok(plainMarkup.includes('<span class="co-step">4</span> Before you book'));
    assert.ok(!plainMarkup.includes('Add extras'));
    assert.ok(!plainMarkup.includes('id="extras"'));
    assert.ok(!plainMarkup.includes('href="#extras"'));
    assert.ok(plain.body.includes('Tick the 5 boxes above to continue.'));
    assert.strictEqual(plain.body.split(CheckoutConsent.riskHtml()).length - 1, 1);
    console.log('checkout checks passed');
  } finally {
    child.kill();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
