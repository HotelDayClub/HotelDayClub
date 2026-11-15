const { esc, money } = require('./util');
const { FOOD_RULE, FREE_CANCEL, KINDS, safePhoto, policyFacts, supervisionNote } = require('./offering');
const { seatPhoto } = require('./inclusions');
const { instantConfirmationText } = require('./siteMode');
const { MapEmbed } = require('./mapEmbed');
const { ListingImprove } = require('./listingImprove');
const { SearchQuery } = require('./search');
const { PhotoAssets } = require('./photoAssets');
const { SPRITE, icon } = require('./d2Icons');
const { ListingPanel } = require('./listingView');

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CUTOFF_REASON = /same-day|closed for today/i;
const LATE_NOTE = "This booking is inside 24 hours of the start, so it can't be cancelled for free.";
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const GROUPS = [
  { title: 'Day passes', kinds: ['lounger', 'chair', 'entry', 'custom'] },
  { title: 'Cabanas and daybeds', kinds: ['daybed', 'cabana'] },
];
const KIND_ORDER = KINDS.map(k => k.code);
const KIND_ALT = { lounger: 'sun lounger', daybed: 'daybed', cabana: 'cabana', chair: 'pool chair', entry: 'spa or pool entry', custom: 'pool pass' };
const AMENITY_ICON = { wifi: 'wifi', towels: 'towel', showers: 'shower', shower: 'shower', lockers: 'lock', luggage: 'bag', parking: 'car', pool: 'pool', spa: 'wave', sauna: 'wave', steam: 'wave', kids: 'family' };

class ListingD2 {
  static CHIPS = 14;
  static WINDOW = 90;
  static LATE_NOTE = LATE_NOTE;

  static parts(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) return null;
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return { y, m: m - 1, d, wd: dt.getUTCDay() };
  }

  static shift(iso, days) {
    const p = ListingD2.parts(iso);
    if (!p) return '';
    const dt = new Date(Date.UTC(p.y, p.m, p.d + days));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  static label(iso) {
    const p = ListingD2.parts(iso);
    return p ? `${WEEK[p.wd]} ${p.d} ${MONTH[p.m]}` : '';
  }

  static maxDate(todayIso) {
    return ListingD2.shift(todayIso, ListingD2.WINDOW);
  }

  static chipStart(todayIso, closed) {
    const reason = closed && closed[todayIso];
    return reason && CUTOFF_REASON.test(reason) ? ListingD2.shift(todayIso, 1) : todayIso;
  }

  static chipDays({ today, closed, late, selected }) {
    const start = ListingD2.chipStart(today, closed || {});
    const out = [];
    for (let i = 0; i < ListingD2.CHIPS; i++) {
      const date = ListingD2.shift(start, i);
      const p = ListingD2.parts(date);
      const reason = (closed && closed[date]) || '';
      out.push({
        date,
        wd: WEEK[p.wd],
        day: p.d,
        label: ListingD2.label(date),
        today: date === today,
        closed: Boolean(reason),
        reason,
        late: !reason && typeof late === 'function' ? Boolean(late(date)) : false,
        on: date === selected,
      });
    }
    return out;
  }

  static childrenLine(hotel) {
    const kids = String((hotel && hotel.kids_hours) || '').trim();
    if (!kids || /^all open hours/i.test(kids)) return '';
    return kids;
  }

  static hourGroups(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const groups = [];
    for (const row of list) {
      const last = groups[groups.length - 1];
      if (last && last.time === row.time) last.days.push(row.day);
      else groups.push({ time: row.time, days: [row.day] });
    }
    if (groups.length > 1 && groups[0].time === groups[groups.length - 1].time) {
      const tail = groups.pop();
      groups[0].days = tail.days.concat(groups[0].days);
    }
    const short = d => String(d).slice(0, 3);
    return groups.map(g => ({
      time: g.time,
      label: g.days.length === 1 ? short(g.days[0]) : g.days.length === 2 ? `${short(g.days[0])} and ${short(g.days[1])}` : `${short(g.days[0])} to ${short(g.days[g.days.length - 1])}`,
    }));
  }

  static hoursByWeekday(rows) {
    const out = {};
    for (const row of rows || []) {
      const wd = DAY_LONG.indexOf(row.day);
      if (wd >= 0 && row.time && row.time !== 'Closed') out[wd] = row.time;
    }
    return out;
  }

  static hoursFor(rows, iso) {
    const byDay = ListingD2.hoursByWeekday(rows);
    const p = ListingD2.parts(iso);
    if (p && byDay[p.wd]) return byDay[p.wd];
    const times = [...new Set(Object.values(byDay))];
    return times.length === 1 ? times[0] : '';
  }

  static towelChip(items, hotel) {
    const towel = (items || []).find(i => i.code === 'towels');
    if (towel && towel.mode === 'included') return 'Towels included';
    if (towel && towel.mode === 'off') return 'Bring your own towel';
    if (hotel && hotel.towels) return 'Towels included';
    return '';
  }

  static fitsLine(pass) {
    const holds = Number(pass && pass.holds) || 1;
    return `Fits ${holds}`;
  }

  static passGroups(passes) {
    const rank = kind => {
      const i = KIND_ORDER.indexOf(kind || 'custom');
      return i < 0 ? KIND_ORDER.length : i;
    };
    const known = new Set(GROUPS.flatMap(g => g.kinds));
    return GROUPS.map((g, gi) => ({
      title: g.title,
      passes: (passes || [])
        .filter(p => (gi === 0 ? !known.has(p.kind || 'custom') || g.kinds.includes(p.kind || 'custom') : g.kinds.includes(p.kind || 'custom')))
        .sort((a, b) => rank(a.kind) - rank(b.kind)),
    })).filter(g => g.passes.length);
  }

  static cardHref(slug, pass, { date, qty } = {}) {
    const params = new URLSearchParams();
    params.set('pass', pass.code);
    if (date) params.set('date', date);
    const n = SearchQuery.maxUnits(pass.holds);
    const q = parseInt(qty, 10);
    if (Number.isFinite(q) && q > 1 && q <= n) params.set('qty', String(q));
    return `/h/${encodeURIComponent(slug)}?${params.toString()}#book`;
  }

  static pickPass(passes, code) {
    const list = passes || [];
    return list.find(p => p.code === code) || list.find(p => p.featured) || list[0] || null;
  }

  static priceText(h, n) {
    return isDemo(h) ? `${money(n)} (demo)` : money(n);
  }
}

