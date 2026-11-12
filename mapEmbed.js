const { esc } = require('./util');

class MapEmbed {
  static key() {
    return String(process.env.GOOGLE_MAPS_EMBED_KEY || '').trim();
  }

  static coords(hotel) {
    if (!hotel || hotel.lat == null || hotel.lng == null) return null;
    if (String(hotel.lat).trim() === '' || String(hotel.lng).trim() === '') return null;
    const lat = Number(hotel.lat);
    const lng = Number(hotel.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  static place(hotel) {
    const coords = MapEmbed.coords(hotel);
    if (coords) return `${coords.lat},${coords.lng}`;
    return String((hotel && hotel.address) || '').trim();
  }

  static src(hotel) {
    const key = MapEmbed.key();
    const place = MapEmbed.place(hotel);
    if (!key || !place) return '';
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(place)}`;
  }

  static directionsUrl(hotel) {
    const place = MapEmbed.place(hotel);
    if (!place) return '';
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place)}`;
  }

  static html(hotel) {
    const src = MapEmbed.src(hotel);
    if (!src) return '';
    const name = String((hotel && hotel.name) || '').trim() || 'this hotel';
    return `<iframe class="map-embed" title="${esc('Map of ' + name)}" src="${esc(src)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
  }

  static directionsHtml(hotel) {
    const href = MapEmbed.directionsUrl(hotel);
    if (!href) return '';
    return `<p class="map-open"><a href="${esc(href)}" target="_blank" rel="noopener">Open in Google Maps</a></p>`;
  }
}

module.exports = { MapEmbed };
