const { esc } = require('./util');
const { hotelZone } = require('./calendar');
const { loadInclusions, FOOD_DRINK } = require('./inclusions');
const { hotelAreas } = require('./access');

const CATEGORIES = ['gym', 'pool', 'spa', 'sauna', 'steam', 'restaurant', 'cafe', 'bar'];
const FOOD = new Set(['restaurant', 'cafe', 'bar']);
const CAT_CODE = { pool: 'pool', gym: 'gym', spa: 'spa', sauna: 'sauna', steam: 'sauna' };
const CODE_CATS = { pool: ['pool'], gym: ['gym'], spa: ['spa'], sauna: ['sauna', 'steam'] };
const LABELS = {
  gym: 'Gym',
  pool: 'Pool',
  spa: 'Spa',
  sauna: 'Sauna',
  steam: 'Steam room',
  restaurant: 'Restaurant',
  cafe: 'Café',
  bar: 'Bar',
};
const SENTENCE = 'Not included in your pass. Pay the venue directly. Menus, prices and opening hours are set by the venue.';

const ICONS = {
  wifi: '<path d="M4.5 9.5a11 11 0 0 1 15 0"/><path d="M7.5 13a7 7 0 0 1 9 0"/><path d="M10.5 16.2a3 3 0 0 1 3 0"/><path d="M12 19h.01"/>',
  pool: '<path d="M4 15c1.4 1.2 2.8 1.2 4.2 0S11 13.8 12.4 15s2.8 1.2 4.2 0S19.4 13.8 20.8 15"/><path d="M4 18.5c1.4 1.2 2.8 1.2 4.2 0S11 17.3 12.4 18.5s2.8 1.2 4.2 0 2.8-1.2 4.2 0"/><path d="M7 12V6.5M12 12V8"/>',
  towels: '<path d="M7 4h8a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M7 4v14M10 8h4"/>',
  gym: '<path d="M6 9v6M18 9v6M4 10v4M20 10v4M6 12h12M3 11v2M21 11v2"/>',
  sauna: '<path d="M8 19a4 4 0 0 1 8 0"/><path d="M9 14c.4-2 1.4-3 3-3s2.6 1 3 3"/><path d="M12 6v2M9.5 7.2l1 1.6M14.5 7.2l-1 1.6"/>',
  steam: '<path d="M8 20c-2-3 2-4 0-7M12 20c-2-3 2-4 0-7M16 20c-2-3 2-4 0-7"/><path d="M5 9h14"/>',
  spa: '<path d="M8 14c0-3 1.6-5 4-5s4 2 4 5"/><path d="M4 17c1.5 1 3 1 4.5 0S12 16 13.5 17s3 1 4.5 0 3-1 4.5 0"/><path d="M12 4v2"/>',
  showers: '<path d="M6 6h9a3 3 0 0 1 3 3v1H8"/><path d="M8 12v1.5M11 12v1.5M14 12v1.5M9 16v1M12 16.5V18M15 16v1"/>',
  shower: '<path d="M6 6h9a3 3 0 0 1 3 3v1H8"/><path d="M8 12v1.5M11 12v1.5M14 12v1.5M9 16v1M12 16.5V18M15 16v1"/>',
  lockers: '<rect x="4" y="3" width="7" height="18" rx="1"/><rect x="13" y="3" width="7" height="18" rx="1"/><path d="M9 12h.01M18 12h.01"/>',
  toiletries: '<path d="M9 8h6v12H9z"/><path d="M10 8V5h4v3M12 5V3"/>',
  robe: '<path d="M8 7 6 9v11h12V9l-2-2"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M12 7v13"/>',
  kids: '<circle cx="12" cy="7" r="2.2"/><path d="M8 20v-4l2-3h4l2 3v4M9 13l-2 2M15 13l2 2"/>',
  luggage: '<rect x="6" y="7" width="12" height="12" rx="2"/><path d="M9 7V5h6v2M9 19v2M15 19v2"/>',
  parking: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  restaurant: '<path d="M6 3v7a2 2 0 0 0 2 2v9M10 3v7a2 2 0 0 1-2 2M8 3v5"/><path d="M17 3c-2 2-2 6 0 8v10"/>',
  cafe: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3"/>',
  bar: '<path d="M5 4h14l-7 8z"/><path d="M12 12v8M8 20h8"/>',
  generic: '<circle cx="12" cy="12" r="4"/>',
};

