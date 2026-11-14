const { esc, money } = require('./util');
const { FOOD_RULE } = require('./offering');

const svg = paths => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  wifi: svg('<path d="M4.5 9.5a11 11 0 0 1 15 0"/><path d="M7.5 13a7 7 0 0 1 9 0"/><path d="M10.5 16.2a3 3 0 0 1 3 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>'),
  pool: svg('<path d="M4 15c1.4 1.2 2.8 1.2 4.2 0S11 13.8 12.4 15s2.8 1.2 4.2 0S19.4 13.8 20.8 15"/><path d="M4 18.5c1.4 1.2 2.8 1.2 4.2 0S11 17.3 12.4 18.5s2.8 1.2 4.2 0 2.8-1.2 4.2 0"/><path d="M7 12V6.5M12 12V8"/>'),
  towels: svg('<path d="M7 4h8a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M7 4v14M10 8h4"/>'),
  gym: svg('<path d="M6 9v6M18 9v6M4 10v4M20 10v4M6 12h12M3 11v2M21 11v2"/>'),
  sauna: svg('<path d="M8 19a4 4 0 0 1 8 0"/><path d="M9 14c.4-2 1.4-3 3-3s2.6 1 3 3"/><path d="M12 6v2M9.5 7.2l1 1.6M14.5 7.2l-1 1.6"/>'),
  spa: svg('<path d="M8 14c0-3 1.6-5 4-5s4 2 4 5"/><path d="M4 17c1.5 1 3 1 4.5 0S12 16 13.5 17s3 1 4.5 0 3-1 4.5 0"/><path d="M12 4v2"/>'),
  showers: svg('<path d="M7 4h8a2 2 0 0 1 2 2v1H7V6a2 2 0 0 1 0 0z"/><path d="M5 7h14v2H5z"/><path d="M8 11v1.5M12 11v1.5M16 11v1.5M9 15v1M12 15.5V17M15 15v1"/>'),
  lockers: svg('<rect x="4" y="3" width="7" height="18" rx="1"/><rect x="13" y="3" width="7" height="18" rx="1"/><path d="M9 12h.01M18 12h.01"/>'),
  toiletries: svg('<path d="M9 8h6v12H9z"/><path d="M10 8V5h4v3M12 5V3"/>'),
  robe: svg('<path d="M8 7 6 9v11h12V9l-2-2"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M12 7v13"/>'),
  kids: svg('<circle cx="12" cy="7" r="2.2"/><path d="M8 20v-4l2-3h4l2 3v4M9 13l-2 2M15 13l2 2"/>'),
  discount: svg('<path d="M5 8h9l5 4-5 4H5z"/><circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none"/>'),
  late: svg('<circle cx="12" cy="13" r="7"/><path d="M12 10v4l2 2M9 3h6"/>'),
  shower: svg('<path d="M6 6h9a3 3 0 0 1 3 3v1H8"/><path d="M8 12v1.5M11 12v1.5M14 12v1.5M9 16v1M12 16.5V18M15 16v1"/>'),
  luggage: svg('<rect x="6" y="7" width="12" height="12" rx="2"/><path d="M9 7V5h6v2M9 19v2M15 19v2"/>'),
  parking: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>'),
};

const INCLUSIONS = [
  { code: 'wifi', name: 'Complimentary Wi-Fi', per: 'booking', cap: 200, blurb: 'Wi-Fi during the visit.' },
  { code: 'pool', name: 'Pool access', per: 'guest', cap: 200, blurb: 'Use of the pool during day-pass hours.' },
  { code: 'towels', name: 'Towels', per: 'guest', cap: 80, blurb: 'A towel for the visit.' },
  { code: 'gym', name: 'Fitness centre access', per: 'guest', cap: 20, blurb: 'Use the gym on the same day.' },
  { code: 'sauna', name: 'Sauna and steam room', per: 'guest', cap: 30, blurb: 'Sauna and steam room during the visit.' },
  { code: 'spa', name: 'Hot tub and spa pool', per: 'guest', cap: 20, blurb: 'Hot tub or spa pool during the visit.' },
  { code: 'showers', name: 'Showers and change rooms', per: 'guest', cap: 200, blurb: 'Showers and a place to change.' },
  { code: 'lockers', name: 'Lockers', per: 'booking', cap: 40, blurb: 'A locker for the visit.' },
  { code: 'toiletries', name: 'Toiletries', per: 'guest', cap: 40, blurb: 'Basic toiletries.' },
  { code: 'robe', name: 'Robe and slippers', per: 'guest', cap: 30, blurb: 'A robe and slippers.' },
  { code: 'kids', name: "Kids' pool access", per: 'guest', cap: 30, blurb: 'Access for children, within the hotel age rules.' },
  { code: 'discount', name: 'Spa treatment credit', per: 'booking', cap: 20, blurb: 'A credit toward a spa treatment booked at the hotel.' },
  { code: 'late', name: 'Late stay', per: 'guest', cap: 12, blurb: 'Stay until the pool closes, after day-pass hours end.' },
  { code: 'room-shower', name: 'Room shower access', per: 'guest', cap: 20, blurb: 'Use of a room shower. No overnight stay.' },
  { code: 'luggage', name: 'Luggage storage', per: 'booking', cap: 20, blurb: 'Leave a bag while you visit.' },
  { code: 'parking', name: 'Parking', per: 'booking', cap: 20, blurb: 'One car space for the day.' },
];