function isDemo(h) { return Number(h && h.is_demo) === 1; }
function shortName(h) { return String((h && h.name) || '').replace(/\s*\(Demo\)\s*$/, ''); }
function priceHtml(h, n) {
  return isDemo(h) ? `${esc(money(n))} <small>(demo)</small>` : esc(money(n));
}
function passPhoto(p) {
  const file = safePhoto(String(p.photo || ''));
  if (!file) return seatPhoto(p.kind || 'custom');
  return PhotoAssets.jpgUrl(file);
}
function passThumb(p, alt) {
  const file = safePhoto(String(p.photo || ''));
  if (!file) return `<img src="${esc(seatPhoto(p.kind || 'custom'))}" alt="${esc(alt)}" width="88" height="88" loading="lazy" decoding="async">`;
  return PhotoAssets.imgTag(file, { alt, width: 88, height: 88, sizes: '88px' });
}
function galleryPhoto(p, alt, i) {
  const file = String(p || '').trim();
  if (!file) return '';
  const load = i === 0 ? 'eager' : 'lazy';
  const fp = i === 0 ? 'high' : '';
  return PhotoAssets.imgTag(file, { alt, width: 1200, height: 900, sizes: '(max-width:390px) 100vw, (max-width:800px) 50vw, 800px', loading: load, fetchpriority: fp });
}
function passAlt(p, h) {
  const kind = KIND_ALT[p.kind] || 'day pass';
  return isDemo(h) ? `Example photo of a ${kind}, not this hotel` : `${kind} at ${shortName(h)}`;
}

function heroTowelChip(h) {
  const bring = h && (h.towels == null || Number(h.towels) === 0);
  const label = bring ? 'Bring your own towel' : 'Towels included';
  return `<ul class="d2-towel-chip" aria-label="Towels"><li>${icon('towel')}<span>${esc(label)}</span></li></ul>`;
}

function heroCopyHtml(h, heading, area, desc) {
  const demo = isDemo(h);
  return `<div class="d2-hero-copy" id="d2-hero-copy"><div class="d2-hero-in">
<p class="d2-hero-loc">${esc(area)}</p>
<h1 class="d2-hero-title">${esc(heading)}</h1>
${demo ? '<span class="d2-hero-tag">Fictional demo listing</span>' : ''}
<p class="d2-desc" id="d2-desc">${desc}</p>${heroTowelChip(h)}<button type="button" class="d2-rm text-link" id="d2-rm" aria-expanded="false" aria-controls="d2-desc" hidden>Read more</button>
</div></div>`;
}

function galleryHtml(h, hero) {
  const photos = Array.isArray(h.photos) ? h.photos : [];
  const n = photos.length;
  const demo = isDemo(h);
  const alt = demo ? 'Stock photo, not this hotel' : `Photo of ${shortName(h)}`;
  const strip = photos.map((p, i) => galleryPhoto(p, alt, i)).join('');
  const dots = n > 1 ? `<span class="d2-dots" aria-hidden="true">${photos.map((p, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</span>` : '';
  const count = n > 1 ? `<button type="button" class="d2-count" id="d2-count" aria-label="Photo 1 of ${n}, view all photos">${icon('photo')}<span>1 / ${n}</span></button>` : '';
  const credit = demo ? '<span class="d2-pill d2-lbl">Stock photos · not this hotel</span>' : '';
  const strong = n > 0 ? `<div class="d2-gw" id="d2-gw" role="group" aria-label="Photos, swipe for more" tabindex="0">${strip}</div>` : '';
  const copy = hero ? heroCopyHtml(h, hero.heading, hero.area, hero.desc) : '';
  return `<div class="d2-photos${n < 2 ? ' d2-solo' : ''}"><div class="d2-hero">${strong}${credit}${dots}${count}${copy}</div></div>
<dialog class="d2-lb" id="d2-lb" aria-label="Photos"><div class="d2-lb-bar"><p id="d2-lb-count" aria-live="polite">1 / ${n || 1}</p><button type="button" class="d2-lb-close" aria-label="Close photos">${icon('x')}</button></div><div class="d2-lb-stage"><button type="button" class="d2-lb-prev" aria-label="Previous photo">${icon('arrow', 'flip')}</button><img alt="${esc(alt)}" width="1200" height="900"><button type="button" class="d2-lb-next" aria-label="Next photo">${icon('arrow')}</button></div></dialog>`;
}

function passCard(p, h, items, opts) {
  const desc = String(p.description || '').trim();
  const href = ListingD2.cardHref(h.slug, p, { date: opts.date, qty: opts.qty });
  return `<a class="d2-card d2-row" href="${esc(href)}" data-pass="${esc(p.code)}">${passThumb(p, passAlt(p, h))}<div class="d2-card-body"><div class="d2-card-top"><b class="n">${esc(p.name)}</b><p class="pr">From ${priceHtml(h, p.price)}</p></div>${desc ? `<p>${esc(desc)}</p>` : ''}<p class="fit">${esc(ListingD2.fitsLine(p))}</p></div></a>`;
}

function chipHtml(c) {
  if (c.closed) {
    return `<button type="button" class="d2-d cl${c.on ? ' pk' : ''}" aria-disabled="true" aria-label="${esc(c.label)}, closed" data-date="${esc(c.date)}" data-reason="${esc(c.reason)}"><span class="w">${esc(c.wd)}</span><b>${c.day}</b><i>Closed</i></button>`;
  }
  return `<label class="d2-d${c.on ? ' on' : ''}"><input type="radio" name="date" value="${esc(c.date)}" aria-label="${esc(c.label)}${c.today ? ' (today)' : ''}"${c.on ? ' checked' : ''}${c.late ? ' data-late="1"' : ''} required><span class="w">${esc(c.wd)}</span><b>${c.day}</b>${c.today ? '<i>Today</i>' : ''}</label>`;
}

function holdHtml(hold) {
  if (!hold) return '';
  const links = (hold.links || []).map(link => `<a class="d2-alt" href="${esc(link.href)}">${esc(link.label)}</a>`).join('');
  const tail = links
    ? `<span class="d2-alts">${links}</span>`
    : `<span class="d2-none">${esc(hold.empty)} <a href="${esc(hold.listingHref)}">Back to ${esc(hold.hotelName)}</a></span>`;
  const when = hold.when ? `<b>${esc(hold.when)}</b>` : '';
  return `<div class="d2-note warn" id="d2-hold" role="alert" tabindex="-1" data-date="${esc(hold.date)}">${esc(hold.before)}${when}${esc(hold.after)} ${tail}</div>`;
}

