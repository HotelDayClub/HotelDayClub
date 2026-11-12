const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-pause-'));
const unitPath = path.join(dir, 'unit.db');
const httpPath = path.join(dir, 'http.db');
process.env.DB_PATH = unitPath;
process.env.DATA_DIR = '';
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
delete process.env.CONTACT_EMAIL;
const childBase = { ...process.env };

const db = require('../db');
const mailer = require('../mailer');
const { PauseBooked } = require('../pauseBooked');
const { HotelClock } = require('../calendar');

const DATE = '2026-11-20';
const EMPTY = '2026-11-21';
const LATER = '2026-11-22';
const repo = path.join(__dirname, '..');

const hotelId = db.prepare(`INSERT INTO hotels (slug, name, area, login, status, is_demo)
  VALUES ('pause-pool', 'Pause Pool (Demo)', 'Bondi', 'pause-pool', 'active', 1)`).run().lastInsertRowid;
const passId = db.prepare(`INSERT INTO pass_types (hotel_id, code, name, price, daily_cap, holds)
  VALUES (?, 'chair', 'Pool chair', 40, 10, 1)`).run(hotelId).lastInsertRowid;
const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(hotelId);

function addBooking(target, { code, date, name, email, status = 'confirmed', checked = null }) {
  return target.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, party, status, checked_in_at, refunded)
    VALUES (?, ?, ?, ?, 1, 40, 40, ?, ?, '0400111222', 2, ?, ?, 0)`).run(code, hotelId, passId, date, name, email, status, checked).lastInsertRowid;
}
function snap(id) {
  return db.prepare('SELECT status, refunded, checked_in_at, guest_email_state, guest_email_tries FROM bookings WHERE id=?').get(id);
}
function blocked(date) {
  return db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(hotelId, date) || null;
}
function alerts() {
  return db.prepare('SELECT date, reason, guest_count, summary FROM closure_alerts ORDER BY id').all();
}

const confirmedId = addBooking(db, { code: 'HDC-PCONF', date: DATE, name: 'Ada Confirmed', email: 'ada-pause@example.com' });
const checkedId = addBooking(db, { code: 'HDC-PCHECK', date: DATE, name: 'Bea Checked', email: 'bea-pause@example.com', checked: '2026-11-20 01:00:00' });
const cancelledId = addBooking(db, { code: 'HDC-PCANCEL', date: DATE, name: 'Cara Cancelled', email: 'cara-pause@example.com', status: 'cancelled' });
addBooking(db, { code: 'HDC-POTHER', date: LATER, name: 'Dee Other', email: 'dee-pause@example.com' });
const before = { confirmed: snap(confirmedId), checked: snap(checkedId), cancelled: snap(cancelledId) };

const active = PauseBooked.active(db, hotelId, DATE);
assert.strictEqual(active.length, 2, 'active bookings are confirmed plus checked in');
assert.ok(active.some(row => row.code === 'HDC-PCHECK' && row.checked_in_at));
assert.ok(!active.some(row => row.code === 'HDC-PCANCEL'));
assert.strictEqual(PauseBooked.sentence(2), '2 guests are booked. Hotel Day Club will contact them.');
assert.strictEqual(PauseBooked.sentence(1), '1 guest is booked. Hotel Day Club will contact them.');

const held = PauseBooked.pause(db, hotelId, DATE, { mode: 'toggle', confirm: false });
assert.strictEqual(held.kind, 'confirm');
assert.strictEqual(held.alert, false);
assert.strictEqual(held.bookings.length, 2);
assert.strictEqual(blocked(DATE), null);
assert.strictEqual(alerts().length, 0);

const immediate = PauseBooked.pause(db, hotelId, EMPTY, { mode: 'toggle', confirm: false });
assert.strictEqual(immediate.kind, 'paused');
assert.strictEqual(immediate.alert, false);
assert.strictEqual(blocked(EMPTY).reason, 'Paused');
assert.strictEqual(alerts().length, 0);
const resumedEmpty = PauseBooked.pause(db, hotelId, EMPTY, { mode: 'toggle', confirm: false });
assert.strictEqual(resumedEmpty.kind, 'resume');
assert.strictEqual(resumedEmpty.alert, false);
assert.strictEqual(blocked(EMPTY), null);

db.prepare("INSERT INTO blocked_dates (hotel_id, date, reason) VALUES (?, ?, 'Private event')").run(hotelId, LATER);
const alreadyClosed = PauseBooked.pause(db, hotelId, LATER, { mode: 'toggle', confirm: true });
assert.strictEqual(alreadyClosed.kind, 'closed');
assert.strictEqual(alreadyClosed.alert, false);
assert.strictEqual(blocked(LATER).reason, 'Private event');

function recorder() {
  const calls = [];
  function request(options, cb) {
    return {
      on() { return this; },
      setTimeout() { return this; },
      destroy() {},
      end(body) {
        calls.push({ options, body: String(body || '') });
        cb({ statusCode: 202, resume() {}, on() {} });
      },
    };
  }
  return { request, calls };
}

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function post(port, urlPath, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: repo,
      env: {
        ...childBase,
        PORT: String(port),
        DB_PATH: httpPath,
        DATA_DIR: '',
        ADMIN_PASSWORD: 'pause-admin',
        DEMO_HOTEL_PASSWORD: 'pause-hotel',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 30000);
    child.stdout.on('data', chunk => {
      log += chunk;
      if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve({ child, logRef: () => log }); }
    });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function confirmSection(html) {
  const start = html.indexOf('id="pause-confirm"');
  assert.ok(start >= 0, 'confirm step missing');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}
function skips(log) {
  return (log.match(/mail: skipped, RESEND_API_KEY unset/g) || []).length;
}
function tokenDate(token) {
  const body = String(token || '').split('.')[0];
  return JSON.parse(Buffer.from(body, 'base64url').toString()).d;
}

(async () => {
  process.env.RESEND_API_KEY = 'pause-test-key';
  process.env.MAIL_FROM = 'Hotel Day Club <hello@hoteldayclub.com.au>';
  const rec = recorder();
  mailer.setRequest(rec.request);

  const paused = PauseBooked.pause(db, hotelId, DATE, { mode: 'pause', confirm: true });
  assert.strictEqual(paused.kind, 'paused');
  assert.strictEqual(paused.alert, true);
  assert.strictEqual(blocked(DATE).reason, 'Paused');
  const sent = await PauseBooked.notify(db, hotel, DATE, paused.bookings, 'Paused');
  assert.strictEqual(sent.ok, true);
  assert.strictEqual(rec.calls.length, 1);
  const payload = JSON.parse(rec.calls[0].body);
  assert.deepStrictEqual(payload.to, ['hello@hoteldayclub.com.au']);
  assert.ok(payload.text.includes('HDC-PCONF'));
  assert.ok(payload.text.includes('HDC-PCHECK'));
  assert.ok(payload.text.includes('Checked in'));
  assert.ok(payload.text.includes('Ada Confirmed'));
  assert.ok(payload.text.includes('Hotel Day Club will contact them.'));
  assert.ok(payload.html.includes('Hotel Day Club will contact them.'));
  assert.ok(!payload.text.includes('HDC-PCANCEL'));
  assert.ok(!payload.text.includes('cara-pause@example.com'));
  assert.ok(!payload.html.includes('cara-pause@example.com'));
  const mailed = payload.subject + payload.text + payload.html;
  assert.ok(!/refund|stripe|\bcard\b/i.test(mailed), mailed);
  assert.strictEqual(alerts().length, 1);
  assert.strictEqual(alerts()[0].guest_count, 2);
  assert.strictEqual(alerts()[0].reason, 'Paused');
  assert.ok(alerts()[0].summary.includes('HDC-PCONF'));
  assert.ok(alerts()[0].summary.includes('HDC-PCHECK'));
  assert.deepStrictEqual(snap(confirmedId), before.confirmed);
  assert.deepStrictEqual(snap(checkedId), before.checked);
  assert.deepStrictEqual(snap(cancelledId), before.cancelled);

  const again = PauseBooked.pause(db, hotelId, DATE, { mode: 'pause', confirm: true });
  assert.strictEqual(again.kind, 'already');
  assert.strictEqual(again.alert, false);
  assert.strictEqual(rec.calls.length, 1);

  const resumed = PauseBooked.pause(db, hotelId, DATE, { mode: 'toggle' });
  assert.strictEqual(resumed.kind, 'resume');
  assert.strictEqual(resumed.alert, false);
  assert.strictEqual(blocked(DATE), null);
  assert.strictEqual(alerts().length, 1);
  assert.strictEqual(rec.calls.length, 1);
  const heldAgain = PauseBooked.pause(db, hotelId, DATE, { mode: 'toggle', confirm: false });
  assert.strictEqual(heldAgain.kind, 'confirm');
  assert.strictEqual(blocked(DATE), null);
  const emptyNotify = await PauseBooked.notify(db, hotel, EMPTY, [], 'Paused');
  assert.strictEqual(emptyNotify.empty, true);
  assert.strictEqual(rec.calls.length, 1);
  assert.strictEqual(snap(confirmedId).status, 'confirmed');
  assert.strictEqual(snap(confirmedId).refunded, 0);
  assert.strictEqual(snap(checkedId).status, 'confirmed');
  assert.strictEqual(snap(checkedId).refunded, 0);

  const port = 3473;
  const started = await start(port);
  const { child } = started;
  try {
    const Database = require('better-sqlite3');
    const live = new Database(httpPath);
    const row = live.prepare("SELECT * FROM hotels WHERE login='demo-saltwater'").get();
    const pass = live.prepare('SELECT id FROM pass_types WHERE hotel_id=? ORDER BY id LIMIT 1').get(row.id);
    const today = HotelClock.today(row);
    const preview = await (async () => {
      const ok = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'pause-hotel' });
      assert.strictEqual(ok.status, 302);
      const jar = (ok.headers['set-cookie'] || []).map(cookie => cookie.split(';')[0]).join('; ');
      const email = await get(port, '/hotel/email-preview', { Cookie: jar });
      const token = (email.body.match(/href="\/hotel\/go\/([^"]+)"/) || [])[1];
      assert.ok(token, 'pause token missing');
      return { jar, token, when: tokenDate(token) };
    })();
    const { jar, token, when } = preview;
    assert.notStrictEqual(when, today);

    function silence(date) {
      live.prepare("UPDATE bookings SET status='cancelled' WHERE hotel_id=? AND date=?").run(row.id, date);
      live.prepare('DELETE FROM blocked_dates WHERE hotel_id=? AND date=?').run(row.id, date);
    }
    function book(date, code, name, email, checked) {
      return live.prepare(`INSERT INTO bookings (code, hotel_id, pass_type_id, date, qty, unit_price, total, guest_name, email, phone, party, status, checked_in_at, refunded)
        VALUES (?, ?, ?, ?, 1, 40, 40, ?, ?, '0400111222', 2, 'confirmed', ?, 0)`).run(code, row.id, pass.id, date, name, email, checked).lastInsertRowid;
    }
    function reason(date) {
      return (live.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(row.id, date) || {}).reason || '';
    }
    function alertCount() {
      return live.prepare('SELECT COUNT(*) n FROM closure_alerts').get().n;
    }
    function state(id) {
      return live.prepare('SELECT status, refunded, checked_in_at, guest_email_state FROM bookings WHERE id=?').get(id);
    }

    silence(today);
    const todayConfirmed = book(today, 'HDC-TCONF', 'Nora Confirmed', 'nora-pause@example.com', null);
    const todayChecked = book(today, 'HDC-TCHECK', 'Omar Checked', 'omar-pause@example.com', '2026-11-12 01:00:00');
    book(today, 'HDC-TCANCEL', 'Pia Cancelled', 'pia-pause@example.com', null);
    live.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(live.prepare("SELECT id FROM bookings WHERE code='HDC-TCANCEL'").get().id);
    const todayBefore = { confirmed: state(todayConfirmed), checked: state(todayChecked) };

    const ask = await post(port, '/hotel/pause', { when: 'today' }, { Cookie: jar });
    assert.strictEqual(ask.status, 200);
    assert.strictEqual(reason(today), '');
    assert.strictEqual(alertCount(), 0);
    assert.strictEqual(skips(started.logRef()), 0);
    const panel = confirmSection(ask.body);
    assert.ok(ask.body.includes('class="dash"'));
    assert.ok(ask.body.includes('Demo listing'));
    assert.ok(ask.body.includes('>Today</a>'));
    assert.ok(panel.includes('2 guests are booked. Hotel Day Club will contact them.'));
    assert.ok(panel.includes('Nora Confirmed'));
    assert.ok(panel.includes('Omar Checked'));
    assert.ok(panel.includes('Checked in'));
    assert.ok(panel.includes('HDC-TCONF'));
    assert.ok(panel.includes('HDC-TCHECK'));
    assert.ok(!panel.includes('Pia Cancelled'));
    assert.ok(!panel.includes('HDC-TCANCEL'));
    assert.ok(panel.includes('action="/hotel/pause"'));
    assert.ok(panel.includes('name="confirm" value="1"'));
    assert.ok(panel.includes('name="when" value="today"'));
    assert.ok(panel.includes('Pause this date'));
    assert.ok(!/refund|stripe|\bcard\b/i.test(panel), panel);

    const saved = await post(port, '/hotel/pause', { when: 'today', confirm: '1' }, { Cookie: jar });
    assert.strictEqual(saved.status, 303);
    assert.ok(decodeURIComponent(saved.headers.location).includes('Paused'));
    assert.ok(!decodeURIComponent(saved.headers.location).includes('will contact'));
    assert.strictEqual(reason(today), 'Paused');
    assert.strictEqual(alertCount(), 1);
    assert.strictEqual(skips(started.logRef()), 1);
    const listed = live.prepare('SELECT summary, guest_count, reason FROM closure_alerts ORDER BY id DESC LIMIT 1').get();
    assert.strictEqual(listed.guest_count, 2);
    assert.strictEqual(listed.reason, 'Paused');
    assert.ok(listed.summary.includes('HDC-TCONF'));
    assert.ok(listed.summary.includes('HDC-TCHECK'));
    assert.ok(!listed.summary.includes('HDC-TCANCEL'));
    assert.deepStrictEqual(state(todayConfirmed), todayBefore.confirmed);
    assert.deepStrictEqual(state(todayChecked), todayBefore.checked);

    const resume = await post(port, '/hotel/pause', { when: 'today' }, { Cookie: jar });
    assert.strictEqual(resume.status, 303);
    assert.ok(decodeURIComponent(resume.headers.location).includes('Resumed'));
    assert.ok(!resume.body.includes('id="pause-confirm"'));
    assert.strictEqual(reason(today), '');
    assert.strictEqual(alertCount(), 1);
    assert.strictEqual(skips(started.logRef()), 1);

    live.prepare("UPDATE bookings SET status='cancelled' WHERE hotel_id=? AND date=? AND status!='cancelled'").run(row.id, today);
    const zero = await post(port, '/hotel/pause', { when: 'today' }, { Cookie: jar });
    assert.strictEqual(zero.status, 303);
    const zeroMsg = decodeURIComponent(zero.headers.location);
    assert.ok(zeroMsg.includes('Paused'));
    assert.ok(!zeroMsg.includes('will contact'));
    assert.strictEqual(reason(today), 'Paused');
    assert.strictEqual(alertCount(), 1);
    assert.strictEqual(skips(started.logRef()), 1);

    silence(when);
    book(when, 'HDC-MCONF', 'Quinn Tomorrow', 'quinn-pause@example.com', null);
    book(when, 'HDC-MCHECK', 'Rae Tomorrow', 'rae-pause@example.com', '2026-11-12 02:00:00');
    const link = await get(port, '/hotel/go/' + token);
    assert.strictEqual(link.status, 200);
    assert.ok(!(link.headers['set-cookie'] || []).join('').includes('hotel='));
    assert.strictEqual(reason(when), '');
    assert.strictEqual(alertCount(), 1);
    assert.strictEqual(skips(started.logRef()), 1);
    const linkPanel = confirmSection(link.body);
    assert.ok(link.body.includes('class="dash"'));
    assert.ok(linkPanel.includes('2 guests are booked. Hotel Day Club will contact them.'));
    assert.ok(linkPanel.includes('Quinn Tomorrow'));
    assert.ok(linkPanel.includes('Rae Tomorrow'));
    assert.ok(linkPanel.includes('Checked in'));
    assert.ok(linkPanel.includes('action="/hotel/go/' + token + '"'));
    assert.ok(!/refund|stripe|\bcard\b/i.test(linkPanel));

    const linkSave = await post(port, '/hotel/go/' + token, { confirm: '1' });
    assert.strictEqual(linkSave.status, 200);
    assert.ok(linkSave.body.includes('Paused'));
    const savedFlash = linkSave.body.indexOf('<div class="flash" role="status">Saved</div>');
    assert.ok(savedFlash !== -1 && savedFlash < linkSave.body.indexOf('<h1'));
    assert.ok(!(linkSave.headers['set-cookie'] || []).join('').includes('hotel='));
    assert.strictEqual(reason(when), 'Paused');
    assert.strictEqual(alertCount(), 2);
    assert.strictEqual(skips(started.logRef()), 2);
    const mailRow = live.prepare("SELECT status, refunded FROM bookings WHERE code='HDC-MCONF'").get();
    assert.strictEqual(mailRow.status, 'confirmed');
    assert.strictEqual(mailRow.refunded, 0);

    const linkAgain = await post(port, '/hotel/go/' + token, { confirm: '1' });
    assert.strictEqual(linkAgain.status, 200);
    assert.ok(linkAgain.body.includes('already paused'));
    assert.strictEqual(alertCount(), 2);
    assert.strictEqual(skips(started.logRef()), 2);

    const resumeTomorrow = await post(port, '/hotel/pause', { when: 'tomorrow' }, { Cookie: jar });
    assert.strictEqual(resumeTomorrow.status, 303);
    assert.ok(decodeURIComponent(resumeTomorrow.headers.location).includes('Resumed'));
    assert.strictEqual(reason(when), '');
    assert.strictEqual(alertCount(), 2);
    assert.strictEqual(skips(started.logRef()), 2);

    const later = HotelClock.offset(row, 4);
    const emptyDay = HotelClock.offset(row, 5);
    silence(later);
    silence(emptyDay);
    book(later, 'HDC-LATER', 'Sam Later', 'sam-pause@example.com', null);
    const blockAsk = await post(port, '/hotel/blocked', { dates: later, reason: 'Pool maintenance' }, { Cookie: jar });
    assert.strictEqual(blockAsk.status, 200);
    assert.strictEqual(reason(later), '');
    assert.strictEqual(alertCount(), 2);
    const blockPanel = confirmSection(blockAsk.body);
    assert.ok(blockPanel.includes('1 guest is booked. Hotel Day Club will contact them.'));
    assert.ok(blockPanel.includes('Sam Later'));
    assert.ok(blockPanel.includes('name="confirm" value="1"'));
    assert.ok(!/refund|stripe|\bcard\b/i.test(blockPanel));
    const blockSave = await post(port, '/hotel/blocked', { dates: later, reason: 'Pool maintenance', confirm: '1' }, { Cookie: jar });
    assert.strictEqual(blockSave.status, 303);
    assert.strictEqual(reason(later), 'Pool maintenance');
    assert.strictEqual(alertCount(), 3);
    assert.strictEqual(skips(started.logRef()), 3);
    assert.strictEqual(live.prepare("SELECT status, refunded FROM bookings WHERE code='HDC-LATER'").get().refunded, 0);

    const emptyBlock = await post(port, '/hotel/blocked', { dates: [later, emptyDay].join(','), reason: '' }, { Cookie: jar });
    assert.strictEqual(emptyBlock.status, 303);
    assert.ok(decodeURIComponent(emptyBlock.headers.location).includes('Blocked'));
    assert.strictEqual(reason(emptyDay), 'Closed');
    assert.strictEqual(alertCount(), 3);
    assert.strictEqual(skips(started.logRef()), 3);

    book(emptyDay, 'HDC-ALREADY', 'Tara Already', 'tara-pause@example.com', null);
    const reblock = await post(port, '/hotel/block', { date: emptyDay, reason: 'Still closed' }, { Cookie: jar });
    assert.strictEqual(reblock.status, 303);
    assert.ok(!reblock.body.includes('id="pause-confirm"'));
    assert.strictEqual(alertCount(), 3);
    assert.strictEqual(skips(started.logRef()), 3);

    const fresh = HotelClock.offset(row, 6);
    silence(fresh);
    book(fresh, 'HDC-FRESH', 'Uma Fresh', 'uma-pause@example.com', null);
    const oneAsk = await post(port, '/hotel/block', { date: fresh, reason: 'Private event' }, { Cookie: jar });
    assert.strictEqual(oneAsk.status, 200);
    assert.strictEqual(reason(fresh), '');
    assert.ok(confirmSection(oneAsk.body).includes('1 guest is booked. Hotel Day Club will contact them.'));
    const oneSave = await post(port, '/hotel/block', { date: fresh, reason: 'Private event', confirm: '1' }, { Cookie: jar });
    assert.strictEqual(oneSave.status, 303);
    assert.strictEqual(reason(fresh), 'Private event');
    assert.strictEqual(alertCount(), 4);
    assert.strictEqual(skips(started.logRef()), 4);

    const opened = await post(port, '/hotel/unblock', { date: fresh }, { Cookie: jar });
    assert.strictEqual(opened.status, 303);
    assert.ok(decodeURIComponent(opened.headers.location).includes('Unblocked'));
    assert.strictEqual(reason(fresh), '');
    assert.strictEqual(alertCount(), 4);
    assert.strictEqual(skips(started.logRef()), 4);

    const adminIn = await post(port, '/admin/login', { user: 'jason', pass: 'pause-admin' });
    const adminJar = (adminIn.headers['set-cookie'] || []).map(cookie => cookie.split(';')[0]).join('; ');
    const admin = await get(port, '/admin', { Cookie: adminJar });
    assert.strictEqual(admin.status, 200);
    const closuresAt = admin.body.indexOf('id="closures"');
    assert.ok(closuresAt >= 0);
    const closures = admin.body.slice(closuresAt, admin.body.indexOf('</section>', closuresAt));
    assert.ok(closures.includes('HDC-TCONF'));
    assert.ok(closures.includes('HDC-MCHECK'));
    assert.ok(closures.includes('Hotel Day Club will contact them.'));
    assert.ok(!closures.includes('HDC-TCANCEL'));
    live.close();
  } finally {
    child.kill('SIGTERM');
  }
  console.log('pause checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
