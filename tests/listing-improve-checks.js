const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FOOD_RULE, rulesText } = require('../offering');
const { ListingImprove } = require('../listingImprove');
const { listingHtml } = require('../listingView');

const shareJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'share.js'), 'utf8');

assert.strictEqual(
  ListingImprove.cleanShareUrl('https://www.hoteldayclub.com.au/h/skyline-rooftop?date=2026-11-14&utm_source=x&gclid=y#top'),
  'https://www.hoteldayclub.com.au/h/skyline-rooftop?date=2026-11-14',
);
assert.strictEqual(
  ListingImprove.cleanShareUrl('https://www.hoteldayclub.com.au/h/skyline-rooftop?pass=chair&qty=2&guests=4&fbclid=z&ref=a'),
  'https://www.hoteldayclub.com.au/h/skyline-rooftop?pass=chair&guests=4&qty=2',
);
assert.strictEqual(
  ListingImprove.cleanShareUrl('https://www.hoteldayclub.com.au/h/skyline-rooftop#book'),
  'https://www.hoteldayclub.com.au/h/skyline-rooftop',
);
assert.strictEqual(
  ListingImprove.pageShareUrl('skyline-rooftop', { date: '2026-11-14', pass: 'chair', qty: '', guests: '' }),
  'https://www.hoteldayclub.com.au/h/skyline-rooftop?date=2026-11-14&pass=chair',
);

assert.deepStrictEqual(ListingImprove.sharePlan({ canShare: true, coarse: true, errorName: '', clipboard: 'ok' }), { path: 'share', status: '', fallback: false });
assert.deepStrictEqual(ListingImprove.sharePlan({ canShare: true, coarse: true, errorName: 'AbortError', clipboard: 'ok' }), { path: 'share-cancel', status: '', fallback: false });
assert.deepStrictEqual(ListingImprove.sharePlan({ canShare: true, coarse: false, errorName: '', clipboard: 'ok' }), { path: 'copy', status: 'Link copied', fallback: false });
assert.deepStrictEqual(ListingImprove.sharePlan({ canShare: false, coarse: false, errorName: '', clipboard: 'ok' }), { path: 'copy', status: 'Link copied', fallback: false });
assert.deepStrictEqual(ListingImprove.sharePlan({ canShare: true, coarse: true, errorName: 'NotAllowedError', clipboard: 'denied' }), { path: 'fallback', status: '', fallback: true, hint: 'Select the link and copy it.' });
assert.deepStrictEqual(ListingImprove.sharePlan({ canShare: false, coarse: false, errorName: '', clipboard: 'missing' }), { path: 'fallback', status: '', fallback: true, hint: 'Select the link and copy it.' });

assert.ok(shareJs.includes('navigator.share'));
assert.ok(shareJs.includes('navigator.clipboard.writeText'));
assert.ok(shareJs.includes("title: document.title, url: url"));
assert.ok(!shareJs.includes('text:'));
assert.ok(shareJs.includes('AbortError'));
assert.ok(shareJs.includes('Link copied'));
assert.ok(shareJs.includes('showFallback'));
assert.ok(ListingImprove.shareHtml('https://www.hoteldayclub.com.au/h/skyline-rooftop').includes('Select the link and copy it.'));
assert.ok(shareJs.includes("'(pointer:coarse)'"));
assert.ok(shareJs.includes('3000'));
assert.ok(!/mailto:|wa\.me|whatsapp|facebook|twitter|x\.com/i.test(shareJs));

const why = ListingImprove.whyText();
assert.strictEqual(why, 'Why no ratings yet? Ratings will only come from real guests after real visits. None are shown now.');
assert.ok(!ListingImprove.mentionsRatingScore(why));
assert.ok(!/[★☆]/.test(why));
assert.ok(!/\d/.test(why));
assert.ok(!/\breviews?\b/i.test(why));
assert.ok(ListingImprove.mentionsRatingScore('4.8 stars'));
assert.ok(ListingImprove.mentionsRatingScore('Rated 5/5'));
assert.ok(!why.includes('\u2014'));

assert.deepStrictEqual(ListingImprove.STEPS.map(row => row[0]), ['Book a date', 'Show your QR code', 'Enjoy your day']);

