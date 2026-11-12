const { csvCell } = require('./waitlist');
const { arrivalText } = require('./offering');
const { HotelClock } = require('./calendar');

const UTC_STAMPS = ['created_at', 'checked_in_at', 'rules_ack_at', 'terms_ack_at', 'risk_ack_at', 'consent_at'];

const BOOKING_COLUMNS = [
  'code', 'hotel', 'hotel_slug', 'date', 'qty', 'party', 'expected_arrival', 'guest_name', 'email', 'phone',
  'status', 'unit_price', 'total', 'created_at', 'checked_in_at', 'arrived_count', 'marketing_opt_in',
  'rules_ack_at', 'terms_ack_at', 'risk_ack_at', 'terms_version', 'refunds_version', 'privacy_version', 'risk_version', 'consent_at', 'consent_ip', 'cancel_note', 'seeded',
];

const HOTEL_BOOKING_COLUMNS = [
  'date', 'booking_code', 'guest_name', 'pass', 'guests', 'expected_arrival', 'status', 'gross_sales', 'paid_to_you',
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
  return toCsv(BOOKING_COLUMNS, rows.map(row => {
    const copy = { ...row };
    for (const key of UTC_STAMPS) if (copy[key]) copy[key] = HotelClock.iso(copy[key]);
    return copy;
  }));
}

function hotelsCsv(rows) {
  return toCsv(HOTEL_COLUMNS, rows);
}

function hotelBookingsCsv(rows) {
  return toCsv(HOTEL_BOOKING_COLUMNS, rows.map(row => ({
    ...row,
    expected_arrival: arrivalText(row.expected_arrival, 'csv'),
    paid_to_you: row.paid_to_you == null || row.paid_to_you === '' ? '$—' : row.paid_to_you,
  })));
}

module.exports = { BOOKING_COLUMNS, HOTEL_COLUMNS, HOTEL_BOOKING_COLUMNS, bookingsCsv, hotelsCsv, hotelBookingsCsv };
