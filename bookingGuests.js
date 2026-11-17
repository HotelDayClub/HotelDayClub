const { esc } = require('./util');
const { GuestPrivacy } = require('./guestPrivacy');
const { displayName } = require('./hotelName');

function normalizeName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function validGuestName(raw) {
  const name = normalizeName(raw);
  if (name.length < 2 || name.length > 80) return false;
  const parts = name.split(' ').filter(Boolean);
  return parts.length >= 2;
}

function namesFromBody(body, party) {
  const n = Math.max(1, Math.floor(Number(party) || 1));
  const main = normalizeName(body.name);
  const names = [main];
  for (let i = 2; i <= n; i++) {
    const key = `guest_${i}`;
  const alt = body[`guest${i}`];
    const val = body[key] != null ? body[key] : alt;
    names.push(normalizeName(val));
  }
  return names;
}

function fieldErrors(body, party) {
  const errors = {};
  const names = namesFromBody(body, party);
  if (!validGuestName(names[0])) errors.name = 'Enter your full name (first and last).';
  for (let i = 2; i <= party; i++) {
    const key = `guest_${i}`;
    if (!validGuestName(names[i - 1])) errors[key] = 'Enter a full name (first and last).';
  }
  return errors;
}

function save(db, bookingId, names) {
  const del = db.prepare('DELETE FROM booking_guests WHERE booking_id=?');
  const ins = db.prepare('INSERT INTO booking_guests(booking_id, position, full_name) VALUES (?,?,?)');
  db.transaction(() => {
    del.run(bookingId);
    names.forEach((full, idx) => ins.run(bookingId, idx + 1, full));
  })();
}

function listForBooking(db, bookingId) {
  return db.prepare('SELECT position, full_name FROM booking_guests WHERE booking_id=? ORDER BY position')
    .all(bookingId)
    .map(r => r.full_name);
}

function loadMap(db, bookingIds) {
  const ids = [...new Set((bookingIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT booking_id, position, full_name FROM booking_guests WHERE booking_id IN (${placeholders}) ORDER BY booking_id, position`).all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.booking_id)) map.set(row.booking_id, []);
    map.get(row.booking_id).push(row.full_name);
  }
  return map;
}

function attach(rows, guestMap) {
  return (rows || []).map(row => {
    const list = guestMap.get(row.id) || [row.guest_name].filter(Boolean);
    return { ...row, guest_names: list };
  });
}

function partyHeadline(mainName, party) {
  const n = Math.max(1, Math.floor(Number(party) || 1));
  const main = normalizeName(mainName) || GuestPrivacy.NAME;
  if (n <= 1) return main;
  const extra = n - 1;
  return `${main} + ${extra} guest${extra === 1 ? '' : 's'}`;
}

function othersHtml(names, { muted = true } = {}) {
  const rest = (names || []).slice(1).filter(Boolean);
  if (!rest.length) return '';
  const cls = muted ? 'guest-others muted small' : 'guest-others';
  return `<div class="${cls}">${rest.map(n => esc(n)).join(', ')}</div>`;
}

function headlineHtml(row, hotel, now) {
  const hidden = !!(hotel && GuestPrivacy.pastWindow(row.date, hotel, now) && !GuestPrivacy.keepsContact(row));
  const names = hidden
    ? [GuestPrivacy.NAME]
    : (row.guest_names && row.guest_names.length ? row.guest_names : [row.guest_name]);
  const party = row.party || row.qty * (row.holds || 1);
  const main = hidden ? GuestPrivacy.NAME : names[0];
  const title = partyHeadline(main, party);
  const others = hidden ? '' : othersHtml(names);
  return { title, others, names, hidden };
}

function csvNames(names, hidden) {
  if (hidden) return GuestPrivacy.NAME;
  return (names || []).join('; ');
}

function searchGuestSql(alias = 'b') {
  return `OR EXISTS (SELECT 1 FROM booking_guests bg WHERE bg.booking_id=${alias}.id AND lower(bg.full_name) LIKE ?)`;
}

module.exports = {
  validGuestName,
  namesFromBody,
  fieldErrors,
  save,
  listForBooking,
  loadMap,
  attach,
  partyHeadline,
  othersHtml,
  headlineHtml,
  csvNames,
  searchGuestSql,
};