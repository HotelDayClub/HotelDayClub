const assert = require('assert');
const { arrivalInner } = require('../arrival');
const { listingHtml } = require('../listingView');
const { MapEmbed } = require('../mapEmbed');

const savedKey = process.env.GOOGLE_MAPS_EMBED_KEY;
const KEY = 'dummy-embed-key';

const salt = {
  name: 'The Saltwater Terrace (Demo)',
  address: '18 Demo Terrace, Bondi Beach NSW 2026',
  lat: -33.8915,
  lng: 151.2767,
  is_demo: 1,
};
const addressOnly = {
  name: 'A "Hotel"',
  address: '1 "Demo" & Lane',
  is_demo: 1,
};
const live = {
  name: 'Harbour House',
  address: '9 Real Street, Sydney NSW 2000',
  lat: -33.8688,
  lng: 151.2093,
  is_demo: 0,
};

const PEEK = '<button type="button" class="map-peek" data-lat="-33.8915" data-lng="151.2767" data-label="18 Demo Terrace, Bondi Beach NSW 2026" aria-haspopup="dialog" aria-controls="map-sheet" aria-expanded="false"><svg class="map-peek-art" viewBox="0 0 160 72" aria-hidden="true"><rect width="160" height="72" fill="#DDF1EE"/><path d="M0 24h160M0 48h160M36 0v72M92 0v72" stroke="#D9E6E4" stroke-width="4"/><path d="M0 12h160M68 0v72" stroke="#F5FAF9" stroke-width="2"/><circle cx="80" cy="34" r="6" fill="#FF7294" stroke="#17323A" stroke-width="1.6"/></svg><span class="map-peek-label">View map</span></button>';
const SHEET = '<dialog class="map-sheet" id="map-sheet" aria-labelledby="map-sheet-title"><div class="map-sheet-bar"><h4 id="map-sheet-title">18 Demo Terrace, Bondi Beach NSW 2026</h4><button type="button" class="map-close">Close</button></div><div class="map-canvas" aria-label="Map. You can pan and zoom."></div><p class="map-credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors. Fictional demo address.</p></dialog>';

function section(hotel) {
  const place = arrivalInner(hotel);
  return `${place.address || ''}${place.there || ''}`;
}

function listing(hotel) {
  return listingHtml({
    h: { ...hotel, slug: 'saltwater-terrace', area: 'Eastern Beaches', tagline: 'Pool day', blurb: 'A demo pool.', photos: [] },
    date: '',
    minDate: '2026-11-12',
    maxDate: '2027-02-10',
    closed: '',
    passes: [],
    av: [],
    from: 45,
    cancel: 'Pick a date to see your free-cancellation deadline.',
    know: 'Free cancellation until 24 hours before access hours start.',
    included: [],
    addonList: '',
    hours: '',
    policy: { body: '', note: '' },
    accessByPass: {},
    foodLine: '',
  });
}

function directions(html, query) {
  const href = `https://www.google.com/maps/dir/?api=1&amp;destination=${query}`;
  assert.ok(html.includes(`<a href="${href}" target="_blank" rel="noopener">Open in Google Maps</a>`), href);
}

