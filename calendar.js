const { ymd, addDays } = require('./util');
const { dayPlan } = require('./offering');

// Hotels do not store a timezone. Access hours are civil times in Australia/Sydney.
// Instants are written in UTC so calendar apps in any zone show the right moment.

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

function sydneyToUtc(year, month, day, hour, minute) {
  const offset = sydneyOffsetMinutes(year, month, day, hour, minute);
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

function accessInstants(date, opens, closes) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const start = parseHm(opens);
  const end = parseHm(closes);
  if (!start || !end) return null;
  const [year, month, day] = date.split('-').map(Number);
  const startAt = sydneyToUtc(year, month, day, start.hour, start.minute);
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
  const endAt = sydneyToUtc(endYear, endMonth, endDay, end.hour, end.minute);
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
  return accessInstants(date, plan.opens, plan.effective || plan.closes);
}

function icsEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function bookingIcs(b, hotel, window) {
  const where = String((hotel && (hotel.address || hotel.area)) || '').trim();
  const summary = 'Day pass at ' + ((hotel && hotel.name) || 'Hotel Day Club');
  const description = 'Booking ' + b.code + '. Show this code at reception.';
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
    details: 'Booking ' + booking.code + '. Show this code at reception.',
    location: where,
  });
}

module.exports = {
  sydneyOffsetMinutes, accessInstants, formatUtc, eventWindow,
  bookingIcs, googleCalendarUrl, passCalendarLink,
};
