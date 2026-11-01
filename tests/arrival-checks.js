const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-arrival-'));
const dbPath = path.join(dir, 'daypass.db');
process.env.DB_PATH = dbPath;
delete process.env.DATA_DIR;

const raw = new Database(dbPath);
raw.exec(`CREATE TABLE bookings(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, hotel_id INTEGER, pass_type_id INTEGER, date TEXT,
  qty INTEGER, unit_price INTEGER, total INTEGER, guest_name TEXT, email TEXT, phone TEXT,
  status TEXT DEFAULT 'confirmed', checked_in_at TEXT, created_at TEXT,
  rules_ack_at TEXT, rules_text TEXT, party INTEGER
)`);
raw.close();

const db = require('../db');
function arrivalCols(database) {
  return database.prepare('PRAGMA table_info(bookings)').all().filter(col => col.name === 'expected_arrival');
}
assert.strictEqual(arrivalCols(db).length, 1);
assert.strictEqual(arrivalCols(db)[0].notnull, 0);
assert.strictEqual(String(arrivalCols(db)[0].type).toUpperCase(), 'TEXT');

delete require.cache[require.resolve('../db')];
const again = require('../db');
assert.strictEqual(arrivalCols(again).length, 1, 'expected_arrival migration must be idempotent');

const { arrivalOptions, normalizeArrival, arrivalText, ARRIVAL_LIST_ERROR } = require('../offering');
const { hotelToday } = require('../calendar');
const { BOOKING_COLUMNS, HOTEL_BOOKING_COLUMNS, bookingsCsv, hotelBookingsCsv } = require('../dataExport');
const { bookingNotice } = require('../notices');

function addHotel(slug, extra) {
  const id = db.prepare(`INSERT INTO hotels (slug, name, timezone, status, opens, closes)
    VALUES (?, ?, ?, 'active', ?, ?)`).run(slug, slug, extra.timezone || '', extra.opens || null, extra.closes || null).lastInsertRowid;
  return db.prepare('SELECT * FROM hotels WHERE id=?').get(id);
}
function addHours(hotelId, opens, closes) {
  const ins = db.prepare('INSERT INTO hotel_hours (hotel_id, weekday, open, opens, closes) VALUES (?, ?, 1, ?, ?)');
  for (let weekday = 0; weekday < 7; weekday++) ins.run(hotelId, weekday, opens, closes);
}

const normal = addHotel('arrival-normal', { timezone: 'Australia/Sydney' });
addHours(normal.id, '09:00', '18:00');
const normalOpts = arrivalOptions(db, normal, '2027-06-15');
assert.strictEqual(normalOpts[0].value, 'unsure');
assert.strictEqual(normalOpts[0].label, 'Not sure');
assert.strictEqual(normalOpts.find(option => option.value === '09:00').label, '9–10 am');
assert.strictEqual(normalOpts.find(option => option.value === '11:00').label, '11 am – 12 pm');
assert.strictEqual(normalOpts.find(option => option.value === '12:00').label, '12–1 pm');
assert.strictEqual(normalOpts[normalOpts.length - 1].value, '17:00');
assert.strictEqual(normalOpts[normalOpts.length - 1].label, '5–6 pm');