const BY_CODE = Object.fromEntries(INCLUSIONS.map(item => [item.code, item]));
const FOOD_DRINK = new Set(['welcome', 'food', 'poolside']);
const FOOD_NOTE = FOOD_RULE;
const PASS_FOOD_LINE = FOOD_RULE;

const row = (mode, price = 0, cap = 0, note = '') => ({ mode, price, cap, note });

const PRESETS = {
  'saltwater-terrace': {
    wifi: row('included'), pool: row('included'), towels: row('included'), showers: row('included'),
    lockers: row('included'), toiletries: row('included'), luggage: row('included'),
    gym: row('addon', 25, 20),
    parking: row('addon', 18, 30, 'One car space for the day. Spaces run out.'),
  },
  'skyline-rooftop': {
    wifi: row('included'), pool: row('included'), towels: row('included'), showers: row('included'), lockers: row('included'),
    gym: row('addon', 20, 25), robe: row('addon', 18, 20),
    parking: row('addon', 40, 16, 'Hotel car park. A height limit applies in this demo.'),
  },
  'harbourside-lido': {
    wifi: row('included'), pool: row('included'), towels: row('included'), showers: row('included'),
    sauna: row('included'), lockers: row('included'), toiletries: row('included'), robe: row('included'),
    gym: row('addon', 30, 15),
    parking: row('addon', 45, 12, 'Limited basement spaces.'),
  },
  'palm-court': {
    wifi: row('included'), pool: row('included'), towels: row('included'), showers: row('included'),
    kids: row('included'),
    parking: row('included', 0, 0, 'On-site parking is included with the pass in this demo.'),
  },
  'manly-sands': {
    wifi: row('included'), pool: row('included'), towels: row('included'), showers: row('included'), luggage: row('included'),
    parking: row('addon', 15, 20, 'Street-side hotel bays. First come in this demo.'),
  },
  'bayview-spa': {
    wifi: row('included'), pool: row('included'), towels: row('included'), showers: row('included'),
    sauna: row('included'), spa: row('included'), robe: row('included'), lockers: row('included'),
    gym: row('addon', 25, 12), discount: row('addon', 30, 10),
    parking: row('addon', 28, 18, 'One space in the hotel forecourt.'),
  },
};

const DRESS = {
  'saltwater-terrace': 'Swimwear at the pool. A cover-up in the lobby.',
  'skyline-rooftop': 'Swimwear on the roof. Cover up in the lifts.',
  'harbourside-lido': 'Swimwear in the pool hall. Robes are worn in the spa.',
  'palm-court': 'Swimwear. Children in the water wear swim nappies.',
  'manly-sands': 'Swimwear. No glass near the pool.',
  'bayview-spa': 'Swimwear. Robes are provided for the bathhouse in this demo.',
};

const SEAT_PHOTO = {
  lounger: '/assets/photos/seats/lounger.webp',
  daybed: '/assets/photos/seats/daybed.webp',
  cabana: '/assets/photos/seats/cabana.webp',
  chair: '/assets/photos/seats/chair.webp',
  entry: '/assets/photos/seats/entry.webp',
  custom: '/assets/photos/seats/pool.webp',
};

function seatPhoto(kind) {
  return SEAT_PHOTO[kind] || SEAT_PHOTO.custom;
}

