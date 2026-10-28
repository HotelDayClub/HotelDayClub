const { ymd, addDays } = require('./util');
const { dayPlan, fmtTime, cancelNote } = require('./offering');

// Civil access times use the hotel's stored timezone, or its stored state, or a
// state abbreviation already in the stored address. Otherwise they use Sydney.
// Instants are written in UTC so calendar apps in any zone show the right moment.

const ZONES = {
  NSW: 'Australia/Sydney',
  'NEW SOUTH WALES': 'Australia/Sydney',
  QLD: 'Australia/Brisbane',
  QUEENSLAND: 'Australia/Brisbane',
  WA: 'Australia/Perth',
  'WESTERN AUSTRALIA': 'Australia/Perth',
};

function stateZone(state) {
  return ZONES[String(state || '').trim().toUpperCase()] || '';
}

function addressZone(address) {
  const text = String(address || '');
  if (/\bQueensland\b/i.test(text) || /\bQLD\b/.test(text)) return 'Australia/Brisbane';
  if (/\bWestern Australia\b/i.test(text) || /\bWA\b/.test(text)) return 'Australia/Perth';
  if (/\bNew South Wales\b/i.test(text) || /\bNSW\b/.test(text)) return 'Australia/Sydney';
  return '';
}

function hotelZone(hotel) {
  const tz = String((hotel && hotel.timezone) || '').trim();
  if (tz === 'Australia/Sydney' || tz === 'Australia/Brisbane' || tz === 'Australia/Perth') return tz;
  return stateZone(hotel && hotel.state) || addressZone(hotel && hotel.address) || 'Australia/Sydney';
}

function hotelToday(hotel, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: hotelZone(hotel),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function firstSunday(year, monthIndex) {
  const dow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return dow === 0 ? 1 : 1 + (7 - dow);
}

function sydneyOffsetMinutes(year, month, day, hour, minute) {
  const april = firstSunday(year, 3);
  const october = firstSunday(year, 9);
  const mins = hour * 60 + minute;
  if (month < 4 || month > 10) return 11 * 60;
  if (month > 4 && month < 10) return 10 * 60;
  if (month === 4) {
    if (day < april) return 11 * 60;
    if (day > april) return 10 * 60;
    // First Sunday in April: clocks go back at 03:00. The 02:00 hour happens twice;
    // use the earlier one (still AEDT) so a visit that started the night before stays continuous.
    return mins < 3 * 60 ? 11 * 60 : 10 * 60;
  }
  if (day < october) return 10 * 60;
  if (day > october) return 11 * 60;
  // First Sunday in October: 02:00–03:00 does not exist. Times before 03:00 stay on AEST.
  return mins < 3 * 60 ? 10 * 60 : 11 * 60;
}

function zoneOffsetMinutes(zone, year, month, day, hour, minute) {
  if (zone === 'Australia/Brisbane') return 10 * 60;
  if (zone === 'Australia/Perth') return 8 * 60;
  return sydneyOffsetMinutes(year, month, day, hour, minute);
}

function zoneToUtc(zone, year, month, day, hour, minute) {
  const offset = zoneOffsetMinutes(zone, year, month, day, hour, minute);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 60000);
}

function parseHm(hhmm) {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hour = +m[1];
  const minute = +m[2];
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function accessInstants(date, opens, closes, hotel) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const start = parseHm(opens);
  const end = parseHm(closes);
  if (!start || !end) return null;
  const zone = hotelZone(hotel);
  const [year, month, day] = date.split('-').map(Number);
  const startAt = zoneToUtc(zone, year, month, day, start.hour, start.minute);
  let endYear = year;
  let endMonth = month;
  let endDay = day;
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  if (endMin <= startMin) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    endYear = next.getUTCFullYear();
    endMonth = next.getUTCMonth() + 1;
    endDay = next.getUTCDate();
  }
  const endAt = zoneToUtc(zone, endYear, endMonth, endDay, end.hour, end.minute);
  if (!(startAt < endAt)) return null;
  return { start: startAt, end: endAt };
}

function formatUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function eventWindow(db, hotel, date) {
  if (!hotel) return null;
  const plan = dayPlan(db, hotel, date);
  if (!plan || !plan.open || !plan.opens) return null;
  const closes = plan.effective || plan.closes;
  const window = accessInstants(date, plan.opens, closes, hotel);
  if (!window) return null;
  window.span = `${fmtTime(plan.opens)}–${fmtTime(closes)}`;
  window.cancel = cancelNote(db, hotel, date);
  return window;
}

function lifeguardFact(hotel) {
  const raw = hotel && hotel.lifeguard;
  if (raw == null || raw === '') return '';
  const n = Number(raw);
  const hours = String((hotel && hotel.lifeguard_hours) || '').trim();
  if (n === 1) return 'A lifeguard is on duty.';
  if (n === 2) return hours ? `A lifeguard is on duty during ${hours}.` : 'A lifeguard is on duty.';
  if (n === 0) return 'No lifeguard is on duty.';
  return '';
}

function eventFacts(booking, hotel, window) {
  const lines = ['Booking ' + (booking && booking.code ? booking.code : '') + '. Show this code at reception.'];
  if (window && window.span) lines.push('Access hours ' + window.span + '.');
  const cancel = String((booking && booking.cancel_note) || (window && window.cancel) || '').trim();
  if (cancel) lines.push(cancel);
  lines.push('Food and drink not included.');
  const guard = lifeguardFact(hotel);
  if (guard) lines.push(guard);
  return lines.join('\n');
}

function icsEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function bookingIcs(b, hotel, window) {
  const where = String((hotel && (hotel.address || hotel.area)) || '').trim();
  const summary = 'Day pass at ' + ((hotel && hotel.name) || 'Hotel Day Club');
  const description = eventFacts(b, hotel, window);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hotel Day Club//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscape(b.code)}@hoteldayclub.com.au`,
    `DTSTAMP:${formatUtc(new Date())}`,
  ];
  if (window && window.start && window.end) {
    lines.push(`DTSTART:${formatUtc(window.start)}`);
    lines.push(`DTEND:${formatUtc(window.end)}`);
  } else {
    const day = String(b.date || '').replace(/-/g, '');
    const end = day && /^\d{8}$/.test(day) ? ymd(addDays(new Date(b.date + 'T00:00:00'), 1)).replace(/-/g, '') : day;
    lines.push(`DTSTART;VALUE=DATE:${day}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
  }
  lines.push(`SUMMARY:${icsEscape(summary)}`);
  lines.push(`DESCRIPTION:${icsEscape(description)}`);
  if (where) lines.push(`LOCATION:${icsEscape(where)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR', '');
  return lines.join('\r\n');
}

function googleCalendarUrl({ title, start, end, details, location }) {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', title || 'Day pass');
  if (start && end) params.set('dates', `${formatUtc(start)}/${formatUtc(end)}`);
  if (details) params.set('details', details);
  if (location) params.set('location', location);
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function passCalendarLink(booking, hotel, window) {
  if (!window || !window.start || !window.end) return '';
  const where = String((hotel && (hotel.address || hotel.area)) || '').trim();
  return googleCalendarUrl({
    title: 'Day pass at ' + ((hotel && hotel.name) || 'Hotel Day Club'),
    start: window.start,
    end: window.end,
    details: eventFacts(booking, hotel, window),
    location: where,
  });
}

module.exports = {
  sydneyOffsetMinutes, hotelZone, hotelToday, accessInstants, formatUtc, eventWindow,
  bookingIcs, googleCalendarUrl, passCalendarLink,
};
