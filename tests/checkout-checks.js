const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');
const { CheckoutFlow } = require('../checkout');
const { CheckoutConsent, ConsentLog, LEGAL_EFFECTIVE, LEGAL_VERSIONS } = require('../consent');
const { GuestCheckIn } = require('../offering');

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
  assert.deepStrictEqual(CheckoutFlow.requiredTicks(), ['accept']);
  assert.deepStrictEqual(CheckoutFlow.consentTicks(), ['accept', 'marketing']);
  assert.strictEqual(CheckoutConsent.detailsSummary(), 'Read the full risk warning, hotel rules and group rules');
  assert.ok(CheckoutConsent.keyPointsText({ lifeguard: 0 }).includes('No lifeguard is on duty at this pool.'));
  assert.ok(!CheckoutConsent.keyPointsText({ lifeguard: 0 }).includes('A lifeguard is on duty'));
  assert.ok(CheckoutConsent.keyPointsText({ lifeguard: 1 }).includes('A lifeguard is on duty.'));
  assert.ok(!CheckoutConsent.keyPointsText({ lifeguard: 1 }).includes('No lifeguard is on duty at this pool.'));
  assert.ok(CheckoutConsent.keyPointsText({ lifeguard: 2, lifeguard_hours: '10am to 4pm' }).includes('A lifeguard is on duty during 10am to 4pm.'));
  assert.ok(CheckoutConsent.hazardLines({ kids_hours: 'All open hours, shallow end', age_policy: 'All ages', heated: 0, setting: 'outdoor' }).some(line => line.includes('shallow end')));
  assert.deepStrictEqual(CheckoutConsent.hazardLines({}), []);
  assert.ok(CheckoutConsent.acceptHtml().includes('href="/terms"') && CheckoutConsent.acceptHtml().includes('href="/refunds"'));
  assert.ok(CheckoutConsent.checkoutMarketingText().includes('by email'));
  assert.ok(!CheckoutConsent.checkoutMarketingText().includes('SMS'));
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
  assert.ok(css.includes('.co-full summary{display:flex;align-items:center;min-height:44px'));
  assert.ok(css.includes('.co-key{background:#F6EFE6'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));

  const port = 3482;
  const child = await start(port);
  try {
    const Database = require('better-sqlite3');
    const live = new Database(dbPath);
    const hotel = live.prepare("SELECT id FROM hotels WHERE slug='saltwater-terrace'").get();
    let when = '';
    for (let i = 3; i < 24 && !when; i++) {
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
    assert.ok(body.split('Tick the box above to continue.').length - 1 >= 4);
    assert.ok(!body.includes('Tick the 5 boxes'));
    assert.ok(body.includes('<span class="co-fact-val co-pass-line">Sun lounger × 1 · $45 (demo)</span>'));
    assert.ok(body.includes(`href="/h/saltwater-terrace?date=${when}&amp;pass=lounger&amp;qty=1#book"`));
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

    const boxes = [...body.matchAll(/<input type="checkbox" name="(accept|marketing|risk|rules|group|terms|share)"[^>]*>/g)];
    assert.strictEqual(boxes.length, 2, boxes.map(match => match[1]).join(','));
    const requiredNames = boxes.filter(match => /(?:^|\s)required(?:\s|>)/.test(match[0])).map(match => match[1]);
    assert.deepStrictEqual(requiredNames, ['accept']);
    assert.ok(!/(?:^|\s)required(?:\s|>)/.test(tickTag(body, 'marketing')));
    assert.ok(!tickTag(body, 'accept').includes('checked'));
    assert.ok(!tickTag(body, 'marketing').includes('checked'));
    assert.ok(body.includes('by email'));
    assert.ok(!body.includes('email/SMS'));
    assert.ok(!body.includes('name="share"'));
    const consent = body.slice(body.indexOf('id="co-consent"'), body.indexOf('class="co-decide"'));
    const detailsAt = consent.indexOf('<details class="co-full">');
    assert.ok(detailsAt > 0);
    const detailsTag = consent.slice(detailsAt, consent.indexOf('>', detailsAt) + 1);
    assert.ok(!/\sopen[\s>]/.test(detailsTag), detailsTag);
    assert.ok(consent.includes('<summary>Read the full risk warning, hotel rules and group rules</summary>'));
    const visible = consent.slice(0, detailsAt);
    assert.ok(visible.includes('No lifeguard is on duty at this pool.'));
    assert.ok(visible.includes('the hotel can refuse entry or ask you to leave, and no refund is payable unless the law requires it.'));
    assert.ok(visible.includes('Kids: All open hours'));
    assert.ok(!visible.includes('<h3>Risk warning</h3>'));
    assert.ok(consent.includes('<h3>Risk warning</h3>'));
    assert.ok(consent.includes('Group and children'));
    assert.ok(!consent.includes('Towels included'));
    assert.ok(!consent.includes('Free cancellation up to 24 hours before your access hours start.'));
    const detailsEnd = consent.indexOf('</details>');
    const noticeAt = consent.indexOf('We collect your name, email and mobile');
    const cancelAt = consent.indexOf('Cancellation and refunds');
    const tickAt = consent.indexOf('name="accept"');
    assert.ok(detailsEnd > detailsAt && noticeAt > detailsEnd && noticeAt < tickAt, 'collection notice above the tick');
    assert.ok(cancelAt > noticeAt && cancelAt < tickAt, 'cancellation line directly above the tick');
    assert.strictEqual(body.split('class="cancel-note"').length - 1, 1);
    assert.ok(body.includes('Nothing in this limits your rights under the Australian Consumer Law.'));
    assert.ok(body.includes('Infinity pool, heated'));
    for (const phrase of ['pending Legal', 'existing wording, unchanged', 'Demo payment', 'No card is needed', 'No money is taken', 'Tick the 3 boxes', 'Card number', '4242', 'I agree to Hotel Day Club sharing']) {
      assert.ok(!body.includes(phrase), phrase);
    }
    assert.ok(!/stripe/i.test(body));
    assert.ok(!/\bcommission\b/i.test(body));
    const visibleCopy = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
    assert.ok(!visibleCopy.includes('\u2014'));
    assert.ok(!/\d+\s*%/.test(visibleCopy));
    assert.ok(body.includes('Send me hot-day alerts and offers by email. I can unsubscribe at any time.'));

    let palmWhen = '';
    for (let i = 3; i < 24 && !palmWhen; i++) {
      const day = new Date();
      day.setDate(day.getDate() + i);
      if (![0, 4, 5, 6].includes(day.getDay())) continue;
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const palm = await get(port, `/checkout?hotel=palm-court&date=${encodeURIComponent(iso)}&pass=lounger&qty=1`);
      if (palm.status !== 200) continue;
      palmWhen = iso;
      const palmVisible = palm.body.slice(palm.body.indexOf('id="co-consent"'), palm.body.indexOf('<details class="co-full">'));
      assert.ok(palmVisible.includes('A lifeguard is on duty.'));
      assert.ok(!palmVisible.includes('No lifeguard is on duty at this pool.'));
      assert.ok(palmVisible.includes('shallow end'));
    }
    assert.ok(palmWhen, 'palm-court checkout');

    const token = (body.match(/name="book_token" value="([a-f0-9]+)"/) || [])[1];
    assert.ok(token);
    const oldDb = new Database(dbPath);
    const passId = oldDb.prepare("SELECT id FROM pass_types WHERE hotel_id=? AND code='lounger'").get(hotel.id).id;
    const oldBooking = oldDb.prepare(`INSERT INTO bookings(code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, status)
      VALUES ('HDC-OLDCONS', ?, ?, ?, 1, 45, 45, 'Old Guest', 'old@example.com', '0412000000', 'confirmed')`).run(hotel.id, passId, when).lastInsertRowid;
    const oldAt = '2026-11-12T01:02:03.000Z';
    oldDb.prepare('INSERT INTO consent_log(booking_id, kind, policy_version, consented_at, ip) VALUES (?, ?, ?, ?, ?)').run(oldBooking, 'terms', '2026-11-12', oldAt, '203.0.113.9');
    oldDb.prepare('INSERT INTO consent_log(booking_id, kind, policy_version, consented_at, ip) VALUES (?, ?, ?, ?, ?)').run(oldBooking, 'share', '2026-11-12', oldAt, '203.0.113.9');
    oldDb.close();

    const partial = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', book_token: token,
      name: 'Alex Citizen', email: 'not-an-email', phone: '0412', risk: '1', rules: '1', terms: '1', group: '1', share: '1',
    });
    assert.strictEqual(partial.status, 409);
    assert.ok(partial.body.includes('Tick the box above to continue.'));
    assert.ok(!/name="accept"[^>]*\schecked/.test(partial.body));
    assert.ok(!/name="marketing"[^>]*\schecked/.test(partial.body));
    assert.ok(partial.body.includes('value="Alex Citizen"'));
    assert.ok(partial.body.includes('aria-disabled="true"'));

    const again = (partial.body.match(/name="book_token" value="([a-f0-9]+)"/) || [])[1];
    assert.strictEqual(again, token);
    const ready = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', book_token: again,
      name: 'Alex Citizen', email: 'still-bad', phone: '0412345678',
      accept: '1',
    });
    assert.strictEqual(ready.status, 409);
    assert.ok(!ready.body.includes('aria-disabled="true"'));
    assert.strictEqual((ready.body.match(/class="co-reason"[^>]*hidden/g) || []).length, 3);
    const reasons = [...ready.body.matchAll(/<p class="co-reason"[^>]*>([^<]*)<\/p>/g)];
    assert.strictEqual(reasons.length, 3);
    assert.ok(reasons.every(match => match[1] === ''));
    assert.ok(!/>Tick the box above to continue.</.test(ready.body));
    assert.ok(ready.body.includes('Enter a valid email.'));
    assert.ok(tickTag(ready.body, 'accept').includes('checked'));
    assert.ok(!tickTag(ready.body, 'marketing').includes('checked'));

    const booked = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', book_token: again,
      name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678',
      accept: '1',
    });
    assert.strictEqual(booked.status, 303, booked.body.slice(0, 300));
    const done = await get(port, booked.headers.location);
    assert.strictEqual(done.status, 200);
    assert.ok(done.body.includes('<h1>Your demo booking</h1>'));
    assert.ok(done.body.includes('function clearCheckoutMemory()'));
    assert.ok(done.body.includes("indexOf('hdc-checkout:')"));
    assert.ok(done.body.includes('sessionStorage.removeItem(key)'));
    assert.ok(done.body.includes('clearCheckoutMemory();'));
    assert.ok(/Terms, Cancellation &amp; Refund Policy, hotel rules and risk warning: accepted at checkout \d{1,2} \w+ \d{4}, \d{1,2}:\d{2} (am|pm)\./.test(done.body));
    assert.strictEqual((done.body.match(/accepted at checkout/g) || []).length, 1);
    assert.ok(done.body.includes(GuestCheckIn.line().replace(/'/g, '&#39;')));
    assert.ok(!done.body.includes('<b>Bring</b>'));
    assert.ok(done.body.includes('Before you swim'));
    assert.ok(done.body.includes('Demo: nothing is charged or refunded.'));

    const saved = new Database(dbPath);
    const stored = saved.prepare('SELECT id, consent_at, consent_ip, marketing_opt_in, rules_text FROM bookings WHERE email=?').get('alex@example.com');
    const logs = saved.prepare('SELECT kind, policy_version, consented_at, ip, terms_version, refunds_version, rules_version, risk_version, privacy_version, marketing FROM consent_log WHERE booking_id=?').all(stored.id);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].kind, 'acceptance');
    assert.strictEqual(logs[0].terms_version, LEGAL_VERSIONS.terms);
    assert.strictEqual(logs[0].refunds_version, '2026-11-12');
    assert.strictEqual(logs[0].risk_version, LEGAL_VERSIONS.risk);
    assert.strictEqual(logs[0].privacy_version, LEGAL_VERSIONS.privacy);
    assert.strictEqual(logs[0].rules_version, ConsentLog.rulesVersion(stored.rules_text));
    assert.strictEqual(logs[0].consented_at, stored.consent_at);
    assert.strictEqual(logs[0].ip, stored.consent_ip);
    assert.ok(stored.consent_ip);
    assert.strictEqual(logs[0].marketing, 0);
    assert.strictEqual(stored.marketing_opt_in, 0);
    assert.strictEqual(LEGAL_EFFECTIVE, '2026-11-15');
    const kept = saved.prepare('SELECT kind, policy_version, consented_at, ip, terms_version, marketing FROM consent_log WHERE booking_id=? ORDER BY kind').all(oldBooking);
    assert.deepStrictEqual(kept, [
      { kind: 'share', policy_version: '2026-11-12', consented_at: oldAt, ip: '203.0.113.9', terms_version: null, marketing: null },
      { kind: 'terms', policy_version: '2026-11-12', consented_at: oldAt, ip: '203.0.113.9', terms_version: null, marketing: null },
    ]);
    saved.close();

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
    assert.ok(plain.body.includes('Tick the box above to continue.'));
    assert.ok(plain.body.includes('No lifeguard is on duty at this pool.'));
    assert.strictEqual((plain.body.match(/<input type="checkbox"/g) || []).length, 2);
    console.log('checkout checks passed');
  } finally {
    child.kill();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