function loadInclusions(db, hotelId) {
  const rows = db.prepare('SELECT code, mode, price, daily_cap, note FROM inclusions WHERE hotel_id=?').all(hotelId);
  const by = Object.fromEntries(rows.map(r => [r.code, r]));
  return INCLUSIONS.map(item => {
    const saved = by[item.code] || { mode: 'off', price: 0, daily_cap: 0, note: '' };
    return { ...item, mode: saved.mode || 'off', price: saved.price || 0, daily_cap: saved.daily_cap || 0, note: saved.note || '' };
  });
}

function upsertAddon(db, hotelId, item, mode, price, cap) {
  const existing = db.prepare('SELECT id, sort FROM addons WHERE hotel_id=? AND code=?').get(hotelId, item.code);
  const enabled = mode === 'addon' ? 1 : 0;
  const useCap = Math.max(0, cap || item.cap || 0);
  const usePrice = Math.max(0, price || 0);
  if (existing) {
    if (item.code === 'late') {
      db.prepare('UPDATE addons SET enabled=?, price=?, daily_cap=? WHERE id=?').run(enabled, usePrice, useCap || item.cap, existing.id);
      return;
    }
    db.prepare('UPDATE addons SET enabled=?, price=?, daily_cap=?, name=?, blurb=?, per=? WHERE id=?')
      .run(enabled, usePrice, useCap || item.cap, item.name, item.blurb, item.per, existing.id);
    return;
  }
  if (!enabled) return;
  const sort = INCLUSIONS.findIndex(i => i.code === item.code);
  db.prepare('INSERT INTO addons(hotel_id,code,name,blurb,price,daily_cap,per,enabled,sort) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(hotelId, item.code, item.name, item.blurb, usePrice, useCap || item.cap, item.per, 1, sort);
}

function ensureInclusions(db) {
  const ins = db.prepare('INSERT INTO inclusions(hotel_id, code, mode, price, daily_cap, note) VALUES (?,?,?,?,?,?)');
  const has = db.prepare('SELECT 1 FROM inclusions WHERE hotel_id=? AND code=?');
  const dress = db.prepare("UPDATE hotels SET dress_code=? WHERE slug=? AND (dress_code IS NULL OR dress_code='')");
  db.transaction(() => {
    for (const hotel of db.prepare('SELECT id, slug FROM hotels').all()) {
      const preset = PRESETS[hotel.slug] || {};
      if (DRESS[hotel.slug]) dress.run(DRESS[hotel.slug], hotel.slug);
      for (const item of INCLUSIONS) {
        if (has.get(hotel.id, item.code)) continue;
        const picked = preset[item.code] || row('off');
        ins.run(hotel.id, item.code, picked.mode, picked.price || 0, picked.cap || 0, picked.note || '');
        if (picked.mode === 'addon') upsertAddon(db, hotel.id, item, 'addon', picked.price || 0, picked.cap || item.cap);
        else db.prepare('UPDATE addons SET enabled=0 WHERE hotel_id=? AND code=?').run(hotel.id, item.code);
      }
    }
    db.prepare(`UPDATE inclusions SET mode='off', price=0, daily_cap=0 WHERE code IN ('welcome','food','poolside')`).run();
    db.prepare(`UPDATE addons SET enabled=0 WHERE code IN ('welcome','food','poolside')`).run();
    const foodRules = [
      ['Food and drink from the pool bar only', 'Food and drink are not included. Buy them from the pool bar.'],
      ['Food and drink from the hotel only', 'Food and drink are not included. Buy them from the hotel.'],
      ['Bar from noon. No outside food or drink.', 'Food and drink are not included. The bar sells them from noon. No outside food or drink.'],
      ['No outside food. Café on site.', 'Food and drink are not included. Buy them at the café. No outside food.'],
      ['Café on site. Packed lunches welcome.', 'Food and drink are not included. Buy them at the café. Packed lunches are welcome.'],
      ['Kiosk on site. No glass.', 'Food and drink are not included. Buy them at the kiosk. No glass.'],
      ['No outside food or drink.', 'Food and drink are not included. No outside food or drink.'],
    ];
    const setRule = db.prepare('UPDATE hotels SET food_rule=? WHERE food_rule=?');
    for (const [from, to] of foodRules) setRule.run(to, from);
    const blurbs = [
      ['A heated infinity pool on level one, looking straight out to the Pacific. Loungers, towels and a pool bar doing frozen margs from 11.', 'A heated infinity pool on level one, looking straight out to the Pacific. Loungers and towels. The pool bar sells drinks from 11.'],
      ['Swim above the office towers. A heated rooftop pool, cabana daybeds and a bar that opens at noon. Quietest Mon to Thu.', 'Rise above the office towers to a heated rooftop pool with city views. Swim in the sun, then stretch out on a reserved daybed or gather friends in a rooftop cabana for four. The bar opens at noon, with food and drink available to buy.'],
    ];
    const setBlurb = db.prepare('UPDATE hotels SET blurb=? WHERE blurb=? AND COALESCE(is_demo,0)=1');
    for (const [from, to] of blurbs) setBlurb.run(to, from);
    const manlyBlurb = require('./seed').DEMO_INTROS['manly-sands'].blurb;
    const setManly = db.prepare(`UPDATE hotels SET blurb=? WHERE slug='manly-sands' AND COALESCE(is_demo,0)=1 AND blurb=?`);
    for (const from of [
      'Canopy daybeds right on the water line, a magnesium pool and a kiosk doing smashed avo and cold ones.',
      'Canopy daybeds right on the water line, a magnesium pool, and a kiosk selling food and drinks.',
      'Canopy daybeds steps from the beach, a magnesium pool and a kiosk doing smashed avo and cold ones.',
    ]) setManly.run(manlyBlurb, from);
  })();
}

function saveInclusions(db, hotelId, body, { allowLate }) {
  const upd = db.prepare('INSERT INTO inclusions(hotel_id, code, mode, price, daily_cap, note) VALUES (?,?,?,?,?,?) ON CONFLICT(hotel_id, code) DO UPDATE SET mode=excluded.mode, price=excluded.price, daily_cap=excluded.daily_cap, note=excluded.note');
  let lateBlocked = false;
  db.transaction(() => {
    for (const item of INCLUSIONS) {
      let mode = ['included', 'addon', 'off'].includes(body['inc_' + item.code]) ? body['inc_' + item.code] : 'off';
      const price = Math.max(0, parseInt(body['price_' + item.code], 10) || 0);
      let cap = Math.max(0, parseInt(body['cap_' + item.code], 10) || 0);
      const note = String(body['note_' + item.code] || '').trim().slice(0, 160);
      if (item.code === 'late' && mode === 'addon' && !allowLate) {
        mode = 'off';
        lateBlocked = true;
      }
      if (mode !== 'addon') cap = 0;
      upd.run(hotelId, item.code, mode, price, cap, note);
      upsertAddon(db, hotelId, item, mode, price, cap || item.cap);
    }
  })();
  return { lateBlocked };
}

function syncAddonEdit(db, hotelId, code, enabled, price, cap) {
  if (FOOD_DRINK.has(code)) {
    db.prepare('UPDATE inclusions SET mode=?, price=0, daily_cap=0 WHERE hotel_id=? AND code=?').run('off', hotelId, code);
    db.prepare('UPDATE addons SET enabled=0 WHERE hotel_id=? AND code=?').run(hotelId, code);
    return 0;
  }
  if (!BY_CODE[code]) return enabled;
  const current = db.prepare('SELECT mode FROM inclusions WHERE hotel_id=? AND code=?').get(hotelId, code);
  const was = current ? current.mode : 'off';
  let mode = was;
  if (was === 'included') mode = 'included';
  else if (enabled) mode = 'addon';
  else mode = 'off';
  const on = mode === 'addon' ? 1 : 0;
  db.prepare('INSERT INTO inclusions(hotel_id, code, mode, price, daily_cap, note) VALUES (?,?,?,?,?,?) ON CONFLICT(hotel_id, code) DO UPDATE SET mode=excluded.mode, price=excluded.price, daily_cap=excluded.daily_cap')
    .run(hotelId, code, mode, price, mode === 'addon' ? cap : 0, '');
  return on;
}

function includedRows(items) {
  return (items || []).filter(i => i.mode === 'included' && !FOOD_DRINK.has(i.code));
}
function includedQty(item, people) {
  const guests = Math.max(1, Number(people) || 1);
  return item.per === 'booking' ? 1 : guests;
}
function includedLineText(item, qty) {
  if (item.code === 'towels') return `${qty} × ${item.name}`;
  return item.name;
}
function includedLines(items, people) {
  return includedRows(items).map(item => {
    const qty = includedQty(item, people);
    return { qty, name: item.name, text: includedLineText(item, qty) };
  });
}
function includedText(items, people) {
  return includedLines(items, people).map(line => line.text).join('\n');
}
function placeCodes(areas) {
  const covered = new Set();
  for (const area of areas || []) {
    if (Number(area.serves_food)) continue;
    const name = String(area.name || '').toLowerCase();
    if (/gym|fitness/.test(name)) covered.add('gym');
    if (/sauna|steam/.test(name)) covered.add('sauna');
    if (/hot tub|\bspa\b/.test(name)) covered.add('spa');
    if (/\bpools?\b/.test(name)) covered.add('pool');
  }
  return covered;
}
function amenityItems(items, areas) {
  const covered = placeCodes(areas);
  return includedRows(items).filter(item => {
    if (item.code === 'pool' && covered.has('pool')) return false;
    if (item.code === 'sauna' && covered.has('sauna')) return false;
    if (item.code === 'spa' && covered.has('spa')) return false;
    if (item.code === 'gym' && covered.has('gym')) return false;
    return true;
  });
}
function amenityLines(items, people, areas) {
  return includedLines(amenityItems(items, areas), people);
}
function foodSentence(hotel) {
  const stored = String((hotel && hotel.food_rule) || '').trim();
  if (!stored || /food and drink credit|welcome drink|poolside food and drink/i.test(stored)) return FOOD_RULE;
  return stored;
}
function guestFoodLine(db, hotel) {
  if (!hotel) return FOOD_NOTE;
  return foodSentence(hotel);
}
function includedNote(items) {
  const park = (items || []).find(i => i.code === 'parking' && i.mode === 'included' && String(i.note || '').trim());
  return park ? String(park.note).trim() : '';
}
function includedBlock(items, people) {
  const lines = includedLines(items, people);
  const note = includedNote(items);
  if (!lines.length && !note) return '';
  const list = lines.length ? `<ul>${lines.map(line => `<li>${esc(line.text)}</li>`).join('')}</ul>` : '';
  const extra = note ? `<p class="pass-note">${esc(note)}</p>` : '';
  return `<div class="inc-recap"><b>What's included</b>${list}${extra}</div>`;
}
function includedHtml(items) {
  const rows = includedRows(items);
  if (!rows.length) return '';
  const note = includedNote(items);
  return `<section class="l-sec" id="included"><h3>What's included</h3><ul class="inc-grid">${rows.map(i => `<li>${ICONS[i.code] || ''}<span>${esc(i.name)}</span></li>`).join('')}</ul>${note ? `<p class="muted small">${esc(note)}</p>` : ''}</section>`;
}

function priceBit(n) {
  return Number(n) > 0 ? `<span class="extra-price">${money(n)} <small>(demo)</small></span>` : '';
}
function addonsHtml(items, offers) {
  const rows = (offers || []).filter(a => a && a.code !== 'late' && !FOOD_DRINK.has(a.code));
  const parkingOff = items.find(i => i.code === 'parking' && i.mode === 'off');
  const list = rows.map(i => `<label class="extra"><input type="checkbox" name="addon" value="${esc(i.code)}" data-price="${Number(i.price) || 0}" data-per="${esc(i.per || 'guest')}"><span class="extra-name">${esc(i.name)}</span>${priceBit(i.price)}</label>`).join('');
  const off = parkingOff ? '<p class="muted small">Parking is not offered with this pass.</p>' : '';
  if (!list && !off) return '';
  const box = list
    ? `<details class="extras" id="extras" open><summary><span class="extra-label">Add extras <span class="extra-opt">(optional)</span></span></summary><div class="extra-list" id="addons-pick">${list}</div></details>`
    : '';
  return `<section class="l-sec" id="addons-list">${box}${off}</section>`;
}

function dayBeats(items) {
  const mode = code => (items.find(i => i.code === code) || {}).mode;
  const on = code => mode(code) && mode(code) !== 'off';
  const inc = code => mode(code) === 'included';
  const mid = [];
  if (on('pool')) mid.push({ h: 'Swim', p: 'The pool is yours for the day-pass hours.' });
  if (on('spa') || on('sauna')) mid.push({ h: 'Warm up', p: inc('spa') || inc('sauna') ? 'Heat, steam or the hot tub is included.' : 'Add the spa if you want it.' });
  if (on('gym')) mid.push({ h: 'Move', p: inc('gym') ? 'The fitness centre is included.' : 'Add the fitness centre if you want it.' });
  return [
    { h: 'Arrive', p: 'Check in, change, and the day is yours.' },
    ...mid.slice(0, 3),
    { h: 'Head home', p: 'Leave when the day-pass hours end. There is no room and no overnight stay.' },
  ];
}
function beatsHtml(items) {
  return `<ol class="day-beats">${dayBeats(items).map(s => `<li><b>${esc(s.h)}</b><span>${esc(s.p)}</span></li>`).join('')}</ol>`;
}
function hoursInner(lines) {
  return `<ul class="hours-list">${lines.map(r => `<li><span>${esc(r.day)}</span><b>${esc(r.time)}</b></li>`).join('')}</ul><p class="muted small">These are the day-pass hours for this demo listing.</p>`;
}
function hoursHtml(lines) {
  return `<details class="fold" id="hours"><summary>Opening hours</summary>${hoursInner(lines)}</details>`;
}
function policyParts(hotel, foodLine) {
  const offering = require('./offering');
  const facts = offering.policyFacts(hotel);
  const watch = offering.supervisionNote(hotel);
  const rows = [
    ['Lifeguard', watch ? `${facts.lifeguard}. ${watch}` : facts.lifeguard],
    ['Pool', facts.pool],
    ['Heated', facts.heated],
    ['Age', hotel.age_policy || 'See the hotel'],
    ['Children', hotel.kids_hours || 'See the age line'],
    ['ID at check-in', hotel.id_required ? 'Bring photo ID.' : 'Photo ID is not required in this demo.'],
    ['Dress', hotel.dress_code || 'Swimwear at the pool.'],
    ['Food and drink', foodLine || hotel.food_rule || FOOD_NOTE],
    ['Cancellation', 'Free cancellation up to 24 hours before your access hours start.'],
  ];
  const note = Number(hotel.is_demo) === 1
    ? 'Example information for a fictional hotel. It is not a contract. <a href="/refunds">Cancellation and refund policy</a>.'
    : '<a href="/refunds">Cancellation and refund policy</a>.';
  return { rows, note };
}
function policyDl(rows) {
  return `<dl class="policy">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
function policyHtml(hotel, foodLine) {
  const { rows, note } = policyParts(hotel, foodLine);
  return `<details class="fold" id="policy"><summary>Guest policy</summary>${policyDl(rows)}<p class="muted small">${note}</p></details>`;
}
function policyInner(hotel, foodLine) {
  const { rows, note } = policyParts(hotel, foodLine);
  return { body: policyDl(rows.filter(([k]) => k !== 'Cancellation' && k !== 'Food and drink')), note };
}
function offerSelect(item) {
  return `<select name="inc_${item.code}" aria-label="${esc(item.name)} offer">
<option value="included" ${item.mode === 'included' ? 'selected' : ''}>Included</option>
<option value="addon" ${item.mode === 'addon' ? 'selected' : ''}>Paid add-on</option>
<option value="off" ${item.mode === 'off' ? 'selected' : ''}>Not offered</option>
</select>`;
}
function inclusionsForm(items) {
  const rows = items.map(i => `<div class="inc-edit">
<span>${esc(i.name)}</span>
${offerSelect(i)}
<label>Price<input class="num" type="number" min="0" step="1" name="price_${i.code}" value="${i.price ? i.price : ''}" placeholder="Blank" aria-label="${esc(i.name)} price. Leave blank if there is no charge."></label>
<label>A day<input class="num" type="number" min="0" step="1" name="cap_${i.code}" value="${i.daily_cap || 0}" aria-label="${esc(i.name)} per day"></label>
${i.code === 'parking' ? `<label class="inc-note">Note<input name="note_parking" maxlength="160" value="${esc(i.note || '')}" placeholder="Where to park"></label>` : `<input type="hidden" name="note_${i.code}" value="${esc(i.note || '')}">`}
</div>`).join('');
  return `<form class="inc-form" method="post" action="/hotel/inclusions"><h2>What's included</h2>
<p class="muted small">Included items come with the pass. ${esc(FOOD_RULE)} Paid add-ons are optional at booking and use the daily number as a cap. Leave the price blank when there is no charge. Parking uses that cap as spaces per day. Not offered stays off the listing.</p>
<div class="inc-edit inc-head"><span>Item</span><span>Offer</span><span>Price</span><span>A day</span></div>
${rows}
<div class="offer-save"><button class="btn btn-navy" type="submit">Save what's included</button></div></form>`;
}

module.exports = {
  INCLUSIONS, FOOD_NOTE, PASS_FOOD_LINE, FOOD_DRINK, SEAT_PHOTO, seatPhoto, loadInclusions, ensureInclusions, saveInclusions, syncAddonEdit,
  includedHtml, includedLines, includedText, includedNote, includedBlock, amenityLines, foodSentence, guestFoodLine,
  addonsHtml, inclusionsForm, beatsHtml, hoursHtml, hoursInner, policyHtml, policyInner,
};
