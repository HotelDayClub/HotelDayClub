const { esc } = require('./util');
const { PHOTOS, safePhoto, spotLabel } = require('./offering');

const PURCHASE = 'Food and drink available to purchase';
const MAX_AREAS = 12;

// Named areas already stated on each fictional listing. Nothing here adds a venue the copy does not name.
const PRESETS = {
  'saltwater-terrace': [
    { name: 'Infinity pool', blurb: 'A heated infinity pool on level one, looking straight out to the Pacific.', hours: 'Daily 10am–4pm', photo: 'infinity-ocean.jpg' },
    { name: 'Pool bar', blurb: 'The pool bar sells drinks from 11.', hours: 'From 11am', servesFood: 1 },
  ],
  'skyline-rooftop': [
    { name: 'Heated rooftop pool', blurb: 'A heated rooftop pool with city views.', hours: 'Mon–Thu 11am–4pm, Sat–Sun 11am–4pm', photo: 'rooftop-city.jpg' },
    { name: 'Bar', blurb: 'A bar selling drinks from noon.', hours: 'From noon', servesFood: 1 },
    { name: 'Gym', blurb: 'Use the gym on the same day.', link: 'none' },
  ],
  'harbourside-lido': [
    { name: 'Glass-roofed pool', blurb: 'A light-filled pool under a glass roof.', hours: 'Daily 9am–6pm', photo: 'glass-roof-pool.jpg' },
    { name: 'Steam room', blurb: 'Steam room during the visit.' },
    { name: 'Sauna', blurb: 'Sauna during the visit.' },
    { name: 'Café', blurb: PURCHASE + '.', servesFood: 1 },
  ],
  'palm-court': [
    { name: 'Lagoon pool', blurb: 'A big lagoon pool ringed by palms, with plenty of shade and a family-friendly shallow end.', hours: 'Thu–Sun 10am–5pm', photo: 'tropical-resort.jpg' },
    { name: 'Café', blurb: PURCHASE + '.', servesFood: 1 },
  ],
  'manly-sands': [
    { name: 'Magnesium pool', blurb: 'A magnesium pool.', hours: 'Daily 10am–4pm', photo: 'infinity-palms.jpg' },
    { name: 'Kiosk', blurb: 'A kiosk selling food and drinks. No glass.', servesFood: 1 },
  ],
  'bayview-spa': [
    { name: 'Bathhouse', blurb: 'A calm bathhouse with hot and cold plunge.', hours: 'Tue–Sun 9am–4pm', photo: 'spa-steps.jpg' },
    { name: 'Plunge pools', blurb: 'Hot and cold plunge.', hours: 'Tue–Sun 9am–4pm', photo: 'indoor-spa-pool.jpg' },
    { name: 'Heated outdoor pool', blurb: 'A heated outdoor pool.', hours: 'Tue–Sun 9am–4pm' },
    { name: 'Sauna and steam room', blurb: 'Sauna and steam room during the visit.' },
    { name: 'Hot tub and spa pool', blurb: 'Hot tub or spa pool during the visit.' },
  ],
};

