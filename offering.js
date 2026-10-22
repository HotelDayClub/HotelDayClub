const { esc, ymd, nice } = require('./util');

const KINDS = [
  { code: 'lounger', name: 'Sun lounger' },
  { code: 'daybed', name: 'Daybed' },
  { code: 'cabana', name: 'Cabana' },
  { code: 'chair', name: 'Pool chair' },
  { code: 'entry', name: 'General entry' },
  { code: 'custom', name: 'Custom' },
];
const KIND_NAME = Object.fromEntries(KINDS.map(k => [k.code, k.name]));
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const PHOTOS = [
  ['hero-loungers.jpg', 'Loungers'],
  ['daybed-canopy.jpg', 'Daybed'],
  ['cabana-drapes.jpg', 'Cabana'],
  ['rooftop-city.jpg', 'Rooftop'],
  ['infinity-ocean.jpg', 'Infinity pool'],
  ['beach-resort-pool.jpg', 'Beach pool'],
  ['glass-roof-pool.jpg', 'Glass roof'],
  ['indoor-spa-pool.jpg', 'Indoor spa'],
  ['spa-steps.jpg', 'Spa'],
  ['tropical-resort.jpg', 'Lagoon'],
  ['resort-palms.jpg', 'Palms'],
  ['kids-float.jpg', 'Shallow end'],
  ['thatched-umbrellas.jpg', 'Umbrellas'],
  ['loungers-snacks.jpg', 'Poolside'],
  ['infinity-palms.jpg', 'Palms and pool'],
];