assert.strictEqual(ListingImprove.notIncludedLines([
  { code: 'wifi', name: 'Complimentary Wi-Fi', mode: 'included' },
  { code: 'gym', name: 'Fitness centre access', mode: 'addon' },
  { code: 'parking', name: 'Parking', mode: 'off' },
  { code: 'pool', name: 'Pool access', mode: 'included' },
  { code: 'food', name: 'Food', mode: 'off' },
])[0], FOOD_RULE);
assert.ok(ListingImprove.notIncludedLines([{ code: 'gym', name: 'Fitness centre access', mode: 'addon' }]).includes('Fitness centre access (available as an add-on)'));
assert.ok(!ListingImprove.notIncludedLines([{ code: 'pool', name: 'Pool access', mode: 'off' }]).includes('Pool access'));
const noisy = ListingImprove.notIncludedLines([
  { code: 'gym', name: 'Fitness centre access', mode: 'addon' },
  { code: 'kids', name: "Kids' pool access", mode: 'off' },
  { code: 'discount', name: 'Spa treatment credit', mode: 'off' },
  { code: 'late', name: 'Late stay', mode: 'off' },
  { code: 'room-shower', name: 'Room shower access', mode: 'off' },
  { code: 'toiletries', name: 'Toiletries', mode: 'off' },
  { code: 'sauna', name: 'Sauna and steam room', mode: 'off' },
  { code: 'spa', name: 'Hot tub and spa pool', mode: 'off' },
  { code: 'towels', name: 'Towels', mode: 'included' },
]);
assert.strictEqual(noisy[0], FOOD_RULE);
assert.ok(noisy.includes('Toiletries'));
assert.ok(noisy.includes('Sauna and steam room'));
assert.ok(noisy.includes('Hot tub and spa pool'));
assert.ok(!noisy.some(line => /Kids' pool access|Spa treatment credit|Late stay|Room shower access/.test(line)));
assert.ok(!noisy.includes('Towels'));
assert.ok(noisy.length <= 6);
const manyAddons = ListingImprove.notIncludedLines([
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ code: 'a' + i, name: 'Add ' + i, mode: 'addon' })),
  { code: 'sauna', name: 'Sauna and steam room', mode: 'off' },
]);
assert.strictEqual(manyAddons.length, 6);
assert.strictEqual(manyAddons[0], FOOD_RULE);
assert.ok(!manyAddons.includes('Sauna and steam room'));
assert.strictEqual(ListingImprove.notIncludedLines([{ code: 'towels', name: 'Towels', mode: 'off' }])[1], 'Towels');

assert.strictEqual(ListingImprove.facts({}).length, 0);
assert.strictEqual(ListingImprove.factsHtml({}), '');
assert.strictEqual(ListingImprove.guardFact({ lifeguard: 0 }), 'Lifeguard: not on duty');
assert.strictEqual(ListingImprove.heatFact({ heated: 1, setting: 'outdoor' }), 'Heated outdoor pool');
assert.strictEqual(ListingImprove.heatFact({ heated: null, setting: 'outdoor' }), '');
assert.strictEqual(ListingImprove.kidsFact(''), '');
assert.strictEqual(ListingImprove.kidsFact('No children'), 'No children');
assert.strictEqual(ListingImprove.kidsFact('All open hours'), 'Children welcome all open hours');
assert.strictEqual(ListingImprove.ageLabel(''), '');
assert.strictEqual(ListingImprove.ageLabel('All ages'), 'All ages · family friendly');
assert.strictEqual(ListingImprove.ageLabel('18+'), 'Adults only (18+)');
assert.strictEqual(ListingImprove.ageLabel('Mystery'), '');

const blankRules = ListingImprove.ruleRows({});
assert.ok(blankRules.every(row => row[0] === 'Food rule' ? row[1] === FOOD_RULE : row[0] === 'Glass' ? row[1] === 'Ask the hotel' : row[1] === 'Ask the hotel' || row[1] === FOOD_RULE));
assert.strictEqual(blankRules.find(row => row[0] === 'Glass')[1], 'Ask the hotel');
assert.strictEqual(blankRules.find(row => row[0] === 'Food rule')[1], FOOD_RULE);
for (const sample of [{}, { lifeguard: 0 }, { lifeguard: 1 }, { lifeguard: 2, lifeguard_hours: '10am to 4pm' }, { id_required: 1, age_policy: '18+', kids_hours: 'No children', dress_code: 'Swimwear on the roof.' }]) {
  for (const [label, text] of ListingImprove.ruleRows(sample)) {
    assert.ok(!String(text).toLowerCase().startsWith(String(label).toLowerCase()), `${label} / ${text}`);
  }
}
assert.strictEqual(ListingImprove.ruleRows({ lifeguard: 0 }).find(row => row[0] === 'Lifeguard')[1], 'Not on duty');
assert.strictEqual(ListingImprove.ruleRows({ lifeguard: 1 }).find(row => row[0] === 'Lifeguard')[1], 'On duty');
const barRule = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8').match(/\.book-bar-cancel\{[^}]+\}/);
assert.ok(barRule);
assert.ok(!barRule[0].includes('ellipsis'));
assert.strictEqual(ListingImprove.recordedRules({ age_policy: '18+', towels: 1, food_rule: FOOD_RULE, id_required: 1, lifeguard: 0, heated: 1, setting: 'outdoor' }), rulesText({ age_policy: '18+', towels: 1, food_rule: FOOD_RULE, id_required: 1, lifeguard: 0, heated: 1, setting: 'outdoor' }));