const bare = addHotel('arrival-bare', { timezone: 'Australia/Brisbane' });
const warns = [];
const origWarn = console.warn;
console.warn = (...args) => warns.push(args.join(' '));
let bareOpts;
try {
  bareOpts = arrivalOptions(db, bare, '2027-06-15');
  assert.ok(warns.some(line => line.includes('9am–5pm')));
  assert.deepStrictEqual(bareOpts.map(option => option.value), ['unsure', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  const noted = warns.length;
  db.prepare("UPDATE hotels SET opens='08:00', closes='12:00' WHERE id=?").run(bare.id);
  const withHours = db.prepare('SELECT * FROM hotels WHERE id=?').get(bare.id);
  const setOpts = arrivalOptions(db, withHours, '2027-06-15');
  assert.strictEqual(warns.length, noted);
  assert.deepStrictEqual(setOpts.map(option => option.value), ['unsure', '08:00', '09:00', '10:00', '11:00']);
} finally {
  console.warn = origWarn;
}

const perth = addHotel('arrival-perth', { timezone: 'Australia/Perth' });
addHours(perth.id, '09:00', '17:00');
const now = new Date('2026-06-15T02:00:00.000Z');
const perthToday = hotelToday(perth, now);
assert.strictEqual(perthToday, '2026-06-15');
const perthOpts = arrivalOptions(db, perth, perthToday, now).map(option => option.value);
assert.strictEqual(perthOpts[0], 'unsure');
assert.ok(!perthOpts.includes('09:00'), 'window that has already ended is hidden');
assert.ok(perthOpts.includes('10:00'), 'same-day filter uses Perth time, not Sydney');
assert.ok(!perthOpts.includes('unsure') || perthOpts.filter(value => value === 'unsure').length === 1);

const list = normalOpts;
assert.deepStrictEqual(normalizeArrival(undefined, list), { value: 'unsure' });
assert.deepStrictEqual(normalizeArrival('', list), { value: 'unsure' });
assert.deepStrictEqual(normalizeArrival('   ', list), { value: 'unsure' });
assert.deepStrictEqual(normalizeArrival('11:00', list), { value: '11:00' });
const rejected = normalizeArrival('03:00', list);
assert.strictEqual(rejected.status, 409);
assert.strictEqual(rejected.error, ARRIVAL_LIST_ERROR);
assert.strictEqual(rejected.error, 'Please choose a time from the list.');
const malformed = normalizeArrival(['11:00'], list);
assert.strictEqual(malformed.status, 400);
assert.strictEqual(malformed.error, ARRIVAL_LIST_ERROR);

assert.strictEqual(arrivalText('11:00', 'estimate'), '11 am – 12 pm (estimate)');
assert.strictEqual(arrivalText('unsure', 'estimate'), 'Not sure');
assert.strictEqual(arrivalText(null, 'estimate'), '');
assert.strictEqual(arrivalText(null, 'short'), '—');
assert.strictEqual(arrivalText('11:00', 'short'), '11 am');
assert.strictEqual(arrivalText('11:00', 'detail'), "11 am – 12 pm (guest's estimate)");
assert.strictEqual(arrivalText('unsure', 'csv'), 'Not sure');
assert.strictEqual(arrivalText('11:00', 'csv'), '11:00');
assert.strictEqual(arrivalText(null, 'csv'), '');

assert.strictEqual(BOOKING_COLUMNS[BOOKING_COLUMNS.indexOf('party') + 1], 'expected_arrival');
assert.strictEqual(HOTEL_BOOKING_COLUMNS[HOTEL_BOOKING_COLUMNS.indexOf('guests') + 1], 'expected_arrival');
const adminHeader = bookingsCsv([{ code: 'HDC-1', party: 2, expected_arrival: 'unsure' }]).split('\r\n')[0].split(',');
assert.strictEqual(adminHeader[adminHeader.indexOf('party') + 1], 'expected_arrival');
const csv = hotelBookingsCsv([
  { date: '2026-11-02', booking_code: 'HDC-1', guest_name: '=Mia', pass: 'Daybed', guests: 2, expected_arrival: '11:00', status: 'confirmed', gross_sales: 80 },
  { date: '2026-11-03', booking_code: 'HDC-2', guest_name: 'Sam', pass: 'Chair', guests: 1, expected_arrival: 'unsure', status: 'confirmed', gross_sales: 40 },
  { date: '2026-11-04', booking_code: 'HDC-3', guest_name: 'Jo', pass: 'Chair', guests: 1, expected_arrival: null, status: 'confirmed', gross_sales: 40 },
]);
const lines = csv.split('\r\n');
assert.strictEqual(lines[0], 'date,booking_code,guest_name,pass,guests,expected_arrival,status,gross_sales,paid_to_you');
assert.ok(lines[1].includes(`"'=Mia"`));
assert.ok(lines[1].includes('"11:00"'));
assert.ok(lines[2].includes('"Not sure"'));
assert.ok(lines[3].includes('"1","","confirmed"'));
assert.ok(lines[1].includes('"$—"'));

const mailed = bookingNotice({
  demo: true,
  to: 'a@b.co',
  code: 'HDC-A',
  hotelName: 'Skyline',
  area: 'North Sydney',
  dateLabel: 'Wed 4 Nov',
  hours: '10am–4pm',
  passLabel: 'Pool chair × 1',
  guests: '1',
  totalLabel: '$40',
  cancel: 'Free cancellation until 11am Wed 4 Nov.',
  contact: 'hello@hoteldayclub.com.au',
  link: 'https://www.hoteldayclub.com.au/booking/HDC-A',
  arrival: '11 am – 12 pm (estimate)',
});
assert.ok(mailed.text.includes('Your demo booking'));
assert.ok(mailed.text.includes('Food and drink are not included in your pass.'));
assert.ok(mailed.html.includes('Food and drink are not included in your pass.'));
assert.ok(mailed.text.includes('Expected arrival: 11 am – 12 pm (estimate)'));
assert.ok(mailed.text.includes("Your pass is valid any time during the hotel's opening hours — your expected arrival time is an estimate, not a reservation."));
assert.ok(mailed.html.includes("your expected arrival time is an estimate, not a reservation."));
const quiet = bookingNotice({
  demo: true,
  to: 'a@b.co',
  code: 'HDC-A',
  hotelName: 'Skyline',
  dateLabel: 'Wed 4 Nov',
  hours: '10am–4pm',
  passLabel: 'Pool chair × 1',
  guests: '1',
  totalLabel: '$40',
  cancel: 'Free cancellation until 11am Wed 4 Nov.',
  contact: 'hello@hoteldayclub.com.au',
  link: 'https://www.hoteldayclub.com.au/booking/HDC-A',
});
assert.ok(!quiet.text.includes('Expected arrival'));
assert.ok(!quiet.html.includes('expected arrival time is an estimate'));
assert.ok(quiet.text.includes('Your demo booking'));

console.log('arrival checks passed');
