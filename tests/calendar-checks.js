const assert = require('assert');
const { accessInstants, formatUtc, bookingIcs, googleCalendarUrl } = require('../calendar');
const { HOTEL_SHARE, PLATFORM_FEE, hotelPct, feePct, share } = require('../commission');
const { addonsHtml } = require('../inclusions');

function at(date, opens, closes, hotel) {
  const window = accessInstants(date, opens, closes, hotel);
  assert.ok(window, date + ' ' + opens + '-' + closes);
  return { start: formatUtc(window.start), end: formatUtc(window.end) };
}

// Tuesday 20 Jan 2026 is AEDT (UTC+11). 11:00–16:00 Sydney is 00:00Z–05:00Z.
assert.deepStrictEqual(at('2026-01-20', '11:00', '16:00'), {
  start: '20260120T000000Z',
  end: '20260120T050000Z',
});
// Tuesday 14 Jul 2026 is AEST (UTC+10). 11:00–16:00 Sydney is 01:00Z–06:00Z.
assert.deepStrictEqual(at('2026-07-14', '11:00', '16:00'), {
  start: '20260714T010000Z',
  end: '20260714T060000Z',
});
// Day after the April 2026 fallback (5 Apr) is standard time. Day after the October start (4 Oct) is daylight time.
assert.deepStrictEqual(at('2026-04-06', '10:00', '16:00'), {
  start: '20260406T000000Z',
  end: '20260406T060000Z',
});
assert.deepStrictEqual(at('2026-10-05', '10:00', '16:00'), {
  start: '20261004T230000Z',
  end: '20261005T050000Z',
});
// A pass that runs past midnight ends on the next civil morning.
assert.deepStrictEqual(at('2026-01-20', '22:00', '02:00'), {
  start: '20260120T110000Z',
  end: '20260120T150000Z',
});
assert.deepStrictEqual(at('2026-07-14', '22:00', '02:00'), {
  start: '20260714T120000Z',
  end: '20260714T160000Z',
});
// Queensland has no daylight saving. Western Australia stays on UTC+8. A stored timezone wins over the state.
assert.deepStrictEqual(at('2026-01-20', '11:00', '16:00', { address: '1 Demo St, Brisbane QLD 4000' }), {
  start: '20260120T010000Z',
  end: '20260120T060000Z',
});
assert.deepStrictEqual(at('2026-07-14', '11:00', '16:00', { state: 'QLD' }), {
  start: '20260714T010000Z',
  end: '20260714T060000Z',
});
assert.deepStrictEqual(at('2026-01-20', '11:00', '16:00', { state: 'WA' }), {
  start: '20260120T030000Z',
  end: '20260120T080000Z',
});
assert.deepStrictEqual(at('2026-01-20', '11:00', '16:00', { state: 'NSW', timezone: 'Australia/Perth' }), {
  start: '20260120T030000Z',
  end: '20260120T080000Z',
});
assert.deepStrictEqual(at('2026-01-20', '11:00', '16:00', { address: 'Bondi Beach NSW 2026', state: 'QLD' }), {
  start: '20260120T010000Z',
  end: '20260120T060000Z',
});

const summer = accessInstants('2026-01-20', '11:00', '16:00');
const ics = bookingIcs(
  { code: 'HDC-TEST', date: '2026-01-20', cancel_note: 'Free cancellation until 11 am, Mon 19 Jan (hotel time).' },
  { name: 'Skyline Rooftop', address: '4 Demo Street', area: 'North Sydney', lifeguard: 0 },
  { ...summer, span: '11am–4pm' },
);
assert.ok(ics.includes('DTSTART:20260120T000000Z'));
assert.ok(ics.includes('DTEND:20260120T050000Z'));
assert.ok(!ics.includes('VALUE=DATE'));
assert.ok(ics.includes('Booking HDC-TEST. Show this code at reception.'));
assert.ok(ics.includes('Access hours 11am–4pm.'));
assert.ok(ics.includes('Free cancellation until 11 am\\, Mon 19 Jan (hotel time).'));
assert.ok(ics.includes('Food and drink not included.'));
assert.ok(ics.includes('No lifeguard is on duty.'));
assert.ok(ics.includes('LOCATION:4 Demo Street'));
assert.ok(ics.includes('SUMMARY:Day pass at Skyline Rooftop'));

const url = new URL(googleCalendarUrl({
  title: 'Day pass at Skyline Rooftop',
  start: summer.start,
  end: summer.end,
  details: 'Booking HDC-TEST. Show this code at reception.',
  location: '4 Demo Street',
}));
assert.strictEqual(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
assert.strictEqual(url.searchParams.get('action'), 'TEMPLATE');
assert.strictEqual(url.searchParams.get('text'), 'Day pass at Skyline Rooftop');
assert.strictEqual(url.searchParams.get('dates'), '20260120T000000Z/20260120T050000Z');
assert.ok(url.searchParams.get('details').includes('HDC-TEST'));
assert.strictEqual(url.searchParams.get('location'), '4 Demo Street');

const fallback = bookingIcs({ code: 'HDC-DAY', date: '2026-01-20' }, { name: 'Pool', area: 'Bondi' }, null);
assert.ok(fallback.includes('DTSTART;VALUE=DATE:20260120'));
assert.ok(fallback.includes('LOCATION:Bondi'));

assert.strictEqual(PLATFORM_FEE, 0.25);
assert.strictEqual(HOTEL_SHARE, 0.75);
assert.strictEqual(hotelPct(), 75);
assert.strictEqual(feePct(), 25);
assert.deepStrictEqual(share(200), { payout: 150, fee: 50 });
assert.deepStrictEqual(share(10.1), { payout: 7.58, fee: 2.52 });

assert.strictEqual(addonsHtml([], []), '');
const off = addonsHtml([{ code: 'parking', mode: 'off', name: 'Parking' }], []);
assert.ok(off.includes('Parking is not offered'));
assert.ok(!off.includes('name="addon"'));
const box = addonsHtml([], [{ code: 'gym', name: 'Fitness centre access', price: 25, per: 'guest' }]);
assert.ok(box.includes('type="checkbox"'));
assert.ok(box.includes('name="addon"'));
assert.ok(box.includes('value="gym"'));
assert.ok(box.includes('data-price="25"'));
assert.ok(!box.includes('extra-static'));

console.log('calendar checks passed');