const TICK = '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

class HotelAmenities {
  static CATEGORIES = CATEGORIES;
  static FOOD = FOOD;
  static LABELS = LABELS;
  static SENTENCE = SENTENCE;
  static lastReport = null;

  static schema(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS hotel_amenities(
  id INTEGER PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  category TEXT NOT NULL CHECK(category IN ('gym','pool','spa','sauna','steam','restaurant','cafe','bar')),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
  included INTEGER NOT NULL DEFAULT 0 CHECK(NOT(category IN ('restaurant','cafe','bar') AND included=1)),
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_by TEXT CHECK(hidden_by IN ('hotel','admin') OR hidden_by IS NULL),
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hotel_amenities_log(
  id INTEGER PRIMARY KEY,
  amenity_id INTEGER,
  hotel_id INTEGER,
  actor TEXT,
  action TEXT,
  old_value TEXT,
  new_value TEXT,
  at TEXT
);
`);
  }

  static now() {
    return new Date().toISOString();
  }

  static cleanLabel(raw, { trimTo = 0 } = {}) {
    let text = String(raw ?? '');
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/[\u0000-\u001F\u007F]/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    if (trimTo > 0) return text.slice(0, trimTo);
    return text;
  }

  static categoryCode(raw) {
    const text = String(raw || '').trim().toLowerCase();
    const map = {
      gym: 'gym',
      pool: 'pool',
      spa: 'spa',
      sauna: 'sauna',
      steam: 'steam',
      'steam room': 'steam',
      restaurant: 'restaurant',
      cafe: 'cafe',
      café: 'cafe',
      bar: 'bar',
    };
    return map[text] || '';
  }

  static classifyName(name) {
    const text = String(name || '').toLowerCase();
    const cafeAt = text.search(/caf[eé]/);
    const barAt = text.search(/bar/);
    const cafe = cafeAt >= 0;
    const bar = barAt >= 0;
    if (cafe && bar) {
      const category = cafeAt <= barAt ? 'cafe' : 'bar';
      return { category, ambiguous: true, unmapped: false };
    }
    if (cafe) return { category: 'cafe', ambiguous: false, unmapped: false };
    if (bar) return { category: 'bar', ambiguous: false, unmapped: false };
    return { category: 'restaurant', ambiguous: false, unmapped: true };
  }

  static includedBit(category, items) {
    if (FOOD.has(category)) return 0;
    const code = CAT_CODE[category];
    if (!code) return 0;
    const item = (items || []).find(row => row.code === code);
    return item && item.mode === 'included' ? 1 : 0;
  }

  static log(db, { amenityId, hotelId, actor, action, oldValue, newValue, at }) {
    db.prepare(`INSERT INTO hotel_amenities_log(amenity_id, hotel_id, actor, action, old_value, new_value, at)
      VALUES (?,?,?,?,?,?,?)`).run(amenityId || null, hotelId, actor, action, oldValue || null, newValue || null, at || HotelAmenities.now());
  }

  static syncIncluded(db, hotelId) {
    const items = loadInclusions(db, hotelId);
    const rows = db.prepare('SELECT id, category, included FROM hotel_amenities WHERE hotel_id=?').all(hotelId);
    const upd = db.prepare('UPDATE hotel_amenities SET included=? WHERE id=?');
    for (const row of rows) {
      const bit = HotelAmenities.includedBit(row.category, items);
      if (Number(row.included) !== bit) upd.run(bit, row.id);
    }
  }

  static ensure(db) {
    HotelAmenities.schema(db);
    const report = HotelAmenities.seed(db);
    HotelAmenities.lastReport = report;
    console.log(HotelAmenities.reportLine(report));
    return report;
  }

  static reportLine(report) {
    const list = rows => (rows.length ? rows.map(row => `${row.slug}: ${row.name} -> ${row.category}`).join('; ') : 'none');
    return `hotel amenities seed: added=${report.added.length} skipped=${report.skipped} ambiguous=${list(report.ambiguous)} unmapped=${list(report.unmapped)}`;
  }

  static seed(db) {
    HotelAmenities.schema(db);
    const areas = db.prepare(`SELECT a.*, h.slug FROM access_areas a JOIN hotels h ON h.id=a.hotel_id WHERE a.serves_food=1 ORDER BY a.hotel_id, a.sort, a.id`).all();
    const exists = db.prepare('SELECT 1 FROM hotel_amenities WHERE hotel_id=? AND category=? AND label=?');
    const ins = db.prepare(`INSERT INTO hotel_amenities(hotel_id, category, label, included, hidden, hidden_by, sort, updated_at)
      VALUES (?,?,?,0,0,NULL,?,?)`);
    const report = { added: [], skipped: 0, ambiguous: [], unmapped: [] };
    const at = HotelAmenities.now();
    db.transaction(() => {
      for (const area of areas) {
        const kind = HotelAmenities.classifyName(area.name);
        const label = HotelAmenities.cleanLabel(area.name, { trimTo: 60 });
        const entry = { hotelId: area.hotel_id, slug: area.slug, name: label || String(area.name || '').trim(), category: kind.category };
        if (kind.ambiguous) report.ambiguous.push(entry);
        if (kind.unmapped) report.unmapped.push(entry);
        if (!label) {
          report.skipped += 1;
          continue;
        }
        if (exists.get(area.hotel_id, kind.category, label)) {
          report.skipped += 1;
          continue;
        }
        const id = ins.run(area.hotel_id, kind.category, label, Number(area.sort) || 0, at).lastInsertRowid;
        HotelAmenities.log(db, {
          amenityId: id,
          hotelId: area.hotel_id,
          actor: 'system',
          action: 'add',
          newValue: label,
          at,
        });
        report.added.push(entry);
      }
    })();
    return report;
  }

  static coveredCodes(areas) {
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

  static inclusionLabel(item, people) {
    if (item.code === 'wifi') return 'Wi-Fi';
    if (item.code === 'towels') {
      const qty = item.per === 'booking' ? 1 : Math.max(1, Number(people) || 1);
      if (qty === 1) return 'Towels: 1 per person';
      return `${qty} towels`;
    }
    return item.name;
  }

  static iconKeyForCode(code) {
    if (code === 'room-shower') return 'shower';
    if (ICONS[code]) return code;
    return 'generic';
  }

  static icon(name) {
    const paths = ICONS[name] || ICONS.generic;
    return `<svg class="aico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  }

  static groups(db, hotelId, opts = {}) {
    const items = loadInclusions(db, hotelId);
    const people = Math.max(1, Number(opts.people) || 1);
    const areas = opts.areas || hotelAreas(db, hotelId);
    const covered = HotelAmenities.coveredCodes(areas);
    const all = db.prepare('SELECT * FROM hotel_amenities WHERE hotel_id=? ORDER BY sort, id').all(hotelId);
    const visible = all.filter(row => !Number(row.hidden));
    const included = [];
    const optional = [];
    const handled = new Set();

    for (const item of items) {
      if (item.mode !== 'included' && item.mode !== 'addon') continue;
      if (FOOD_DRINK.has(item.code)) continue;
      const cats = CODE_CATS[item.code];
      const bucket = item.mode === 'included' ? included : optional;
      if (cats) {
        const configured = all.filter(row => cats.includes(row.category));
        if (configured.length) {
          for (const row of visible.filter(entry => cats.includes(entry.category))) {
            bucket.push({ label: row.label, icon: row.icon || row.category, towels: false });
            handled.add(row.category);
          }
          for (const cat of cats) handled.add(cat);
          continue;
        }
        if (covered.has(item.code)) continue;
      }
      bucket.push({
        label: HotelAmenities.inclusionLabel(item, people),
        icon: HotelAmenities.iconKeyForCode(item.code),
        towels: item.code === 'towels',
      });
    }

    const onsite = [];
    for (const row of visible) {
      if (FOOD.has(row.category) || !handled.has(row.category)) {
        onsite.push({ label: row.label, icon: row.category, towels: false });
      }
    }
    return { included, optional, onsite };
  }

  static rowHtml(row, kind) {
    const tail = kind === 'included'
      ? TICK
      : kind === 'optional'
        ? '<b class="tagx">Optional extra</b>'
        : '<b class="tago">Pay the venue</b>';
    return `<li class="am-row">${HotelAmenities.icon(row.icon)}<span>${esc(row.label)}</span>${tail}</li>`;
  }

  static listHtml(rows, kind) {
    const draw = list => `<ul class="am-list${kind === 'included' ? ' am-in' : ''}">${list.map(row => HotelAmenities.rowHtml(row, kind)).join('')}</ul>`;
    if (rows.length <= 6) return draw(rows);
    return `${draw(rows.slice(0, 6))}<details class="am-more">${draw(rows.slice(6))}<summary><span class="m-o">Show all (${rows.length})</span><span class="m-c">Show fewer</span></summary></details>`;
  }

  static sentenceHtml() {
    return `<p class="os-line"><b>Not included in your pass.</b> Pay the venue directly. Menus, prices and opening hours are set by the venue.</p>`;
  }

  static demoHotel(hotel) {
    return !hotel || Number(hotel.is_demo) === 1 || /\(Demo\)/i.test(String(hotel.name || ''));
  }

  static listingHtml(db, hotel, opts = {}) {
    if (!hotel) return '';
    const groups = HotelAmenities.groups(db, hotel.id, opts);
    if (!groups.included.length && !groups.optional.length && !groups.onsite.length) return '';
    const demo = HotelAmenities.demoHotel(hotel);
    const title = demo ? 'Example amenities (demo)' : 'Amenities';
    const intro = demo
      ? 'Set by the hotel. Shown as examples on this demo.'
      : 'Set by the hotel.';
    const parts = [];
    if (groups.included.length) {
      parts.push(`<div class="am-grp am-y"><h3>Included in your pass</h3>${HotelAmenities.listHtml(groups.included, 'included')}</div>`);
    }
    if (groups.optional.length) {
      parts.push(`<div class="am-grp am-x"><h3 id="am-x">Optional extras (not in the pass price)</h3><p class="am-intro">Add at checkout. The price is shown there.</p>${HotelAmenities.listHtml(groups.optional, 'optional')}</div>`);
    }
    if (groups.onsite.length) {
      parts.push(`<div class="am-grp am-os"><h3>On site (not included)</h3>${HotelAmenities.listHtml(groups.onsite, 'onsite')}</div>`);
    }
    return `<section class="lsec am" id="amenities" aria-labelledby="am-h"><h2 id="am-h">${esc(title)}</h2><p class="am-intro">${esc(intro)}</p><div class="am-cols">${parts.join('')}</div></section>`;
  }

  static seatHtml(db, hotel, opts = {}) {
    if (!hotel) return '';
    const groups = HotelAmenities.groups(db, hotel.id, opts);
    if (!groups.included.length && !groups.optional.length && !groups.onsite.length) return '';
    const demo = HotelAmenities.demoHotel(hotel);
    const title = demo ? 'Example amenities (demo)' : 'Amenities';
    const chips = rows => `<ul class="chips-c">${rows.map(row => `<li class="am-row">${HotelAmenities.icon(row.icon)}<span>${esc(row.label)}</span></li>`).join('')}</ul>`;
    const parts = [];
    if (groups.optional.length) parts.push(`<p class="amc-row"><b>Extras (paid):</b></p>${chips(groups.optional)}`);
    if (groups.onsite.length) {
      parts.push(`<h3>On site (not included)</h3><ul class="chips-c os">${groups.onsite.map(row => `<li class="am-row">${HotelAmenities.icon(row.icon)}<span>${esc(row.label)}</span></li>`).join('')}</ul>`);
    }
    const href = `/h/${encodeURIComponent(hotel.slug)}#am-h`;
    return `<section class="am-c" aria-labelledby="amc-h"><h2 id="amc-h" class="h3">${esc(title)}</h2>${parts.join('')}<a class="tlink" href="${esc(href)}">See all amenities</a></section>`;
  }

  static bookingHtml(db, hotelId) {
    if (!hotelId) return '';
    const groups = HotelAmenities.groups(db, hotelId, { people: 1 });
    if (!groups.onsite.length) return '';
    const rows = groups.onsite.map(row => `<li class="am-row">${HotelAmenities.icon(row.icon)}<span>${esc(row.label)}</span><b class="tago">Pay the venue</b></li>`).join('');
    return `<div class="bk-venues"><h3>On site (not included)</h3><ul class="am-list">${rows}</ul></div>`;
  }

  static statusNote(category, items) {
    if (FOOD.has(category)) return 'Venues like this are always shown as not included in the pass.';
    const code = CAT_CODE[category];
    const item = (items || []).find(row => row.code === code);
    const mode = item ? item.mode : 'off';
    if (mode === 'included') return 'Included in pass (from your inclusions)';
    if (mode === 'addon') return 'Optional extra (from your inclusions)';
    return 'On site (from your inclusions)';
  }

  static formatWhen(hotel, iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso || '');
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: hotelZone(hotel || {}),
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).formatToParts(date);
    const get = type => {
      const found = parts.find(part => part.type === type);
      return found ? found.value : '';
    };
    return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`.replace(/\s+/g, ' ').trim();
  }

  static actionPhrase(row) {
    const actor = String(row.actor || '');
    const who = actor === 'system' ? 'system' : actor.startsWith('admin') ? 'admin' : 'hotel';
    if (row.action === 'add') return `${row.new_value || 'A venue'} added by ${who}`;
    if (row.action === 'rename') return `${row.old_value || 'A venue'} renamed to ${row.new_value || ''} by ${who}`;
    if (row.action === 'hide') return `${row.new_value || row.old_value || 'A venue'} hidden by ${who}`;
    if (row.action === 'show') return `${row.new_value || row.old_value || 'A venue'} shown by ${who}`;
    if (row.action === 'remove') return `${row.old_value || 'A venue'} removed by ${who}`;
    return `Updated by ${who}`;
  }

  static logLine(db, hotel) {
    const row = db.prepare('SELECT * FROM hotel_amenities_log WHERE hotel_id=? ORDER BY id DESC LIMIT 1').get(hotel.id);
    if (!row) return '';
    const demo = HotelAmenities.demoHotel(hotel) ? ' (demo)' : '';
    return `Change log: ${HotelAmenities.formatWhen(hotel, row.at)} · ${HotelAmenities.actionPhrase(row)}${demo}`;
  }

  static form(db, hotel) {
    const items = loadInclusions(db, hotel.id);
    const rows = db.prepare('SELECT * FROM hotel_amenities WHERE hotel_id=? ORDER BY sort, id').all(hotel.id);
    const demo = HotelAmenities.demoHotel(hotel);
    const title = demo ? 'Amenities and on-site venues (demo)' : 'Amenities and on-site venues';
    const options = CATEGORIES.map(code => `<option value="${code}">${esc(LABELS[code])}</option>`).join('');
    const list = rows.map(row => {
      const locked = row.hidden_by === 'admin' && Number(row.hidden) === 1;
      const shown = !Number(row.hidden);
      const label = locked ? 'Hidden by admin' : (shown ? 'Shown' : 'Hidden');
      const pressed = shown ? 'true' : 'false';
      const hint = locked
        ? ', an admin hid this and the hotel cannot show it'
        : (shown ? ' on public pages, select to hide' : ' on public pages, select to show');
      return `<li class="vrow"><div class="vcat">${HotelAmenities.icon(row.category)}<span>${esc(LABELS[row.category] || row.category)}</span></div>
<label class="vname"><span class="vh">Name for ${esc(LABELS[row.category] || 'venue')}</span><input name="name_${row.id}" value="${esc(row.label)}" maxlength="60" autocomplete="off"></label>
<button class="btn vtog ${shown ? 'on' : 'off'}" type="submit" name="toggle" value="${row.id}" aria-pressed="${pressed}">${esc(label)}<span class="vh">${esc(hint)}</span></button>
<button class="btn btn-line vrem" type="submit" name="remove" value="${row.id}">Remove</button>
<p class="vnote">${esc(HotelAmenities.statusNote(row.category, items))}</p></li>`;
    }).join('');
    const log = HotelAmenities.logLine(db, hotel);
    return `<form class="vform card" id="amenities" method="post" action="/hotel/amenities"><h2>${esc(title)}</h2>
<p class="muted small">Shown on your listing and seat pages. Name only (max 60 characters): no prices, offers, opening hours, menus, logos or ratings. Hidden venues disappear from public pages straight away.</p>
<ul class="vlist">${list}</ul>
<fieldset class="vadd"><legend>Add a venue or amenity</legend>
<label>Category<select name="new_cat">${options}</select></label>
<label>Name<input name="new_name" maxlength="60" placeholder="e.g. Example bar" autocomplete="off"></label>
<button class="btn btn-line" type="submit" name="add" value="1">Add</button>
</fieldset>
<p class="muted small">Whether a pool, gym, spa, sauna or steam room shows as included comes from your inclusions, not from this list. Restaurants, cafés and bars are always shown as not included in the pass.</p>
<div class="vfoot"><button class="btn btn-navy" type="submit">Save changes</button>${log ? `<p class="muted small">${esc(log)}</p>` : ''}</div></form>`;
  }

  static owned(db, hotelId, id) {
    const rowId = parseInt(id, 10);
    if (!rowId) return null;
    return db.prepare('SELECT * FROM hotel_amenities WHERE id=? AND hotel_id=?').get(rowId, hotelId) || null;
  }

  static adminToggle(db, body, actor) {
    const id = parseInt(body && body.id, 10);
    const row = id ? db.prepare('SELECT * FROM hotel_amenities WHERE id=?').get(id) : null;
    if (!row) return { err: 'Venue not found.' };
    const at = HotelAmenities.now();
    const hidden = Number(row.hidden) === 1;
    if (hidden) {
      db.prepare('UPDATE hotel_amenities SET hidden=0, hidden_by=NULL, updated_at=? WHERE id=?').run(at, row.id);
      HotelAmenities.log(db, { amenityId: row.id, hotelId: row.hotel_id, actor, action: 'show', newValue: row.label, at });
      return { ok: true, msg: `${row.label} is shown on public pages.` };
    }
    db.prepare("UPDATE hotel_amenities SET hidden=1, hidden_by='admin', updated_at=? WHERE id=?").run(at, row.id);
    HotelAmenities.log(db, { amenityId: row.id, hotelId: row.hotel_id, actor, action: 'hide', newValue: row.label, at });
    return { ok: true, msg: `${row.label} is hidden on public pages.` };
  }

  static adminHtml(db) {
    const hotels = db.prepare('SELECT id, name, is_demo FROM hotels ORDER BY name, id').all();
    const rowsFor = db.prepare('SELECT * FROM hotel_amenities WHERE hotel_id=? ORDER BY sort, id');
    const cards = [];
    for (const hotel of hotels) {
      const rows = rowsFor.all(hotel.id);
      if (!rows.length) continue;
      const body = rows.map(row => {
        const shown = !Number(row.hidden);
        const action = shown ? 'Hide venue' : 'Show venue';
        return `<tr><td data-label="Venue">${esc(row.label)}</td><td data-label="Category">${esc(LABELS[row.category] || row.category)}</td><td data-label="Public status">${shown ? 'Shown' : 'Hidden'}</td><td data-label="Action"><form method="post" action="/admin/venues/hide"><button class="btn btn-line" type="submit" name="id" value="${row.id}">${action}</button></form></td></tr>`;
      }).join('');
      cards.push(`<section class="adm-card" id="venues-${hotel.id}"><h2>Venues · ${esc(hotel.name)}</h2><div class="adm-table adm-stack"><table class="atab"><thead><tr><th scope="col">Venue</th><th scope="col">Category</th><th scope="col">Public status</th><th scope="col">Action</th></tr></thead><tbody>${body}</tbody></table></div><p class="adm-muted">Every change is logged with time and who made it (hotel or admin). Hidden venues are removed from public pages immediately.</p></section>`);
    }
    if (!cards.length) return '<section class="adm-card" id="venues"><h2>Venues</h2><p>No venues yet.</p></section>';
    return `<div id="venues">${cards.join('')}</div>`;
  }
}

HotelAmenities.save = function saveWrapped(db, hotelId, body, actor) {
  try {
    return HotelAmenities.saveBody(db, hotelId, body, actor);
  } catch (err) {
    if (err && err.expose) return { err: err.message };
    throw err;
  }
};

HotelAmenities.saveBody = function saveBody(db, hotelId, body, actor) {
  const input = body || {};
  const rows = db.prepare('SELECT * FROM hotel_amenities WHERE hotel_id=? ORDER BY sort, id').all(hotelId);
  const renames = [];
  for (const row of rows) {
    const key = 'name_' + row.id;
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const label = HotelAmenities.cleanLabel(input[key]);
    if (label.length < 1 || label.length > 60) return { err: 'Use a name of 1 to 60 characters.' };
    if (label !== row.label) renames.push({ row, label });
  }
  let op = null;
  if (input.remove) op = { type: 'remove', id: input.remove };
  else if (input.toggle) op = { type: 'toggle', id: input.toggle };
  else if (Object.prototype.hasOwnProperty.call(input, 'add')) op = { type: 'add' };
  if (op && op.type === 'add') {
    const category = HotelAmenities.categoryCode(input.new_cat);
    if (!CATEGORIES.includes(category)) return { err: 'Choose a category from the list.' };
    const label = HotelAmenities.cleanLabel(input.new_name);
    if (label.length < 1 || label.length > 60) return { err: 'Use a name of 1 to 60 characters.' };
    op.label = label;
    op.category = category;
  }
  const at = HotelAmenities.now();
  const run = db.transaction(() => {
    const updName = db.prepare('UPDATE hotel_amenities SET label=?, updated_at=? WHERE id=? AND hotel_id=?');
    for (const change of renames) {
      updName.run(change.label, at, change.row.id, hotelId);
      HotelAmenities.log(db, {
        amenityId: change.row.id,
        hotelId,
        actor,
        action: 'rename',
        oldValue: change.row.label,
        newValue: change.label,
        at,
      });
    }
    if (!op) return { ok: true };
    if (op.type === 'remove' || op.type === 'toggle') {
      const row = HotelAmenities.owned(db, hotelId, op.id);
      if (!row) throw Object.assign(new Error('That venue was not found.'), { expose: true });
      if (op.type === 'remove') {
        db.prepare('DELETE FROM hotel_amenities WHERE id=? AND hotel_id=?').run(row.id, hotelId);
        HotelAmenities.log(db, { amenityId: row.id, hotelId, actor, action: 'remove', oldValue: row.label, at });
        return { ok: true };
      }
      const hidden = Number(row.hidden) === 1;
      if (hidden && row.hidden_by === 'admin') throw Object.assign(new Error('An admin hid this venue. The hotel cannot show it.'), { expose: true });
      if (hidden) {
        db.prepare('UPDATE hotel_amenities SET hidden=0, hidden_by=NULL, updated_at=? WHERE id=?').run(at, row.id);
        HotelAmenities.log(db, { amenityId: row.id, hotelId, actor, action: 'show', newValue: row.label, at });
      } else {
        db.prepare("UPDATE hotel_amenities SET hidden=1, hidden_by='hotel', updated_at=? WHERE id=?").run(at, row.id);
        HotelAmenities.log(db, { amenityId: row.id, hotelId, actor, action: 'hide', newValue: row.label, at });
      }
      return { ok: true };
    }
    const items = loadInclusions(db, hotelId);
    const included = HotelAmenities.includedBit(op.category, items);
    const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM hotel_amenities WHERE hotel_id=?').get(hotelId).n;
    const id = db.prepare(`INSERT INTO hotel_amenities(hotel_id, category, label, included, hidden, hidden_by, sort, updated_at)
      VALUES (?,?,?,?,0,NULL,?,?)`).run(hotelId, op.category, op.label, included, sort, at).lastInsertRowid;
    HotelAmenities.log(db, { amenityId: id, hotelId, actor, action: 'add', newValue: op.label, at });
    return { ok: true };
  });
  const result = run();
  HotelAmenities.syncIncluded(db, hotelId);
  return result;
};

module.exports = { HotelAmenities, SENTENCE, CATEGORIES };
