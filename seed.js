const fs = require('fs'); const path = require('path');
const { ymd, addDays } = require('./util');
const { parseTime, writeOffering, rulesText, syncLateAddons, dayPlan } = require('./offering');
const { demoHotelPassword } = require('./passwords');

const CATALOG = [
  { code: 'gym', name: 'Gym access', blurb: 'Use the gym on the same day.', per: 'guest', price: 25, cap: 20 },
  { code: 'parking', name: 'Parking', blurb: 'One car space for the day.', per: 'booking', price: 20, cap: 25 },
  { code: 'food', name: 'Food & drink credit', blurb: 'To spend at the bar or café.', per: 'guest', price: 30, cap: 40 },
  { code: 'cabana', name: 'Cabana upgrade', blurb: 'A reserved cabana for your group.', per: 'booking', price: 80, cap: 6 },
  { code: 'robe', name: 'Towel & robe pack', blurb: 'An extra towel and a robe.', per: 'guest', price: 15, cap: 30 },
  { code: 'late', name: 'Late access', blurb: 'Stay until the pool closes, after day-pass hours end. It does not run past closing time.', per: 'guest', price: 35, cap: 12 },
];
const PRESETS = {
  'saltwater-terrace': { gym: { enabled: 1, price: 25, cap: 20 }, parking: { enabled: 1, price: 18, cap: 30 }, food: { enabled: 1, price: 30, cap: 40 }, cabana: { enabled: 1, price: 85, cap: 6 }, robe: { enabled: 0 }, late: { enabled: 0, price: 35, cap: 15 } },
  'skyline-rooftop': { gym: { enabled: 1, price: 20, cap: 25 }, parking: { enabled: 1, price: 40, cap: 16 }, food: { enabled: 1, price: 28, cap: 30 }, cabana: { enabled: 1, price: 95, cap: 4 }, robe: { enabled: 1, price: 18, cap: 20 }, late: { enabled: 0, price: 40, cap: 10 } },
  'harbourside-lido': { gym: { enabled: 1, price: 30, cap: 15 }, parking: { enabled: 1, price: 45, cap: 12 }, food: { enabled: 1, price: 35, cap: 25 }, cabana: { enabled: 0 }, robe: { enabled: 1, price: 22, cap: 20 }, late: { enabled: 0, price: 30, cap: 10 } },
  'palm-court': { gym: { enabled: 0 }, parking: { enabled: 0 }, food: { enabled: 1, price: 22, cap: 40 }, cabana: { enabled: 1, price: 60, cap: 8 }, robe: { enabled: 1, price: 12, cap: 25 }, late: { enabled: 0, price: 25, cap: 15 } },
  'manly-sands': { gym: { enabled: 0 }, parking: { enabled: 1, price: 15, cap: 20 }, food: { enabled: 1, price: 28, cap: 35 }, cabana: { enabled: 1, price: 70, cap: 6 }, robe: { enabled: 0 }, late: { enabled: 0, price: 32, cap: 12 } },
  'bayview-spa': { gym: { enabled: 1, price: 25, cap: 12 }, parking: { enabled: 1, price: 28, cap: 18 }, food: { enabled: 1, price: 40, cap: 20 }, cabana: { enabled: 1, price: 110, cap: 5 }, robe: { enabled: 1, price: 20, cap: 20 }, late: { enabled: 0 } },
};

