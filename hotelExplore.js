const { esc } = require('./util');
const { PHOTOS, safePhoto, dayHoursText } = require('./offering');
const { PhotoAssets } = require('./photoAssets');
const { icon } = require('./d2Icons');

const BAR_KINDS = new Set(['bar', 'restaurant', 'cafe']);
const STOCK = PHOTOS.map(([file]) => file);
const MAX_CARDS = 4;
const INTRO_MAX = 240;
const NAME_MAX = 30;
const LINE_MAX = 70;
const DETAILS_MAX = 300;
const HOURS_MAX = 40;

const DEMO_SEED = {
  'saltwater-terrace': {
    intro: '',
    areas: [
      { name: 'The Pool', line: 'Heated outdoor pool with loungers and ocean views.', details: 'Heated outdoor pool with loungers and ocean views.', hours: '', photo: 'infinity-palms.jpg', kind: 'pool' },
      { name: 'The Terrace', line: 'Shaded deck with loungers and daybeds around the pool.', details: 'Shaded deck with loungers and daybeds around the pool.', hours: '', photo: 'hero-loungers.jpg', kind: 'other' },
      { name: 'Pool bar', line: 'Have a drink by the pool. Cocktails, coffee and light bites.', details: 'Have a drink by the pool. Cocktails, coffee and light bites.', hours: '', photo: 'loungers-snacks.jpg', kind: 'bar' },
      { name: 'Restaurant', line: 'Lunch with a view. Modern Australian, seafood and share plates.', details: 'Lunch with a view. Modern Australian, seafood and share plates.', hours: '12pm–3pm', photo: 'restaurant-view.jpg', kind: 'restaurant' },
    ],
  },
  'skyline-rooftop': {
    intro: '',
    areas: [
      { name: 'Rooftop pool', line: 'Heated pool with city views and a breeze off the harbour.', details: 'Heated pool with city views and a breeze off the harbour.', hours: '', photo: 'rooftop-city.jpg', kind: 'pool' },
      { name: 'Pool deck', line: 'Loungers and chairs on the roof around the pool.', details: 'Loungers and chairs on the roof around the pool.', hours: '', photo: 'hero-loungers.jpg', kind: 'other' },
      { name: 'Rooftop bar', line: 'Cocktails and small plates with skyline views.', details: 'Cocktails and small plates with skyline views.', hours: '', photo: 'loungers-snacks.jpg', kind: 'bar' },
    ],
  },
  'harbourside-lido': {
    intro: '',
    areas: [
      { name: 'Glass-roof pool', line: 'Light-filled indoor pool under a glass roof.', details: 'Light-filled indoor pool under a glass roof.', hours: '', photo: 'glass-roof-pool.jpg', kind: 'pool' },
      { name: 'Lido deck', line: 'Loungers beside the pool hall.', details: 'Loungers beside the pool hall.', hours: '', photo: 'indoor-spa-pool.jpg', kind: 'other' },
      { name: 'Café', line: 'Coffee, pastries and light lunch in the pool hall.', details: 'Coffee, pastries and light lunch in the pool hall.', hours: '', photo: 'loungers-snacks.jpg', kind: 'cafe' },
    ],
  },
  'palm-court': {
    intro: '',
    areas: [
      { name: 'Lagoon pool', line: 'Outdoor lagoon with palms and a shallow end for families.', details: 'Outdoor lagoon with palms and a shallow end for families.', hours: '', photo: 'tropical-resort.jpg', kind: 'pool' },
      { name: 'Garden terrace', line: 'Loungers and shade in the palm gardens.', details: 'Loungers and shade in the palm gardens.', hours: '', photo: 'thatched-umbrellas.jpg', kind: 'other' },
      { name: 'Pool café', line: 'Coffee and light bites beside the lagoon.', details: 'Coffee and light bites beside the lagoon.', hours: '', photo: 'loungers-snacks.jpg', kind: 'cafe' },
    ],
  },
  'manly-sands': {
    intro: '',
    areas: [
      { name: 'Magnesium pool', line: 'Outdoor pool steps from the beach.', details: 'Outdoor pool steps from the beach.', hours: '', photo: 'infinity-palms.jpg', kind: 'pool' },
      { name: 'Beach deck', line: 'Loungers and daybeds facing the water.', details: 'Loungers and daybeds facing the water.', hours: '', photo: 'daybed-canopy.jpg', kind: 'other' },
      { name: 'Kiosk', line: 'Drinks and snacks by the pool.', details: 'Drinks and snacks by the pool.', hours: '', photo: 'loungers-snacks.jpg', kind: 'bar' },
    ],
  },
  'bayview-spa': {
    intro: '',
    areas: [
      { name: 'Bathhouse', line: 'Hot and cold plunge pools in a calm bathhouse.', details: 'Hot and cold plunge pools in a calm bathhouse.', hours: '', photo: 'spa-steps.jpg', kind: 'spa' },
      { name: 'Outdoor pool', line: 'Heated outdoor pool in the garden.', details: 'Heated outdoor pool in the garden.', hours: '', photo: 'indoor-spa-pool.jpg', kind: 'pool' },
      { name: 'Garden lounge', line: 'Quiet loungers in the garden.', details: 'Quiet loungers in the garden.', hours: '', photo: 'hero-loungers.jpg', kind: 'other' },
    ],
  },
};