function many(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}
function cleanLine(value, max) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
function foodClaim(text) {
  return /\b(included|complimentary)\b|\bfree\s+(drink|drinks|food|meal|meals)\b/i.test(text);
}
function guestBlurb(area) {
  let blurb = cleanLine(area && area.blurb, 160);
  if (!area || !Number(area.serves_food)) return blurb;
  blurb = blurb.replace(/([^.?!]*)\b(included|complimentary)\b([^.?!]*)[.?!]?/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!/available to purchase/i.test(blurb)) {
    blurb = `${blurb ? blurb.replace(/[.\s]+$/, '') + '. ' : ''}${PURCHASE}.`;
  }
  return blurb.replace(/\s+/g, ' ').trim();
}
function accessLine(area) {
  const blurb = guestBlurb(area);
  const hours = cleanLine(area.hours, 80);
  return [String(area.name || '').trim() + (blurb || hours ? ':' : ''), blurb, hours].filter(Boolean).join(' ');
}
function accessText(areas) {
  return (areas || []).map(accessLine).filter(Boolean).join('\n');
}
function photoSrc(photo) {
  const file = safePhoto(photo);
  return file ? '/assets/photos/' + file : '';
}
function accessList(areas, opts = {}) {
  const rows = areas || [];
  if (!rows.length) return '';
  const demo = !!opts.demo;
  return `<ul class="access-list">${rows.map(area => {
    const src = photoSrc(area.photo);
    const name = cleanLine(area.name, 60);
    const alt = demo ? `Example photo of ${name}, not this hotel` : name;
    const img = src ? `<img src="${esc(src)}" alt="${esc(alt)}" width="480" height="360" loading="lazy" decoding="async">` : '';
    const blurb = guestBlurb(area);
    const hours = cleanLine(area.hours, 80);
    return `<li class="access-item">${img}<div><b>${esc(name)}</b>${blurb ? `<p>${esc(blurb)}</p>` : ''}${hours ? `<p class="access-hours">${esc(hours)}</p>` : ''}</div></li>`;
  }).join('')}</ul>`;
}
function splitAreas(areas) {
  const included = [];
  const buy = [];
  for (const area of areas || []) (Number(area.serves_food) ? buy : included).push(area);
  return { included, buy };
}
function accessDetail(areas, opts = {}) {
  const { included, buy } = splitAreas(areas);
  const extra = opts.amenities || '';
  const parts = [];
  if (included.length || extra) parts.push(`<h4>Included access</h4>${included.length ? accessList(included, opts) : ''}${extra}`);
  if (buy.length) parts.push(`<h4>On site to buy (not included)</h4>${accessList(buy, opts)}`);
  return parts.join('');
}
function accessBlock(areas, opts) {
  const { included, buy } = splitAreas(areas);
  const parts = [];
  if (included.length) parts.push(`<div class="inc-recap"><b>Included access</b>${accessList(included, opts)}</div>`);
  if (buy.length) parts.push(`<div class="inc-recap"><b>On site to buy (not included)</b>${accessList(buy, opts)}</div>`);
  return parts.join('');
}
function linkedAreas(db, hotelId) {
  return db.prepare(`SELECT DISTINCT a.* FROM access_areas a
    JOIN pass_access pa ON pa.area_id=a.id
    WHERE a.hotel_id=? ORDER BY a.sort, a.id`).all(hotelId);
}
function forPass(db, passId) {
  if (!passId) return [];
  return db.prepare(`SELECT a.* FROM access_areas a
    JOIN pass_access pa ON pa.area_id=a.id
    WHERE pa.pass_type_id=? ORDER BY a.sort, a.id`).all(passId);
}
function byPass(db, hotelId) {
  const rows = db.prepare(`SELECT a.*, pa.pass_type_id FROM access_areas a
    JOIN pass_access pa ON pa.area_id=a.id
    WHERE a.hotel_id=? ORDER BY a.sort, a.id`).all(hotelId);
  const map = {};
  for (const row of rows) (map[row.pass_type_id] || (map[row.pass_type_id] = [])).push(row);
  return map;
}
function hotelAreas(db, hotelId) {
  return db.prepare('SELECT * FROM access_areas WHERE hotel_id=? ORDER BY sort, id').all(hotelId);
}
function linkedIds(db, hotelId) {
  const rows = db.prepare(`SELECT pa.pass_type_id, pa.area_id FROM pass_access pa
    JOIN access_areas a ON a.id=pa.area_id WHERE a.hotel_id=?`).all(hotelId);
  const map = {};
  for (const row of rows) {
    if (!map[row.pass_type_id]) map[row.pass_type_id] = new Set();
    map[row.pass_type_id].add(row.area_id);
  }
  return map;
}

function readAreas(body) {
  const ids = many(body.area_id);
  const keys = many(body.area_key);
  const names = many(body.area_name);
  const blurbs = many(body.area_blurb);
  const hours = many(body.area_hours);
  const photos = many(body.area_photo);
  const food = new Set(many(body.area_food).map(v => String(v)));
  const typed = key => {
    const value = body['area_type_' + key];
    return value === 'buy' || value === 'included' ? value : '';
  };
  const count = Math.max(ids.length, keys.length, names.length, blurbs.length, hours.length, photos.length);
  if (count > MAX_AREAS) return { err: `You can list up to ${MAX_AREAS} areas.` };
  const areas = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const name = cleanLine(names[i], 60);
    const blurb = cleanLine(blurbs[i], 140);
    const when = cleanLine(hours[i], 80);
    const rawPhoto = String(photos[i] || '').trim();
    const key = String(keys[i] || i);
    if (!name && !blurb && !when && !rawPhoto) continue;
    if (!name) return { err: 'Name each area.' };
    const folded = name.toLowerCase();
    if (seen.has(folded)) return { err: `Two areas are both called ${name}.` };
    seen.add(folded);
    if (rawPhoto && !safePhoto(rawPhoto)) return { err: `Choose a photo from the list for ${name}.` };
    const kind = typed(key);
    const servesFood = kind ? (kind === 'buy' ? 1 : 0) : (food.has(key) ? 1 : 0);
    if (servesFood && foodClaim(blurb)) return { err: `${name}: food and drink is not included. Say it is available to purchase.` };
    areas.push({
      id: parseInt(ids[i], 10) || 0,
      key,
      name,
      blurb,
      hours: when,
      photo: safePhoto(rawPhoto),
      servesFood,
    });
  }
  return { areas };
}

