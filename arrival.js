const { esc } = require('./util');

const PRESETS = {
  'saltwater-terrace': {
    address: '18 Demo Terrace, Bondi Beach NSW 2026',
    lat: -33.8915, lng: 151.2767,
    transit: 'Bondi Junction station, then the 333 bus towards Bondi Beach. Get off at Campbell Parade.',
    parking: 'The demo car park entrance is on Demo Lane, behind the building.',
    entrance: 'Day guests check in at the pool reception on level 1, not the hotel front desk.',
  },
  'skyline-rooftop': {
    address: '4 Demo Street, North Sydney NSW 2060',
    lat: -33.8396, lng: 151.2069,
    transit: 'North Sydney station is a short walk. Use the Miller Street exit.',
    parking: 'Car park entry is off Demo Lane. A height limit applies in this demo.',
    entrance: 'Day guests take the pool lift from the ground-floor lobby and check in on the roof.',
  },
  'harbourside-lido': {
    address: '90 Demo Place, Sydney NSW 2000',
    lat: -33.8688, lng: 151.2093,
    transit: 'Town Hall or Wynyard station, then a short walk.',
    parking: 'The basement entry is on Demo Lane. Spaces are limited in this demo.',
    entrance: 'Day guests check in at the lido desk inside the pool hall, not hotel reception.',
  },
  'palm-court': {
    address: '7 Demo Avenue, Parramatta NSW 2150',
    lat: -33.8151, lng: 151.0011,
    transit: 'Parramatta station, then a short walk.',
    parking: 'On-site parking. Enter from Demo Avenue and follow the signs to the pool.',
    entrance: 'Day guests check in at the garden reception beside the lagoon.',
  },
  'manly-sands': {
    address: '22 Demo Road, Manly NSW 2095',
    lat: -33.798, lng: 151.287,
    transit: 'The Manly ferry, then a short walk. The 199 bus also stops nearby.',
    parking: 'Street-side hotel bays on Demo Road. First come in this demo.',
    entrance: 'Day guests check in at the beachfront desk, not the hotel lobby.',
  },
  'bayview-spa': {
    address: '5 Demo Crescent, Rose Bay NSW 2029',
    lat: -33.8745, lng: 151.271,
    transit: 'Edgecliff station, then the 323 bus towards Rose Bay.',
    parking: 'Forecourt spaces. Enter from Demo Crescent.',
    entrance: 'Day guests check in at the bathhouse door on the garden side.',
  },
};

function numOrNull(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
}

function ensureArrival(db) {
  const upd = db.prepare(`UPDATE hotels SET address=?, lat=?, lng=?, transit_note=?, parking_entrance=?, day_entrance=?
    WHERE slug=? AND (address IS NULL OR address='')`);
  db.transaction(() => {
    for (const [slug, row] of Object.entries(PRESETS)) {
      upd.run(row.address, row.lat, row.lng, row.transit, row.parking, row.entrance, slug);
    }
  })();
}

function saveArrival(db, hotelId, body) {
  const address = String(body.address || '').trim().slice(0, 160);
  if (!address) return { err: 'Add an address.' };
  const lat = numOrNull(body.lat);
  const lng = numOrNull(body.lng);
  const hasLat = String(body.lat || '').trim() !== '';
  const hasLng = String(body.lng || '').trim() !== '';
  if (hasLat || hasLng) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { err: 'Latitude must be between -90 and 90, and longitude between -180 and 180.' };
    }
  }
  const clip = key => String(body[key] || '').trim().slice(0, 240);
  const state = ['NSW', 'QLD', 'WA'].includes(String(body.state || '').trim()) ? String(body.state).trim() : '';
  const timezone = ['Australia/Sydney', 'Australia/Brisbane', 'Australia/Perth'].includes(String(body.timezone || '').trim())
    ? String(body.timezone).trim()
    : '';
  db.prepare('UPDATE hotels SET address=?, lat=?, lng=?, transit_note=?, parking_entrance=?, day_entrance=?, state=?, timezone=? WHERE id=?')
    .run(address, hasLat ? lat : null, hasLng ? lng : null, clip('transit_note'), clip('parking_entrance'), clip('day_entrance'), state || null, timezone || null, hotelId);
  return {};
}