function cleanCopy(text) {
  return String(text || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\u2014/g, '-')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function clip(text, max) {
  return cleanCopy(text).slice(0, max);
}
function isBar(kind) {
  return BAR_KINDS.has(String(kind || '').trim());
}
function photoOk(file) {
  const name = safePhoto(String(file || '').trim());
  return name && STOCK.includes(name) ? name : '';
}

function load(db, hotelId) {
  const row = db.prepare('SELECT about_intro FROM hotels WHERE id=?').get(hotelId);
  const areas = db.prepare('SELECT * FROM hotel_explore_areas WHERE hotel_id=? ORDER BY sort_order, id').all(hotelId);
  return {
    intro: cleanCopy(row && row.about_intro),
    areas: areas.map(a => ({
      id: a.id,
      sort_order: a.sort_order,
      name: cleanCopy(a.name),
      line: cleanCopy(a.line),
      details: cleanCopy(a.details),
      hours: cleanCopy(a.hours),
      photo: photoOk(a.photo),
      kind: cleanCopy(a.kind) || 'other',
    })),
  };
}

function checkInLine(hotel) {
  const ent = cleanCopy(hotel && hotel.day_entrance);
  if (!ent) return '';
  if (/reception/i.test(ent)) return 'At reception.';
  const bit = ent.split(/[.!]/)[0].trim();
  return bit ? `${bit}.` : '';
}

function cardHours(db, hotel, card, date, today) {
  const own = cleanCopy(card.hours);
  if (own) return own;
  const iso = date || today;
  if (db && hotel && iso) return dayHoursText(db, hotel, iso);
  return '';
}

function areaImg(file, alt) {
  if (!file) return '';
  return PhotoAssets.imgTag(file, { alt, width: 272, height: 160, sizes: '(max-width:390px) 272px, 260px', loading: 'lazy' });
}

class HotelExplore {
  static visible(data) {
    if (!data) return null;
    const areas = (data.areas || []).filter(a => a.name && a.photo);
    if (!areas.length) return null;
    return { intro: data.intro, areas };
  }

  static sectionHtml(hotel, data, ctx = {}) {
    const vis = HotelExplore.visible(data);
    if (!vis) return '';
    const demo = Number(hotel.is_demo) === 1;
    const { db, date, today } = ctx;
    const cards = vis.areas.map((a, i) => {
      const food = isBar(a.kind);
      const note = food ? '<span class="d2-ex-chip">Not included</span>' : '';
      const hrs = cardHours(db, hotel, a, date, today);
      return `<article class="d2-ex-card"${i === 0 ? ' id="d2-ex-first"' : ''}>
${areaImg(a.photo, demo ? 'Stock photo, not this hotel' : a.name)}
<div class="d2-ex-body">
<h3>${esc(a.name)}</h3>
${note}
<p class="d2-ex-line">${esc(a.line)}</p>
${hrs ? `<p class="d2-ex-hrs">${esc(hrs)}</p>` : ''}
<button type="button" class="sec-action d2-ex-open" data-open-explore aria-haspopup="dialog">See details<span class="sa-arr" aria-hidden="true">→</span></button>
</div>
</article>`;
    }).join('');
    const tag = demo ? '<span class="ex">Example hotel details (demo)</span>' : '';
    const stock = demo ? '<p class="d2-ex-stock">Stock photos · not this hotel</p>' : '';
    return `<section class="d2-s" id="explore"><h2>Explore the hotel</h2>${tag}${stock}
<div class="d2-ex-wrap" tabindex="0" aria-label="Hotel areas"><div class="d2-ex-row">${cards}</div></div>
${HotelExplore.sheetHtml(hotel, vis.areas, ctx)}
</section>`;
  }

  static sheetRow(a, demo, ctx = {}) {
    const { db, hotel, date, today } = ctx;
    const food = isBar(a.kind);
    const note = food ? '<p class="d2-ex-sheet-note"><span class="d2-ex-chip">Not included</span></p>' : '';
    const hrs = cardHours(db, hotel, a, date, today);
    const line = cleanCopy(a.line);
    const details = cleanCopy(a.details);
    const extra = details && details !== line ? `<p>${esc(details)}</p>` : '';
    const body = `${line || details ? `<p>${esc(line || details)}</p>` : ''}${hrs ? `<p class="d2-ex-hrs">${esc(hrs)}</p>` : ''}${line ? extra : ''}`;
    return `<li class="d2-ex-sheet-item">
${areaImg(a.photo, demo ? 'Stock photo, not this hotel' : a.name)}
<div>
<h3>${esc(a.name)}</h3>
${note}
${body}
</div>
</li>`;
  }

  static sheetHtml(hotel, areas, ctx = {}) {
    const demo = Number(hotel.is_demo) === 1;
    const rows = areas.map(a => HotelExplore.sheetRow(a, demo, { ...ctx, hotel })).join('');
    const checkIn = checkInLine(hotel);
    const foot = checkIn ? `<p class="d2-ex-checkin"><b>Where to check in:</b> ${esc(checkIn)}</p>` : '';
    return `<dialog class="d2-sheet d2-ex-sheet" id="d2-explore-sheet" aria-labelledby="d2-explore-h">
<div class="d2-ex-sheet-in">
<div class="d2-grab" aria-hidden="true"></div>
<div class="d2-top"><h2 id="d2-explore-h">Explore the hotel</h2><button type="button" class="d2-x" id="d2-explore-close" aria-label="Close">${icon('x')}</button></div>
${demo ? '<span class="ex">Example hotel details (demo)</span>' : ''}
<ul class="d2-ex-sheet-list">${rows}</ul>
${foot}
</div>
</dialog>`;
  }

  static form(hotel, data) {
    const areas = data.areas.length ? data.areas : [{ id: '', name: '', line: '', details: '', hours: '', photo: '', kind: 'pool', sort_order: 0 }];
    const photoOpts = file => `<option value="">No photo</option>${STOCK.map(f => `<option value="${esc(f)}"${file === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}`;
    const kindOpts = (sel) => [['pool', 'Pool'], ['spa', 'Spa'], ['gym', 'Gym'], ['bar', 'Bar'], ['restaurant', 'Restaurant'], ['cafe', 'Cafe'], ['other', 'Other']]
      .map(([v, l]) => `<option value="${esc(v)}"${sel === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
    const editors = areas.map((a, i) => `<div class="explore-edit" data-idx="${i}">
<input type="hidden" name="card_id" value="${esc(a.id || '')}">
<label class="fl">Name<input name="card_name" maxlength="${NAME_MAX}" value="${esc(a.name)}"></label>
<label class="fl">Short line<input name="card_line" maxlength="${LINE_MAX}" value="${esc(a.line)}"></label>
<label class="fl">Details<textarea name="card_details" maxlength="${DETAILS_MAX}">${esc(a.details)}</textarea></label>
<label class="fl">Hours<input name="card_hours" maxlength="${HOURS_MAX}" value="${esc(a.hours)}"></label>
<label class="fl">Photo<select name="card_photo">${photoOpts(a.photo)}</select></label>
<label class="fl">Kind<select name="card_kind">${kindOpts(a.kind)}</select></label>
<div class="two"><button type="submit" class="btn btn-line" name="move" value="up:${i}"${i === 0 ? ' disabled' : ''}>Move up</button><button type="submit" class="btn btn-line" name="move" value="down:${i}"${i >= areas.length - 1 ? ' disabled' : ''}>Move down</button></div>
<button type="submit" class="linkbtn" name="remove" value="${i}">Remove card</button>
</div>`).join('');
    return `<form class="explore-form" method="post" action="/hotel/explore" id="explore-edit"><h2>Explore the hotel</h2>
<p class="muted small">Guests see this on the listing between Passes and Details. Up to ${MAX_CARDS} area cards. Use stock photos only.</p>
<label class="fl">Intro<textarea name="about_intro" maxlength="${INTRO_MAX}">${esc(data.intro)}</textarea></label>
<div id="explore-cards">${editors}</div>
<p class="offer-actions"><button type="submit" class="btn btn-line" name="add" value="1"${areas.length >= MAX_CARDS ? ' disabled' : ''}>Add a card</button></p>
<div class="offer-save"><button class="btn btn-navy" type="submit">Save Explore the hotel</button></div>
</form>`;
  }
}

function parseCards(body) {
  const ids = [].concat(body.card_id || []);
  const names = [].concat(body.card_name || []);
  const lines = [].concat(body.card_line || []);
  const details = [].concat(body.card_details || []);
  const hours = [].concat(body.card_hours || []);
  const photos = [].concat(body.card_photo || []);
  const kinds = [].concat(body.card_kind || []);
  const n = Math.max(ids.length, names.length);
  const out = [];
  for (let i = 0; i < n && out.length < MAX_CARDS; i++) {
    const name = clip(names[i], NAME_MAX);
    if (!name) continue;
    const kind = clip(kinds[i] || 'other', 20) || 'other';
    out.push({
      id: parseInt(ids[i], 10) || 0,
      name,
      line: clip(lines[i], LINE_MAX),
      details: clip(details[i], DETAILS_MAX),
      hours: clip(hours[i], HOURS_MAX),
      photo: photoOk(photos[i]),
      kind,
    });
  }
  return out;
}

function mutateExplore(db, hotelId, body) {
  const ins = db.prepare('INSERT INTO hotel_explore_areas(hotel_id, sort_order, name, line, details, hours, photo, kind) VALUES (?,?,?,?,?,?,?,?)');
  const rows = db.prepare('SELECT * FROM hotel_explore_areas WHERE hotel_id=? ORDER BY sort_order, id').all(hotelId);
  if (String(body.add || '') === '1') {
    if (rows.length >= MAX_CARDS) return { err: `Up to ${MAX_CARDS} cards only.` };
    const sort = rows.length;
    ins.run(hotelId, sort, 'New area', '', '', '', STOCK[0] || 'hero-loungers.jpg', 'pool');
    return { ok: true };
  }
  const move = String(body.move || '');
  const sortUpd = db.prepare('UPDATE hotel_explore_areas SET sort_order=? WHERE id=? AND hotel_id=?');
  if (move.startsWith('up:') || move.startsWith('down:')) {
    const i = parseInt(move.split(':')[1], 10);
    const j = move.startsWith('up:') ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && i < rows.length && j < rows.length) {
      db.transaction(() => {
        sortUpd.run(j, rows[i].id, hotelId);
        sortUpd.run(i, rows[j].id, hotelId);
      })();
    }
    return { ok: true };
  }
  if (body.remove !== undefined && body.remove !== '') {
    const i = parseInt(body.remove, 10);
    if (i >= 0 && i < rows.length) {
      db.prepare('DELETE FROM hotel_explore_areas WHERE id=? AND hotel_id=?').run(rows[i].id, hotelId);
      db.transaction(() => {
        rows.filter((_, idx) => idx !== i).forEach((row, sort) => sortUpd.run(sort, row.id, hotelId));
      })();
    }
    return { ok: true };
  }
  return null;
}

function saveExplore(db, hotelId, body) {
  const mutated = mutateExplore(db, hotelId, body);
  if (mutated) return mutated;
  const intro = clip(body.about_intro, INTRO_MAX);
  const cards = parseCards(body);
  if (cards.some(c => !c.photo)) return { err: 'Each card needs a stock photo.' };
  const updHotel = db.prepare('UPDATE hotels SET about_intro=? WHERE id=?');
  const owned = new Set(db.prepare('SELECT id FROM hotel_explore_areas WHERE hotel_id=?').all(hotelId).map(r => r.id));
  const upd = db.prepare('UPDATE hotel_explore_areas SET name=?, line=?, details=?, hours=?, photo=?, kind=?, sort_order=? WHERE id=? AND hotel_id=?');
  const ins = db.prepare('INSERT INTO hotel_explore_areas(hotel_id, sort_order, name, line, details, hours, photo, kind) VALUES (?,?,?,?,?,?,?,?)');
  const del = db.prepare('DELETE FROM hotel_explore_areas WHERE id=? AND hotel_id=?');
  db.transaction(() => {
    updHotel.run(intro, hotelId);
    const keep = new Set();
    cards.forEach((card, sort) => {
      let id = owned.has(card.id) ? card.id : 0;
      if (id) upd.run(card.name, card.line, card.details, card.hours, card.photo, card.kind, sort, id, hotelId);
      else id = ins.run(hotelId, sort, card.name, card.line, card.details, card.hours, card.photo, card.kind).lastInsertRowid;
      keep.add(id);
    });
    for (const id of owned) if (!keep.has(id)) del.run(id, hotelId);
  })();
  return {};
}

const DEMO_EXPLORE_KEY = 'demo_explore_seed';
const DEMO_EXPLORE_VERSION = '2';

function metaTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT \'\')');
}

