const { nice } = require('./util');

// One place for the free-cancellation instant. The clock on the sentence is the
// hotel's time, 24 hours before access starts. Guest cancel and the sentence share it.
class BookingCancel {
  static window(hotel, date, opens, now = new Date()) {
    const { fmtTime } = require('./offering');
    const { hotelZone, zoneToUtc } = require('./calendar');
    const [year, month, day] = String(date || '').split('-').map(Number);
    const [hour, minute] = String(opens || '').split(':').map(Number);
    const zone = hotelZone(hotel || {});
    const start = zoneToUtc(zone, year, month, day, hour || 0, minute || 0);
    const deadline = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(deadline);
    const get = type => {
      const part = parts.find(item => item.type === type);
      return part ? part.value : '';
    };
    let hh = get('hour');
    if (hh === '24') hh = '00';
    const when = `${fmtTime(`${hh}:${get('minute')}`)}, ${nice(`${get('year')}-${get('month')}-${get('day')}`)}`;
    return { free: now.getTime() <= deadline.getTime(), when, deadline };
  }

  static guestMay(db, hotel, booking, now = new Date()) {
    if (!booking || booking.status === 'cancelled' || booking.checked_in_at) return false;
    const { dayPlan } = require('./offering');
    const plan = dayPlan(db, hotel, booking.date);
    if (!plan || !plan.open || !plan.opens) return false;
    return BookingCancel.window(hotel, booking.date, plan.opens, now).free;
  }

  static mark(db, id) {
    const row = db.prepare("UPDATE bookings SET status='cancelled', refunded=1 WHERE id=? AND status!='cancelled'").run(id);
    return row.changes === 1;
  }
}

module.exports = { BookingCancel };
