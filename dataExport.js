const { csvCell } = require('./waitlist');

const BOOKING_COLUMNS = [
  'code', 'hotel', 'hotel_slug', 'date', 'qty', 'party', 'guest_name', 'email', 'phone',
  'status', 'unit_price', 'total', 'created_at', 'checked_in_at', 'marketing_opt_in',
  'rules_ack_at', 'terms_ack_at', 'risk_ack_at', 'cancel_note', 'seeded',
];

const HOTEL_COLUMNS = [
  'id', 'slug', 'name', 'area', 'status', 'login', 'contact_name', 'contact_email', 'address',
];

function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map(key => csvCell(row[key])).join(','));
  return lines.join('\r\n') + '\r\n';
}

function bookingsCsv(rows) {
  return toCsv(BOOKING_COLUMNS, rows);
}

function hotelsCsv(rows) {
  return toCsv(HOTEL_COLUMNS, rows);
}

module.exports = { BOOKING_COLUMNS, HOTEL_COLUMNS, bookingsCsv, hotelsCsv };