const past = { date: '2020-01-02', reason: 'Old' };
const future = [
  { date: '2026-11-20', reason: 'Private event' },
  { date: '2026-12-01', reason: 'Pool maintenance' },
  { date: '2026-12-25', reason: '' },
  { date: '2027-01-04', reason: 'Fourth' },
];
const shown = ListingImprove.closedDates([past, ...future], '2026-11-13');
assert.strictEqual(shown.length, 3);
assert.strictEqual(shown[0].date, '2026-11-20');
assert.strictEqual(shown[2].date, '2026-12-25');
assert.ok(shown[2].label.endsWith(': closed'));
assert.ok(!shown.some(row => row.date === '2027-01-04' || row.date === '2020-01-02'));
assert.strictEqual(ListingImprove.closedDates([], '2026-11-13').length, 0);
assert.strictEqual(ListingImprove.seasonLine({}), '');
assert.strictEqual(ListingImprove.seasonLine({ season_start: '12-01', season_end: '03-31' }), 'Season: 1 Dec to 31 Mar');
assert.strictEqual(ListingImprove.closedWeekdays([{ day: 'Friday', time: 'Closed' }, { day: 'Monday', time: '11am–4pm' }]), 'Closed Friday');
assert.ok(!ListingImprove.seasonLine({ season_start: '12-01', season_end: '03-31' }).includes('\u2014'));

const html = listingHtml({
  h: {
    slug: 'demo-pool', name: 'Demo Pool (Demo)', area: 'Eastern Beaches', tagline: 'A pool', blurb: 'A pool.',
    photos: [], is_demo: 1, age_policy: 'All ages', kids_hours: 'All open hours', lifeguard: 0, heated: 1, setting: 'outdoor', id_required: 1, towels: 1,
  },
  date: '2026-12-01',
  minDate: '2026-11-13',
  maxDate: '2027-02-11',
  closed: '',
  passes: [],
  av: [],
  from: 45,
  cancel: 'CANCEL-SENTINEL',
  know: 'CANCEL-SENTINEL',
  included: [{ code: 'wifi', name: 'Complimentary Wi-Fi', mode: 'included' }, { code: 'gym', name: 'Fitness centre access', mode: 'addon' }],
  addonList: '',
  policy: { body: '<p>policy</p>', note: 'note' },
  accessByPass: {},
  foodLine: FOOD_RULE,
  hourRows: [{ day: 'Friday', time: 'Closed' }],
  todayWd: 5,
  upcomingClosed: [{ date: '2026-12-25', reason: '<maintenance>' }],
});
const goAt = html.indexOf('id="go"');
const noteAt = html.indexOf('id="cancel-note"');
assert.ok(goAt !== -1 && noteAt !== -1 && goAt < noteAt);
assert.ok(html.includes('CANCEL-SENTINEL'));
assert.ok(html.slice(html.indexOf('id="bar-cancel"'), html.indexOf('id="bar-cancel"') + 80).includes('CANCEL-SENTINEL'));
assert.ok(html.includes('href="/refunds"'));
const notInc = html.slice(html.indexOf('<ul class="not-inc">'), html.indexOf('</ul>', html.indexOf('<ul class="not-inc">')));
assert.ok(!notInc.includes(FOOD_RULE));
assert.ok(notInc.includes('available as an add-on'));
assert.strictEqual(html.split(FOOD_RULE).length - 1, 1);
assert.ok(html.indexOf('id="seat-h"') < html.indexOf('id="hiw"'));
assert.ok(html.includes('aria-label="Key facts"'));
assert.ok(html.includes('Lifeguard: not on duty'));
assert.ok(html.includes('Fictional demo listing'));
assert.ok(!ListingImprove.mentionsRatingScore(html.slice(html.indexOf('class="why-no"'), html.indexOf('</p>', html.indexOf('class="why-no"')))));
assert.ok(html.includes('id="share-box"'));
assert.ok(!/mailto:|whatsapp|facebook/i.test(html.slice(html.indexOf('id="share-area"'), html.indexOf('id="share-status"') + 80)));
assert.ok(!html.includes('id="season"'));
assert.ok(!html.includes('Season and closed dates'));
assert.ok(!html.includes('&lt;maintenance&gt;'));
assert.ok(html.includes('<b>Book a date</b>'));
assert.ok(!html.includes('1 × Towels'));
assert.ok(!html.includes('\u2014'));

console.log('listing-improve-checks ok');
