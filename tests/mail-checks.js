const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-mail-'));
const unitPath = path.join(dir, 'unit.db');
process.env.DB_PATH = unitPath;
process.env.DATA_DIR = '';
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
delete process.env.CONTACT_EMAIL;

const db = require('../db');
const mailer = require('../mailer');
const notices = require('../notices');

const GUEST = 'leak-guest@example.com';
const STREET = '99 Secret Lane, Sydney NSW 2000';
const PHONE = '0412999000';

function capture(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  return Promise.resolve().then(fn).finally(() => { console.error = orig; }).then(result => ({ result, lines }));
}
function rowState(code) {
  return db.prepare('SELECT guest_email_tries tries, guest_email_state state FROM bookings WHERE code=?').get(code);
}
function alertState(id) {
  return db.prepare('SELECT alert_tries tries, alert_state state FROM contact_messages WHERE id=?').get(id);
}

const day = new Date(2026, 10, 4);
const hotelId = db.prepare(`INSERT INTO hotels (slug, name, area, login, address, hours, lifeguard, is_demo, photos)
  VALUES ('mail-pool', 'Skyline Rooftop', 'Bondi Beach', 'mail-pool', ?, 'Daily · 10am–4pm', 0, 1, '[]')`).run(STREET).lastInsertRowid;
db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)').run(hotelId, day.getDay(), '10:00', '16:00');
const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, holds) VALUES (?, 'chair', 'Pool chair', 40, 1)`).run(hotelId).lastInsertRowid;
const addonId = db.prepare(`INSERT INTO addons (hotel_id, code, name, price, per, enabled) VALUES (?, 'gym', 'Gym', 10, 'person', 1)`).run(hotelId).lastInsertRowid;
db.prepare(`INSERT INTO inclusions (hotel_id, code, mode, price, daily_cap, note) VALUES (?, 'towels', 'included', 0, 0, '')`).run(hotelId);

function insertBooking(code, email) {
  const id = db.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, party, cancel_note)
    VALUES (?, ?, ?, '2026-11-04', 2, 40, 100, 'Alex Citizen', ?, ?, 2, 'Free cancellation until 11am Wed 4 Nov.')`).run(code, hotelId, passId, email, PHONE).lastInsertRowid;
  db.prepare(`INSERT INTO booking_addons (booking_id, addon_id, name, qty, unit_price, total) VALUES (?, ?, 'Gym', 2, 10, 20)`).run(id, addonId);
}

function recorder(decide) {
  const calls = [];
  function request(options, cb) {
    const handlers = {};
    const req = {
      on(ev, fn) { handlers[ev] = fn; return this; },
      setTimeout(ms, fn) { this._timeout = fn; return this; },
      destroy() { this.destroyed = true; },
      end(body) {
        const call = { options, body: String(body || '') };
        calls.push(call);
        const outcome = decide(calls.length, call);
        if (outcome === 'error') {
          handlers.error(new Error('connect failed for ' + GUEST + ' bearer secret-key'));
          return;
        }
        if (outcome === 'timeout') {
          this._timeout();
          return;
        }
        cb({
          statusCode: outcome,
          resume() {},
          on() {},
        });
      },
    };
    return req;
  }
  return { request, calls };
}