function sheetHtml(o) {
  const { h, passes, items } = o;
  const days = o.days;
  const pick = o.pick;
  const date = o.date;
  const qty = o.qty;
  const hours = ListingD2.hoursFor(o.hourRows, date);
  const maxDate = o.maxDate;
  const kids = ListingD2.childrenLine(h);
  const chosen = days.find(c => c.on) || null;
  const outside = Boolean(date && !chosen && ListingD2.parts(date) && date >= o.today && date <= maxDate && !(o.closed && o.closed[date]));
  const extra = outside ? chipHtml({ date, wd: WEEK[ListingD2.parts(date).wd], day: ListingD2.parts(date).d, label: ListingD2.label(date), today: false, closed: false, late: Boolean(o.lateNote), on: true }) : '';
  const total = pick
    ? `${esc(pick.name)}${qty > 1 ? ` × ${qty}` : ''}${date ? ` · ${esc(ListingD2.label(date))}` : ''}`
    : '';
  const totalPrice = pick && date ? esc(ListingD2.priceText(h, pick.price * qty)) : 'Pick a date';
  const disabled = !pick || !date;
  const out = p => {
    if (!date || (o.closed && o.closed[date])) return false;
    const row = (o.av || []).find(r => r.code === p.code);
    return Boolean(row) && Number(row.remaining) < qty;
  };
  const tiles = passes.map(p => {
    const on = pick && p.code === pick.code;
    const off = out(p);
    return `<label class="d2-pt${on ? ' on' : ''}${off ? ' off' : ''}"><input type="radio" name="pass" value="${esc(p.code)}" data-name="${esc(p.name)}" data-price="${esc(p.price)}" data-holds="${esc(Math.max(1, Number(p.holds) || 1))}" data-fits="${esc(ListingD2.fitsLine(p))}" data-label="${esc(ListingD2.priceText(h, p.price))}"${on ? ' checked' : ''}${off ? ' disabled' : ''}>${PhotoAssets.imgTag(safePhoto(String(p.photo || '')), { alt: isDemo(h) ? 'Stock photo, not this hotel' : p.name, width: 120, height: 60, sizes: '120px', loading: 'lazy' })}<b>${esc(p.name)}</b><span>${off ? 'Sold out' : esc(ListingD2.priceText(h, p.price))}</span><i class="tk">${icon('tick')}</i></label>`;
  }).join('');
  const noJsDate = `<noscript><form class="d2-nojs" action="/h/${esc(encodeURIComponent(h.slug))}#book" method="get"><label>Another date<input type="date" name="date" min="${esc(o.today)}" max="${esc(maxDate)}" value="${esc(outside ? date : '')}"></label><input type="hidden" name="pass" value="${esc(pick ? pick.code : '')}"><input type="hidden" name="qty" value="${qty}"><button class="d2-btn out" type="submit">Use this date</button></form></noscript>`;
  return `<section class="d2-book" id="book" aria-labelledby="d2-book-h" tabindex="-1">
<form class="d2-form" id="d2-form" action="/checkout" method="get" data-slug="${esc(h.slug)}" data-min="${esc(o.today)}" data-max="${esc(maxDate)}" data-date="${esc(date)}" data-qty="${qty}" data-demo="${isDemo(h) ? '1' : '0'}" data-closed="${esc(JSON.stringify(o.closed || {}))}" data-hours="${esc(JSON.stringify(ListingD2.hoursByWeekday(o.hourRows)))}" data-max-people="${SearchQuery.BOOKING_SPOTS}">
<input type="hidden" name="hotel" value="${esc(h.slug)}">
<div class="d2-grab" aria-hidden="true"></div>
<div class="d2-top"><h2 id="d2-book-h">Book a pass</h2><button type="button" class="d2-x" id="d2-close" aria-label="Close" hidden>${icon('x')}</button></div>
${holdHtml(o.hold)}
<div class="d2-passblock" id="d2-passblock">
<span class="d2-lab" id="d2-pass-lab">Pass</span>
<div class="d2-pp" role="radiogroup" aria-labelledby="d2-pass-lab">${tiles}</div>
<p class="d2-fit" id="d2-fit">${icon('people')}<span id="d2-fit-t">${esc(pick ? ListingD2.fitsLine(pick) : '')}</span></p>
</div>
<div class="d2-passrow" id="d2-passrow" hidden><span class="d2-lab">Pass <small id="d2-passrow-t"></small></span><button type="button" class="d2-mdb text-link" id="d2-change">Change</button></div>
<div class="d2-lab d2-labrow"><span>Date <small id="d2-hrs">${hours ? `${esc(hours)}, hotel time` : 'Hotel time'}</small></span><button type="button" class="d2-mdb text-link" id="d2-more" aria-expanded="false" aria-controls="d2-calbox" hidden>${icon('cal')}<span>More dates</span></button></div>
<div class="d2-dates" id="d2-dates" role="group" aria-label="Date, next ${ListingD2.CHIPS} days">${days.map(chipHtml).join('')}${extra}</div>
<div class="d2-cal" id="d2-calbox" hidden></div>
<p class="d2-note" id="d2-closed" role="status" hidden></p>
<p class="d2-note warn" id="d2-late" role="status"${o.lateNote ? '' : ' hidden'}>${esc(o.lateNote || '')}</p>
${kids ? `<p class="d2-note kid" id="d2-kids"><b>Children</b> ${esc(kids)}</p>` : ''}
<span class="d2-lab" id="d2-spots-lab">Spots <small>up to ${SearchQuery.BOOKING_SPOTS} people</small></span>
<p class="d2-note" id="d2-cap" role="status" hidden>Up to 6 people per booking.</p>
<div class="d2-step" role="group" aria-labelledby="d2-spots-lab"><button type="button" class="d2-sb" id="d2-qminus" aria-label="Fewer spots" hidden>${icon('minus')}</button><input class="d2-qty" id="d2-qty" name="qty" type="number" inputmode="numeric" min="1" max="${SearchQuery.BOOKING_SPOTS}" value="${qty}" aria-label="Spots"><button type="button" class="d2-sb" id="d2-qplus" aria-label="More spots" hidden>${icon('plus')}</button></div>
<div class="d2-tot" aria-live="polite"><span id="d2-tot-l">${total}</span><b id="d2-tot-p">${totalPrice}</b></div>
<button class="d2-btn d2-go" id="d2-go" type="submit"${disabled ? ' aria-disabled="true"' : ''}>Book</button>
<p class="d2-demo">${isDemo(h) ? 'Demo: no charge.' : 'You will review the booking at checkout.'}</p>
</form>
${noJsDate}
</section>`;
}

function notIncludedChips(items) {
  return ListingImprove.notIncludedLines(items)
    .filter(line => line !== FOOD_RULE && !/available as an add-on/i.test(line));
}

function hoursBandHtml(h, o) {
  const items = o.items || o.included || [];
  const groups = ListingD2.hourGroups(o.hourRows || []);
  const open = groups.filter(g => g.time && g.time !== 'Closed');
  const uniform = open.length === 1 && groups.length === 1;
  const time = open.length === 1 ? open[0].time : '';
  const schedule = groups.map(g => `<div><dt>${esc(g.label)}</dt><dd>${esc(g.time)}</dd></div>`).join('');
  const rows = o.hourRows || [];
  const openDays = rows.filter(r => r.time && r.time !== 'Closed').map(r => r.day);
  const when = openDays.length === 7 ? 'Monday to Sunday. Hotel local time.' : 'Hotel local time.';
  const park = (items || []).find(i => i.code === 'parking' && i.mode !== 'off');
  const parkAddon = (o.addons || []).find(a => a.code === 'parking');
  let parkBlock = '';
  if (park && park.mode === 'included') {
    parkBlock = `<div class="d2-hb-park"><h3>Parking</h3><p class="d2-park-line"><span>${esc(String(park.note || '').trim() || 'Included with your pass')}</span></p></div>`;
  } else if (parkAddon) {
    parkBlock = `<div class="d2-hb-park"><h3>Parking</h3><p class="d2-park-line"><span>Paid extra, added at checkout</span><span class="r">${esc(ListingD2.priceText(h, parkAddon.price))}</span></p></div>`;
  }
  if (!groups.length && !parkBlock) return '';
  return `<div class="d2-hours-band"><div class="d2-hours-in">${groups.length ? `<div class="d2-hb-hours"><h3>Hours</h3>${time ? `<p class="d2-time">${esc(time)}</p>` : ''}${schedule ? `<dl class="d2-hb-schedule">${schedule}</dl>` : ''}<p class="d2-when">${esc(when)}</p></div>` : ''}${parkBlock}</div></div>`;
}

