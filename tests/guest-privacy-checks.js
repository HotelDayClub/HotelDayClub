const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { HotelClock } = require('../calendar');
const { GuestPrivacy } = require('../guestPrivacy');
const { hotelBookingsCsv } = require('../dataExport');

function channel(hex) {
  const n = parseInt(hex, 16) / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}
function contrast(fg, bg) {
  const lum = hex => {
    const h = hex.replace('#', '');
    return 0.2126 * channel(h.slice(0, 2)) + 0.7152 * channel(h.slice(2, 4)) + 0.0722 * channel(h.slice(4, 6));
  };
  const lighter = Math.max(lum(fg), lum(bg));
  const darker = Math.min(lum(fg), lum(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function unit() {
  assert.strictEqual(GuestPrivacy.HOTEL_GUEST_DAYS, 30);
  assert.strictEqual(GuestPrivacy.NOTICE, 'Guest names and contact details are hidden 30 days after the visit, unless an incident was logged.');
  assert.ok(GuestPrivacy.NOTICE.includes(String(GuestPrivacy.HOTEL_GUEST_DAYS)));
  assert.ok(!GuestPrivacy.NOTICE.includes('\u2014') && !GuestPrivacy.NOTICE.includes('\u2013'));
  const gate = GuestPrivacy.contactGate();
  assert.ok(gate.includes('b.date >= ?'));
  assert.ok(gate.includes("gn.kind = 'incident'"));
  assert.ok(!gate.includes('no_show'));

  const zone = { timezone: 'Australia/Sydney' };
  const now = new Date('2026-11-13T02:00:00Z');
  assert.strictEqual(HotelClock.today(zone, now), '2026-11-13');
  assert.strictEqual(GuestPrivacy.cutoff(zone, now), '2026-10-14');
  const day30 = GuestPrivacy.present({ date: '2026-10-14', guest_name: 'Day Thirty', email: 'day30@example.com', phone: '0400000030', notes: [] }, zone, now);
  assert.strictEqual(day30.guest_name, 'Day Thirty');
  assert.strictEqual(day30.email, 'day30@example.com');
  const day29 = GuestPrivacy.present({ date: '2026-10-15', guest_name: 'Day Twentynine', email: 'day29@example.com', phone: '0400000029', notes: [] }, zone, now);
  assert.strictEqual(day29.guest_name, 'Day Twentynine');
  const day31 = GuestPrivacy.present({ date: '2026-10-13', guest_name: 'Day Thirtyone', email: 'day31@example.com', phone: '0400000031', notes: [] }, zone, now);
  assert.strictEqual(day31.guest_name, 'Guest');
  assert.strictEqual(day31.email, '');
  assert.strictEqual(day31.phone, '');
  assert.strictEqual(day31.contact_hidden, true);
  const incident = GuestPrivacy.present({ date: '2026-10-13', guest_name: 'Kept Guest', email: 'kept@example.com', phone: '0400000032', notes: [{ kind: 'incident' }] }, zone, now);
  assert.strictEqual(incident.guest_name, 'Kept Guest');
  assert.strictEqual(incident.email, 'kept@example.com');
  const noshow = GuestPrivacy.present({ date: '2026-10-13', guest_name: 'Absent Guest', email: 'gone@example.com', phone: '0400000033', notes: [{ kind: 'no_show' }] }, zone, now);
  assert.strictEqual(noshow.guest_name, 'Guest');
  assert.strictEqual(noshow.email, '');
  assert.strictEqual(noshow.phone, '');

  const csv = hotelBookingsCsv(GuestPrivacy.presentAll([
    { date: '2026-10-13', booking_code: 'HDC-OLD', guest_name: 'Day Thirtyone', email: 'day31@example.com', phone: '0400000031', notes: [] },
    { date: '2026-10-15', booking_code: 'HDC-NEW', guest_name: '=Day Twentynine', email: 'day29@example.com', phone: '0400000029', notes: [] },
  ], zone, now));
  assert.ok(csv.startsWith('date,booking_code,guest_name,'));
  assert.strictEqual(csv.charCodeAt(0), 'd'.charCodeAt(0));
  assert.ok(csv.includes('"HDC-OLD"'));
  assert.ok(csv.includes('"Guest"'));
  assert.ok(!csv.includes('day31@example.com'));
  assert.ok(!csv.includes('0400000031'));
  assert.ok(!csv.includes('Day Thirtyone'));
  assert.ok(csv.includes(`"'=Day Twentynine"`));
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
  const colour = css.match(/\.guest-privacy\{[^}]*color:\s*(#[0-9A-Fa-f]{6})/);
  assert.ok(colour, 'guest privacy line sets a colour');
  assert.ok(contrast(colour[1], '#FFFFFF') >= 4.5, 'lookup note on white');
  assert.ok(contrast(colour[1], '#F5FAF9') >= 4.5, 'csv note on the dashboard tint');
  console.log('guest privacy unit checks passed');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-privacy-'));
const dbPath = path.join(dir, 'daypass.db');

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
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
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function cookie(res) {
  return (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'privacy-admin', DEMO_HOTEL_PASSWORD: 'privacy-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 30000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function csvCells(line) {
  return String(line || '').split(',').map(part => part.replace(/^"|"$/g, '').replace(/""/g, '"'));
}

async function runServer() {
  const port = 3391;
  const child = await start(port);
  try {
    const Database = require('better-sqlite3');
    const live = new Database(dbPath);
    const salt = live.prepare("SELECT * FROM hotels WHERE slug='saltwater-terrace'").get();
    const pass = live.prepare('SELECT id FROM pass_types WHERE hotel_id=? LIMIT 1').get(salt.id).id;
    const day31 = HotelClock.offset(salt, -31);
    const day30 = HotelClock.offset(salt, -30);
    const day29 = HotelClock.offset(salt, -29);
    const today = HotelClock.today(salt);
    const ins = live.prepare(`INSERT INTO bookings(code,short_code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,party)
      VALUES (?,?,?,?,?,1,45,45,?,?,?,'confirmed',1)`);
    const note = live.prepare("INSERT INTO guest_notes(booking_id,hotel_id,kind,note,created_at) VALUES (?,?,?,?,datetime('now'))");
    const old = ins.run('HDC-PRIV31', 'HDC-ZZZ3-AGEX', salt.id, pass, day31, 'Isolde Quince', 'isolde.quince.old@example.com', '0488 310 031');
    const border = ins.run('HDC-PRIV30', 'HDC-ZZZ3-KEEP', salt.id, pass, day30, 'Isolde Border', 'isolde.border.edge@example.com', '0488 300 030');
    ins.run('HDC-PRIV29', 'HDC-ZZZ2-SHWN', salt.id, pass, day29, 'Isolde Recent', 'isolde.recent.new@example.com', '0488 290 029');
    const incident = ins.run('HDC-PRIVIN', 'HDC-ZZZ3-NTEX', salt.id, pass, day31, 'Isolde Noted', 'isolde.noted.keep@example.com', '0488 311 031');
    const noshow = ins.run('HDC-PRIVNS', 'HDC-ZZZ3-NSHW', salt.id, pass, day31, 'Isolde Absent', 'isolde.absent.skip@example.com', '0488 312 031');
    ins.run('HDC-PRIVTD', 'HDC-ZZZ3-TD4Y', salt.id, pass, today, '=Csv Guard', 'csv.guard.today@example.com', '0488 100 001');
    note.run(incident.lastInsertRowid, salt.id, 'incident', 'Slip by the pool');
    note.run(noshow.lastInsertRowid, salt.id, 'no_show', 'Did not arrive');
    assert.ok(old.lastInsertRowid);
    assert.ok(border.lastInsertRowid);
    const before = live.prepare('SELECT COUNT(*) n FROM bookings').get().n;
    live.close();

    const login = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'privacy-hotel' }, { 'X-Forwarded-For': '203.0.113.71' });
    assert.strictEqual(login.status, 302);
    const jar = cookie(login);
    const auth = { Cookie: jar };

    const home = await get(port, '/hotel', auth);
    assert.strictEqual(home.status, 200);
    const notes = home.body.split(GuestPrivacy.NOTICE).length - 1;
    assert.ok(notes >= 2, 'notice under the csv link and the lookup');
    const liveDb = new Database(dbPath, { readonly: true });
    const totals = liveDb.prepare("SELECT COALESCE(SUM(qty),0) spots, COALESCE(SUM(COALESCE(party, qty)),0) people, COUNT(*) n FROM bookings WHERE hotel_id=? AND status!='cancelled'").get(salt.id);
    assert.ok(home.body.includes(`<span>Spots booked</span><b>${totals.spots}</b>`));
    assert.ok(home.body.includes(`${totals.n} bookings · ${totals.people} people`));
    liveDb.close();

    const byCode = await get(port, '/hotel?q=' + encodeURIComponent('HDC-PRIV31'), auth);
    assert.ok(byCode.body.includes('<b>Guest</b>'));
    assert.ok(byCode.body.includes(GuestPrivacy.NOTICE));
    assert.ok(byCode.body.includes('1 result'));
    assert.ok(!byCode.body.includes('Isolde Quince'));
    assert.ok(!byCode.body.includes('isolde.quince.old@example.com'));
    assert.ok(!byCode.body.includes('0488 310 031'));
    const byShort = await get(port, '/hotel?q=' + encodeURIComponent('ZZZ3 AGEX'), auth);
    assert.ok(byShort.body.includes('<b>Guest</b>'));
    assert.ok(byShort.body.includes('HDC-PRIV31'));
    assert.ok(!byShort.body.includes('Isolde Quince'));
    assert.ok(!byShort.body.includes('isolde.quince.old@example.com'));

    const byName = await get(port, '/hotel?q=' + encodeURIComponent('Quince'), auth);
    assert.ok(byName.body.includes('0 results'));
    assert.ok(!byName.body.includes('HDC-PRIV31'));
    assert.ok(!byName.body.includes('isolde.quince.old@example.com'));
    const byPartial = await get(port, '/hotel?q=' + encodeURIComponent('quin'), auth);
    assert.ok(!byPartial.body.includes('HDC-PRIV31'));
    const byEmail = await get(port, '/hotel?q=' + encodeURIComponent('isolde.quince.old@example.com'), auth);
    assert.ok(byEmail.body.includes('0 results'));
    assert.ok(!byEmail.body.includes('HDC-PRIV31'));
    assert.ok(!byEmail.body.includes('Isolde Quince'));
    const byPhone = await get(port, '/hotel?q=' + encodeURIComponent('0488 310 031'), auth);
    assert.ok(!byPhone.body.includes('HDC-PRIV31'));
    assert.ok(!byPhone.body.includes('Isolde Quince'));

    const recent = await get(port, '/hotel?q=' + encodeURIComponent('Isolde Recent'), auth);
    assert.ok(recent.body.includes('<b>Isolde Recent</b>'));
    assert.ok(recent.body.includes('isolde.recent.new@example.com'));
    assert.ok(recent.body.includes('0488 290 029'));
    const borderPage = await get(port, '/hotel?q=' + encodeURIComponent('Isolde Border'), auth);
    assert.ok(borderPage.body.includes('<b>Isolde Border</b>'));
    assert.ok(borderPage.body.includes('isolde.border.edge@example.com'));
    assert.ok(borderPage.body.includes('0488 300 030'));
    const kept = await get(port, '/hotel?q=' + encodeURIComponent('Isolde Noted'), auth);
    assert.ok(kept.body.includes('<b>Isolde Noted</b>'));
    assert.ok(kept.body.includes('isolde.noted.keep@example.com'));
    assert.ok(kept.body.includes('0488 311 031'));
    const absent = await get(port, '/hotel?q=' + encodeURIComponent('Isolde Absent'), auth);
    assert.ok(absent.body.includes('0 results'));
    assert.ok(!absent.body.includes('HDC-PRIVNS'));
    assert.ok(!absent.body.includes('isolde.absent.skip@example.com'));
    const family = await get(port, '/hotel?q=' + encodeURIComponent('Isolde'), auth);
    assert.ok(family.body.includes('HDC-PRIV29'));
    assert.ok(family.body.includes('HDC-PRIV30'));
    assert.ok(family.body.includes('HDC-PRIVIN'));
    assert.ok(!family.body.includes('HDC-PRIV31'));
    assert.ok(!family.body.includes('HDC-PRIVNS'));

    const checkCode = await get(port, '/hotel/checkin?code=' + encodeURIComponent('HDC-PRIV31'), auth);
    assert.ok(checkCode.body.includes('<h2>Guest'));
    assert.ok(checkCode.body.includes('was for'));
    assert.ok(!checkCode.body.includes('Isolde Quince'));
    assert.ok(!checkCode.body.includes('isolde.quince.old@example.com'));
    assert.ok(!checkCode.body.includes('0488 310 031'));
    const checkShort = await get(port, '/hotel/checkin?q=' + encodeURIComponent('zzz3 agex'), auth);
    assert.ok(checkShort.body.includes('<h2>Guest'));
    assert.ok(!checkShort.body.includes('Isolde Quince'));
    assert.ok(!checkShort.body.includes('isolde.quince.old@example.com'));
    const checkName = await get(port, '/hotel/checkin?q=' + encodeURIComponent('Quince'), auth);
    assert.ok(checkName.body.includes('No bookings match that search.'));
    assert.ok(!checkName.body.includes('HDC-PRIV31'));
    const checkEmail = await get(port, '/hotel/checkin?q=' + encodeURIComponent('isolde.quince.old@example.com'), auth);
    assert.ok(checkEmail.body.includes('No bookings match that search.'));
    assert.ok(!checkEmail.body.includes('Isolde Quince'));
    const checkPhone = await get(port, '/hotel/checkin?q=' + encodeURIComponent('0488310031'), auth);
    assert.ok(!checkPhone.body.includes('HDC-PRIV31'));
    assert.ok(!checkPhone.body.includes('Isolde Quince'));
    const checkRecent = await get(port, '/hotel/checkin?q=' + encodeURIComponent('0488290029'), auth);
    assert.ok(checkRecent.body.includes('Isolde Recent'));
    assert.ok(checkRecent.body.includes('<h2>Isolde Recent'));
    const checkKept = await get(port, '/hotel/checkin?q=' + encodeURIComponent('Isolde Noted'), auth);
    assert.ok(checkKept.body.includes('<h2>Isolde Noted'));
    const checkGone = await get(port, '/hotel/checkin?q=' + encodeURIComponent('Absent'), auth);
    assert.ok(checkGone.body.includes('No bookings match that search.'));
    assert.ok(!checkGone.body.includes('HDC-PRIVNS'));
    const checkPartial = await get(port, '/hotel/checkin?q=' + encodeURIComponent('quin'), auth);
    assert.ok(!checkPartial.body.includes('HDC-PRIV31'));

    const printed = await get(port, '/hotel/print?date=' + encodeURIComponent(day31), auth);
    assert.strictEqual(printed.status, 200);
    assert.ok(printed.body.includes('Isolde Noted'));
    assert.ok(printed.body.includes('<b>Guest</b>'));
    assert.ok(!printed.body.includes('Isolde Quince'));
    assert.ok(!printed.body.includes('Isolde Absent'));
    assert.ok(!printed.body.includes('isolde.quince.old@example.com'));
    assert.ok(!printed.body.includes('isolde.absent.skip@example.com'));

    const csv = await get(port, '/hotel/bookings.csv', auth);
    assert.strictEqual(csv.status, 200);
    assert.ok(String(csv.headers['content-type']).includes('text/csv'));
    assert.ok(csv.body.startsWith('date,booking_code,guest_name,'));
    assert.strictEqual(csv.body.charCodeAt(0), 'd'.charCodeAt(0));
    const header = csvCells(csv.body.split('\r\n')[0]);
    const nameAt = header.indexOf('guest_name');
    assert.ok(nameAt > 0);
    const row31 = csv.body.split('\r\n').find(line => line.includes('HDC-PRIV31'));
    const row30 = csv.body.split('\r\n').find(line => line.includes('HDC-PRIV30'));
    const row29 = csv.body.split('\r\n').find(line => line.includes('HDC-PRIV29'));
    const rowIn = csv.body.split('\r\n').find(line => line.includes('HDC-PRIVIN'));
    const rowNs = csv.body.split('\r\n').find(line => line.includes('HDC-PRIVNS'));
    const rowTd = csv.body.split('\r\n').find(line => line.includes('HDC-PRIVTD'));
    assert.strictEqual(csvCells(row31)[nameAt], 'Guest');
    assert.strictEqual(csvCells(row30)[nameAt], 'Isolde Border');
    assert.strictEqual(csvCells(row29)[nameAt], 'Isolde Recent');
    assert.strictEqual(csvCells(rowIn)[nameAt], 'Isolde Noted');
    assert.strictEqual(csvCells(rowNs)[nameAt], 'Guest');
    assert.strictEqual(csvCells(rowTd)[nameAt], "'=Csv Guard");
    assert.ok(!csv.body.includes('isolde.quince.old@example.com'));
    assert.ok(!csv.body.includes('0488 310 031'));
    assert.ok(!csv.body.includes('Isolde Quince'));
    assert.ok(!csv.body.includes('isolde.absent.skip@example.com'));
    assert.ok(!csv.body.includes('0488 312 031'));
    assert.ok(!csv.body.includes('Isolde Absent'));
    assert.ok(csv.body.includes('Isolde Noted'));

    const analytics = await get(port, '/hotel/analytics', auth);
    assert.strictEqual(analytics.status, 200);
    assert.ok(analytics.body.includes('How this listing is doing'));
    assert.ok(!analytics.body.includes('isolde.quince.old@example.com'));
    assert.ok(!analytics.body.includes('Isolde Quince'));

    const admin = await post(port, '/admin/login', { user: 'jason', pass: 'privacy-admin' }, { 'X-Forwarded-For': '203.0.113.72' });
    assert.strictEqual(admin.status, 302);
    const adminJar = cookie(admin);
    const adminCsv = await get(port, '/admin/export/bookings.csv', { Cookie: adminJar });
    assert.strictEqual(adminCsv.status, 200);
    assert.ok(adminCsv.body.includes('Isolde Quince'));
    assert.ok(adminCsv.body.includes('isolde.quince.old@example.com'));
    assert.ok(adminCsv.body.includes('0488 310 031'));
    assert.ok(adminCsv.body.includes('Isolde Absent'));
    assert.ok(adminCsv.body.includes('isolde.absent.skip@example.com'));
    assert.ok(adminCsv.body.includes('Isolde Noted'));
    assert.ok(adminCsv.body.includes('isolde.border.edge@example.com'));
    const adminList = await get(port, '/admin/bookings?q=' + encodeURIComponent('isolde.quince.old@example.com'), { Cookie: adminJar });
    assert.strictEqual(adminList.status, 200);
    assert.ok(adminList.body.includes('Isolde Quince'));
    assert.ok(adminList.body.includes('isolde.quince.old@example.com'));
    assert.ok(adminList.body.includes('0488 310 031'));

    const after = new Database(dbPath, { readonly: true });
    const stored = after.prepare('SELECT guest_name, email, phone FROM bookings WHERE code=?').get('HDC-PRIV31');
    assert.deepStrictEqual(stored, { guest_name: 'Isolde Quince', email: 'isolde.quince.old@example.com', phone: '0488 310 031' });
    const stillNoted = after.prepare('SELECT guest_name, email, phone FROM bookings WHERE code=?').get('HDC-PRIVIN');
    assert.strictEqual(stillNoted.guest_name, 'Isolde Noted');
    assert.strictEqual(after.prepare('SELECT COUNT(*) n FROM bookings').get().n, before);
    assert.strictEqual(after.prepare("SELECT COUNT(*) n FROM guest_notes WHERE kind='incident' AND booking_id=(SELECT id FROM bookings WHERE code='HDC-PRIVIN')").get().n, 1);
    after.close();
    console.log('guest privacy checks passed');
  } finally {
    child.kill('SIGTERM');
  }
}

unit();
runServer().catch(err => {
  console.error(err);
  process.exit(1);
});