// One-time upgrade of demo Explore copy seeded by earlier versions. A field is only
// replaced when it still equals the old seed text, so hotel edits are kept. Adds the
// new seed cards (the Restaurant card) that are missing, up to MAX_CARDS.
function upgradeDemoExplore(db, hotelId, seed, oldSeed) {
  const rows = db.prepare('SELECT * FROM hotel_explore_areas WHERE hotel_id=? ORDER BY sort_order, id').all(hotelId);
  const upd = db.prepare('UPDATE hotel_explore_areas SET line=?, details=?, hours=? WHERE id=?');
  const ins = db.prepare('INSERT INTO hotel_explore_areas(hotel_id, sort_order, name, line, details, hours, photo, kind) VALUES (?,?,?,?,?,?,?,?)');
  const hotel = db.prepare('SELECT about_intro FROM hotels WHERE id=?').get(hotelId);
  if (oldSeed && hotel && (hotel.about_intro || '') === (oldSeed.intro || '')) {
    db.prepare('UPDATE hotels SET about_intro=? WHERE id=?').run(seed.intro || '', hotelId);
  }
  const oldAreas = (oldSeed && oldSeed.areas) || [];
  for (const row of rows) {
    const was = oldAreas.find(a => a.name === row.name);
    const now = seed.areas.find(a => a.name === row.name);
    if (!was || !now) continue;
    const pick = (field) => (row[field] === (was[field] || '') ? (now[field] || '') : row[field]);
    const next = { line: pick('line'), details: pick('details'), hours: pick('hours') };
    if (next.line !== row.line || next.details !== row.details || next.hours !== row.hours) upd.run(next.line, next.details, next.hours, row.id);
  }
  const names = new Set(rows.map(r => r.name));
  const oldNames = new Set(oldAreas.map(a => a.name));
  let total = rows.length;
  let sort = rows.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), -1) + 1;
  for (const a of seed.areas) {
    if (names.has(a.name) || oldNames.has(a.name) || total >= MAX_CARDS) continue;
    ins.run(hotelId, sort++, a.name, a.line, a.details, a.hours || '', a.photo, a.kind);
    total += 1;
  }
}