function policiesHtml(h) {
  const demo = isDemo(h);
  const facts = policyFacts(h);
  const watch = supervisionNote(h);
  const lifeguard = watch ? `${facts.lifeguard}. ${watch}` : facts.lifeguard;
  const age = String(h.age_policy || '').trim() || 'See the hotel';
  const kids = String(h.kids_hours || '').trim() || 'See the age line';
  const kidsVal = demo && /^all open hours/i.test(kids) ? `${esc(kids)} <span class="ex">example data</span>` : esc(kids);
  const id = Number(h.id_required) === 1
    ? 'Photo ID at check-in. The booking name must match a guest in your group.'
    : (demo ? 'Photo ID is not required in this demo.' : 'Photo ID is not required.');
  const dress = String(h.dress_code || '').trim() || 'Swimwear at the pool.';
  const policies = [
    ['Lifeguard', lifeguard],
    ['Pool', facts.pool],
    ['Heated', facts.heated],
    ['Ages', age],
    ['Children', kidsVal],
    ['ID', id],
    ['Dress', dress],
    ['Glass', 'Ask the hotel'],
  ];
  const kv = `<dl class="d2-kv">${policies.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${k === 'Children' ? kidsVal : esc(v)}</dd></div>`).join('')}</dl><div class="d2-links"><a href="/risk">${icon('warn')}Read the pool risk warning</a></div>`;
  return `<section class="d2-pol" aria-labelledby="d2-pol-h"><div class="d2-col d2-narrow"><h2 id="d2-pol-h">Guest policies</h2>${kv}</div></section>`;
}

function detailsHtml(o) {
  const { h, items } = o;
  const demo = isDemo(h);
  const address = String(h.address || '').trim();
  const mapsHref = MapEmbed.directionsUrl(h);
  const embed = MapEmbed.html(h);
  const placeholder = demo && !embed
    ? `<div class="d2-map" role="img" aria-label="Map placeholder (demo)"><svg viewBox="0 0 600 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="600" height="180" fill="#F5FAF9"/><path d="M0 120 C120 100 220 150 340 118 S520 90 600 110 V180 H0Z" fill="#DDF1EE"/><path d="M0 60 H600 M150 0 V180 M420 0 V180 M0 140 L600 30" stroke="#D9E6E4" stroke-width="6" fill="none"/><circle cx="300" cy="86" r="12" fill="#0B6E6F"/><circle cx="300" cy="86" r="5" fill="#fff"/></svg><span class="d2-pill">Map placeholder (demo)</span></div>`
    : '';
  const addr = address
    ? `<p class="d2-addr">${icon('pin')}<span>${esc(address)}${demo ? '<span class="d2-muted blk">This is a fictional demo address.</span>' : ''}</span></p>`
    : '';
  const location = `<div class="d2-block"><h3>Location</h3>${addr}${embed ? `<div class="d2-map d2-embed">${embed}</div>` : placeholder}${mapsHref ? `<a class="d2-btn out block" href="${esc(mapsHref)}" target="_blank" rel="noopener">${icon('nav')}Open in Google Maps</a>` : ''}</div>`;

  const groups = o.groups || { included: [], onsite: [] };
  const incRows = groups.included.filter(r => !/^towels?\b/i.test(String(r.label || '')));
  const row = r => `<li>${icon(AMENITY_ICON[r.icon] || 'check')}${esc(r.label)}</li>`;
  const included = incRows.length
    ? `<p class="d2-sub first">Included in your pass${demo ? ' <span class="ex">Example amenities (demo)</span>' : ''}</p><ul class="d2-inc">${incRows.map(row).join('')}</ul>`
    : `<p class="d2-muted">${esc(ListingImprove.includedEmptyCopy(false))}</p>`;
  const off = notIncludedChips(items);
  const onsiteList = groups.onsite.length
    ? `<ul class="d2-inc d2-os">${groups.onsite.map(r => `<li>${icon(AMENITY_ICON[r.icon] || 'pin')}${esc(r.label)}</li>`).join('')}</ul>`
    : '';
  const offLine = off.length ? `<p class="d2-os-note">Not included: ${esc(off.join(' · '))}</p>` : '';
  const onsiteBlock = (groups.onsite.length || off.length)
    ? `<h3>On site (not included)</h3>${onsiteList}${offLine}`
    : '';
  const extras = (o.addons || []).filter(a => a.code !== 'parking' && Number(a.price) > 0 && a.code !== 'late');
  const extraAddonIcon = code => {
    if (code === 'gym') return 'people';
    if (code === 'parking') return 'car';
    return 'plus';
  };
  const extraRows = extras.length
    ? `<h3>Extras</h3><ul class="d2-extra-list">${extras.map(a => `<li class="d2-extra"><span class="d2-extra-ico" aria-hidden="true">${icon(extraAddonIcon(a.code))}</span><span class="d2-extra-name">${esc(a.name)}</span><span class="d2-extra-pr">${priceHtml(h, a.price)}</span></li>`).join('')}</ul>`
    : '';
  const included3 = `<h3>What's included</h3>${included}${onsiteBlock}${extraRows}`;

  return `<section class="d2-s" id="details"><h2>Details</h2>${location}${included3}</section>`;
}

function bookBarHtml(fromHtml, dateLabel, qty) {
  return `<div class="d2-bookbar" role="region" aria-label="Book"><div class="d2-bookbar-in">
<p class="d2-bookbar-price">${fromHtml}</p>
<a class="d2-fake" href="#book" data-open="date"><span id="d2-bar-date">${esc(dateLabel)}</span>${icon('cal')}</a>
<a class="d2-fake" href="#book" data-open="spots"><span id="d2-bar-qty">${qty} (up to ${SearchQuery.BOOKING_SPOTS} people)</span>${icon('down')}</a>
<a class="d2-btn" href="#book" data-open="date">Check dates</a>
</div></div>`;
}