const ALL_WEEK = '0,1,2,3,4,5,6';
function week(days, opens, closes) {
  const open = new Set(String(days).split(',').map(Number));
  return [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, open: open.has(weekday) ? 1 : 0, opens, closes }));
}
const OFFERINGS = {
  'saltwater-terrace': {
    hours: week(ALL_WEEK, '10:00', '16:00'), cutoff_hours: 2, heated: 1, setting: 'outdoor',
    age_policy: 'All ages', kids_hours: 'All open hours', towels: 1, food_rule: 'Food and drink from the pool bar only',
    id_required: 1, lifeguard: 0,
    spots: [
      { code: 'lounger', kind: 'lounger', name: 'Sun lounger', description: 'A lounger by the infinity pool, with a towel.', holds: 1, price: 45, daily_cap: 24, photo: 'hero-loungers.jpg', featured: 1 },
      { code: 'daybed', kind: 'daybed', name: 'Daybed', description: 'A reserved daybed for two, with shade.', holds: 2, price: 95, daily_cap: 6, photo: 'daybed-canopy.jpg' },
      { code: 'cabana', kind: 'cabana', name: 'Cabana', description: 'A draped cabana for four, with loungers.', holds: 4, price: 220, daily_cap: 3, photo: 'cabana-drapes.jpg' },
    ],
  },
  'skyline-rooftop': {
    hours: week('0,1,2,3,4,6', '11:00', '17:00'), cutoff_hours: 1, heated: 1, setting: 'outdoor',
    age_policy: '18+', kids_hours: 'No children', towels: 1, food_rule: 'Bar from noon. No outside food or drink.',
    id_required: 1, lifeguard: 0, room_only_from: '16:00', room_only_to: '17:00',
    spots: [
      { code: 'chair', kind: 'chair', name: 'Pool chair', description: 'A chair on the rooftop deck, with a towel.', holds: 1, price: 55, daily_cap: 20, photo: 'rooftop-city.jpg', featured: 1 },
      { code: 'daybed', kind: 'daybed', name: 'Daybed', description: 'A reserved daybed for two, with a city view.', holds: 2, price: 120, daily_cap: 8, photo: 'daybed-canopy.jpg' },
      { code: 'cabana', kind: 'cabana', name: 'Cabana', description: 'A cabana for four on the roof.', holds: 4, price: 260, daily_cap: 4, photo: 'cabana-drapes.jpg' },
    ],
  },
  'harbourside-lido': {
    hours: week(ALL_WEEK, '09:00', '18:00'), cutoff_hours: 2, heated: 1, setting: 'indoor',
    age_policy: '16+', kids_hours: '16 and over only', towels: 1, food_rule: 'No outside food. Café on site.',
    id_required: 1, lifeguard: 0,
    season_start: '12-01', season_end: '03-31', season_opens: '08:00', season_closes: '19:00',
    spots: [
      { code: 'entry', kind: 'entry', name: 'General entry', description: 'Pool, steam room and sauna.', holds: 1, price: 65, daily_cap: 40, photo: 'glass-roof-pool.jpg', featured: 1 },
      { code: 'lounger', kind: 'lounger', name: 'Sun lounger', description: 'A lounger under the glass roof, with a robe.', holds: 1, price: 85, daily_cap: 16, photo: 'hero-loungers.jpg' },
      { code: 'daybed', kind: 'daybed', name: 'Daybed', description: 'A quiet daybed for two beside the pool.', holds: 2, price: 150, daily_cap: 6, photo: 'indoor-spa-pool.jpg' },
    ],
  },
  'palm-court': {
    hours: week('0,4,5,6', '10:00', '17:00'), cutoff_hours: 1, heated: 0, setting: 'outdoor',
    age_policy: 'All ages', kids_hours: 'All open hours, shallow end', towels: 1, food_rule: 'Café on site. Packed lunches welcome.',
    id_required: 1, lifeguard: 1,
    spots: [
      { code: 'lounger', kind: 'lounger', name: 'Sun lounger', description: 'A lounger in the palm gardens, with a towel.', holds: 1, price: 35, daily_cap: 40, photo: 'tropical-resort.jpg', featured: 1 },
      { code: 'chair', kind: 'chair', name: 'Pool chair', description: 'A chair by the shallow end.', holds: 1, price: 25, daily_cap: 30, photo: 'kids-float.jpg' },
      { code: 'daybed', kind: 'daybed', name: 'Daybed', description: 'A shaded daybed for two.', holds: 2, price: 70, daily_cap: 10, photo: 'thatched-umbrellas.jpg' },
    ],
  },
  'manly-sands': {
    hours: week(ALL_WEEK, '10:00', '16:00'), cutoff_hours: 2, heated: 0, setting: 'outdoor',
    age_policy: 'All ages', kids_hours: 'Until 2pm', towels: 1, food_rule: 'Kiosk on site. No glass.',
    id_required: 1, lifeguard: 0,
    spots: [
      { code: 'lounger', kind: 'lounger', name: 'Sun lounger', description: 'A lounger by the magnesium pool, with a towel.', holds: 1, price: 40, daily_cap: 28, photo: 'infinity-palms.jpg', featured: 1 },
      { code: 'daybed', kind: 'daybed', name: 'Daybed', description: 'A canopy daybed for two, steps from the beach.', holds: 2, price: 90, daily_cap: 8, photo: 'daybed-canopy.jpg' },
    ],
  },
  'bayview-spa': {
    hours: week('0,2,3,4,5,6', '09:00', '16:00'), cutoff_hours: 3, heated: 1, setting: 'both',
    age_policy: '18+', kids_hours: 'No children', towels: 1, food_rule: 'No outside food or drink.',
    id_required: 1, lifeguard: 0,
    spots: [
      { code: 'entry', kind: 'entry', name: 'General entry', description: 'Bathhouse, plunge pools and the outdoor pool.', holds: 1, price: 80, daily_cap: 24, photo: 'spa-steps.jpg', featured: 1 },
      { code: 'cabana', kind: 'cabana', name: 'Cabana', description: 'A draped cabana for two by the outdoor pool.', holds: 2, price: 180, daily_cap: 5, photo: 'cabana-drapes.jpg' },
    ],
  },
};
function weekdayOf(date) { return new Date(date + 'T00:00:00').getDay(); }

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

