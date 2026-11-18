// Photo map for the six fictional demo hotels (fix-brief-3). '' means no photo on purpose.
const DEMO_PHOTOS = {
  'saltwater-terrace': {
    gallery: ['infinity-ocean.jpg', 'clifftop-ocean.jpg', 'sea-terrace-pool.jpg', 'hotel-gym.jpg'],
    passes: { lounger: 'terrace-pool.jpg', daybed: '', cabana: '' },
    explore: { 'The Pool': 'harbour-twilight-pool.jpg', 'The Terrace': 'hero-loungers.jpg', 'Pool bar': '', 'Restaurant': 'restaurant-view.jpg' },
    access: { 'Infinity pool': 'harbour-twilight-pool.jpg' },
  },
  'skyline-rooftop': {
    gallery: ['rooftop-pergola-pool.jpg', 'pool-lane-morning.jpg', 'hotel-gym.jpg', 'sea-terrace-pool.jpg'],
    passes: { chair: 'hero-loungers.jpg', daybed: '', cabana: '' },
    explore: { 'Rooftop pool': '', 'Pool deck': 'terrace-pool.jpg', 'Rooftop bar': '' },
    access: { 'Heated rooftop pool': '' },
  },
  'harbourside-lido': {
    gallery: ['glass-roof-pool.jpg', 'spa-sauna-room.jpg', 'hotel-gym.jpg', 'indoor-spa-pool.jpg'],
    passes: { entry: 'pool-lane-morning.jpg', lounger: 'spa-loungers.jpg', daybed: '' },
    explore: { 'Glass-roof pool': '', 'Lido deck': 'hero-loungers.jpg', 'Café': '' },
    access: { 'Glass-roofed pool': '' },
  },
  'palm-court': {
    gallery: ['terrace-pool.jpg', 'infinity-ocean.jpg', 'pool-lane-morning.jpg', 'clifftop-ocean.jpg'],
    passes: { lounger: 'harbour-twilight-pool.jpg', chair: 'sea-terrace-pool.jpg', daybed: '' },
    explore: { 'Lagoon pool': 'coastal-deck-pool.jpg', 'Garden terrace': 'hero-loungers.jpg', 'Pool café': '' },
    access: { 'Lagoon pool': 'coastal-deck-pool.jpg' },
  },
  'manly-sands': {
    gallery: ['clifftop-ocean.jpg', 'infinity-ocean.jpg', 'pool-lane-morning.jpg', 'terrace-pool.jpg'],
    passes: { lounger: 'hero-loungers.jpg', daybed: '' },
    explore: { 'Magnesium pool': 'coastal-deck-pool.jpg', 'Beach deck': 'sea-terrace-pool.jpg', 'Kiosk': '' },
    access: { 'Magnesium pool': 'coastal-deck-pool.jpg' },
  },
  'bayview-spa': {
    gallery: ['spa-loungers.jpg', 'spa-sauna-room.jpg', 'hotel-gym.jpg', 'sea-terrace-pool.jpg'],
    passes: { entry: 'pool-lane-morning.jpg', cabana: '' },
    explore: { 'Bathhouse': 'indoor-spa-pool.jpg', 'Outdoor pool': 'harbour-twilight-pool.jpg', 'Garden lounge': 'hero-loungers.jpg' },
    access: { 'Bathhouse': 'spa-sauna-room.jpg', 'Plunge pools': 'indoor-spa-pool.jpg' },
  },
};

const KEY = 'demo_photos';
const VERSION = '3';

// One-time rewrite of stored demo photos (fictional demo hotels only). Fresh seeds already match.
function applyDemoPhotos(db) {
  db.exec("CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')");
  const done = db.prepare('SELECT value FROM app_meta WHERE key=?').get(KEY);
  if (done && done.value === VERSION) return;
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  db.transaction(() => {
    for (const [slug, m] of Object.entries(DEMO_PHOTOS)) {
      const h = db.prepare('SELECT id FROM hotels WHERE slug=? AND COALESCE(is_demo,0)=1').get(slug);
      if (!h) continue;
      db.prepare('UPDATE hotels SET photos=? WHERE id=?').run(JSON.stringify(m.gallery), h.id);
      for (const [code, file] of Object.entries(m.passes)) db.prepare('UPDATE pass_types SET photo=? WHERE hotel_id=? AND code=?').run(file, h.id, code);
      if (tables.has('hotel_explore_areas')) for (const [name, file] of Object.entries(m.explore)) db.prepare('UPDATE hotel_explore_areas SET photo=? WHERE hotel_id=? AND name=?').run(file, h.id, name);
      if (tables.has('access_areas')) for (const [name, file] of Object.entries(m.access)) db.prepare('UPDATE access_areas SET photo=? WHERE hotel_id=? AND name=?').run(file, h.id, name);
    }
    db.prepare('INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY, VERSION);
  })();
}

module.exports = { DEMO_PHOTOS, applyDemoPhotos, DEMO_PHOTOS_KEY: KEY, DEMO_PHOTOS_VERSION: VERSION };