function goodToKnow(h) {
  const arrive = `Show your QR code at check-in. ${instantConfirmationText()}`;
  const demo = isDemo(h);
  return `<section class="d2-band" id="before" aria-labelledby="d2-gtk"><div class="d2-col">
<h2 id="d2-gtk">Good to know</h2>
<div class="d2-qa"><div><b>What happens when I arrive?</b><p>${esc(arrive)}</p><a href="/contact">Help when you need it</a></div></div>
<div class="d2-qa"><div><b>What's included?</b><p>Everything listed under Included in your pass.</p><p>${esc(FOOD_RULE)}</p></div></div>
<div class="d2-qa"><div><b>Can I cancel?</b><p>${esc(FREE_CANCEL)}</p><a href="/refunds">Cancellation and refund policy</a></div></div>
${demo ? '<p class="d2-contract">Example information for a fictional hotel. It is not a contract.</p>' : ''}
</div></section>`;
}

function listingHtmlD2(opts) {
  const { h } = opts;
  const demo = isDemo(h);
  const short = shortName(h);
  const heading = demo ? `${short} (Demo)` : short;
  const passes = Array.isArray(opts.passes) ? opts.passes : [];
  const items = Array.isArray(opts.included) ? opts.included : [];
  const today = opts.minDate || opts.today;
  const closed = opts.closed && typeof opts.closed === 'object' ? opts.closed : {};
  const maxDate = opts.maxDate || ListingD2.maxDate(today);
  const date = opts.date || '';
  const qty = Math.max(1, Math.min(SearchQuery.BOOKING_SPOTS, parseInt(opts.qty, 10) || 1));
  const days = ListingD2.chipDays({ today, closed, late: opts.late, selected: date });
  const pick = ListingD2.pickPass(passes, opts.passCode);
  const lateNote = date && typeof opts.late === 'function' && opts.late(date) ? (opts.lateNote || ListingD2.LATE_NOTE) : '';
  const from = passes.length ? Math.min(...passes.map(p => Number(p.price))) : 0;
  const cardOpts = { date, qty };
  const sections = ListingD2.passGroups(passes).map(g => `<h3 class="d2-group">${esc(g.title)}</h3><div class="d2-cards">${g.passes.map(p => passCard(p, h, items, cardOpts)).join('')}</div>`).join('');
  const sheet = sheetHtml({ ...opts, items, passes, days, pick, date, qty, today, maxDate, closed, lateNote });
  const dateLabel = date ? ListingD2.label(date) : 'Any date';
  const fromHtml = `From <b>${esc(money(from))}</b>${demo ? ' <small>(demo)</small>' : ''}`;
  const addressLine = String(h.area || '').trim();
  const desc = `<b>${esc(h.tagline)}.</b> ${esc(h.blurb)}`;
  return `<div class="d2 listing" id="d2-root">${SPRITE}
${galleryHtml(h, { heading, area: addressLine, desc })}
${bookBarHtml(fromHtml, dateLabel, qty)}
<div class="d2-tabs" id="d2-tabs"><div class="in"><nav aria-label="On this page"><a href="#passes" aria-current="true">Passes</a><a href="#details">Details</a></nav><a class="d2-datebtn" href="#book" id="d2-pill" data-open="date">${icon('cal')}<span id="d2-pill-t">${esc(dateLabel)}</span></a></div></div>
<div class="d2-layout"><div class="d2-col">
<section class="d2-head" id="overview" hidden aria-hidden="true"><p class="d2-title">${esc(heading)}</p>
<p class="d2-loc">${esc(addressLine)}</p>
${demo ? '<span class="d2-tag">Fictional demo listing</span>' : ''}
<p class="d2-desc">${desc}</p></section>
<section class="d2-s" id="passes"><h2>Passes</h2><p class="d2-muted">Price per spot.${demo ? ' Example photos.' : ''}</p>
<div class="d2-pass-groups">${sections}</div>
${sheet}
</section>
${detailsHtml({ ...opts, items })}
</div></div>
${hoursBandHtml(h, { ...opts, items })}
${policiesHtml(h)}
${goodToKnow(h)}
<div class="d2-bar" role="region" aria-label="Book"><p>${fromHtml}</p><a class="d2-btn d2-bar-btn" href="#book" data-open="date">Check dates</a></div>
</div>
${listingScriptD2(h.slug)}`;
}