function ensureSchedules(db) {
  const ins = db.prepare('INSERT INTO hotel_hours(hotel_id,weekday,open,opens,closes) VALUES (?,?,?,?,?)');
  const has = db.prepare('SELECT COUNT(*) n FROM hotel_hours WHERE hotel_id=?');
  db.transaction(() => {
    for (const [slug, spec] of Object.entries(OFFERINGS)) {
      const h = db.prepare('SELECT * FROM hotels WHERE slug=?').get(slug);
      if (!h || has.get(h.id).n) continue;
      const opens = parseTime(h.opens) || spec.hours.find(r => r.open).opens;
      const closes = parseTime(h.closes) || spec.hours.find(r => r.open).closes;
      const open = new Set(String(h.open_days || '').split(',').map(n => parseInt(n, 10)));
      for (let wd = 0; wd < 7; wd++) ins.run(h.id, wd, open.has(wd) ? 1 : 0, opens, closes);
    }
    db.prepare("UPDATE booking_addons SET name='Late access' WHERE name LIKE 'Late access until 8%' OR name LIKE 'Late access (until 8%'").run();
    db.prepare("UPDATE hotels SET blurb=REPLACE(blurb, ' Year-round, rain or shine.', '') WHERE blurb LIKE '%Year-round, rain or shine.%'").run();
    syncLateAddons(db);
    db.prepare("UPDATE hotels SET status='active' WHERE status IS NULL OR status=''").run();
    db.prepare('UPDATE hotels SET cutoff_hours=2 WHERE cutoff_hours IS NULL').run();
    db.prepare('UPDATE pass_types SET holds=1 WHERE holds IS NULL OR holds < 1').run();
    db.prepare("UPDATE pass_types SET kind='lounger' WHERE (kind IS NULL OR kind='') AND code='pool'").run();
    db.prepare("UPDATE pass_types SET kind='entry' WHERE (kind IS NULL OR kind='') AND code='spa'").run();
    db.prepare("UPDATE pass_types SET kind=code WHERE kind IS NULL OR kind=''").run();
  })();
}