function saveAccess(db, hotelId, body) {
  const parsed = readAreas(body || {});
  if (parsed.err) return parsed;
  const owned = new Set(db.prepare('SELECT id FROM access_areas WHERE hotel_id=?').all(hotelId).map(r => r.id));
  const passes = db.prepare('SELECT id FROM pass_types WHERE hotel_id=?').all(hotelId);
  const passIds = new Set(passes.map(p => p.id));
  const links = {};
  for (const id of passIds) links[id] = new Set(many(body['access_' + id]).map(v => String(v)));
  const upd = db.prepare('UPDATE access_areas SET name=?, blurb=?, photo=?, hours=?, serves_food=?, sort=? WHERE id=? AND hotel_id=?');
  const ins = db.prepare('INSERT INTO access_areas(hotel_id, name, blurb, photo, hours, serves_food, sort) VALUES (?,?,?,?,?,?,?)');
  const del = db.prepare('DELETE FROM access_areas WHERE id=? AND hotel_id=?');
  const clear = db.prepare('DELETE FROM pass_access WHERE area_id IN (SELECT id FROM access_areas WHERE hotel_id=?)');
  const link = db.prepare('INSERT OR IGNORE INTO pass_access(pass_type_id, area_id) VALUES (?,?)');
  db.transaction(() => {
    const keep = new Set();
    const keyToId = new Map();
    parsed.areas.forEach((area, sort) => {
      let id = owned.has(area.id) ? area.id : 0;
      if (id) upd.run(area.name, area.blurb, area.photo, area.hours, area.servesFood, sort, id, hotelId);
      else id = ins.run(hotelId, area.name, area.blurb, area.photo, area.hours, area.servesFood, sort).lastInsertRowid;
      keep.add(id);
      keyToId.set(area.key, id);
    });
    for (const id of owned) if (!keep.has(id)) del.run(id, hotelId);
    clear.run(hotelId);
    for (const passId of passIds) {
      for (const key of links[passId]) {
        const areaId = keyToId.get(key);
        if (areaId) link.run(passId, areaId);
      }
    }
  })();
  return { ok: true };
}