const pad = n => String(n).padStart(2, '0');
function fmtTime(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(hhmm || '');
  let h = +m[1];
  const min = m[2];
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return min === '00' ? `${h}${ap}` : `${h}:${min}${ap}`;
}
function parseTime(s) {
  if (s == null || s === '') return '';
  const raw = String(s).trim().toLowerCase();
  let m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return '';
    return `${pad(h)}:${pad(min)}`;
  }
  m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!m) return '';
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h < 1 || h > 12 || min > 59) return '';
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return `${pad(h)}:${pad(min)}`;
}
function minutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  return m ? (+m[1] * 60 + +m[2]) : null;
}
function many(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}
function mmddOk(s) {
  const raw = String(s || '').trim();
  const d = raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const m = d ? [d[1], d[2]] : (raw.match(/^(\d{2})-(\d{2})$/) || []).slice(1);
  if (m.length < 2) return '';
  const mo = +m[0], da = +m[1];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  return `${pad(mo)}-${pad(da)}`;
}
function seasonLabel(mmdd) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [m, d] = String(mmdd).split('-').map(Number);
  if (!m || !d) return mmdd;
  return `${d} ${months[m - 1]}`;
}
function safePhoto(name) {
  return PHOTOS.some(([f]) => f === name) ? name : '';
}
function spotLabel(p) {
  const holds = Number(p.holds) || 1;
  return holds > 1 ? `${p.name} for ${holds}` : p.name;
}
function rot(wd) { return (wd + 6) % 7; }
function effectiveClose(r, roomFrom) {
  const roomMin = minutes(roomFrom);
  const openMin = minutes(r.opens);
  const closeMin = minutes(r.closes);
  if (roomMin != null && openMin != null && closeMin != null && roomMin > openMin && roomMin < closeMin) return roomFrom;
  return r.closes;
}
function hoursSummary(rows, roomFrom) {
  const open = rows.filter(r => r.open).map(r => ({ ...r, closes: effectiveClose(r, roomFrom) })).sort((a, b) => rot(a.weekday) - rot(b.weekday));
  if (!open.length) return { hours: 'Closed to day passes', open_days: '', opens: '', closes: '' };
  const groups = [];
  for (const r of open) {
    const last = groups[groups.length - 1];
    const prev = last && last.days[last.days.length - 1];
    if (last && last.opens === r.opens && last.closes === r.closes && rot(r.weekday) === rot(prev) + 1) last.days.push(r.weekday);
    else groups.push({ opens: r.opens, closes: r.closes, days: [r.weekday] });
  }
  const span = days => days.length === 1 ? DAY_SHORT[days[0]] : days.length === 7 ? 'Daily' : `${DAY_SHORT[days[0]]}–${DAY_SHORT[days[days.length - 1]]}`;
  const first = groups[0];
  return {
    hours: groups.map(g => `${span(g.days)} · ${fmtTime(g.opens)}–${fmtTime(g.closes)}`).join(', '),
    open_days: open.map(r => r.weekday).sort((a, b) => a - b).join(','),
    opens: fmtTime(first.opens),
    closes: fmtTime(first.closes),
  };
}
function inSeason(hotel, date) {
  if (!hotel.season_start || !hotel.season_end || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const d = date.slice(5);
  const a = hotel.season_start, b = hotel.season_end;
  return a <= b ? (d >= a && d <= b) : (d >= a || d <= b);
}
function dayPlan(db, hotel, date) {
  if (!hotel || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const rows = db.prepare('SELECT weekday, open, opens, closes FROM hotel_hours WHERE hotel_id=?').all(hotel.id);
  if (!rows.length) return null;
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  const row = rows.find(r => r.weekday === wd);
  if (!row || !row.open) return { open: false };
  let opens = row.opens, closes = row.closes;
  if (inSeason(hotel, date) && hotel.season_opens && hotel.season_closes) {
    opens = hotel.season_opens;
    closes = hotel.season_closes;
  }
  const roomMin = minutes(hotel.room_only_from);
  const openMin = minutes(opens);
  const closeMin = minutes(closes);
  if (roomMin != null && openMin != null && roomMin <= openMin) return { open: false, roomOnly: true };
  let effective = closes;
  if (roomMin != null && closeMin != null && openMin != null && roomMin > openMin && roomMin < closeMin) effective = hotel.room_only_from;
  return { open: true, opens, closes, effective };
}
function dayClosure(db, hotel, date, now = new Date()) {
  if (!hotel || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const plan = dayPlan(db, hotel, date);
  if (!plan) {
    if (!hotel.open_days) return null;
    const [y, m, d] = date.split('-').map(Number);
    const open = hotel.open_days.split(',').map(n => parseInt(n, 10));
    if (open.includes(new Date(y, m - 1, d).getDay())) return null;
    const days = String(hotel.hours || '').split('·')[0].trim();
    return days ? `Day passes run ${days}` : 'Closed this day';
  }
  if (!plan.open) {
    if (plan.roomOnly) return 'Room guests only';
    const days = String(hotel.hours || '').split('·')[0].trim();
    return days ? `Day passes run ${days}` : 'Closed this day';
  }
  if (date === ymd(now) && plan.effective) {
    const closeMin = minutes(plan.effective);
    const cutoff = Number.isFinite(Number(hotel.cutoff_hours)) ? Number(hotel.cutoff_hours) : 2;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= closeMin) return 'Day passes have closed for today';
    if (nowMin >= closeMin - cutoff * 60) return 'Same-day booking has closed';
  }
  return null;
}
function closureReason(db, hotel, date, now) {
  if (!hotel) return null;
  const blocked = db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(hotel.id, date);
  if (blocked) return blocked.reason || 'Closed';
  return dayClosure(db, hotel, date, now);
}
function scheduleLabel(db, hotel, date) {
  if (!hotel || !hotel.id) return (hotel && hotel.hours) || '';
  const rows = db.prepare('SELECT weekday, open, opens, closes FROM hotel_hours WHERE hotel_id=?').all(hotel.id);
  if (!rows.length) return hotel.hours || '';
  const seasonal = inSeason(hotel, date) && hotel.season_opens && hotel.season_closes;
  const mapped = rows.map(r => ({
    weekday: r.weekday,
    open: r.open,
    opens: seasonal ? hotel.season_opens : r.opens,
    closes: seasonal ? hotel.season_closes : r.closes,
  }));
  return hoursSummary(mapped, hotel.room_only_from).hours;
}
function hoursView(db, hotel, date) {
  const plan = hotel ? dayPlan(db, hotel, date) : null;
  let span = '';
  let hoursLine = hotel ? scheduleLabel(db, hotel, date) : '';
  if (!hoursLine && hotel) hoursLine = hotel.hours || '';
  if (plan && plan.open && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    span = `${fmtTime(plan.opens)}–${fmtTime(plan.effective || plan.closes)}`;
    if (!hoursLine) {
      const [y, m, d] = date.split('-').map(Number);
      hoursLine = `${DAY_SHORT[new Date(y, m - 1, d).getDay()]} · ${span}`;
    }
  }
  return { hoursLine, span, showSeason: !(plan && plan.open && inSeason(hotel, date)) };
}
function listingHours(db, hotel, date) {
  return hoursView(db, hotel, date).hoursLine;
}
function syncHoursLabels(db) {
  const hotels = db.prepare('SELECT id, room_only_from FROM hotels').all();
  const upd = db.prepare('UPDATE hotels SET hours=?, open_days=?, opens=?, closes=? WHERE id=?');
  for (const h of hotels) {
    const rows = db.prepare('SELECT weekday, open, opens, closes FROM hotel_hours WHERE hotel_id=?').all(h.id);
    if (!rows.length) continue;
    const sum = hoursSummary(rows, h.room_only_from);
    upd.run(sum.hours, sum.open_days, sum.opens, sum.closes, h.id);
  }
}
function rulesLines(hotel, opts = {}) {
  const setting = hotel.setting === 'indoor' ? 'Indoor' : hotel.setting === 'both' ? 'Indoor and outdoor' : 'Outdoor';
  const lines = [`${hotel.heated ? 'Heated' : 'Unheated'} · ${setting}`];
  if (hotel.age_policy) lines.push(hotel.age_policy);
  if (hotel.kids_hours) lines.push(`Kids: ${hotel.kids_hours}`);
  lines.push(hotel.towels ? 'Towels included' : 'Bring your own towel');
  if (hotel.food_rule) lines.push(hotel.food_rule);
  lines.push(hotel.id_required ? 'Photo ID required' : 'Photo ID not required');
  lines.push(hotel.lifeguard ? 'Lifeguard on duty' : 'No lifeguard on duty');
  if (opts.hoursLine) lines.push(opts.hoursLine);
  else if (hotel.hours) lines.push(hotel.hours);
  if (hotel.room_only_from && hotel.room_only_to) lines.push(`Room guests only ${fmtTime(hotel.room_only_from)}–${fmtTime(hotel.room_only_to)}`);
  if (opts.showSeason !== false && hotel.season_start && hotel.season_end && hotel.season_opens && hotel.season_closes) {
    lines.push(`Seasonal hours ${seasonLabel(hotel.season_start)}–${seasonLabel(hotel.season_end)}, ${fmtTime(hotel.season_opens)}–${fmtTime(hotel.season_closes)}`);
  }
  const cutoff = hotel.cutoff_hours == null ? 2 : Number(hotel.cutoff_hours);
  lines.push(cutoff > 0 ? `Same-day bookings close ${cutoff} hour${cutoff === 1 ? '' : 's'} before close` : 'Same-day bookings until close');
  lines.push('Free cancellation until 24 hours before access hours start');
  return lines;
}
function hhmmFromMinutes(total) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
function lateSpan(opens, closes, roomFrom, roomTo) {
  const openMin = minutes(opens);
  const closeMin = minutes(closes);
  const roomStart = minutes(roomFrom);
  const roomEnd = minutes(roomTo);
  if (openMin == null || closeMin == null || closeMin <= openMin) return null;
  if (roomStart != null && roomStart <= openMin) return null;
  let passEnd = closeMin;
  if (roomStart != null && roomStart > openMin && roomStart < closeMin) passEnd = roomStart;
  if (closeMin <= passEnd) return null;
  if (roomStart != null && roomEnd != null && passEnd < roomEnd && closeMin > roomStart) {
    if (roomEnd < closeMin) return { fromMin: roomEnd, untilMin: closeMin };
    return null;
  }
  if (roomStart != null && roomEnd == null) return null;
  return { fromMin: passEnd, untilMin: closeMin };
}
function latePossible(spec) {
  const hours = (spec.hours || []).filter(r => r.open);
  const from = spec.room_only_from;
  const to = spec.room_only_to;
  if (hours.some(r => lateSpan(r.opens, r.closes, from, to))) return true;
  if (spec.season_opens && spec.season_closes && hours.length && lateSpan(spec.season_opens, spec.season_closes, from, to)) return true;
  return false;
}
function hotelLatePossible(db, hotel) {
  if (!hotel) return false;
  const hours = db.prepare('SELECT weekday, open, opens, closes FROM hotel_hours WHERE hotel_id=?').all(hotel.id);
  return latePossible({
    hours,
    room_only_from: hotel.room_only_from,
    room_only_to: hotel.room_only_to,
    season_opens: hotel.season_opens,
    season_closes: hotel.season_closes,
  });
}
function lateWindow(db, hotel, date) {
  const plan = dayPlan(db, hotel, date);
  if (!plan || !plan.open) return null;
  const span = lateSpan(plan.opens, plan.closes, hotel.room_only_from, hotel.room_only_to);
  if (!span) return null;
  return { end: hhmmFromMinutes(span.fromMin), until: hhmmFromMinutes(span.untilMin) };
}
function syncLateAddons(db) {
  const off = db.prepare("UPDATE addons SET enabled=0, name=?, blurb=? WHERE hotel_id=? AND code='late'");
  const keep = db.prepare("UPDATE addons SET name=?, blurb=? WHERE hotel_id=? AND code='late'");
  for (const h of db.prepare('SELECT * FROM hotels').all()) {
    if (hotelLatePossible(db, h)) keep.run('Late access', 'Only after room guests only has ended, and only until the pool closes.', h.id);
    else off.run('Late access', 'Not offered. It would overlap room guests only or run past the pool closing time.', h.id);
  }
}
function cancelNote(db, hotel, date, now = new Date()) {
  const plan = dayPlan(db, hotel, date);
  if (!plan || !plan.open || !plan.opens) return 'See the cancellation policy for this date.';
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = String(plan.opens).split(':').map(Number);
  const start = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  const deadline = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const when = `${fmtTime(`${pad(deadline.getHours())}:${pad(deadline.getMinutes())}`)} ${nice(ymd(deadline))}`;
  if (now.getTime() > deadline.getTime()) return "This booking is inside 24 hours of the start, so it can't be cancelled for free.";
  return `Free cancellation until ${when}.`;
}
function venueFacts(hotel) {
  const setting = hotel.setting === 'indoor' ? 'Indoor' : hotel.setting === 'both' ? 'Indoor and outdoor' : 'Outdoor';
  return {
    setting,
    heat: hotel.heated ? 'Heated' : 'Unheated',
    guard: hotel.lifeguard ? 'A lifeguard is on duty during day-pass hours.' : 'No lifeguard is on duty.',
    age: hotel.age_policy || 'See the hotel rules',
    kids: hotel.kids_hours ? `Kids: ${hotel.kids_hours}.` : '',
    lifeguard: !!hotel.lifeguard,
  };
}
function riskLines(hotel) {
  const v = venueFacts(hotel);
  return [
    'Swimming and using pools, spas, plunge pools, saunas and steam rooms carry risks of injury, illness and death.',
    'Drowning or near-drowning, including in shallow water, and especially for children and weak or tired swimmers.',
    'Slips, trips and falls on wet surfaces, stairs and pool edges. Spinal and head injury from diving or jumping. Diving is not permitted.',
    'Heat-related illness, fainting and heart strain in spas, saunas and steam rooms, and from cold plunge pools, particularly with alcohol, pregnancy, heart conditions, blood-pressure conditions or some medications.',
    'Sunburn and heat stress at outdoor pools.',
    "Alcohol greatly increases these risks. Don't swim or use spas or saunas after drinking.",
    "Water-borne illness. Don't swim if you've had diarrhoea recently.",
    `Lifeguard: ${v.guard} Staff are not watching the pool continuously.`,
    `Pool: ${v.setting} · ${v.heat}.`,
    `Children: ${v.age}. ${v.kids} Every child must be actively supervised in the water by an adult on this booking.`.replace(/\s+/g, ' ').trim(),
  ];
}
function riskText(hotel) { return riskLines(hotel).join(' '); }
function riskCard(hotel) {
  const lines = riskLines(hotel);
  return `<div class="rules-card risk-card"><h3>Risk warning</h3><p>${esc(lines[0])}</p><ul>${lines.slice(1, 7).map(l => `<li>${esc(l)}</li>`).join('')}</ul><p><b>At this venue</b></p><ul>${lines.slice(7).map(l => `<li>${esc(l)}</li>`).join('')}</ul><p class="muted small">Shown in full before you confirm. <a href="/risk">Risk warning (draft)</a></p></div>`;
}
function riskTick(hotel) {
  const who = hotel.lifeguard ? 'a lifeguard is on duty during day-pass hours' : 'no lifeguard is on duty';
  return `I have read the risk warning. I understand that swimming and using spa facilities involve risks of injury and death, and that ${who}. I'll decide for myself whether I, and anyone in my care, am fit to take part, and I won't swim or use a spa or sauna after drinking.`;
}
function swimNote(hotel) {
  const guard = hotel.lifeguard ? 'A lifeguard is on duty during day-pass hours.' : 'No lifeguard on duty.';
  return `Before you swim: ${guard} Pools, spas and saunas carry risks of serious injury and drowning. No diving. No swimming after alcohol. Supervise children at all times. Follow staff directions and the hotel's rules. In an emergency, alert staff and call 000.`;
}
function rulesText(hotel, opts) { return rulesLines(hotel, opts).join('. ') + '.'; }
function rulesCard(hotel, opts) {
  return `<div class="rules-card"><h3>Pool rules</h3><ul>${rulesLines(hotel, opts).map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}
function amenitiesFrom(h) {
  const a = [h.heated ? 'Heated pool' : 'Unheated pool'];
  a.push(h.setting === 'indoor' ? 'Indoor pool' : h.setting === 'both' ? 'Indoor and outdoor' : 'Outdoor pool');
  if (h.towels) a.push('Towels included');
  if (h.lifeguard) a.push('Lifeguard on duty');
  if (h.age_policy) a.push(h.age_policy);
  return a;
}
function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'hotel';
}
function defaultHours() {
  return [0, 1, 2, 3, 4, 5, 6].map(wd => ({ weekday: wd, open: 1, opens: '10:00', closes: '16:00' }));
}
function hoursFor(db, hotelId) {
  const rows = db.prepare('SELECT weekday, open, opens, closes FROM hotel_hours WHERE hotel_id=?').all(hotelId);
  if (!rows.length) return defaultHours();
  const by = Object.fromEntries(rows.map(r => [r.weekday, r]));
  return [0, 1, 2, 3, 4, 5, 6].map(wd => by[wd] || { weekday: wd, open: 0, opens: '10:00', closes: '16:00' });
}
function blankJoin() {
  return {
    hotel: {
      name: '', area: '', tagline: '', blurb: '', contact_name: '', contact_email: '', login: '',
      cutoff_hours: 2, heated: 0, setting: 'outdoor', age_policy: 'All ages', kids_hours: 'All open hours',
      towels: 1, food_rule: 'Food and drink from the hotel only', id_required: 1, lifeguard: 0,
      season_start: '', season_end: '', season_opens: '', season_closes: '', room_only_from: '', room_only_to: '',
    },
    spots: [{ kind: 'lounger', name: 'Sun lounger', description: 'A lounger by the pool, with a towel.', holds: 1, price: 45, daily_cap: 20, photo: 'hero-loungers.jpg' }],
    hours: defaultHours(),
  };
}
function readForm(body) {
  const names = many(body.spot_name);
  const kinds = many(body.kind);
  const descs = many(body.spot_desc);
  const holds = many(body.holds);
  const prices = many(body.price);
  const caps = many(body.cap);
  const photos = many(body.photo);
  const ids = many(body.spot_id);
  const codes = many(body.code);
  const spots = [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || '').trim();
    if (!name) continue;
    const kind = KIND_NAME[kinds[i]] ? kinds[i] : 'custom';
    const hold = Math.max(1, Math.min(12, parseInt(holds[i], 10) || 1));
    const price = parseInt(prices[i], 10);
    const cap = parseInt(caps[i], 10);
    if (!Number.isFinite(price) || price < 0) return { err: `Enter a price for ${name}.` };
    if (!Number.isFinite(cap) || cap < 0) return { err: `Enter a daily allocation for ${name}.` };
    spots.push({
      id: parseInt(ids[i], 10) || 0,
      code: String(codes[i] || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20),
      kind, name: name.slice(0, 40), description: String(descs[i] || '').trim().slice(0, 180),
      holds: hold, price, daily_cap: cap, photo: safePhoto(photos[i]),
    });
  }
  if (!spots.length) return { err: 'Add at least one seating type.' };
  const openFlags = new Set(many(body.day_open).map(n => parseInt(n, 10)));
  const hours = [];
  for (let wd = 0; wd < 7; wd++) {
    const open = openFlags.has(wd);
    const opens = parseTime(body['opens_' + wd]);
    const closes = parseTime(body['closes_' + wd]);
    if (open && (!opens || !closes)) return { err: `Add opening and closing times for ${DAY_LONG[wd]}.` };
    if (open && minutes(closes) <= minutes(opens)) return { err: `${DAY_LONG[wd]} needs a closing time after opening.` };
    hours.push({ weekday: wd, open: open ? 1 : 0, opens: opens || '10:00', closes: closes || '16:00' });
  }
  if (!hours.some(r => r.open)) return { err: 'Open at least one day to day-pass guests.' };
  const cutoff = parseInt(body.cutoff_hours, 10);
  if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 24) return { err: 'Same-day cutoff is a number of hours from 0 to 24.' };
  const seasonStart = mmddOk(body.season_start);
  const seasonEnd = mmddOk(body.season_end);
  const seasonOpens = parseTime(body.season_opens);
  const seasonCloses = parseTime(body.season_closes);
  const seasonBits = [body.season_start, body.season_end, body.season_opens, body.season_closes].map(v => String(v || '').trim()).filter(Boolean);
  if (seasonBits.length && !(seasonStart && seasonEnd && seasonOpens && seasonCloses)) return { err: 'Seasonal hours need a start date, an end date, and both times. Use 12-01 for 1 December.' };
  if (seasonOpens && minutes(seasonCloses) <= minutes(seasonOpens)) return { err: 'Seasonal closing time needs to be after opening.' };
  const roomFrom = parseTime(body.room_only_from);
  const roomTo = parseTime(body.room_only_to);
  if ((String(body.room_only_from || '').trim() || String(body.room_only_to || '').trim()) && (!roomFrom || !roomTo)) return { err: 'Room guests only needs a start and an end.' };
  if (roomFrom && minutes(roomTo) <= minutes(roomFrom)) return { err: 'Room guests only needs an end after the start.' };
  if (roomFrom) {
    for (const r of hours) {
      if (r.open && minutes(roomFrom) <= minutes(r.opens)) return { err: `Room guests only (${fmtTime(roomFrom)}) starts at or before day passes open on ${DAY_LONG[r.weekday]}. A pass can't be sold past that time.` };
    }
    if (seasonOpens && minutes(roomFrom) <= minutes(seasonOpens)) return { err: `Room guests only (${fmtTime(roomFrom)}) starts at or before the seasonal opening. A pass can't be sold past that time.` };
  }
  const name = String(body.hotel_name || '').trim();
  const area = String(body.area || '').trim();
  if (!name) return { err: 'Enter the hotel name.' };
  if (!area) return { err: 'Enter the neighbourhood.' };
  const setting = ['indoor', 'outdoor', 'both'].includes(body.setting) ? body.setting : 'outdoor';
  return {
    profile: {
      name: name.slice(0, 80),
      area: area.slice(0, 60),
      tagline: String(body.tagline || '').trim().slice(0, 140),
      blurb: String(body.blurb || '').trim().slice(0, 500),
      contact_name: String(body.contact_name || '').trim().slice(0, 80),
      contact_email: String(body.contact_email || '').trim().slice(0, 120),
    },
    spots, hours, cutoff_hours: cutoff,
    heated: body.heated === '1' ? 1 : 0,
    setting,
    age_policy: String(body.age_policy || '').trim().slice(0, 120) || 'All ages',
    kids_hours: String(body.kids_hours || '').trim().slice(0, 120),
    towels: body.towels === '1' ? 1 : 0,
    food_rule: String(body.food_rule || '').trim().slice(0, 160),
    id_required: body.id_required === '1' ? 1 : 0,
    lifeguard: body.lifeguard === '1' ? 1 : 0,
    season_start: seasonStart || null,
    season_end: seasonEnd || null,
    season_opens: seasonOpens || null,
    season_closes: seasonCloses || null,
    room_only_from: roomFrom || null,
    room_only_to: roomTo || null,
  };
}
function writeOffering(db, hotelId, spec) {
  const existing = db.prepare('SELECT * FROM pass_types WHERE hotel_id=?').all(hotelId);
  const booked = db.prepare('SELECT 1 FROM bookings WHERE pass_type_id=? LIMIT 1');
  const up = db.prepare('UPDATE pass_types SET code=?, kind=?, name=?, description=?, holds=?, price=?, daily_cap=?, photo=?, sort=? WHERE id=? AND hotel_id=?');
  const ins = db.prepare('INSERT INTO pass_types(hotel_id,code,kind,name,description,holds,price,daily_cap,photo,sort) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const used = new Set();
  const seen = new Set();
  spec.spots.forEach((s, sort) => {
    let code = s.code || (s.kind === 'custom' ? slugify(s.name).replace(/-/g, '') : s.kind) || 'spot';
    const base = code;
    let n = 2;
    const clash = id => db.prepare('SELECT id FROM pass_types WHERE hotel_id=? AND code=? AND id!=?').get(hotelId, code, id || 0);
    while (used.has(code) || clash(s.id)) {
      code = (base + n++).slice(0, 20);
      if (n > 30) break;
    }
    used.add(code);
    if (s.id && existing.some(e => e.id === s.id)) {
      up.run(code, s.kind, s.name, s.description, s.holds, s.price, s.daily_cap, s.photo || null, sort, s.id, hotelId);
      seen.add(s.id);
    } else {
      seen.add(ins.run(hotelId, code, s.kind, s.name, s.description, s.holds, s.price, s.daily_cap, s.photo || null, sort).lastInsertRowid);
    }
  });
  const kept = [];
  const del = db.prepare('DELETE FROM pass_types WHERE id=? AND hotel_id=?');
  for (const e of existing) {
    if (seen.has(e.id)) continue;
    if (booked.get(e.id)) { kept.push(e.name); continue; }
    del.run(e.id, hotelId);
  }
  const rep = db.prepare('INSERT OR REPLACE INTO hotel_hours(hotel_id,weekday,open,opens,closes) VALUES (?,?,?,?,?)');
  for (const r of spec.hours) rep.run(hotelId, r.weekday, r.open ? 1 : 0, r.opens, r.closes);
  const sum = hoursSummary(spec.hours, spec.room_only_from);
  const profile = spec.profile || {};
  db.prepare(`UPDATE hotels SET name=COALESCE(?, name), area=COALESCE(?, area), tagline=COALESCE(?, tagline), blurb=COALESCE(?, blurb),
    contact_name=?, contact_email=?, hours=?, open_days=?, opens=?, closes=?, cutoff_hours=?,
    heated=?, setting=?, age_policy=?, kids_hours=?, towels=?, food_rule=?, id_required=?, lifeguard=?,
    season_start=?, season_end=?, season_opens=?, season_closes=?, room_only_from=?, room_only_to=? WHERE id=?`).run(
    profile.name || null, profile.area || null, profile.tagline ?? null, profile.blurb ?? null,
    profile.contact_name || null, profile.contact_email || null,
    sum.hours, sum.open_days, sum.opens, sum.closes, spec.cutoff_hours,
    spec.heated ? 1 : 0, spec.setting || 'outdoor', spec.age_policy || 'All ages', spec.kids_hours || null,
    spec.towels ? 1 : 0, spec.food_rule || null, spec.id_required ? 1 : 0, spec.lifeguard ? 1 : 0,
    spec.season_start || null, spec.season_end || null, spec.season_opens || null, spec.season_closes || null,
    spec.room_only_from || null, spec.room_only_to || null, hotelId
  );
  return { ok: true, kept };
}
function saveOffering(db, hotelId, body) {
  const spec = readForm(body);
  if (spec.err) return spec;
  const late = db.prepare("SELECT enabled FROM addons WHERE hotel_id=? AND code='late'").get(hotelId);
  if (late && late.enabled && !latePossible(spec)) return { err: "Late access is on, but it would overlap room guests only or run past the pool's closing time. Turn late access off, or leave time after room guests only and before the pool closes." };
  return writeOffering(db, hotelId, spec);
}
function echoForm(body) {
  const names = many(body.spot_name);
  const spots = (names.length ? names : ['Sun lounger']).map((name, i) => ({
    id: parseInt(many(body.spot_id)[i], 10) || 0,
    code: many(body.code)[i] || '',
    kind: many(body.kind)[i] || 'lounger',
    name: name || '',
    description: many(body.spot_desc)[i] || '',
    holds: parseInt(many(body.holds)[i], 10) || 1,
    price: many(body.price)[i] ?? 45,
    daily_cap: many(body.cap)[i] ?? 10,
    photo: many(body.photo)[i] || '',
  }));
  const open = new Set(many(body.day_open).map(n => parseInt(n, 10)));
  const hours = [0, 1, 2, 3, 4, 5, 6].map(wd => ({
    weekday: wd, open: open.has(wd) ? 1 : 0,
    opens: parseTime(body['opens_' + wd]) || '10:00', closes: parseTime(body['closes_' + wd]) || '16:00',
  }));
  return {
    hotel: {
      name: body.hotel_name || '', area: body.area || '', tagline: body.tagline || '', blurb: body.blurb || '',
      contact_name: body.contact_name || '', contact_email: body.contact_email || '', login: body.login || '',
      cutoff_hours: body.cutoff_hours ?? 2, heated: body.heated === '1' ? 1 : 0, setting: body.setting || 'outdoor',
      age_policy: body.age_policy || '', kids_hours: body.kids_hours || '', towels: body.towels === '1' ? 1 : 0,
      food_rule: body.food_rule || '', id_required: body.id_required === '1' ? 1 : 0, lifeguard: body.lifeguard === '1' ? 1 : 0,
      season_start: body.season_start || '', season_end: body.season_end || '', season_opens: body.season_opens || '',
      season_closes: body.season_closes || '', room_only_from: body.room_only_from || '', room_only_to: body.room_only_to || '',
      marketing: body.marketing === '1' ? 1 : 0,
    },
    spots, hours,
  };
}
function yn(name, label, on) {
  return `<label class="fl">${label}<select name="${name}"><option value="0" ${on ? '' : 'selected'}>No</option><option value="1" ${on ? 'selected' : ''}>Yes</option></select></label>`;
}
function spotCard(s, index, locked) {
  const kind = KIND_NAME[s.kind] ? s.kind : 'custom';
  return `<div class="spot-card"><div class="spot-top"><b>Seating ${index + 1}</b>${locked ? '<span class="muted small">Has bookings</span>' : '<button type="button" class="linkbtn remove-spot">Remove</button>'}</div>
<input type="hidden" name="spot_id" value="${s.id || ''}"><input type="hidden" name="code" value="${esc(s.code || '')}">
<div class="spot-grid">
<label class="fl">Type<select name="kind">${KINDS.map(k => `<option value="${k.code}" ${k.code === kind ? 'selected' : ''}>${k.name}</option>`).join('')}</select></label>
<label class="fl">Name<input name="spot_name" value="${esc(s.name || '')}" maxlength="40" required></label>
<label class="fl">People it holds<input name="holds" type="number" min="1" max="12" value="${s.holds || 1}" required></label>
<label class="fl">Price (AUD)<input name="price" type="number" min="0" step="1" value="${s.price ?? ''}" required></label>
<label class="fl">Each day<input name="cap" type="number" min="0" step="1" data-code="${esc(s.code || '')}" value="${s.daily_cap ?? ''}" required></label>
<label class="fl">Photo<select name="photo"><option value="">No photo</option>${PHOTOS.map(([f, l]) => `<option value="${f}" ${s.photo === f ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
</div>
<label class="fl">Description<input name="spot_desc" maxlength="180" value="${esc(s.description || '')}" placeholder="What is included with this spot"></label></div>`;
}
function offeringForm({ action, hotel, spots, hours, account, error, lockedIds }) {
  const h = hotel || {};
  const locked = lockedIds || new Set();
  const rows = hours && hours.length ? hours : defaultHours();
  return `<form class="offer" id="settings" method="post" action="${esc(action)}">
${error ? `<div class="alert">${esc(error)}</div>` : ''}
<nav class="form-jumps"><a href="#sec-hotel">Hotel</a><a href="#sec-seating">Seating</a><a href="#sec-hours">Hours</a><a href="#sec-rules">Rules</a></nav>
<h2 id="sec-hotel">Hotel</h2>
<label class="fl">Hotel name<input name="hotel_name" required maxlength="80" value="${esc(h.name || '')}"></label>
<div class="two"><label class="fl">Neighbourhood<input name="area" required maxlength="60" value="${esc(h.area || '')}" placeholder="Eastern Beaches"></label>
<label class="fl">Contact name<input name="contact_name" maxlength="80" value="${esc(h.contact_name || '')}"></label></div>
<label class="fl">Contact email<input name="contact_email" type="email" maxlength="120" value="${esc(h.contact_email || '')}" placeholder="you@hotel.com"></label>
<label class="fl">Short line<input name="tagline" maxlength="140" value="${esc(h.tagline || '')}" placeholder="Heated pool above the beach"></label>
<label class="fl">About the pool<textarea name="blurb" maxlength="500" rows="3">${esc(h.blurb || '')}</textarea></label>
${account ? `<div class="two"><label class="fl">Username<input name="login" required maxlength="30" autocapitalize="none" value="${esc(h.login || '')}" placeholder="harbour-hotel"></label>
<label class="fl">Password<input name="password" type="password" required minlength="4" autocomplete="new-password"></label></div>
<p class="muted small">Demo only. This login is stored so you can open the dashboard. An admin approves the hotel before it appears on the site.</p>` : ''}
<h2 id="sec-seating">Seating</h2>
<p class="muted small lead-in">Sun lounger, daybed, cabana, pool chair, general entry, or your own name. Each one has its own price and a daily limit.</p>
<div id="spots">${spots.map((s, i) => spotCard(s, i, locked.has(s.id))).join('')}</div>
<p class="offer-actions"><button type="button" class="btn btn-line" id="add-spot">Add a seating type</button></p>
<template id="spot-tpl">${spotCard({ kind: 'lounger', name: 'Sun lounger', holds: 1, price: 45, daily_cap: 10, description: '' }, 0, false)}</template>
<h2 id="sec-hours">Hours</h2>
<p class="muted small lead-in">Every day starts open. Untick a day you are closed to day-pass guests, and set the times the pool is open.</p>
${DAY_ORDER.map(wd => {
    const r = rows.find(x => x.weekday === wd) || { open: 0, opens: '10:00', closes: '16:00' };
    return `<div class="hours-row"><input type="checkbox" name="day_open" value="${wd}" ${r.open ? 'checked' : ''} aria-label="${DAY_LONG[wd]} open"><span>${DAY_SHORT[wd]}</span>
<input type="time" name="opens_${wd}" value="${esc(r.opens || '10:00')}" aria-label="${DAY_LONG[wd]} opens"><input type="time" name="closes_${wd}" value="${esc(r.closes || '16:00')}" aria-label="${DAY_LONG[wd]} closes"></div>`;
  }).join('')}
<label class="fl">Same-day cutoff, hours before close<input name="cutoff_hours" type="number" min="0" max="24" step="1" value="${h.cutoff_hours ?? 2}" required></label>
<p class="muted small">0 means guests can book until the day-pass end. A later “room guests only” time brings that end forward.</p>
<details class="opt-fold" ${h.season_start ? 'open' : ''}><summary>Seasonal hours, optional</summary>
<div class="two"><label class="fl">Starts<input name="season_start" value="${esc(h.season_start || '')}" placeholder="12-01" inputmode="numeric"></label>
<label class="fl">Ends<input name="season_end" value="${esc(h.season_end || '')}" placeholder="03-31" inputmode="numeric"></label></div>
<div class="two"><label class="fl">Opens<input type="time" name="season_opens" value="${esc(h.season_opens || '')}"></label>
<label class="fl">Closes<input type="time" name="season_closes" value="${esc(h.season_closes || '')}"></label></div>
<p class="muted small">Month-day, so 12-01 is 1 December. Leave blank to use the weekly hours all year.</p></details>
<details class="opt-fold" ${h.room_only_from ? 'open' : ''}><summary>Room guests only, optional</summary>
<div class="two"><label class="fl">From<input type="time" name="room_only_from" value="${esc(h.room_only_from || '')}"></label>
<label class="fl">To<input type="time" name="room_only_to" value="${esc(h.room_only_to || '')}"></label></div>
<p class="muted small">Day passes stop when this block starts. Late access cannot overlap these hours. It is only available after the block ends, and only until the pool closes.</p></details>
<h2 id="sec-rules">Pool rules</h2>
<p class="muted small lead-in">Shown on the listing. Guests tick these rules before they book.</p>
<div class="two">${yn('heated', 'Heated', h.heated)}
<label class="fl">Setting<select name="setting"><option value="outdoor" ${h.setting === 'indoor' || h.setting === 'both' ? '' : 'selected'}>Outdoor</option><option value="indoor" ${h.setting === 'indoor' ? 'selected' : ''}>Indoor</option><option value="both" ${h.setting === 'both' ? 'selected' : ''}>Indoor and outdoor</option></select></label></div>
<div class="two"><label class="fl">Age policy<input name="age_policy" maxlength="120" value="${esc(h.age_policy || '')}" placeholder="All ages, or 18+"></label>
<label class="fl">Kids' hours<input name="kids_hours" maxlength="120" value="${esc(h.kids_hours || '')}" placeholder="All open hours, or until 2pm"></label></div>
<div class="two">${yn('towels', 'Towels included', h.towels)}${yn('id_required', 'Photo ID required', h.id_required !== 0)}</div>
<div class="two">${yn('lifeguard', 'Lifeguard on duty', h.lifeguard)}
<label class="fl">Food and drink<input name="food_rule" maxlength="160" value="${esc(h.food_rule || '')}" placeholder="Pool bar only"></label></div>
${account ? `<label class="tick"><input type="checkbox" name="marketing" value="1" ${h.marketing ? 'checked' : ''}> Email me about listing a hotel. Optional, and separate from this application.</label>
<p class="privacy-note">We use your name, email and login to review this application and reply to you. <a href="/privacy">Privacy policy</a></p>` : ''}
<div class="offer-save"><button class="btn btn-navy" type="submit">${account ? 'Submit for approval' : 'Save'}</button></div>
</form>
<script>
const KIND={lounger:'Sun lounger',daybed:'Daybed',cabana:'Cabana',chair:'Pool chair',entry:'General entry',custom:''};
const presets=Object.values(KIND).filter(Boolean);
function bind(card){const kind=card.querySelector('[name=kind]'),name=card.querySelector('[name=spot_name]');if(!kind||!name||kind.dataset.bound)return;kind.dataset.bound='1';kind.addEventListener('change',()=>{if(!name.value||presets.includes(name.value))name.value=KIND[kind.value]||'';});}
document.querySelectorAll('#spots .spot-card').forEach(bind);
const add=document.getElementById('add-spot');
if(add)add.addEventListener('click',()=>{const box=document.getElementById('spots');box.appendChild(document.getElementById('spot-tpl').content.cloneNode(true));const cards=box.querySelectorAll('.spot-card');const card=cards[cards.length-1];card.querySelector('.spot-top b').textContent='Seating '+cards.length;bind(card);});
document.getElementById('spots').addEventListener('click',e=>{const btn=e.target.closest('.remove-spot');if(!btn)return;if(document.querySelectorAll('#spots .spot-card').length<2)return;btn.closest('.spot-card').remove();});
</script>`;
}

const LIVE_LIST = `<script>
async function refreshToday(){
  const el=document.getElementById('today'); if(!el) return;
  try{
    const r=await fetch(el.dataset.live,{cache:'no-store'});
    if(!r.ok) return;
    const html=await r.text();
    if(html.trim()) el.outerHTML=html;
  }catch(e){}
}
setInterval(refreshToday,8000);
</script>`;

module.exports = {
  KINDS, PHOTOS, fmtTime, parseTime, minutes, spotLabel, hoursSummary, dayPlan, dayClosure, closureReason,
  rulesLines, rulesText, rulesCard, amenitiesFrom, slugify, hoursFor, blankJoin, readForm,
  writeOffering, saveOffering, offeringForm, echoForm, LIVE_LIST, safePhoto,
  listingHours, hoursView, syncHoursLabels, inSeason, latePossible, hotelLatePossible, lateWindow, syncLateAddons,
  cancelNote, riskLines, riskText, riskCard, riskTick, swimNote,
};
