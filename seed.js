const fs = require('fs'); const path = require('path');
const { ymd, addDays } = require('./util');

const CATALOG = [
  { code: 'gym', name: 'Gym access', blurb: 'Use the gym on the same day.', per: 'guest', price: 25, cap: 20 },
  { code: 'parking', name: 'Parking', blurb: 'One car space for the day.', per: 'booking', price: 20, cap: 25 },
  { code: 'food', name: 'Food & drink credit', blurb: 'To spend at the bar or café.', per: 'guest', price: 30, cap: 40 },
  { code: 'cabana', name: 'Cabana upgrade', blurb: 'A reserved cabana for your group.', per: 'booking', price: 80, cap: 6 },
  { code: 'robe', name: 'Towel & robe pack', blurb: 'An extra towel and a robe.', per: 'guest', price: 15, cap: 30 },
  { code: 'late', name: 'Late access (until 8pm)', blurb: 'Stay on after 4pm, out by 8pm.', per: 'guest', price: 35, cap: 12 },
];
// enabled, price, daily cap. Hotels that already include something leave it off.
const PRESETS = {
  'saltwater-terrace': { gym: { enabled: 1, price: 25, cap: 20 }, parking: { enabled: 1, price: 18, cap: 30 }, food: { enabled: 1, price: 30, cap: 40 }, cabana: { enabled: 1, price: 85, cap: 6 }, robe: { enabled: 0 }, late: { enabled: 1, price: 35, cap: 15 } },
  'skyline-rooftop': { gym: { enabled: 1, price: 20, cap: 25 }, parking: { enabled: 1, price: 40, cap: 16 }, food: { enabled: 1, price: 28, cap: 30 }, cabana: { enabled: 1, price: 95, cap: 4 }, robe: { enabled: 1, price: 18, cap: 20 }, late: { enabled: 1, price: 40, cap: 10 } },
  'harbourside-lido': { gym: { enabled: 1, price: 30, cap: 15 }, parking: { enabled: 1, price: 45, cap: 12 }, food: { enabled: 1, price: 35, cap: 25 }, cabana: { enabled: 0 }, robe: { enabled: 1, price: 22, cap: 20 }, late: { enabled: 1, price: 30, cap: 10 } },
  'palm-court': { gym: { enabled: 0 }, parking: { enabled: 0 }, food: { enabled: 1, price: 22, cap: 40 }, cabana: { enabled: 1, price: 60, cap: 8 }, robe: { enabled: 1, price: 12, cap: 25 }, late: { enabled: 1, price: 25, cap: 15 } },
  'manly-sands': { gym: { enabled: 0 }, parking: { enabled: 1, price: 15, cap: 20 }, food: { enabled: 1, price: 28, cap: 35 }, cabana: { enabled: 1, price: 70, cap: 6 }, robe: { enabled: 0 }, late: { enabled: 1, price: 32, cap: 12 } },
  'bayview-spa': { gym: { enabled: 1, price: 25, cap: 12 }, parking: { enabled: 1, price: 28, cap: 18 }, food: { enabled: 1, price: 40, cap: 20 }, cabana: { enabled: 1, price: 110, cap: 5 }, robe: { enabled: 1, price: 20, cap: 20 }, late: { enabled: 0 } },
};

function ensureAddons(db) {
  const hotels = db.prepare('SELECT id, slug FROM hotels').all();
  const has = db.prepare('SELECT 1 FROM addons WHERE hotel_id=? AND code=?');
  const ins = db.prepare('INSERT INTO addons(hotel_id,code,name,blurb,price,daily_cap,per,enabled,sort) VALUES (?,?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const h of hotels) CATALOG.forEach((a, sort) => {
      if (has.get(h.id, a.code)) return;
      const o = (PRESETS[h.slug] && PRESETS[h.slug][a.code]) || {};
      ins.run(h.id, a.code, a.name, a.blurb, o.price ?? a.price, o.cap ?? a.cap, a.per, o.enabled ? 1 : 0, sort);
    });
  })();
}