function seed(db) {
const hotels = [
  ['saltwater-terrace', 'The Saltwater Terrace (Demo)', 'Eastern Beaches', 'Ocean-facing infinity pool above the sand',
   'A heated infinity pool on level one, looking straight out to the Pacific. Loungers, towels and a pool bar doing frozen margs from 11.',
   ['infinity-ocean.jpg', 'beach-resort-pool.jpg', 'loungers-snacks.jpg', 'infinity-palms.jpg'], ['Heated pool', 'Ocean view', 'Pool bar', 'Towels included', 'Showers & lockers'], 'demo-saltwater'],
  ['skyline-rooftop', 'Skyline Rooftop Hotel (Demo)', 'North Sydney', 'Heated rooftop pool with city views',
   'Swim above the office towers. A heated rooftop pool, cabana daybeds and a bar that opens at noon. Quietest Mon to Thu.',
   ['rooftop-city.jpg', 'hero-loungers.jpg', 'daybed-canopy.jpg', 'cabana-drapes.jpg'], ['Heated pool', 'Rooftop', 'City views', 'Daybeds', 'Gym access'], 'demo-skyline'],
  ['harbourside-lido', 'Harbourside Lido (Demo)', 'CBD & Harbour', 'Glass-roofed pool and day spa in the city',
   'A light-filled pool under a glass roof, with steam room, sauna and a spa menu.',
   ['glass-roof-pool.jpg', 'spa-steps.jpg', 'indoor-spa-pool.jpg', 'hero-loungers.jpg'], ['Indoor heated pool', 'Sauna', 'Steam room', 'Spa treatments', 'Robes'], 'demo-harbourside'],
  ['palm-court', 'Palm Court Resort (Demo)', 'Parramatta', 'Lagoon pool in leafy palm gardens',
   'A big lagoon pool ringed by palms, with plenty of shade and a family-friendly shallow end. Easy parking.',
   ['tropical-resort.jpg', 'resort-palms.jpg', 'kids-float.jpg', 'thatched-umbrellas.jpg'], ['Lagoon pool', 'Kid-friendly', 'Free parking', 'Shade umbrellas', 'Café'], 'demo-palmcourt'],
  ['manly-sands', 'Manly Sands House (Demo)', 'Northern Beaches', 'Canopy daybeds steps from the beach',
   'Canopy daybeds right on the water line, a magnesium pool and a kiosk doing smashed avo and cold ones.',
   ['daybed-canopy.jpg', 'thatched-umbrellas.jpg', 'infinity-palms.jpg', 'beach-resort-pool.jpg'], ['Magnesium pool', 'Beachside', 'Daybeds', 'Kiosk', 'Towels included'], 'demo-manly'],
  ['bayview-spa', 'Bayview Spa Hotel (Demo)', 'Eastern Suburbs', 'Bathhouse, plunge pools and poolside cabanas',
   'A calm bathhouse with hot and cold plunge, a heated outdoor pool and draped cabanas. 18+ on weekdays.',
   ['cabana-drapes.jpg', 'indoor-spa-pool.jpg', 'spa-steps.jpg', 'loungers-snacks.jpg'], ['Heated pool', 'Hot & cold plunge', 'Cabanas', '18+ weekdays', 'Robes'], 'demo-bayview'],
];
const insH = db.prepare('INSERT INTO hotels(slug,name,area,tagline,blurb,photos,amenities,hours,rating,login,password,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
const insB = db.prepare('INSERT INTO blocked_dates(hotel_id,date,reason) VALUES (?,?,?)');
const insBk = db.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,checked_in_at,created_at,party,rules_ack_at,rules_text,seeded,refunded)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0)`);
const insA = db.prepare('INSERT INTO addons(hotel_id,code,name,blurb,price,daily_cap,per,enabled,sort) VALUES (?,?,?,?,?,?,?,?,?)');
const insBA = db.prepare('INSERT INTO booking_addons(booking_id,addon_id,name,qty,unit_price,total) VALUES (?,?,?,?,?,?)');
const bump = db.prepare('UPDATE bookings SET total=total+? WHERE id=?');
const names = ['Mia Thompson', 'Jack Nguyen', 'Olivia Smith', 'Noah Williams', 'Chloe Brown', 'Liam Patel', 'Zoe Martin', 'Ethan Lee', 'Grace Kelly', 'Lucas Rossi', 'Ava Chen', 'Henry Wilson', 'Isla Jones', 'Leo Garcia', 'Ruby Taylor'];
let seq = 48213, r = 7; const rnd = n => { r = (r * 9301 + 49297) % 233280; return Math.floor(r / 233280 * n); };
const today = new Date();
const usedA = {};
db.transaction(() => {
  hotels.forEach((h, i) => {
    const spec = OFFERINGS[h[0]];
    const open = new Set(spec.hours.filter(d => d.open).map(d => d.weekday));
    const id = insH.run(h[0], h[1], h[2], h[3], h[4], JSON.stringify(h[5]), JSON.stringify(h[6]), '', null, h[7], demoHotelPassword(), 'active').lastInsertRowid;
    writeOffering(db, id, spec);
    const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(id);
    const rules = rulesText(hotel);
    const pids = db.prepare('SELECT * FROM pass_types WHERE hotel_id=? ORDER BY sort').all(id);
    const hotelAddons = CATALOG.map((a, sort) => {
      const o = (PRESETS[h[0]] && PRESETS[h[0]][a.code]) || {};
      const row = { ...a, price: o.price ?? a.price, cap: o.cap ?? a.cap, enabled: o.enabled ?? 0 };
      row.id = insA.run(id, a.code, a.name, a.blurb, row.price, row.cap, a.per, row.enabled ? 1 : 0, sort).lastInsertRowid;
      return row;
    }).filter(a => a.enabled);
    insB.run(id, ymd(addDays(today, 10 + i)), 'Private event');
    insB.run(id, ymd(addDays(today, 24)), 'Pool maintenance');
    for (let d = -14; d <= 14; d++) {
      const date0 = ymd(addDays(today, d));
      if (!open.has(weekdayOf(date0))) continue;
      const n = d === 0 ? 4 + rnd(3) : rnd(d < 0 ? 5 : 3);
      for (let k = 0; k < n; k++) {
        const spot = pids[rnd(pids.length)], qty = 1 + rnd(2), nm = names[rnd(names.length)];
        const people = qty * (spot.holds || 1);
        const date = ymd(addDays(today, d));
        const ci = d < 0 ? `${date} 1${rnd(3)}:${10 + rnd(49)}` : null;
        const created = ymd(addDays(today, Math.min(d, 0) - 3)) + ' 09:00';
        const bid = insBk.run('HDC-' + (seq++), id, spot.id, date, qty, spot.price, spot.price * qty, nm, nm.toLowerCase().replace(' ', '.') + '@example.com',
          '04' + String(10000000 + rnd(89999999)), 'confirmed', ci, created, people, created, rules).lastInsertRowid;
        const want = (d === 0 && k === 0) ? 2 : (rnd(100) < 40 ? 1 + rnd(2) : 0);
        if (!want || !hotelAddons.length) continue;
        const idxs = hotelAddons.map((_, ix) => ix);
        for (let s = idxs.length - 1; s > 0; s--) { const j = rnd(s + 1); const t = idxs[s]; idxs[s] = idxs[j]; idxs[j] = t; }
        let extra = 0, picked = 0;
        for (const ix of idxs) {
          if (picked >= want) break;
          const a = hotelAddons[ix];
          const aq = a.per === 'booking' ? 1 : people;
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
  const st = db.prepare("SELECT id,daily_cap,price,holds FROM pass_types WHERE hotel_id=1 AND code='daybed'").get();
  const sample = db.prepare('SELECT rules_text FROM bookings WHERE hotel_id=1 LIMIT 1').get();
  const rules = sample ? sample.rules_text : rulesText(db.prepare('SELECT * FROM hotels WHERE id=1').get());
  let date = null;
  for (let i = 1; i <= 10 && !date; i++) {
    const cand = ymd(addDays(today, i));
    const wd = weekdayOf(cand);
    if (wd < 1 || wd > 5) continue;
    if (db.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=1 AND date=?').get(cand)) continue;
    date = cand;
  }
  const used = db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(st.id, date).n;
  for (let k = used; k < st.daily_cap; k++) {
    const created = ymd(today) + ' 08:00';
    insBk.run('HDC-' + (seq++), 1, st.id, date, 1, st.price, st.price, names[k % 15], 'guest' + k + '@example.com', '0400000' + (100 + k), 'confirmed', null, created, st.holds || 2, created, rules);
  }
})();
seedPerformance(db);
console.log('Seeded', db.prepare('SELECT COUNT(*) n FROM bookings').get().n, 'bookings');
}

function hashString(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const SAMPLE_NAMES = ['Mia Thompson', 'Jack Nguyen', 'Olivia Smith', 'Noah Williams', 'Chloe Brown', 'Liam Patel', 'Zoe Martin', 'Ethan Lee', 'Grace Kelly', 'Lucas Rossi', 'Ava Chen', 'Henry Wilson', 'Isla Jones', 'Leo Garcia', 'Ruby Taylor', 'Sophie Clark', 'Oscar Nguyen', 'Harper Singh'];
let analyticsCovered = '';

function seedPerformance(db) {
  const today = new Date();
  const todayStr = ymd(today);
  const hotels = db.prepare("SELECT * FROM hotels WHERE login LIKE 'demo-%' ORDER BY id").all();
  if (!hotels.length) return;
  const stamp = todayStr + ':' + hotels.map(h => h.id).join(',');
  if (analyticsCovered === stamp) return;
  const passStmt = db.prepare('SELECT * FROM pass_types WHERE hotel_id=? ORDER BY sort, id');
  const addonStmt = db.prepare('SELECT * FROM addons WHERE hotel_id=? AND enabled=1 ORDER BY sort, id');
  const blockedStmt = db.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?');
  const soldPass = db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'");
  const hasRecent = db.prepare("SELECT 1 AS ok FROM bookings WHERE hotel_id=? AND COALESCE(seeded,0)=1 AND CAST(substr(code,5) AS INTEGER)>=170000 AND CAST(substr(code,5) AS INTEGER)<180000");
  const codeTaken = db.prepare('SELECT 1 FROM bookings WHERE code=?');
  const insBk = db.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,status,checked_in_at,created_at,party,rules_ack_at,rules_text,seeded,refunded)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const insNote = db.prepare("INSERT INTO guest_notes(booking_id,hotel_id,kind,note,created_at,seeded) VALUES (?,?, 'no_show', 'Did not arrive', ?, 1)");
  const insAdd = db.prepare('INSERT INTO booking_addons(booking_id,addon_id,name,qty,unit_price,total) VALUES (?,?,?,?,?,?)');
  const bump = db.prepare('UPDATE bookings SET total=total+? WHERE id=?');
  const clearCheckin = db.prepare('UPDATE bookings SET checked_in_at=NULL WHERE id=?');
  // Sample views are written once. A later restart must not rewrite them from live bookings.
  const insView = db.prepare(`INSERT INTO listing_views(hotel_id, day, views, seeded) VALUES (?,?,?,1)
    ON CONFLICT(hotel_id, day, seeded) DO NOTHING`);
  const bookedOn = db.prepare("SELECT COUNT(*) n FROM bookings WHERE hotel_id=? AND date=? AND status!='cancelled' AND COALESCE(seeded,0)=1");
  const pastBooking = db.prepare(`SELECT id FROM bookings WHERE hotel_id=? AND status!='cancelled' AND date>=? AND date<?
    AND NOT EXISTS (SELECT 1 FROM guest_notes g WHERE g.booking_id=bookings.id AND g.kind='no_show')
    ORDER BY date DESC, id DESC LIMIT 1`);

  function codeFactory(base) {
    let n = base;
    return () => {
      let code;
      do { code = 'HDC-' + (n++); } while (codeTaken.get(code));
      return code;
    };
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function localWeekday(date) { return new Date(date + 'T00:00:00').getDay(); }

  db.transaction(() => {
    hotels.forEach((hotel, index) => {
      const passes = passStmt.all(hotel.id);
      if (!passes.length) return;
      const addons = addonStmt.all(hotel.id);
      const rules = rulesText(hotel);
      const rand = mulberry32(hashString(hotel.slug + ':history'));
      const nextCode = codeFactory(180000 + index * 20000);
      const place = (spot, date, qty, status, refunded, noShow, rng = rand) => {
        const people = qty * (spot.holds || 1);
        const back = 1 + Math.floor(rng() * 4);
        const createdDate = ymd(addDays(new Date(date + 'T00:00:00'), -back));
        const created = `${createdDate} ${pad(8 + Math.floor(rng() * 10))}:${pad(Math.floor(rng() * 60))}`;
        const ci = status === 'confirmed' && !noShow ? `${date} ${pad(10 + Math.floor(rng() * 5))}:${pad(Math.floor(rng() * 60))}` : null;
        const nm = SAMPLE_NAMES[Math.floor(rng() * SAMPLE_NAMES.length)];
        const email = nm.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';
        const phone = '04' + String(Math.floor(10000000 + rng() * 90000000));
        const id = insBk.run(nextCode(), hotel.id, spot.id, date, qty, spot.price, spot.price * qty, nm, email, phone, status, ci, created, people, created, rules, refunded ? 1 : 0).lastInsertRowid;
        if (addons.length && rng() < 0.38) {
          const a = addons[Math.floor(rng() * addons.length)];
          const aq = a.per === 'booking' ? 1 : people;
          insAdd.run(id, a.id, a.name, aq, a.price, a.price * aq);
          bump.run(a.price * aq, id);
        }
        if (noShow) insNote.run(id, hotel.id, `${date} 16:10`);
        return id;
      };

      // Top up every open day from 90 days ago through today. Closed days are only
      // the ones this hotel has switched off, plus blocked dates. Saturday and Sunday
      // are the busiest, then Friday, and they stay under the cap. Today keeps two
      // spots free on each seating type so a same-day demo booking can still go through.
      for (let offset = -90; offset <= 0; offset++) {
        const date = ymd(addDays(today, offset));
        const plan = dayPlan(db, hotel, date);
        if (!plan || !plan.open || blockedStmt.get(hotel.id, date)) continue;
        const wd = localWeekday(date);
        const dayRand = mulberry32(hashString(hotel.slug + ':fill:' + date));
        const busy = wd === 0 || wd === 6 ? 0.78 : wd === 5 ? 0.62 : 0.50;
        const target = Math.min(0.90, busy + dayRand() * 0.10);
        const totalCap = passes.reduce((sum, p) => sum + p.daily_cap, 0);
        const caps = new Map();
        let spots = 0;
        for (const p of passes) {
          const sold = soldPass.get(p.id, date).n;
          spots += sold;
          const reserve = date === todayStr ? Math.min(2, p.daily_cap) : 0;
          caps.set(p.id, Math.max(0, p.daily_cap - reserve - sold));
        }
        const goal = Math.max(1, Math.round(totalCap * target));
        let guard = 0;
        while (spots < goal && guard++ < 400) {
          const options = passes.filter(p => caps.get(p.id) > 0);
          if (!options.length) break;
          if (dayRand() < 0.08) {
            const spot = passes[Math.floor(dayRand() * passes.length)];
            place(spot, date, 1, 'cancelled', dayRand() < 0.72, false, dayRand);
            continue;
          }
          const spot = options[Math.floor(dayRand() * options.length)];
          const room = caps.get(spot.id);
          const qty = Math.min(room, dayRand() < 0.2 ? 2 : 1);
          caps.set(spot.id, room - qty);
          spots += qty;
          place(spot, date, qty, 'confirmed', false, date < todayStr && dayRand() < 0.04, dayRand);
        }
      }

      if (!hasRecent.get(hotel.id)) {
        const recentCode = codeFactory(170000 + index * 400);
        const openDays = (from, to) => {
          const out = [];
          for (let offset = from; offset <= to; offset++) {
            const date = ymd(addDays(today, offset));
            const plan = dayPlan(db, hotel, date);
            if (!plan || !plan.open || blockedStmt.get(hotel.id, date)) continue;
            out.push(date);
          }
          return out;
        };
        const addCancel = (date, refunded) => {
          if (!date) return;
          const spot = passes[Math.floor(rand() * passes.length)];
          const people = spot.holds || 1;
          const created = `${ymd(addDays(new Date(date + 'T00:00:00'), -2))} 11:00`;
          const nm = SAMPLE_NAMES[Math.floor(rand() * SAMPLE_NAMES.length)];
          const id = insBk.run(recentCode(), hotel.id, spot.id, date, 1, spot.price, spot.price, nm, nm.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', '0400000000', 'cancelled', null, created, people, created, rules, refunded ? 1 : 0).lastInsertRowid;
          return id;
        };
        const recent = openDays(-7, -1);
        const older = openDays(-14, -8);
        if (recent.length) {
          addCancel(recent[recent.length - 1], true);
          addCancel(recent[Math.max(0, recent.length - 2)], false);
        }
        older.forEach((date, i) => { if (i % 2 === 0) addCancel(date, i % 4 === 0); });
        const weekAgo = ymd(addDays(today, -7));
        let noted = pastBooking.get(hotel.id, weekAgo, todayStr);
        if (!noted && recent.length) {
          const date = recent[recent.length - 1];
          const spot = passes[0];
          const created = `${ymd(addDays(new Date(date + 'T00:00:00'), -1))} 08:00`;
          const nm = SAMPLE_NAMES[0];
          const id = insBk.run(recentCode(), hotel.id, spot.id, date, 1, spot.price, spot.price, nm, 'sample.noshow@example.com', '0400000001', 'confirmed', null, created, spot.holds || 1, created, rules, 0).lastInsertRowid;
          noted = { id };
        }
        if (noted) {
          insNote.run(noted.id, hotel.id, todayStr + ' 09:00');
          clearCheckin.run(noted.id);
        }
      }

      for (let offset = -90; offset <= 0; offset++) {
        const date = ymd(addDays(today, offset));
        const booked = bookedOn.get(hotel.id, date).n;
        const viewRand = mulberry32(hashString(hotel.slug + '|' + date));
        const a = viewRand();
        const b = viewRand();
        const views = booked <= 0 ? 5 + Math.floor(a * 24) : Math.max(booked + 4, Math.round(booked / (0.09 + b * 0.06)));
        insView.run(hotel.id, date, views);
      }
    });
  })();
  analyticsCovered = stamp;
}

function resetAndSeed() {
  const f = process.env.DB_PATH || path.join(__dirname, 'data', 'daypass.db');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  for (const x of [f, f + '-wal', f + '-shm']) if (fs.existsSync(x)) fs.unlinkSync(x);
  delete require.cache[require.resolve('./db')];
  seed(require('./db'));
}

if (require.main === module) resetAndSeed();
module.exports = { seed, ensureAddons, ensureSchedules, seedPerformance };
