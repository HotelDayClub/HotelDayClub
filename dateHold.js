const { ymd, addDays, nice } = require('./util');
const { spotLabel } = require('./offering');

// Why a chosen date cannot be booked, and the next dates that can.
class DateHold {
  static lookAhead() {
    return 90;
  }

  static classify(row) {
    if (!row) return '';
    if (row.past) return 'past';
    if (row.blocked) return 'closed';
    if (Number(row.remaining) === 0) return 'soldout';
    return '';
  }

  static nextOpen(readAvailability, hotelId, passId, qty, startDay, afterDate) {
    const need = Math.max(1, Number(qty) || 1);
    const horizon = ymd(addDays(new Date(startDay + 'T12:00:00'), this.lookAhead()));
    let cursor = afterDate && afterDate >= startDay
      ? ymd(addDays(new Date(afterDate + 'T12:00:00'), 1))
      : startDay;
    const found = [];
    while (cursor && cursor <= horizon && found.length < 3) {
      const rows = readAvailability(hotelId, cursor) || [];
      const row = rows.find(item => item.id === passId);
      if (row && !row.past && !row.blocked && row.remaining >= need) found.push(cursor);
      cursor = ymd(addDays(new Date(cursor + 'T12:00:00'), 1));
    }
    return found;
  }

  static longLabel(date) {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  static copy(hotel, pass, date, kind, reason) {
    const when = nice(date);
    if (kind === 'past') {
      return {
        before: 'That date has passed.',
        when: '',
        detail: '',
        status: 'That date has passed. Pick another date.',
      };
    }
    if (kind === 'soldout') {
      const what = spotLabel(pass);
      return {
        before: `${what} is sold out on `,
        when,
        detail: '.',
        status: `Sold out on ${when}. Pick another date.`,
      };
    }
    if (/same-day|closed for today/i.test(reason || '')) {
      const line = String(reason || 'Closed').replace(/\.$/, '');
      return {
        before: `${line}.`,
        when: '',
        detail: '',
        status: `${line}. Pick another date.`,
      };
    }
    const why = reason || 'Closed';
    return {
      before: `${hotel.name} is closed on `,
      when,
      detail: ` (${why}).`,
      status: `Closed on ${when} (${why}). Pick another date.`,
    };
  }

  static view({ hotel, pass, qty, date, kind, reason, next, listingHref }) {
    const text = this.copy(hotel, pass, date, kind, reason || '');
    const links = (next || []).map(iso => {
      const params = new URLSearchParams();
      params.set('date', iso);
      params.set('pass', pass.code);
      params.set('qty', String(Math.max(1, Number(qty) || 1)));
      return { date: iso, label: nice(iso), href: `/h/${encodeURIComponent(hotel.slug)}?${params.toString()}#book` };
    });
    const open = links.length > 0;
    return {
      date,
      kind,
      before: text.before,
      when: text.when,
      after: `${text.detail}${open ? ' Pick another date:' : ''}`,
      status: open ? text.status : 'No open dates in the next 90 days.',
      links,
      empty: open ? '' : 'No open dates in the next 90 days.',
      listingHref: listingHref || `/h/${encodeURIComponent(hotel.slug)}`,
      hotelName: hotel.name,
      longLabel: this.longLabel(date),
    };
  }
}

module.exports = { DateHold };