function arrivalHtml(hotel) {
  const address = String(hotel.address || '').trim();
  const lat = Number(hotel.lat);
  const lng = Number(hotel.lng);
  const mapped = Number.isFinite(lat) && Number.isFinite(lng);
  if (!address && !mapped) return '';
  const demo = Number(hotel.is_demo) === 1;
  const q = encodeURIComponent(address || `${lat},${lng}`);
  const google = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  const apple = `https://maps.apple.com/?daddr=${q}&dirflg=d`;
  const osm = mapped
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
    : `https://www.openstreetmap.org/search?query=${q}`;
  const label = address || 'Hotel';
  const preview = mapped ? `<button type="button" class="map-peek" data-lat="${lat}" data-lng="${lng}" data-label="${esc(label)}" aria-haspopup="dialog" aria-controls="map-sheet" aria-expanded="false"><svg class="map-peek-art" viewBox="0 0 160 72" aria-hidden="true"><rect width="160" height="72" fill="#E7EEF5"/><path d="M0 24h160M0 48h160M36 0v72M92 0v72" stroke="#C5D4E4" stroke-width="4"/><path d="M0 12h160M68 0v72" stroke="#D7E3EF" stroke-width="2"/><circle cx="80" cy="34" r="6" fill="#FF6B57" stroke="#0A1428" stroke-width="1.6"/></svg><span class="map-peek-label">View map</span></button>` : '';
  const credit = demo ? ' Fictional demo address.' : '';
  const sheet = mapped ? `<dialog class="map-sheet" id="map-sheet" aria-labelledby="map-sheet-title"><div class="map-sheet-bar"><h4 id="map-sheet-title">${esc(label)}</h4><button type="button" class="map-close">Close</button></div><div class="map-canvas" aria-label="Map. You can pan and zoom."></div><p class="map-credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors.${credit}</p></dialog>` : '';
  const directions = address && !demo
    ? `<div class="arrive-acts"><a class="btn btn-navy" href="${esc(google)}" target="_blank" rel="noopener noreferrer">Get directions</a><a class="btn btn-line" href="${esc(apple)}" target="_blank" rel="noopener noreferrer">Apple Maps</a></div>`
    : '';
  const fiction = demo ? `<p class="muted small">This is a fictional demo address. <a href="${esc(osm)}" rel="noopener noreferrer">Open the map</a>.</p>` : '';
  return `<aside class="arrive" id="getting-there"><p class="arrive-kicker">Location</p>${address ? `<p class="arrive-addr">${esc(address)}</p>` : ''}${preview}${directions}${fiction}${sheet}</aside>`;
}

function arrivalForm(hotel) {
  const lat = hotel.lat == null ? '' : hotel.lat;
  const lng = hotel.lng == null ? '' : hotel.lng;
  return `<form class="arrive-form" method="post" action="/hotel/arrival" id="arrive-edit"><h2>Getting there</h2>
<p class="muted small">Guests see a small map beside the description when this listing has an address. Directions stay off demo listings. Train, parking and entrance notes stay on this form. They are not shown on the public page. Leave latitude and longitude blank to hide the map.</p>
<label class="fl">Address<input name="address" maxlength="160" required value="${esc(hotel.address || '')}"></label>
<div class="two"><label class="fl">State<select name="state">
<option value="" ${hotel.state ? '' : 'selected'}>Not stored</option>
<option value="NSW" ${hotel.state === 'NSW' ? 'selected' : ''}>NSW</option>
<option value="QLD" ${hotel.state === 'QLD' ? 'selected' : ''}>QLD</option>
<option value="WA" ${hotel.state === 'WA' ? 'selected' : ''}>WA</option>
</select></label>
<label class="fl">Time zone<select name="timezone">
<option value="" ${hotel.timezone ? '' : 'selected'}>Not stored</option>
<option value="Australia/Sydney" ${hotel.timezone === 'Australia/Sydney' ? 'selected' : ''}>Australia/Sydney</option>
<option value="Australia/Brisbane" ${hotel.timezone === 'Australia/Brisbane' ? 'selected' : ''}>Australia/Brisbane (no daylight saving)</option>
<option value="Australia/Perth" ${hotel.timezone === 'Australia/Perth' ? 'selected' : ''}>Australia/Perth</option>
</select></label></div>
<p class="muted small">Used for the calendar invite. Leave both blank to use NSW, QLD or WA when that is already in the address. Otherwise the invite uses Sydney time.</p>
<div class="two"><label class="fl">Latitude<input name="lat" inputmode="decimal" value="${esc(lat)}" placeholder="-33.8688"></label>
<label class="fl">Longitude<input name="lng" inputmode="decimal" value="${esc(lng)}" placeholder="151.2093"></label></div>
<label class="fl">Train or bus<textarea name="transit_note" maxlength="240">${esc(hotel.transit_note || '')}</textarea></label>
<label class="fl">Parking entrance<textarea name="parking_entrance" maxlength="240">${esc(hotel.parking_entrance || '')}</textarea></label>
<label class="fl">Day guest entrance<textarea name="day_entrance" maxlength="240">${esc(hotel.day_entrance || '')}</textarea></label>
<div class="offer-save"><button class="btn btn-navy" type="submit">Save getting there</button></div></form>`;
}

module.exports = { ensureArrival, saveArrival, arrivalHtml, arrivalForm };
