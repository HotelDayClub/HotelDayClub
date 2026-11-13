const { esc } = require('./util');
const { HotelClock } = require('./calendar');

// Hotel screens and the hotel CSV drop guest contact details once the visit
// is more than HOTEL_GUEST_DAYS before that hotel's today. An incident note
// keeps the details. Rows stay in the database.
class GuestPrivacy {
  static HOTEL_GUEST_DAYS = 30;
  static NAME = 'Guest';
  static NOTICE = 'Guest names and contact details are hidden 30 days after the visit, unless an incident was logged.';

  static cutoff(hotel, now = new Date()) {
    return HotelClock.offset(hotel, -this.HOTEL_GUEST_DAYS, now);
  }

  static pastWindow(date, hotel, now = new Date()) {
    const day = String(date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    return day < this.cutoff(hotel, now);
  }

  static keepsContact(row) {
    return Array.isArray(row && row.notes) && row.notes.some(note => note && note.kind === 'incident');
  }

  static present(row, hotel, now = new Date()) {
    if (!row || !hotel || !this.pastWindow(row.date, hotel, now) || this.keepsContact(row)) return row;
    return { ...row, guest_name: this.NAME, email: '', phone: '', contact_hidden: true };
  }

  static presentAll(rows, hotel, now = new Date()) {
    return (rows || []).map(row => this.present(row, hotel, now));
  }

  // Name, email and phone may match only inside the window, or when an incident was logged.
  // The date bound is a bound parameter. Booking code match stays outside this gate.
  static contactGate() {
    return `(b.date IS NULL OR b.date = '' OR b.date >= ? OR EXISTS (SELECT 1 FROM guest_notes gn WHERE gn.booking_id = b.id AND gn.kind = 'incident'))`;
  }

  static note() {
    return `<p class="muted guest-privacy">${esc(this.NOTICE)}</p>`;
  }
}

module.exports = { GuestPrivacy };