(async () => {
  const direct = notices.bookingNotice({
    demo: true,
    to: GUEST,
    code: 'HDC-ABC',
    hotelName: 'Salt & <Sea>',
    area: 'Bondi Beach',
    dateLabel: 'Wed 4 Nov',
    hours: '10am–4pm',
    passLabel: 'Pool chair × 1',
    guests: '1',
    included: '1 × Towels',
    addons: [{ name: 'Gym', qty: 2, totalLabel: '$20' }],
    totalLabel: '$40',
    cancel: 'Free cancellation until 11am Wed 4 Nov.',
    risk: 'Before you swim: No lifeguard on duty.',
    contact: 'hello@hoteldayclub.com.au',
    link: 'https://www.hoteldayclub.com.au/booking/HDC-ABC',
    guest: 'Alex C.',
    address: STREET,
    phone: PHONE,
  });
  assert.ok(direct.html.includes('Salt &amp; &lt;Sea&gt;'));
  assert.ok(!direct.html.includes('<Sea>'));
  assert.ok(!direct.html.includes(STREET) && !direct.text.includes(STREET));
  assert.ok(!direct.html.includes('Sydney') && !direct.text.includes('Sydney'));
  assert.ok(!direct.html.includes(PHONE) && !direct.text.includes(PHONE));
  assert.ok(!direct.html.includes(GUEST) && !direct.text.includes(GUEST));
  assert.ok(!direct.html.includes('Alex Citizen') && !direct.text.includes('Alex Citizen'));
  assert.ok(direct.html.includes('Alex C.') && direct.text.includes('Alex C.'));
  assert.ok(direct.html.includes('Bondi Beach, Australia'));
  assert.ok(direct.html.includes('1 × Towels'));
  assert.ok(direct.text.includes('Included: 1 × Towels'));
  assert.ok(direct.html.includes('This is a demo booking. No payment was taken and no real booking exists. This is not a reservation at a real hotel.'));
  assert.ok(direct.text.includes('No payment was taken'));
  assert.ok(direct.html.includes('https://www.hoteldayclub.com.au/booking/HDC-ABC'));
  assert.ok(direct.html.includes('#0A1428') && direct.html.includes('#0E1E3A'));
  assert.ok(!/unsubscribe/i.test(direct.html + direct.text));
  assert.strictEqual(direct.subject, 'Your Hotel Day Club demo booking HDC-ABC');
  const liveNote = notices.bookingNotice({
    demo: false,
    to: GUEST,
    code: 'HDC-ABC',
    hotelName: 'Skyline Rooftop',
    area: 'Bondi Beach',
    dateLabel: 'Wed 4 Nov',
    hours: '10am–4pm',
    passLabel: 'Pool chair × 1',
    guests: '1',
    addons: [],
    totalLabel: '$40',
    cancel: 'Free cancellation until 11am Wed 4 Nov.',
    risk: 'Before you swim: No lifeguard on duty.',
    contact: 'hello@hoteldayclub.com.au',
    link: 'https://www.hoteldayclub.com.au/booking/HDC-ABC',
    guest: 'Alex C.',
  });
  assert.strictEqual(liveNote.subject, 'Your Hotel Day Club booking HDC-ABC');
  assert.ok(!liveNote.html.includes('no real booking') && !liveNote.html.includes('demo booking'));
  assert.ok(liveNote.text.includes('Extras: None'));

  const skipped = await capture(() => mailer.sendMail({ to: GUEST, subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' }));
  assert.strictEqual(skipped.result.skipped, true);
  assert.ok(skipped.lines.some(l => l.includes('RESEND_API_KEY unset')));
  assert.ok(!skipped.lines.join('\n').includes(GUEST));

  process.env.RESEND_API_KEY = 're_test_key_should_not_log';
  const noFrom = await capture(() => mailer.sendMail({ to: GUEST, subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' }));
  assert.strictEqual(noFrom.result.skipped, true);
  assert.ok(noFrom.lines.some(l => l.includes('MAIL_FROM unset')));
  assert.ok(!noFrom.lines.join('\n').includes(GUEST));
  assert.ok(!noFrom.lines.join('\n').includes('re_test_key_should_not_log'));

  process.env.MAIL_FROM = 'Hotel Day Club <hello@hoteldayclub.com.au>';
  const badTo = await capture(() => mailer.sendMail({ to: 'not an email', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' }));
  assert.strictEqual(badTo.result.skipped, true);
  assert.ok(badTo.lines.some(l => l === 'mail: skipped, recipient not usable'));

  const okReq = recorder(() => 200);
  mailer.setRequest(okReq.request);
  const sent = await capture(() => mailer.sendMail({
    to: GUEST,
    subject: 'Line\nbreak',
    html: '<p>Hello</p>',
    text: 'Hello',
    idempotencyKey: 'booking:HDC-1',
  }));
  assert.strictEqual(sent.result.ok, true);
  assert.strictEqual(okReq.calls.length, 1);
  const call = okReq.calls[0];
  assert.strictEqual(call.options.hostname, 'api.resend.com');
  assert.strictEqual(call.options.path, '/emails');
  assert.strictEqual(call.options.method, 'POST');
  assert.strictEqual(call.options.headers.Authorization, 'Bearer re_test_key_should_not_log');
  assert.strictEqual(call.options.headers['Idempotency-Key'], 'booking:HDC-1');
  const payload = JSON.parse(call.body);
  assert.strictEqual(payload.from, 'Hotel Day Club <hello@hoteldayclub.com.au>');
  assert.deepStrictEqual(payload.to, [GUEST]);
  assert.strictEqual(payload.reply_to, 'hello@hoteldayclub.com.au');
  assert.strictEqual(payload.subject, 'Line break');
  assert.strictEqual(payload.html, '<p>Hello</p>');
  assert.strictEqual(payload.text, 'Hello');
  assert.ok(!sent.lines.join('\n').includes(GUEST));

  const failReq = recorder(() => 422);
  mailer.setRequest(failReq.request);
  const failed = await capture(() => mailer.sendMail({ to: GUEST, subject: 'Hi', html: '<p>' + GUEST + '</p>', text: GUEST }));
  assert.strictEqual(failed.result.ok, false);
  assert.strictEqual(failed.result.skipped, false);
  assert.ok(failed.lines.some(l => l === 'mail: send failed status=422'));
  assert.ok(!failed.lines.join('\n').includes(GUEST));
  assert.ok(!failed.lines.join('\n').includes('re_test_key_should_not_log'));

  const errReq = recorder(() => 'error');
  mailer.setRequest(errReq.request);
  const net = await capture(() => mailer.sendMail({ to: GUEST, subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' }));
  assert.strictEqual(net.result.ok, false);
  assert.ok(net.lines.some(l => l === 'mail: send failed network'));
  assert.ok(!net.lines.join('\n').includes(GUEST));

  const timeoutReq = recorder(() => 'timeout');
  mailer.setRequest(timeoutReq.request);
  const timed = await capture(() => mailer.sendMail({ to: GUEST, subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' }));
  assert.strictEqual(timed.result.ok, false);
  assert.ok(timed.lines.some(l => l === 'mail: send failed timeout'));

  insertBooking('HDC-ONCE', GUEST);
  let sends = 0;
  const once = recorder(() => {
    sends += 1;
    return 200;
  });
  mailer.setRequest(once.request);
  await notices.sendBookingConfirmation(db, 'HDC-ONCE');
  await notices.sendBookingConfirmation(db, 'HDC-ONCE');
  assert.strictEqual(sends, 1);
  assert.deepStrictEqual(rowState('HDC-ONCE'), { tries: 1, state: 'sent' });
  const booked = JSON.parse(once.calls[0].body);
  assert.strictEqual(booked.to[0], GUEST);
  assert.ok(booked.html.includes('Skyline Rooftop'));
  assert.ok(booked.html.includes('Bondi Beach, Australia'));
  assert.ok(booked.html.includes('Pool chair × 2'));
  assert.ok(booked.html.includes('Gym × 2'));
  assert.ok(booked.html.includes('2 × Towels'));
  assert.ok(booked.text.includes('Included: 2 × Towels'));
  assert.ok(booked.html.includes('$100'));
  assert.ok(booked.html.includes('10am–4pm'));
  assert.ok(booked.html.includes('Free cancellation until 11am Wed 4 Nov.'));
  assert.ok(booked.html.includes('No lifeguard on duty.'));
  assert.ok(booked.html.includes('https://www.hoteldayclub.com.au/booking/HDC-ONCE'));
  assert.ok(booked.html.includes('https://calendar.google.com/calendar/render?'));
  assert.ok(booked.html.includes('action=TEMPLATE'));
  assert.ok(booked.html.includes('20261103T230000Z'));
  assert.ok(booked.html.includes('20261104T050000Z'));
  assert.ok(booked.text.includes('Add to Google Calendar:'));
  assert.ok(booked.text.includes('HDC-ONCE'));
  assert.ok(booked.html.includes('This is a demo booking. No payment was taken and no real booking exists.'));
  assert.ok(booked.text.includes('Questions: hello@hoteldayclub.com.au'));
  assert.ok(!booked.html.includes(STREET) && !booked.text.includes(STREET));
  assert.ok(!booked.html.includes('Sydney') && !booked.text.includes('Sydney'));
  assert.ok(!booked.html.includes(PHONE) && !booked.text.includes(PHONE));
  assert.ok(!booked.html.includes('Alex Citizen'));
  assert.ok(booked.html.includes('Alex C.'));
  assert.strictEqual(once.calls[0].options.headers['Idempotency-Key'], 'booking:HDC-ONCE');

  insertBooking('HDC-RETRY', GUEST);
  let retryN = 0;
  const retry = recorder(() => {
    retryN += 1;
    return retryN === 1 ? 500 : 200;
  });
  mailer.setRequest(retry.request);
  const retryLog = await capture(() => notices.sendBookingConfirmation(db, 'HDC-RETRY'));
  assert.strictEqual(retryN, 2);
  assert.deepStrictEqual(rowState('HDC-RETRY'), { tries: 2, state: 'sent' });
  assert.ok(retryLog.lines.some(l => l === 'booking confirmation email failed code=HDC-RETRY try=1'));
  assert.ok(!retryLog.lines.join('\n').includes(GUEST));
  await notices.sendBookingConfirmation(db, 'HDC-RETRY');
  assert.strictEqual(retryN, 2);

  insertBooking('HDC-FAIL', GUEST);
  let failN = 0;
  const bothFail = recorder(() => {
    failN += 1;
    return 500;
  });
  mailer.setRequest(bothFail.request);
  const failLog = await capture(() => notices.sendBookingConfirmation(db, 'HDC-FAIL'));
  assert.strictEqual(failN, 2);
  assert.deepStrictEqual(rowState('HDC-FAIL'), { tries: 2, state: 'failed' });
  assert.ok(failLog.lines.some(l => l === 'booking confirmation email failed code=HDC-FAIL try=2'));
  assert.ok(!failLog.lines.join('\n').includes(GUEST));
  await notices.sendBookingConfirmation(db, 'HDC-FAIL');
  assert.strictEqual(failN, 2);

  insertBooking('HDC-SKIP', GUEST);
  delete process.env.RESEND_API_KEY;
  let skipN = 0;
  mailer.setRequest(() => { skipN += 1; throw new Error('network'); });
  const skipLog = await capture(() => notices.sendBookingConfirmation(db, 'HDC-SKIP'));
  assert.strictEqual(skipN, 0);
  assert.deepStrictEqual(rowState('HDC-SKIP'), { tries: 1, state: 'skipped' });
  assert.ok(skipLog.lines.some(l => l.includes('RESEND_API_KEY unset')));
  assert.ok(!skipLog.lines.join('\n').includes(GUEST));
  await notices.sendBookingConfirmation(db, 'HDC-SKIP');
  assert.strictEqual(skipN, 0);

  insertBooking('HDC-BAD', 'not-an-email');
  const badLog = await capture(() => notices.sendBookingConfirmation(db, 'HDC-BAD'));
  assert.deepStrictEqual(rowState('HDC-BAD'), { tries: 0, state: 'failed' });
  assert.ok(badLog.lines.some(l => l === 'booking confirmation email failed code=HDC-BAD invalid address'));
  assert.ok(!badLog.lines.join('\n').includes('not-an-email'));

  process.env.RESEND_API_KEY = 're_test_key_should_not_log';
  process.env.MAIL_FROM = 'Hotel Day Club <hello@hoteldayclub.com.au>';
  process.env.CONTACT_EMAIL = 'desk@example.com';
  const messageId = db.prepare(`INSERT INTO contact_messages (name, email, booking_code, topic, message)
    VALUES ('Ada Guest', ?, 'HDC-1', 'change', 'Please move my day.')`).run(GUEST).lastInsertRowid;
  let contactN = 0;
  const contactReq = recorder(() => {
    contactN += 1;
    return contactN === 1 ? 500 : 200;
  });
  mailer.setRequest(contactReq.request);
  const contactLog = await capture(() => notices.sendContactAlert(db, messageId));
  assert.strictEqual(contactN, 2);
  assert.deepStrictEqual(alertState(messageId), { tries: 2, state: 'sent' });
  const alert = JSON.parse(contactReq.calls[0].body);
  assert.deepStrictEqual(alert.to, ['desk@example.com']);
  assert.strictEqual(alert.reply_to, 'hello@hoteldayclub.com.au');
  assert.ok(alert.html.includes(GUEST));
  assert.ok(alert.html.includes('Ada Guest'));
  assert.ok(alert.html.includes('Change or cancel'));
  assert.ok(alert.html.includes('Please move my day.'));
  assert.ok(alert.html.includes('This message came from the demo site.'));
  assert.ok(!/unsubscribe/i.test(alert.html + alert.text));
  assert.ok(!contactLog.lines.join('\n').includes(GUEST));
  assert.ok(contactLog.lines.some(l => l === 'contact alert email failed id=' + messageId + ' try=1'));
  await notices.sendContactAlert(db, messageId);
  assert.strictEqual(contactN, 2);
  delete process.env.CONTACT_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  mailer.setRequest(null);

  const appPath = path.join(dir, 'app.db');
  const port = 3388;
  const child = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: appPath,
        DATA_DIR: '',
        ADMIN_PASSWORD: 'mail-admin-test',
        DEMO_HOTEL_PASSWORD: 'mail-hotel-test',
        RESEND_API_KEY: '',
        MAIL_FROM: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    proc.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); proc.log = () => log; resolve(proc); } });
    proc.stderr.on('data', c => { log += c; });
    proc.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
  function get(urlPath) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
  }
  function post(urlPath, form) {
    const body = new URLSearchParams(form).toString();
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
  try {
    let date = '';
    for (let i = 1; i < 21 && !date; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const avail = JSON.parse((await get('/api/availability?hotel=skyline-rooftop&date=' + iso)).body);
      const chair = (avail.passes || []).find(p => p.code === 'chair');
      if (chair && !chair.blocked && !chair.past && chair.remaining > 0) date = iso;
    }
    assert.ok(date, 'open date');
    const listing = await get('/h/skyline-rooftop?date=' + date);
    assert.ok(listing.body.includes('Instant confirmation'));
    assert.ok(listing.body.includes('a confirmation email is sent to the address you give'));
    assert.ok(listing.body.includes('not a reservation at a real hotel'));
    const missing = await post('/book', {
      hotel: 'skyline-rooftop', date, pass: 'chair', qty: '1',
      name: 'Alex Citizen', email: 'not-an-email', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    });
    assert.strictEqual(missing.status, 409);
    assert.ok(missing.body.includes('valid email'));
    const booked = await post('/book', {
      hotel: 'skyline-rooftop', date, pass: 'chair', qty: '1',
      name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    });
    assert.strictEqual(booked.status, 303, booked.body.slice(0, 300));
    const page = await get(booked.headers.location);
    assert.ok(page.body.includes('A confirmation email is sent to the address you gave.'));
    assert.ok(page.body.includes('This is a demo booking. No payment was taken and no real booking exists.'));
    assert.ok(!page.body.includes('No email is sent'));
    const liveDb = new (require('better-sqlite3'))(appPath, { readonly: true });
    const saved = liveDb.prepare('SELECT email, guest_email_state state, guest_email_tries tries FROM bookings WHERE email=?').get('alex@example.com');
    assert.deepStrictEqual(saved, { email: 'alex@example.com', state: 'skipped', tries: 1 });
    const contact = await post('/contact', {
      name: 'Ada Guest', email: GUEST, topic: 'booking', message: 'Where do I arrive?',
    });
    assert.strictEqual(contact.status, 303);
    const alert = liveDb.prepare('SELECT email, alert_state state FROM contact_messages WHERE email=?').get(GUEST);
    assert.deepStrictEqual(alert, { email: GUEST, state: 'skipped' });
    liveDb.close();
    const log = child.log();
    assert.ok(log.includes('RESEND_API_KEY unset'));
    assert.ok(!log.includes('alex@example.com'));
    assert.ok(!log.includes(GUEST));
  } finally {
    child.kill('SIGTERM');
  }
  console.log('mail checks passed');
})().catch(err => { console.error(err); process.exit(1); });