try {
  delete process.env.GOOGLE_MAPS_EMBED_KEY;
  assert.strictEqual(MapEmbed.key(), '');
  assert.strictEqual(MapEmbed.src(salt), '');
  assert.strictEqual(MapEmbed.directionsUrl(salt), 'https://www.google.com/maps/dir/?api=1&destination=-33.8915%2C151.2767');

  const osmLink = '<p class="muted small">This is a fictional demo address. <a href="https://www.openstreetmap.org/?mlat=-33.8915&amp;mlon=151.2767#map=16/-33.8915/151.2767" rel="noopener noreferrer">Open the map</a>.</p>';
  const plainFiction = '<p class="muted small">This is a fictional demo address.</p>';
  const unset = section(salt);
  assert.ok(unset.includes(PEEK), 'svg preview stays');
  assert.ok(unset.includes(SHEET), 'leaflet dialog stays');
  assert.ok(unset.includes(osmLink));
  assert.ok(!unset.includes(plainFiction));
  assert.ok(unset.includes('18 Demo Terrace, Bondi Beach NSW 2026'));
  assert.ok(!unset.includes('<iframe'));
  assert.ok(!unset.includes('google.com/maps/embed'));
  directions(unset, '-33.8915%2C151.2767');
  assert.ok(!unset.includes(KEY));

  const unsetPage = listing(salt);
  assert.ok(unsetPage.includes(PEEK));
  assert.ok(unsetPage.includes(osmLink));
  assert.ok(unsetPage.includes('id="map-sheet"'));
  assert.ok(unsetPage.includes("s.src='/vendor/leaflet/leaflet.js'"));
  assert.ok(!unsetPage.includes('<iframe'));
  directions(unsetPage, '-33.8915%2C151.2767');

  process.env.GOOGLE_MAPS_EMBED_KEY = '   ';
  assert.strictEqual(MapEmbed.src(salt), '');
  assert.ok(section(salt).includes(PEEK));
  assert.ok(section(salt).includes(osmLink));
  assert.ok(!section(salt).includes('<iframe'));

  process.env.GOOGLE_MAPS_EMBED_KEY = KEY;
  const src = MapEmbed.src(salt);
  assert.strictEqual(src, `https://www.google.com/maps/embed/v1/place?key=${KEY}&q=-33.8915%2C151.2767`);
  const set = section(salt);
  const iframe = `<iframe class="map-embed" title="Map of The Saltwater Terrace (Demo)" src="${src.replace(/&/g, '&amp;')}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
  assert.ok(set.includes(iframe), iframe);
  assert.ok(set.includes('loading="lazy"'));
  assert.ok(set.includes('referrerpolicy="no-referrer-when-downgrade"'));
  assert.ok(set.includes('allowfullscreen'));
  assert.ok(set.includes(plainFiction));
  assert.ok(!set.includes('Open the map'));
  assert.ok(!set.includes('openstreetmap.org'));
  assert.ok(set.includes('18 Demo Terrace, Bondi Beach NSW 2026'));
  assert.ok(!set.includes('class="map-peek"'));
  assert.ok(!set.includes('map-sheet'));
  assert.ok(!set.includes('leaflet'));
  directions(set, '-33.8915%2C151.2767');
  assert.strictEqual(set.split(KEY).length - 1, 1, 'key appears only in the iframe src');
  assert.ok(set.indexOf(KEY) > set.indexOf('src="'));

  const setPage = listing(salt);
  assert.ok(setPage.includes(iframe));
  assert.ok(setPage.includes(plainFiction));
  assert.ok(!setPage.includes('Open the map'));
  assert.ok(!setPage.includes('class="map-peek"'));
  assert.ok(!setPage.includes('map-sheet'));
  assert.ok(!setPage.includes('/vendor/leaflet/leaflet.js'));
  assert.ok(!setPage.includes('leaflet.css'));
  directions(setPage, '-33.8915%2C151.2767');
  assert.strictEqual(setPage.split(KEY).length - 1, 1);

  const quoted = section(addressOnly);
  assert.ok(quoted.includes('title="Map of A &quot;Hotel&quot;"'));
  assert.ok(quoted.includes('src="https://www.google.com/maps/embed/v1/place?key=dummy-embed-key&amp;q=1%20%22Demo%22%20%26%20Lane"'));
  directions(quoted, '1%20%22Demo%22%20%26%20Lane');
  assert.ok(!quoted.includes('class="map-peek"'));
  assert.ok(!quoted.includes('<dialog'));
  assert.ok(quoted.includes(plainFiction));
  assert.ok(!quoted.includes('Open the map'));
  assert.ok(quoted.includes('1 &quot;Demo&quot; &amp; Lane'));

  delete process.env.GOOGLE_MAPS_EMBED_KEY;
  const quotedUnset = section(addressOnly);
  assert.ok(!quotedUnset.includes('<iframe'));
  assert.ok(!quotedUnset.includes('class="map-peek"'));
  assert.ok(!quotedUnset.includes('<dialog'));
  directions(quotedUnset, '1%20%22Demo%22%20%26%20Lane');
  assert.ok(quotedUnset.includes('<p class="muted small">This is a fictional demo address. <a href="https://www.openstreetmap.org/search?query=1%20%22Demo%22%20%26%20Lane" rel="noopener noreferrer">Open the map</a>.</p>'));
  assert.ok(!quotedUnset.includes(plainFiction));

  process.env.GOOGLE_MAPS_EMBED_KEY = KEY;
  const real = section(live);
  assert.ok(real.includes('title="Map of Harbour House"'));
  assert.ok(real.includes('>Get directions</a>'));
  assert.ok(real.includes('>Apple Maps</a>'));
  assert.ok(!real.includes('This is a fictional demo address.'));
  directions(real, '-33.8688%2C151.2093');
  assert.ok(!real.includes('map-sheet'));

  assert.strictEqual(MapEmbed.src({ name: 'Nowhere' }), '');
  assert.strictEqual(MapEmbed.directionsUrl({ name: 'Nowhere' }), '');
  assert.deepStrictEqual(arrivalInner({ name: 'Nowhere' }), { address: '', there: '' });
} finally {
  if (savedKey === undefined) delete process.env.GOOGLE_MAPS_EMBED_KEY;
  else process.env.GOOGLE_MAPS_EMBED_KEY = savedKey;
}

console.log('map-embed-checks ok');