function ensureExplore(db) {
  const have = new Set(db.prepare('PRAGMA table_info(hotels)').all().map(c => c.name));
  if (!have.has('about_intro')) return;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hotel_explore_areas'").get();
  if (!tables) return;
  metaTable(db);
  const done = db.prepare('SELECT value FROM app_meta WHERE key=?').get(DEMO_EXPLORE_KEY);
  if (done && done.value === DEMO_EXPLORE_VERSION) return;
  const { DEMO_SEED_V1 } = require('./exploreSeedV1');
  const count = db.prepare('SELECT COUNT(*) n FROM hotel_explore_areas WHERE hotel_id=?');
  const insIntro = db.prepare('UPDATE hotels SET about_intro=? WHERE slug=? AND (about_intro IS NULL OR about_intro=\'\')');
  const insArea = db.prepare('INSERT INTO hotel_explore_areas(hotel_id, sort_order, name, line, details, hours, photo, kind) VALUES (?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const [slug, seed] of Object.entries(DEMO_SEED)) {
      const h = db.prepare('SELECT id FROM hotels WHERE slug=? AND COALESCE(is_demo,0)=1').get(slug);
      if (!h) continue;
      if (count.get(h.id).n === 0) {
        insIntro.run(seed.intro || '', slug);
        seed.areas.forEach((a, sort) => {
          insArea.run(h.id, sort, a.name, a.line, a.details, a.hours || '', a.photo, a.kind);
        });
      } else {
        upgradeDemoExplore(db, h.id, seed, DEMO_SEED_V1[slug]);
      }
    }
    db.prepare('INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(DEMO_EXPLORE_KEY, DEMO_EXPLORE_VERSION);
  })();
}

module.exports = { HotelExplore, load, saveExplore, ensureExplore, checkInLine, DEMO_SEED, isBar, BAR_KINDS, cardHours, DEMO_EXPLORE_KEY, DEMO_EXPLORE_VERSION };