function listingScriptD2(slug) {
  return `<script>
(function(){
var root=document.getElementById('d2-root');
if(!root) return;
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function $(s,r){return (r||document).querySelector(s)}
function $$(s,r){return [].slice.call((r||document).querySelectorAll(s))}
function offset(){
 var hdr=document.querySelector('.hdr');
 var h=hdr?Math.ceil(hdr.getBoundingClientRect().height):67;
 document.documentElement.style.setProperty('--d2-top',h+'px');
}
offset();
window.addEventListener('resize',offset);

var gw=$('#d2-gw'),lb=$('#d2-lb');
if(gw&&lb){
 var imgs=$$('img',gw),idx=0,from=null,shot=$('img',lb),cnt=$('#d2-lb-count');
 var dots=$$('.d2-dots i'),countBtn=$('#d2-count');
 var show=function(i){
  if(!imgs.length) return;
  idx=(i+imgs.length)%imgs.length;
  shot.src=imgs[idx].currentSrc||imgs[idx].src;
  cnt.textContent=(idx+1)+' / '+imgs.length;
 };
 var openLb=function(i,el){
  from=el||document.activeElement;
  show(i);
  if(!lb.open&&lb.showModal) lb.showModal();
  var c=$('.d2-lb-close',lb); if(c) c.focus();
 };
  imgs.forEach(function(img,i){img.addEventListener('click',function(){openLb(i,img)})});
  if(countBtn) countBtn.addEventListener('click',function(){openLb(0,countBtn)});
 $('.d2-lb-prev',lb).addEventListener('click',function(){show(idx-1)});
 $('.d2-lb-next',lb).addEventListener('click',function(){show(idx+1)});
 $('.d2-lb-close',lb).addEventListener('click',function(){lb.close()});
 lb.addEventListener('close',function(){if(from&&from.focus) from.focus()});
 lb.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'){e.preventDefault();show(idx+1)}
  else if(e.key==='ArrowLeft'){e.preventDefault();show(idx-1)}
  else if(e.key==='Tab'){
   var n=$$('button',lb).filter(function(b){return !b.disabled});
   if(!n.length) return;
   if(e.shiftKey&&document.activeElement===n[0]){e.preventDefault();n[n.length-1].focus()}
   else if(!e.shiftKey&&document.activeElement===n[n.length-1]){e.preventDefault();n[0].focus()}
  }
 });
 var sync=function(){
  var w=gw.clientWidth||1,i=Math.round(gw.scrollLeft/w);
  if(i<0) i=0; if(i>=imgs.length) i=imgs.length-1;
  dots.forEach(function(d,k){d.classList.toggle('on',k===i)});
  if(countBtn){
   var t=countBtn.querySelector('span'); if(t) t.textContent=(i+1)+' / '+imgs.length;
   countBtn.setAttribute('aria-label','Photo '+(i+1)+' of '+imgs.length+', view all photos');
  }
 };
 gw.addEventListener('scroll',sync,{passive:true});
}

var desc=$('#d2-desc'),rm=$('#d2-rm');
if(desc&&rm){
 var fitDesc=function(){
  if(rm.getAttribute('aria-expanded')==='true'){rm.hidden=false;return}
  desc.classList.add('is-clamped');
  rm.hidden=!(desc.scrollHeight>desc.clientHeight+1);
 };
 rm.addEventListener('click',function(){
  var open=rm.getAttribute('aria-expanded')==='true';
  rm.setAttribute('aria-expanded',open?'false':'true');
  rm.textContent=open?'Read more':'Read less';
  desc.classList.toggle('is-clamped',open);
  if(open) fitDesc();
 });
 fitDesc();
 window.addEventListener('resize',fitDesc);
 if(document.fonts&&document.fonts.ready) document.fonts.ready.then(fitDesc);
}

var tabs=$('#d2-tabs nav');
if(tabs){
 var links=$$('a',tabs);
 tabs.addEventListener('click',function(e){
  var a=e.target.closest('a'); if(!a) return;
  var el=document.querySelector(a.getAttribute('href')); if(!el) return;
  e.preventDefault();
  el.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});
  if(history.pushState) history.pushState(null,'',a.getAttribute('href'));
  links.forEach(function(l){if(l===a) l.setAttribute('aria-current','true'); else l.removeAttribute('aria-current')});
 });
 if('IntersectionObserver' in window){
  var secs=links.map(function(l){return document.querySelector(l.getAttribute('href'))}).filter(Boolean);
  var spy=new IntersectionObserver(function(){
   var best=null,line=Math.max(140,window.innerHeight*0.3);
   secs.forEach(function(s){if(s.getBoundingClientRect().top<=line) best=s});
   if(!best) best=secs[0];
   links.forEach(function(l){
    if(best&&l.getAttribute('href')==='#'+best.id) l.setAttribute('aria-current','true'); else l.removeAttribute('aria-current');
   });
  },{rootMargin:'0px 0px -40% 0px',threshold:[0,0.05,0.5,1]});
  secs.forEach(function(s){spy.observe(s)});
 }
}

var form=$('#d2-form'),book=$('#book');
if(!form||!book) return;
var slug=${JSON.stringify(String(slug || ''))};
var MIN=form.getAttribute('data-min'),MAX=form.getAttribute('data-max');
var PEOPLE=parseInt(form.getAttribute('data-max-people'),10)||6;
var closed={},hoursBy={};
var lastAvail=[];
try{closed=JSON.parse(form.getAttribute('data-closed')||'{}')}catch(e){}
try{hoursBy=JSON.parse(form.getAttribute('data-hours')||'{}')}catch(e){}
var demo=form.getAttribute('data-demo')==='1';
var WK=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var FULL=['January','February','March','April','May','June','July','August','September','October','November','December'];
function iso(y,m,d){return y+'-'+String(m+1).replace(/^(\\d)$/,'0$1')+'-'+String(d).replace(/^(\\d)$/,'0$1')}
function parse(s){var m=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s||'');return m?{y:+m[1],m:+m[2]-1,d:+m[3]}:null}
function wdOf(s){var p=parse(s);return new Date(Date.UTC(p.y,p.m,p.d)).getUTCDay()}
function label(s){var p=parse(s);return p?WK[wdOf(s)]+' '+p.d+' '+MON[p.m]:''}
function money(n){return '$'+(n%1?n.toFixed(2):n.toLocaleString('en-AU'))}

var chips=$$('.d2-d input',form);
chips.forEach(function(c){c.name='chip';c.required=false});
var hidden=document.createElement('input');
hidden.type='hidden';hidden.name='date';hidden.value=form.getAttribute('data-date')||'';
form.appendChild(hidden);
var tiles=$$('input[name="pass"]',form);
var qtyEl=$('#d2-qty'),go=$('#d2-go'),lateEl=$('#d2-late'),closedEl=$('#d2-closed');
var seq=0,soldAll=false,calOpen=false,viewY=0,viewM=0;
var today=parse(MIN);viewY=today.y;viewM=today.m;
$$('.d2-sb',form).forEach(function(b){b.hidden=false});
var moreBtn=$('#d2-more');moreBtn.hidden=false;
var x=$('#d2-close');
qtyEl.readOnly=true;

function picked(){return tiles.filter(function(t){return t.checked})[0]||null}
function holdsOf(t){return Math.max(1,parseInt(t&&t.getAttribute('data-holds'),10)||1)}
function unitCap(t){return Math.max(1,Math.floor(PEOPLE/holdsOf(t)))}
function stockCap(){var p=picked();if(!p||!lastAvail.length)return PEOPLE;var r=lastAvail.filter(function(x){return x.code===p.value})[0];if(!r||r.remaining==null)return unitCap(p);return Math.max(0,Math.min(unitCap(p),Number(r.remaining)||0))||1}
function maxQty(){var s=stockCap();return s<1?1:s}
function qty(){var m=maxQty(),n=parseInt(qtyEl.value,10);if(!n||n<1)n=1;if(n>m)n=m;return n}
function syncQtyCap(){
 var m=maxQty();qtyEl.max=String(Math.max(m,1));
 var q=qty();if(parseInt(qtyEl.value,10)!==q) qtyEl.value=q;
 var cap=$('#d2-cap'),p0=picked();if(cap) cap.hidden=!(p0&&unitCap(p0)<PEOPLE);
 var sq=$('#d2-side-qty');if(sq) sq.textContent=q+' (up to '+PEOPLE+' people)';
}
function note(el,text,show){el.textContent=text||'';el.hidden=!show}
function resetTiles(){
 tiles.forEach(function(t){
  t.disabled=false;t.parentNode.classList.remove('off');
  var sp=t.parentNode.querySelector('span');if(sp) sp.textContent=t.getAttribute('data-label');
 });
 soldAll=false;
}
function showClosed(s){
 resetTiles();
 var why=closed[s]||'Closed';
 closedEl.textContent=label(s)+' is closed ('+why+'). Pick another day.';
 closedEl.hidden=false;
}
function paint(){
 var p=picked(),d=hidden.value,q=qty();
 tiles.forEach(function(t){t.parentNode.classList.toggle('on',t.checked)});
 chips.forEach(function(c){c.parentNode.classList.toggle('on',c.checked)});
 $$('.d2-d.cl',form).forEach(function(b){b.classList.remove('pk')});
 if(d&&closed[d]){var ck=$('.d2-d.cl[data-date="'+d+'"]',form);if(ck) ck.classList.add('pk')}
 var fit=$('#d2-fit-t');if(fit&&p) fit.textContent=p.getAttribute('data-fits')||'';
 var pr=$('#d2-passrow-t');if(pr&&p) pr.textContent=p.getAttribute('data-name')+' · '+p.getAttribute('data-label');
 var l=$('#d2-tot-l'),v=$('#d2-tot-p');
 if(p){
  l.textContent=p.getAttribute('data-name')+(q>1?' × '+q:'')+(d?' · '+label(d):'');
  var price=parseFloat(p.getAttribute('data-price'))*q;
  v.textContent=d?(soldAll?'Sold out':money(price)+(demo?' (demo)':'')):'Pick a date';
 }
 var hrs=$('#d2-hrs');
 if(hrs){
  var t=d&&hoursBy[wdOf(d)];
  if(!t){var vals=[];for(var k in hoursBy){if(vals.indexOf(hoursBy[k])<0) vals.push(hoursBy[k])}t=vals.length===1?vals[0]:''}
  hrs.textContent=t?t+', hotel time':'Hotel time';
 }
 var ready=!!(p&&d&&!closed[d]&&!soldAll);
 if(ready) go.removeAttribute('aria-disabled'); else go.setAttribute('aria-disabled','true');
 var pill=$('#d2-pill-t'),sd=$('#d2-side-date'),sq=$('#d2-side-qty');
 var dl=d?label(d):'Any date';
 if(pill) pill.textContent=dl; if(sd) sd.textContent=dl;
 if(sq) sq.textContent=q+' (up to '+PEOPLE+' people)';
 var minus=$('#d2-qminus'),plus=$('#d2-qplus');
 syncQtyCap();
 q=qty();
 minus.setAttribute('aria-disabled',q<=1?'true':'false');
 plus.setAttribute('aria-disabled',q>=maxQty()?'true':'false');
}
function applyAvail(data,s){
 var rows=data.passes||[],q=qty(),any=false;
 lastAvail=rows;
 soldAll=false;
 tiles.forEach(function(t){
  var r=rows.filter(function(x){return x.code===t.value})[0];
  var rem=r?Number(r.remaining):0;
  var off=!r||rem<1;
  var partial=!off&&rem<q;
  t.disabled=off;
  t.parentNode.classList.toggle('off',off);
  var sp=t.parentNode.querySelector('span');
  if(sp) sp.textContent=partial?('Only '+rem+' left'):(off?'Sold out':t.getAttribute('data-label'));
  if(!off) any=true;
 });
 var p=picked();
 if(p&&p.disabled){
  var next=tiles.filter(function(t){return !t.disabled})[0];
  if(next) next.checked=true;
 }
 if(!any){soldAll=true;note(closedEl,'Sold out on '+label(s)+'. Pick another day.',true)}
 else if(!closed[s]) closedEl.hidden=true;
 var late=/can.t be cancelled for free/.test(data.cancel||'');
 note(lateEl,late?data.cancel:'',late);
 paint();
}
function check(){
 var d=hidden.value;
 if(!d||closed[d]){note(lateEl,'',false);return}
 var my=++seq;
 var p=picked();
 fetch('/api/availability?hotel='+encodeURIComponent(slug)+'&date='+encodeURIComponent(d)+'&qty='+qty()+'&pass='+encodeURIComponent(p?p.value:''))
  .then(function(r){if(!r.ok) throw new Error('x');return r.json()})
  .then(function(data){if(my===seq) applyAvail(data,d)})
  .catch(function(){});
}
function setDate(s,fromChip){
 hidden.value=s||'';
 var hold=$('#d2-hold');if(hold) hold.hidden=true;
 if(!s||closed[s]) resetTiles();
 if(!fromChip) chips.forEach(function(c){c.checked=(c.value===s)});
 soldAll=false;
 if(s&&closed[s]) showClosed(s); else closedEl.hidden=true;
 if(!s||closed[s]) note(lateEl,'',false);
 else if(chips.filter(function(c){return c.value===s&&c.getAttribute('data-late')==='1'}).length===0) note(lateEl,'',false);
 paint();
 check();
 if(calOpen) renderCal();
}
function bindChip(c){c.addEventListener('change',function(){if(c.checked) setDate(c.value,true)})}
chips.forEach(bindChip);
function ensureChip(s){
 if(!s||closed[s]||chips.filter(function(c){return c.value===s}).length) return;
 var p=parse(s),lab=document.createElement('label'),inp=document.createElement('input');
 lab.className='d2-d';
 inp.type='radio';inp.name='chip';inp.value=s;inp.setAttribute('aria-label',label(s));
 lab.appendChild(inp);
 lab.insertAdjacentHTML('beforeend','<span class="w">'+WK[wdOf(s)]+'</span><b>'+p.d+'</b>');
 $('#d2-dates').appendChild(lab);
 chips.unshift(inp);bindChip(inp);
 inp.checked=(hidden.value===s);
}
$$('.d2-d.cl',form).forEach(function(b){b.addEventListener('click',function(e){
 e.preventDefault();
 var s=b.getAttribute('data-date');
 showClosed(s);note(lateEl,'',false);
 $$('.d2-d.cl',form).forEach(function(o){o.classList.toggle('pk',o===b)});
 paint();
})});
tiles.forEach(function(t){t.addEventListener('change',function(){syncQtyCap();paint();check()})});
function stepQty(n){
 var q=Math.max(1,Math.min(maxQty(),qty()+n));
 qtyEl.value=q;syncQtyCap();paint();check();
}
$('#d2-qminus').addEventListener('click',function(){stepQty(-1)});
$('#d2-qplus').addEventListener('click',function(){stepQty(1)});

var cal=$('#d2-calbox');
function renderCal(){
 var first=new Date(Date.UTC(viewY,viewM,1)),lead=(first.getUTCDay()+6)%7;
 var days=new Date(Date.UTC(viewY,viewM+1,0)).getUTCDate();
 var minP=parse(MIN),maxP=parse(MAX);
 var prevOff=(viewY===minP.y&&viewM===minP.m),nextOff=(viewY===maxP.y&&viewM===maxP.m);
 var h='<div class="mh"><button type="button" class="nv" data-nav="-1" aria-label="Previous month"'+(prevOff?' aria-disabled="true"':'')+'><svg class="d2ic flip" aria-hidden="true"><use href="#d2-arrow"/></svg></button><b aria-live="polite">'+FULL[viewM]+' '+viewY+'</b><button type="button" class="nv" data-nav="1" aria-label="Next month"'+(nextOff?' aria-disabled="true"':'')+'><svg class="d2ic" aria-hidden="true"><use href="#d2-arrow"/></svg></button></div>';
 h+='<div class="wk" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="grid">';
 for(var i=0;i<lead;i++) h+='<span class="cd blank"></span>';
 for(var d=1;d<=days;d++){
  var s=iso(viewY,viewM,d),lab=label(s);
  if(s<MIN||s>MAX) h+='<span class="cd past" aria-hidden="true">'+d+'</span>';
  else if(closed[s]) h+='<button type="button" class="cd cl" aria-disabled="true" aria-label="'+lab+', closed" data-date="'+s+'">'+d+'</button>';
  else h+='<button type="button" class="cd'+(s===hidden.value?' on':'')+'" aria-pressed="'+(s===hidden.value?'true':'false')+'" aria-label="'+lab+'" data-date="'+s+'">'+d+'</button>';
 }
 h+='</div><p class="d2-hint">Bookable up to '+${ListingD2.WINDOW}+' days ahead. Dashed: closed.</p>';
 cal.innerHTML=h;
}
cal.addEventListener('click',function(e){
 var n=e.target.closest('[data-nav]');
 if(n){
  if(n.getAttribute('aria-disabled')==='true') return;
  viewM+=parseInt(n.getAttribute('data-nav'),10);
  if(viewM<0){viewM=11;viewY--} if(viewM>11){viewM=0;viewY++}
  renderCal();
  var again=$('[data-nav="'+n.getAttribute('data-nav')+'"]',cal);if(again) again.focus();
  return;
 }
 var b=e.target.closest('.cd[data-date]');
 if(!b) return;
 var s=b.getAttribute('data-date');
 if(closed[s]){
  showClosed(s);note(lateEl,'',false);paint();renderCal();
  var cb=$('.cd[data-date="'+s+'"]',cal);if(cb) cb.classList.add('pk');
  return;
 }
 setDate(s,false);
 var sel=$('.cd[data-date="'+s+'"]',cal);if(sel) sel.focus();
});
function toggleCal(on){
 calOpen=on;
 form.classList.toggle('is-more',on);
 cal.hidden=!on;
 $('#d2-dates').hidden=on;
 $('#d2-passrow').hidden=!on;
 moreBtn.setAttribute('aria-expanded',on?'true':'false');
 moreBtn.querySelector('span').textContent=on?'Next 14 days':'More dates';
 if(!on) ensureChip(hidden.value);
 if(on){
  var p=parse(hidden.value);
  if(!p||hidden.value<MIN||hidden.value>MAX) p=parse(MIN);
  viewY=p.y;viewM=p.m;
  renderCal();
 }
 paint();
}
moreBtn.addEventListener('click',function(){toggleCal(!calOpen)});
$('#d2-change').addEventListener('click',function(){toggleCal(false);var t=picked();if(t) t.focus()});
var inChips=chips.filter(function(c){return c.value===hidden.value}).length>0;
if(hidden.value&&!inChips&&!closed[hidden.value]) toggleCal(true);

var sheet=null,opener=null;
function ensureSheet(){
 if(sheet) return sheet;
 sheet=document.createElement('dialog');
 sheet.className='d2-sheet';
 sheet.id='d2-sheet';
 sheet.setAttribute('aria-labelledby','d2-book-h');
 book.parentNode.insertBefore(document.createComment('booking sheet'),book);
 sheet.appendChild(book);
 root.appendChild(sheet);
 sheet.addEventListener('close',function(){
  document.documentElement.classList.remove('d2-lock');
  if(x) x.hidden=true;
  if(opener&&opener.focus) opener.focus();
 });
 sheet.addEventListener('keydown',function(e){
  if(e.key!=='Tab') return;
  var n=$$('a[href],button,input,select,textarea',sheet).filter(function(el){
   if(el.disabled||el.hidden||el.closest('[hidden]')) return false;
   if(el.getAttribute('aria-disabled')==='true'&&el.tagName!=='BUTTON') return false;
   if(el.type==='radio'&&!el.checked&&$$('input[name="'+el.name+'"]',sheet).some(function(r){return r.checked})) return false;
   var b=el.getBoundingClientRect();return b.width>0||b.height>0;
  });
  if(!n.length) return;
  if(e.shiftKey&&document.activeElement===n[0]){e.preventDefault();n[n.length-1].focus()}
  else if(!e.shiftKey&&document.activeElement===n[n.length-1]){e.preventDefault();n[0].focus()}
 });
 sheet.addEventListener('click',function(e){if(e.target===sheet) sheet.close()});
 x.addEventListener('click',function(){sheet.close()});
 return sheet;
}
function selectPass(code){
 var t=tiles.filter(function(r){return r.value===code&&!r.disabled})[0];
 if(t){t.checked=true;paint();check()}
}
function openSheet(o){
 o=o||{};
 var s=ensureSheet();
 if(o.pass) selectPass(o.pass);
 if(!s.open&&s.showModal) s.showModal();
 document.documentElement.classList.add('d2-lock');
 book.scrollTop=0;s.scrollTop=0;
 if(x) x.hidden=false;
 var target=$('#d2-book-h');
 if(o.focus==='hold') target=$('#d2-hold')||target;
 if(target){target.setAttribute('tabindex','-1');target.focus()}
}
document.addEventListener('click',function(e){
 var a=e.target.closest('a[href*="#book"]');
 if(!a||e.defaultPrevented||e.metaKey||e.ctrlKey||e.shiftKey) return;
 var u;try{u=new URL(a.href,location.href)}catch(err){return}
 if(u.pathname!==location.pathname||u.hash!=='#book') return;
 e.preventDefault();
 opener=a;
 var pass=a.getAttribute('data-pass')||u.searchParams.get('pass')||'';
 openSheet({pass:pass,focus:a.getAttribute('data-open')||''});
});
go.addEventListener('click',function(e){
 if(go.getAttribute('aria-disabled')!=='true') return;
 e.preventDefault();
 if(!hidden.value){
  note(closedEl,'Pick a date to book.',true);
  var f=$('.d2-d input',form);if(f&&!calOpen) f.focus();
 }
});
form.addEventListener('submit',function(e){
 if(go.getAttribute('aria-disabled')==='true'||!hidden.value||!picked()){e.preventDefault();return}
 chips.forEach(function(c){c.disabled=true});
});
form.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target===qtyEl) e.preventDefault()});
var urlPass=new URL(location.href).searchParams.get('pass')||'';
chips.forEach(function(c){
 if(c.value===hidden.value) c.checked=true;
 else if(!hidden.value&&c.checked) hidden.value=c.value;
});
if(hidden.value&&closed[hidden.value]&&!$('#d2-hold')){var cd=hidden.value;hidden.value='';chips.forEach(function(c){c.checked=false});showClosed(cd)}
if(urlPass) selectPass(urlPass);
paint();
if(hidden.value&&!closed[hidden.value]) check();
function autoOpen(){
 if(location.hash!=='#book'&&!$('#d2-hold')) return;
 opener=$('#d2-pill')||document.querySelector('a[href*="#book"]')||null;
 var pass=new URL(location.href).searchParams.get('pass')||'';
 openSheet({pass:pass,focus:$('#d2-hold')?'hold':''});
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){setTimeout(autoOpen,0)});
else setTimeout(autoOpen,0);
var aliases={'#inclusions':'#details','#location':'#details','#policies':'#details','#seating':'#passes'};
function alias(){
 var to=aliases[location.hash];
 if(!to) return;
 var el=document.querySelector(to);if(!el) return;
 el.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});
 history.replaceState(null,'',location.pathname+location.search+to);
}
window.addEventListener('hashchange',alias);alias();
})();
</script>`;
}

module.exports = { listingHtmlD2, listingScriptD2, ListingD2, LATE_NOTE };