function areaEditor(area) {
  const photoOptions = `<option value="">No photo</option>${PHOTOS.map(([file, label]) => `<option value="${esc(file)}" ${area.photo === file ? 'selected' : ''}>${esc(label)}</option>`).join('')}`;
  return `<div class="access-edit">
<input type="hidden" name="area_id" value="${area.id || ''}">
<input type="hidden" name="area_key" value="${esc(area.key)}">
<div class="spot-grid">
<label class="fl">Name<input name="area_name" maxlength="60" value="${esc(area.name || '')}" placeholder="Pool, sauna, or the bar's name"></label>
<label class="fl">Hours, optional<input name="area_hours" maxlength="80" value="${esc(area.hours || '')}" placeholder="Daily 10am–6pm"></label>
</div>
<label class="fl">Short description<input name="area_blurb" maxlength="140" value="${esc(area.blurb || '')}" placeholder="One line about this area"></label>
<label class="fl">Photo, optional<select name="area_photo">${photoOptions}</select></label>
<div class="area-type">
<label class="tick"><input type="radio" name="area_type_${esc(area.key)}" value="included" ${Number(area.serves_food) ? '' : 'checked'}> Access included</label>
<label class="tick"><input type="radio" name="area_type_${esc(area.key)}" value="buy" ${Number(area.serves_food) ? 'checked' : ''}> Available to buy</label>
</div>
<button type="button" class="linkbtn remove-area">Remove</button>
</div>`;
}
function accessForm(areas, passes, linked) {
  const rows = areas.length ? areas : [{ id: '', key: 'n0', name: '', blurb: '', hours: '', photo: '', serves_food: 0 }];
  const withKeys = rows.map((area, i) => ({ ...area, key: String(area.id || area.key || ('n' + i)) }));
  const editors = withKeys.map(areaEditor).join('');
  const ticks = (passes || []).map(pass => {
    const on = (linked && linked[pass.id]) || new Set();
    const boxes = withKeys.map(area => `<label><input type="checkbox" name="access_${pass.id}" value="${esc(area.key)}" ${area.id && on.has(area.id) ? 'checked' : ''}> <span class="access-tick-name">${esc(area.name || 'New area')}</span></label>`).join('');
    return `<fieldset class="access-pass"><legend>${esc(spotLabel(pass))}</legend><div class="access-ticks" data-pass="${pass.id}">${boxes}</div></fieldset>`;
  }).join('');
  return `<form class="inc-form" id="included-access" method="post" action="/hotel/access"><h2>Included access</h2>
<p class="muted small">Name each area and choose its type. Access included is a place the pass lets guests into, such as a pool, sauna or steam room. Available to buy is a bar, café, kiosk or pool bar. Food and drink is not included. Tick an area on each pass that includes it.</p>
<div id="access-areas">${editors}</div>
<p class="offer-actions"><button type="button" class="btn btn-line" id="add-area">Add an area</button></p>
<h3>Which passes include them</h3>
<div id="access-passes">${ticks}</div>
<div class="offer-save"><button class="btn btn-navy" type="submit">Save included access</button></div>
<template id="area-tpl">${areaEditor({ id: '', key: 'NEW', name: '', blurb: '', hours: '', photo: '', serves_food: 0 })}</template>
</form>
<script>
(function(){
  const box=document.getElementById('access-areas');
  const add=document.getElementById('add-area');
  if(!box||!add) return;
  let n=0;
  function bind(row){
    const key=row.querySelector('[name=area_key]').value;
    const name=row.querySelector('[name=area_name]');
    name.addEventListener('input',function(){
      document.querySelectorAll('.access-ticks input').forEach(function(input){
        if(input.value!==key) return;
        const label=input.parentElement.querySelector('.access-tick-name');
        if(label) label.textContent=name.value||'New area';
      });
    });
    const remove=row.querySelector('.remove-area');
    if(remove) remove.addEventListener('click',function(){
      document.querySelectorAll('.access-ticks input').forEach(function(input){ if(input.value===key) input.parentElement.remove(); });
      row.remove();
    });
  }
  box.querySelectorAll('.access-edit').forEach(bind);
  add.addEventListener('click',function(){
    if(box.querySelectorAll('.access-edit').length>=${MAX_AREAS}) return;
    const key='n'+Date.now()+(n++);
    const tpl=document.getElementById('area-tpl');
    const row=tpl.content.firstElementChild.cloneNode(true);
    row.querySelector('[name=area_key]').value=key;
    row.querySelectorAll('input[type=radio]').forEach(function(input){ input.name='area_type_'+key; });
    box.appendChild(row);
    bind(row);
    document.querySelectorAll('.access-ticks').forEach(function(ticks){
      const label=document.createElement('label');
      const input=document.createElement('input');
      input.type='checkbox';
      input.name='access_'+ticks.dataset.pass;
      input.value=key;
      const span=document.createElement('span');
      span.className='access-tick-name';
      span.textContent='New area';
      label.appendChild(input);
      label.appendChild(document.createTextNode(' '));
      label.appendChild(span);
      ticks.appendChild(label);
    });
  });
})();
</script>`;
}

function ensureAccess(db) {
  const count = db.prepare('SELECT COUNT(*) n FROM access_areas WHERE hotel_id=?');
  const ins = db.prepare('INSERT INTO access_areas(hotel_id, name, blurb, photo, hours, serves_food, sort) VALUES (?,?,?,?,?,?,?)');
  const link = db.prepare('INSERT OR IGNORE INTO pass_access(pass_type_id, area_id) VALUES (?,?)');
  db.transaction(() => {
    for (const [slug, areas] of Object.entries(PRESETS)) {
      const hotel = db.prepare('SELECT id FROM hotels WHERE slug=? AND COALESCE(is_demo,0)=1').get(slug);
      if (!hotel || count.get(hotel.id).n) continue;
      const passes = db.prepare('SELECT id FROM pass_types WHERE hotel_id=?').all(hotel.id);
      areas.forEach((area, sort) => {
        const photo = safePhoto(area.photo || '');
        const id = ins.run(hotel.id, area.name, area.blurb, photo, area.hours || '', area.servesFood ? 1 : 0, sort).lastInsertRowid;
        if (area.link === 'none') return;
        for (const pass of passes) link.run(pass.id, id);
      });
    }
  })();
}

module.exports = {
  PURCHASE, PRESETS, guestBlurb, accessLine, accessText, accessList, accessDetail, accessBlock,
  forPass, byPass, hotelAreas, linkedAreas, linkedIds, readAreas, saveAccess, accessForm, ensureAccess,
};