function seed(db) {
const hotels = [
  ['saltwater-terrace', 'The Saltwater Terrace (Demo)', 'Eastern Beaches', 'Ocean-facing infinity pool above the sand',
   'A heated infinity pool on level one, looking straight out to the Pacific. Loungers, towels and a pool bar doing frozen margs from 11.',
   ['infinity-ocean.jpg', 'beach-resort-pool.jpg', 'loungers-snacks.jpg', 'infinity-palms.jpg'], ['Heated pool', 'Ocean view', 'Pool bar', 'Towels included', 'Showers & lockers'], 'demo-saltwater', 4.92],
  ['skyline-rooftop', 'Skyline Rooftop Hotel (Demo)', 'North Sydney', 'Heated rooftop pool with city views',
   'Swim above the office towers. A heated rooftop pool, cabana daybeds and a bar that opens at noon. Quietest Mon to Thu.',
   ['rooftop-city.jpg', 'hero-loungers.jpg', 'daybed-canopy.jpg', 'cabana-drapes.jpg'], ['Heated pool', 'Rooftop', 'City views', 'Daybeds', 'Gym access'], 'demo-skyline', 4.85],
  ['harbourside-lido', 'Harbourside Lido (Demo)', 'CBD & Harbour', 'Glass-roofed pool and day spa in the city',
   'A light-filled pool under a glass roof, with steam room, sauna and a spa menu. Year-round, rain or shine.',
   ['glass-roof-pool.jpg', 'spa-steps.jpg', 'indoor-spa-pool.jpg', 'hero-loungers.jpg'], ['Indoor heated pool', 'Sauna', 'Steam room', 'Spa treatments', 'Robes'], 'demo-harbourside', 4.9],
  ['palm-court', 'Palm Court Resort (Demo)', 'Parramatta', 'Lagoon pool in leafy palm gardens',
   'A big lagoon pool ringed by palms, with plenty of shade and a family-friendly shallow end. Easy parking.',
   ['tropical-resort.jpg', 'resort-palms.jpg', 'kids-float.jpg', 'thatched-umbrellas.jpg'], ['Lagoon pool', 'Kid-friendly', 'Free parking', 'Shade umbrellas', 'Café'], 'demo-palmcourt', 4.74],
  ['manly-sands', 'Manly Sands House (Demo)', 'Northern Beaches', 'Canopy daybeds steps from the beach',
   'Canopy daybeds right on the water line, a magnesium pool and a kiosk doing smashed avo and cold ones.',
   ['daybed-canopy.jpg', 'thatched-umbrellas.jpg', 'infinity-palms.jpg', 'beach-resort-pool.jpg'], ['Magnesium pool', 'Beachside', 'Daybeds', 'Kiosk', 'Towels included'], 'demo-manly', 4.96],
  ['bayview-spa', 'Bayview Spa Hotel (Demo)', 'Eastern Suburbs', 'Bathhouse, plunge pools and poolside cabanas',
   'A calm bathhouse with hot and cold plunge, a heated outdoor pool and draped cabanas. 18+ on weekdays.',
   ['cabana-drapes.jpg', 'indoor-spa-pool.jpg', 'spa-steps.jpg', 'loungers-snacks.jpg'], ['Heated pool', 'Hot & cold plunge', 'Cabanas', '18+ weekdays', 'Robes'], 'demo-bayview', 4.88],
];
const passes = [
  ['pool', 'Pool Pass', 'Lounger, towel, pool and showers, 10am–4pm', 45, 30],
  ['daybed', 'Pool + Daybed', 'Reserved daybed for two hours, plus all-day pool access', 75, 8],
  ['spa', 'Spa + Pool', 'Sauna, steam and spa facilities, plus pool access and a robe', 120, 10],
];
const insH = db.prepare('INSERT INTO hotels(slug,name,area,tagline,blurb,photos,amenities,hours,rating,login,password) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
const insP = db.prepare('INSERT INTO pass_types(hotel_id,code,name,description,price,daily_cap,sort) VALUES (?,?,?,?,?,?,?)');
const insB = db.prepare('INSERT INTO blocked_dates(hotel_id,date,reason) VALUES (?,?,?)');
const insBk = db.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,checked_in_at,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insA = db.prepare('INSERT INTO addons(hotel_id,code,name,blurb,price,daily_cap,per,enabled,sort) VALUES (?,?,?,?,?,?,?,?,?)');
const insBA = db.prepare('INSERT INTO booking_addons(booking_id,addon_id,name,qty,unit_price,total) VALUES (?,?,?,?,?,?)');
const bump = db.prepare('UPDATE bookings SET total=total+? WHERE id=?');
const names = ['Mia Thompson', 'Jack Nguyen', 'Olivia Smith', 'Noah Williams', 'Chloe Brown', 'Liam Patel', 'Zoe Martin', 'Ethan Lee', 'Grace Kelly', 'Lucas Rossi', 'Ava Chen', 'Henry Wilson', 'Isla Jones', 'Leo Garcia', 'Ruby Taylor'];
let seq = 48213, r = 7; const rnd = n => { r = (r * 9301 + 49297) % 233280; return Math.floor(r / 233280 * n); };
const today = new Date();
const usedA = {};
db.transaction(() => {
  hotels.forEach((h, i) => {
    const id = insH.run(h[0], h[1], h[2], h[3], h[4], JSON.stringify(h[5]), JSON.stringify(h[6]), 'Daily · 10am–4pm', h[8], h[7], 'demo1234').lastInsertRowid;
    const pids = passes.map((p, j) => insP.run(id, p[0], p[1], p[2], p[3], p[4], j).lastInsertRowid);
    const hotelAddons = CATALOG.map((a, sort) => {
      const o = (PRESETS[h[0]] && PRESETS[h[0]][a.code]) || {};
      const row = { ...a, price: o.price ?? a.price, cap: o.cap ?? a.cap, enabled: o.enabled ?? 0 };
      row.id = insA.run(id, a.code, a.name, a.blurb, row.price, row.cap, a.per, row.enabled ? 1 : 0, sort).lastInsertRowid;
      return row;
    }).filter(a => a.enabled);
    insB.run(id, ymd(addDays(today, 10 + i)), 'Private event');
    insB.run(id, ymd(addDays(today, 24)), 'Pool maintenance');
    for (let d = -14; d <= 14; d++) {
      const n = d === 0 ? 4 + rnd(3) : rnd(d < 0 ? 5 : 3);
      for (let k = 0; k < n; k++) {
        const pj = rnd(3), qty = 1 + rnd(2), price = passes[pj][3], nm = names[rnd(names.length)];
        const date = ymd(addDays(today, d));
        const ci = d < 0 ? `${date} 1${rnd(3)}:${10 + rnd(49)}` : null;
        const bid = insBk.run('HDC-' + (seq++), id, pids[pj], date, qty, price, price * qty, nm, nm.toLowerCase().replace(' ', '.') + '@example.com',
          '04' + String(10000000 + rnd(89999999)), 'confirmed', ci, ymd(addDays(today, Math.min(d, 0) - 3)) + ' 09:00').lastInsertRowid;
        const want = (d === 0 && k === 0) ? 2 : (rnd(100) < 40 ? 1 + rnd(2) : 0);
        if (!want || !hotelAddons.length) continue;
        const idxs = hotelAddons.map((_, ix) => ix);
        for (let s = idxs.length - 1; s > 0; s--) { const j = rnd(s + 1); const t = idxs[s]; idxs[s] = idxs[j]; idxs[j] = t; }
        let extra = 0, picked = 0;
        for (const ix of idxs) {
          if (picked >= want) break;
          const a = hotelAddons[ix];
          const aq = a.per === 'booking' ? 1 : qty;
          const key = a.id + '|' + date;
          const used = usedA[key] || 0;
          if (d >= 0 && used + aq > a.cap) continue;
          insBA.run(bid, a.id, a.name, aq, a.price, a.price * aq);
          usedA[key] = used + aq;
          extra += a.price * aq;
          picked++;
        }
        if (extra) bump.run(extra, bid);
      }
    }
  });
  // A sold-out day for the demo: Saltwater Terrace daybeds, 3 days from now
  const st = db.prepare("SELECT id,daily_cap,price FROM pass_types WHERE hotel_id=1 AND code='daybed'").get();
  const date = ymd(addDays(today, 3));
  const used = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=?').get(st.id, date).n;
  for (let k = used; k < st.daily_cap; k++) insBk.run('HDC-' + (seq++), 1, st.id, date, 1, st.price, st.price, names[k % 15], 'guest' + k + '@example.com', '0400000' + (100 + k), 'confirmed', null, ymd(today) + ' 08:00');
})();
console.log('Seeded', db.prepare('SELECT COUNT(*) n FROM bookings').get().n, 'bookings');
}

function resetAndSeed() {
  const f = process.env.DB_PATH || path.join(__dirname, 'data', 'daypass.db');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  for (const x of [f, f + '-wal', f + '-shm']) if (fs.existsSync(x)) fs.unlinkSync(x);
  delete require.cache[require.resolve('./db')];
  seed(require('./db'));
}

if (require.main === module) resetAndSeed();
module.exports = { seed, ensureAddons };
