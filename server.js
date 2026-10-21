const express = require('express');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { seed, ensureAddons, ensureSchedules } = require('./seed');
const { adminPassword, demoHotelPassword } = require('./passwords');
const { ymd, addDays, esc, money, nice } = require('./util');
const {
  KINDS, spotLabel, closureReason, rulesCard, rulesText, amenitiesFrom, slugify,
  hoursFor, hoursView, syncHoursLabels, blankJoin, readForm, writeOffering, saveOffering, offeringForm, echoForm, LIVE_LIST, safePhoto,
} = require('./offering');
const app = express();
const PORT = process.env.PORT || 3030;
const SECRET = process.env.COOKIE_SECRET || 'hdc-demo-secret';
const ADMIN_USER = 'jason';
const HOTEL_SHARE = 0.75;
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(SECRET));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/jsQR.js', (req, res) => {
  res.type('js');
  res.sendFile(require.resolve('jsqr'));
});

const today = () => ymd(new Date());
const hotelRow = h => h && ({ ...h, photos: JSON.parse(h.photos || '[]'), amenities: JSON.parse(h.amenities || '[]') });
const getHotels = () => db.prepare("SELECT * FROM hotels WHERE COALESCE(status,'active')='active' ORDER BY id").all().map(hotelRow);
const getHotel = slug => hotelRow(db.prepare('SELECT * FROM hotels WHERE slug=?').get(slug));
const publicHotel = slug => { const h = getHotel(slug); return h && (!h.status || h.status === 'active') ? h : null; };
const getPasses = hid => db.prepare('SELECT * FROM pass_types WHERE hotel_id=? ORDER BY sort, id').all(hid);
const isBlocked = (hid, date) => db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(hid, date);
const sold = (pid, date) => db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(pid, date).n;
function availability(hid, date) {
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(hid);
  const why = hotel ? closureReason(db, hotel, date) : null;
  const past = date < today();
  const rows = getPasses(hid).map(p => {
    const s = sold(p.id, date);
    return {
      id: p.id, code: p.code, name: p.name, kind: p.kind || '', holds: p.holds || 1,
      description: p.description || '', photo: p.photo || '', price: p.price, cap: p.daily_cap, sold: s,
      remaining: why || past ? 0 : Math.max(0, p.daily_cap - s), blocked: why, past,
    };
  });
  const capRow = !why && !past && db.prepare('SELECT cap FROM day_caps WHERE hotel_id=? AND date=?').get(hid, date);
  if (capRow) {
    const room = Math.max(0, capRow.cap - rows.reduce((s, p) => s + p.sold, 0));
    rows.forEach(p => { p.remaining = Math.min(p.remaining, room); });
    rows.day_left = room;
  }
  return rows;
}
const getAddons = (hid, enabledOnly = false) => db.prepare(`SELECT * FROM addons WHERE hotel_id=? ${enabledOnly ? 'AND enabled=1' : ''} ORDER BY sort, id`).all(hid);
const addonSold = (aid, date) => db.prepare("SELECT COALESCE(SUM(ba.qty),0) n FROM booking_addons ba JOIN bookings b ON b.id=ba.booking_id WHERE ba.addon_id=? AND b.date=? AND b.status!='cancelled'").get(aid, date).n;
function addonAvailability(hid, date) {
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(hid);
  const why = hotel ? closureReason(db, hotel, date) : null;
  const past = date < today();
  return getAddons(hid, true).map(a => {
    const s = addonSold(a.id, date);
    return { id: a.id, code: a.code, name: a.name, blurb: a.blurb, price: a.price, cap: a.daily_cap, per: a.per, sold: s,
      remaining: why || past ? 0 : Math.max(0, a.daily_cap - s) };
  });
}
function addonCodes(q) {
  const raw = q.addon;
  const list = raw == null || raw === '' ? [] : (Array.isArray(raw) ? raw : [raw]);
  return [...new Set(list.map(s => String(s).trim()).filter(Boolean))];
}
function chosenAddons(hid, date, people, q) {
  const rows = [];
  for (const code of addonCodes(q)) {
    const a = db.prepare('SELECT * FROM addons WHERE hotel_id=? AND code=? AND enabled=1').get(hid, code);
    if (!a) return { err: 'That add-on is not available.' };
    const qty = a.per === 'booking' ? 1 : people;
    const left = Math.max(0, a.daily_cap - addonSold(a.id, date));
    if (left < qty) return { err: left === 0 ? `${a.name} is sold out that day.` : `Only ${left} ${a.name} left that day.` };
    rows.push({ id: a.id, code: a.code, name: a.name, price: a.price, per: a.per, qty, line: a.price * qty });
  }
  return { addons: rows, addonTotal: rows.reduce((s, a) => s + a.line, 0) };
}
const bookingAddons = id => db.prepare('SELECT name, qty, unit_price, total FROM booking_addons WHERE booking_id=? ORDER BY name').all(id);
const newCode = () => { let c; do { c = 'HDC-' + (10000 + Math.floor(Math.random() * 90000)); } while (db.prepare('SELECT 1 FROM bookings WHERE code=?').get(c)); return c; };

const ICON = {
  search: '<svg class="ico sm" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg class="ico sm" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  lock: '<svg class="ico sm" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};
const LOGO = '<a class="logo" href="/"><img src="/assets/logo-mark.svg" alt="">Hotel Day <em>Club</em></a>';
function page(title, body, { nav = 'guest', bare = false } = {}) {
  const right = nav === 'hotel' ? '<a class="hotel-link show" href="/hotel/logout">Log out</a>'
    : nav === 'admin' ? '<a class="hotel-link show" href="/admin/logout">Log out</a>'
    : '<a class="hotel-link show" href="/hotel">Hotel login</a><a class="hotel-link show hide-sm" href="/admin">Admin</a>';
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Hotel Day Club</title><link rel="icon" href="/assets/logo-mark.svg"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"></head><body class="${nav === 'guest' ? 'guest' : ''}">
<div class="demo-banner">Demo site — listings are examples, no real bookings or payments.</div>
<header class="hdr"><div class="wrap hdr-in">${LOGO}
<nav class="hdr-nav"><a href="/how-it-works">How it works</a></nav>
<div class="hdr-right">${right}</div></div></header>
<main>${body}</main>
${bare ? '' : `<footer class="app-ftr"><div class="wrap ftr-in"><div>${LOGO}<p class="muted">Hotel life, by the day.</p></div>
<nav class="ftr-links"><a href="/#explore">Explore</a><a href="/how-it-works">How it works</a><a href="/hotel">Hotel login</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refunds">Refunds</a></nav>
<p class="muted small">Demo only. Hotels shown are fictional example listings with stock photos. No payments are taken.</p></div></footer>`}
</body></html>`;
}
const card = (h, date) => {
  const av = date ? availability(h.id, date) : null;
  const prices = getPasses(h.id).map(p => p.price);
  const from = prices.length ? Math.min(...prices) : 0;
  let spots = '';
  if (av) { const left = av.day_left != null ? av.day_left : av.reduce((a, p) => a + p.remaining, 0); spots = av[0] && av[0].blocked ? '<span class="spots out">Closed</span>' : left === 0 ? '<span class="spots out">Sold out</span>' : `<span class="spots">${left} left</span>`; }
  return `<a class="card" href="/h/${h.slug}${date ? '?date=' + date : ''}"><div class="ph"><img src="/assets/photos/${h.photos[0]}" alt="" loading="lazy"></div>
<div class="c-body"><div class="c-top"><h3>${esc(h.name)}</h3><span class="rate">New</span></div>
<div class="c-sub">${esc(h.area)}</div>
<div class="c-price">From <b>${money(from)}</b> ${spots}</div></div></a>`;
};
const WAVE = '<svg class="wave" viewBox="0 0 1440 72" preserveAspectRatio="none" aria-hidden="true"><path fill="#fff" d="M0 40c180 28 320-36 520-20s340 48 520 20 280-40 400-16V72H0Z"/></svg>';
const seatList = passes => `<div class="seat-list">${passes.map(p => `<div class="seat-row">${p.photo ? `<img src="/assets/photos/${esc(p.photo)}" alt="">` : '<div class="seat-ph"></div>'}
<div><b>${esc(spotLabel(p))}</b><div class="muted small">${esc(p.description || '')}</div></div>
<div class="seat-price"><b>${money(p.price)}</b><div class="muted small">${p.daily_cap} a day</div></div></div>`).join('')}</div>`;

app.get('/', (req, res) => {
  const hotels = getHotels();
  const areas = [...new Set(hotels.map(h => h.area))];
  const { where = '', date = '', kind = '' } = req.query;
  let list = hotels.filter(h => !where || h.area === where);
  if (kind) list = list.filter(h => {
    const spots = getPasses(h.id);
    if (!spots.some(p => p.kind === kind)) return false;
    if (!date) return true;
    return availability(h.id, date).some(p => p.kind === kind && p.remaining > 0);
  });
  const filtered = where || date || kind;
  const kinds = KINDS.filter(k => k.code !== 'custom');
  res.send(page('Hotel pools & spas by the day', `<section class="hero"><div class="hero-card" style="background-image:url(/assets/photos/beach-resort-pool.jpg)">
<span class="photo-credit">Stock photo · example listing</span>
<div class="hero-copy wrap"><h1>A hotel <em>day</em> out, minutes from home.</h1>
<p>A pool, daybed or spa. No room needed.</p></div>${WAVE}</div>
<div class="wrap search-wrap"><form class="search app-search" action="/#explore" method="get">
<div class="seg"><label for="w">Where</label><select id="w" name="where"><option value="">All of Sydney</option>${areas.map(a => `<option ${a === where ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
<div class="seg"><label for="d">When</label><input id="d" type="date" name="date" min="${today()}" value="${esc(date)}"></div>
<div class="seg"><label for="p">Seating</label><select id="p" name="kind"><option value="">Any seating</option>${kinds.map(k => `<option value="${k.code}" ${kind === k.code ? 'selected' : ''}>${k.name}</option>`).join('')}</select></div>
<button class="search-go" type="submit" aria-label="Search">${ICON.search}<span>Search</span></button></form></div></section>
<div class="wrap">
<section id="explore" class="sec"><div class="sec-row"><h2>${filtered ? `${list.length} place${list.length === 1 ? '' : 's'} ${where ? 'in ' + esc(where) : 'around Sydney'}${date ? ' on ' + esc(nice(date)) : ''}` : 'Pools to try this week'}</h2>${filtered ? '<a class="link" href="/#explore">Clear filters</a>' : ''}</div>
<div class="grid">${list.map(h => card(h, date)).join('') || '<p class="muted">Nothing matches. Try another date or seating.</p>'}</div></section>
<section id="how" class="sec how"><h2>Three steps</h2><div class="how-grid">
<div><span class="n">1</span><h3>Pick a pool</h3><p class="muted">Browse hotel pools, daybeds and spas across Sydney.</p></div>
<div><span class="n">2</span><h3>Choose your day</h3><p class="muted">See live spots left. Hotels cap numbers to keep it relaxed.</p></div>
<div><span class="n">3</span><h3>Show your QR</h3><p class="muted">Check in at reception, then the lounger is yours.</p></div></div>
<p class="how-more"><a class="link" href="/how-it-works">Read how it works</a></p></section></div>`));
});

app.get('/h/:slug', (req, res) => {
  const h = publicHotel(req.params.slug); if (!h) return res.status(404).send(page('Not found', '<div class="wrap sec"><h2>Listing not found</h2></div>'));
  const date = req.query.date && req.query.date >= today() ? req.query.date : today();
  const passes = getPasses(h.id);
  const from = passes.length ? Math.min(...passes.map(p => p.price)) : 0;
  const blocked = db.prepare('SELECT date FROM blocked_dates WHERE hotel_id=? AND date>=? ORDER BY date').all(h.id, today()).map(b => b.date);
  res.send(page(h.name, `<div class="wrap listing">
<div class="l-hd"><p class="eyebrow-s">Fictional demo listing</p><h1 class="l-title">${esc(h.name)}</h1>
<div class="muted l-meta">New · ${esc(h.area)} · ${esc(hoursView(db, h, date).hoursLine)}</div></div>
<div class="gallery">${h.photos.map((p, i) => `<img class="g${i}" src="/assets/photos/${p}" alt="">`).join('')}<span class="photo-credit">Stock photos · not this hotel</span></div>
<div class="l-body"><div class="l-main">
<h2>${esc(h.tagline)}</h2><p class="lead">${esc(h.blurb)}</p>
<h3 class="mt">What's included</h3><ul class="amen">${h.amenities.map(a => `<li>${ICON.check} ${esc(a)}</li>`).join('')}</ul>
<h3 class="mt">Seating</h3>${seatList(passes)}
${rulesCard(h, hoursView(db, h, date))}
</div>
<aside class="book-box" id="book"><form action="/checkout" method="get" id="bf">
<input type="hidden" name="hotel" value="${h.slug}">
<div class="bb-price">From <b>${money(from)}</b> <span class="muted">per spot</span></div>
<label class="fl">Date<input type="date" name="date" id="date" min="${today()}" max="${ymd(addDays(new Date(), 90))}" value="${date}" required></label>
<div id="status" class="status"></div>
<div class="pass-pick" id="passes"></div>
<label class="fl">How many<select name="qty" id="qty">${[1, 2, 3, 4, 5, 6].map(n => `<option>${n}</option>`).join('')}</select></label>
<details id="addon-block" class="addon-fold" hidden><summary><span>Add-ons</span><span class="muted" id="addon-sum">Optional</span></summary><div class="addon-pick" id="addons-pick"></div></details>
<div class="bb-total" id="total"></div>
<button class="btn btn-coral full" id="go" type="submit">Reserve</button>
<p class="muted small center">You won't be charged. Demo payment only.</p>
${blocked.length ? `<p class="muted small">Closed: ${blocked.map(nice).join(', ')}</p>` : ''}
</form></aside></div></div>
<script>
const $=s=>document.querySelector(s);let av=[],addons=[],dayLeft=null;
function fmt(n){return '$'+n.toLocaleString('en-AU')}
function h(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function label(p){return p.holds>1?p.name+' for '+p.holds:p.name}
function need(a,q,holds){return a.per==='booking'?1:q*(holds||1)}
function render(){const q=+$('#qty').value;const prevPass=document.querySelector('input[name=pass]:checked');
 $('#passes').innerHTML=av.map(p=>{const dis=p.remaining<q;const on=prevPass&&prevPass.value===p.code&&!dis;return '<label class="pp'+(dis?' dis':'')+'"><input type="radio" name="pass" value="'+p.code+'" '+(dis?'disabled':'')+(on?' checked':'')+'><span><b>'+h(label(p))+'</b><small>'+(p.remaining===0?'Sold out':p.remaining+' left')+'</small></span><b>'+fmt(p.price)+'</b></label>'}).join('');
 if(!document.querySelector('input[name=pass]:checked')){const f=document.querySelector('input[name=pass]:not([disabled])');if(f)f.checked=true}
 const c=document.querySelector('input[name=pass]:checked');const p=c&&av.find(x=>x.code===c.value);const holds=p?p.holds||1:1;
 const fold=$('#addon-block');const wasOpen=fold.open;
 const prev=[...document.querySelectorAll('#addons-pick input:checked')].map(i=>i.value);
 fold.hidden=!addons.length;
 $('#addons-pick').innerHTML=addons.map(a=>{const dis=a.remaining<need(a,q,holds);const on=!dis&&prev.indexOf(a.code)>=0;return '<label class="tog'+(dis?' dis':'')+'"><span><b>'+h(a.name)+'</b><small>'+(dis?'Sold out':fmt(a.price)+(a.per==='booking'?' per booking':' per person'))+'</small></span><input type="checkbox" name="addon" value="'+a.code+'" '+(dis?'disabled':'')+(on?' checked':'')+'></label>'}).join('');
 const picked=document.querySelectorAll('#addons-pick input:checked').length;
 fold.open=wasOpen||picked>0;const sum=$('#addon-sum');if(sum)sum.textContent=picked?picked+' selected':'Optional';
 let extra=0;document.querySelectorAll('#addons-pick input:checked').forEach(i=>{const a=addons.find(x=>x.code===i.value);if(a)extra+=a.price*need(a,q,holds)});
 const people=p?q*holds:q;
 $('#total').innerHTML=p?'<span>'+fmt(p.price)+' × '+q+(people>q?' · '+people+' people':'')+(extra?' + add-ons':'')+'</span><b>'+fmt(p.price*q+extra)+'</b>':'';
 $('#go').disabled=!p;$('#go').textContent=p?'Reserve':'Not available';
 const b=av[0]&&av[0].blocked;const raw=av.reduce((s,x)=>s+x.remaining,0);const total=dayLeft==null?raw:Math.min(raw,dayLeft);
 const st=$('#status');st.className='status'+(b||total===0?' out':'');
 st.textContent=b?b:total===0?'Sold out this day':total+' spots left';
 document.querySelectorAll('#passes input, #addons-pick input').forEach(r=>r.onchange=render)}
async function load(){const r=await fetch('/api/availability?hotel=${h.slug}&date='+$('#date').value);const data=await r.json();av=data.passes;addons=data.addons||[];dayLeft=data.day_left==null?null:data.day_left;render()}
$('#date').onchange=load;$('#qty').onchange=render;load();setInterval(load,15000);
</script>`));
});

app.get('/api/availability', (req, res) => {
  const h = publicHotel(req.query.hotel); if (!h) return res.status(404).json({ error: 'not found' });
  const date = req.query.date || today();
  const passes = availability(h.id, date);
  res.json({ hotel: h.slug, date, passes, day_left: passes.day_left ?? null, addons: addonAvailability(h.id, date) });
});

function validate(q) {
  const h = publicHotel(q.hotel); if (!h) return { err: 'Hotel not found.' };
  const date = String(q.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { err: 'Pick a date.', h };
  const qty = Math.max(1, Math.min(6, parseInt(q.qty, 10) || 1));
  const p = getPasses(h.id).find(x => x.code === q.pass); if (!p) return { err: 'Pick a seating type.', h };
  const a = availability(h.id, date).find(x => x.id === p.id);
  if (a.past) return { err: 'That date has passed.', h };
  if (a.blocked) {
    if (/same-day|closed for today/i.test(a.blocked)) return { err: a.blocked + '.', h };
    return { err: `${h.name} is closed on ${nice(date)} (${a.blocked}).`, h };
  }
  if (a.remaining < qty) return { err: a.remaining === 0 ? `${spotLabel(p)} is sold out on ${nice(date)}.` : `Only ${a.remaining} ${spotLabel(p)} left on ${nice(date)}.`, h };
  const people = qty * (Number(p.holds) || 1);
  const add = chosenAddons(h.id, date, people, q);
  if (add.err) return { err: add.err, h };
  return { h, p, date, qty, people, a, addons: add.addons, addonTotal: add.addonTotal };
}
const errPage = (v, res) => res.status(409).send(page('Not available', `<div class="wrap sec narrow"><div class="alert">${esc(v.err)}</div>${v.h ? `<a class="btn btn-navy" href="/h/${v.h.slug}">Back to ${esc(v.h.name)}</a>` : ''}</div>`));

app.get('/checkout', (req, res) => {
  const v = validate(req.query); if (v.err) return errPage(v, res);
  const { h, p, date, qty, people, a } = v;
  const grand = p.price * qty + v.addonTotal;
  const picked = new Set(v.addons.map(x => x.code));
  const offer = addonAvailability(h.id, date);
  const addonFields = offer.length ? `<details class="addon-fold"${picked.size ? ' open' : ''}><summary><span>Add-ons</span><span class="muted">${picked.size ? picked.size + ' selected' : 'Optional'}</span></summary><div class="addon-pick" id="co-addons">${offer.map(ad => {
    const need = ad.per === 'booking' ? 1 : people;
    const dis = ad.remaining < need;
    const on = !dis && picked.has(ad.code);
    return `<label class="tog${dis ? ' dis' : ''}"><span><b>${esc(ad.name)}</b><small>${dis ? 'Sold out' : `${money(ad.price)} ${ad.per === 'booking' ? 'per booking' : 'per person'}`}</small></span><input type="checkbox" name="addon" value="${esc(ad.code)}" data-price="${ad.price}" data-per="${esc(ad.per)}" ${dis ? 'disabled' : ''} ${on ? 'checked' : ''}></label>`;
  }).join('')}</div></details>` : '';
  res.send(page('Checkout', `<div class="wrap sec checkout">
<a class="link small" href="/h/${h.slug}?date=${date}">← Back to listing</a><h1 class="l-title">Confirm and pay</h1>
<div class="co-grid"><form class="co-form" method="post" action="/book">
${['hotel', 'date', 'qty'].map(k => `<input type="hidden" name="${k}" value="${esc(req.query[k])}">`).join('')}<input type="hidden" name="pass" value="${p.code}">
<h3>Your details</h3>
<label class="fl">Full name<input name="name" required autocomplete="name" placeholder="Alex Citizen"></label>
<div class="two"><label class="fl">Email<input name="email" type="email" required autocomplete="email" placeholder="alex@example.com"></label>
<label class="fl">Mobile<input name="phone" type="tel" required pattern="[0-9 +()-]{8,}" autocomplete="tel" placeholder="0412 345 678"></label></div>
${addonFields}
<div class="demo-pay"><div class="dp-head">${ICON.lock} <b>Demo payment, no charge</b></div>
<p class="small">This is a mock checkout. No card is needed and nothing is charged. In the live version this step is Stripe.</p>
<label class="fl">Card number<input value="4242 4242 4242 4242" disabled></label>
<div class="two"><label class="fl">Expiry<input value="12 / 30" disabled></label><label class="fl">CVC<input value="123" disabled></label></div></div>
${rulesCard(h, hoursView(db, h, date))}
<label class="tick"><input type="checkbox" name="rules" value="1" required> I've read and accept these pool rules.</label>
<label class="tick"><input type="checkbox" name="marketing" value="1"> Email me about day passes. Optional, and separate from this booking.</label>
<p class="privacy-note">We use your name, email and mobile to hold this booking and show it to the hotel. <a href="/privacy">Privacy policy</a></p>
<button class="btn btn-coral full" id="co-btn" type="submit">Confirm booking · ${money(grand)} (demo)</button></form>
<aside class="co-sum"><img src="/assets/photos/${h.photos[0]}" alt=""><div class="pad"><h3>${esc(h.name)}</h3><p class="muted small">${esc(h.area)}</p>
<dl><dt>Date</dt><dd>${esc(nice(date))}</dd><dt>Seating</dt><dd>${esc(spotLabel(p))} × ${qty}</dd><dt>People</dt><dd>${people}</dd><dt>Spots left</dt><dd>${a.remaining}</dd></dl>
<ul class="addon-lines" id="addon-lines">${v.addons.map(ad => `<li><span>${esc(ad.name)} × ${ad.qty}</span><b>${money(ad.line)}</b></li>`).join('')}</ul>
<div class="bb-total"><span>Total</span><b id="co-total">${money(grand)}</b></div><p class="muted small">Prices include GST. Demo only.</p></div></aside></div></div>
<script>
const pass=${p.price}, spots=${qty}, people=${people};
const fmt=n=>'$'+n.toLocaleString('en-AU');
function paint(){let extra=0;const lines=[];
 document.querySelectorAll('#co-addons input:checked').forEach(i=>{const price=+i.dataset.price,q=i.dataset.per==='booking'?1:people;extra+=price*q;lines.push('<li><span>'+i.parentElement.querySelector('b').textContent+' × '+q+'</span><b>'+fmt(price*q)+'</b></li>')});
 const total=pass*spots+extra;
 const box=document.getElementById('addon-lines'); if(box) box.innerHTML=lines.join('');
 const el=document.getElementById('co-total'); if(el) el.textContent=fmt(total);
 const btn=document.getElementById('co-btn'); if(btn) btn.textContent='Confirm booking · '+fmt(total)+' (demo)';
}
document.querySelectorAll('#co-addons input').forEach(i=>i.onchange=paint);paint();
</script>`));
});

app.post('/book', (req, res) => {
  const b = req.body;
  const name = String(b.name || '').trim(), email = String(b.email || '').trim(), phone = String(b.phone || '').trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || phone.replace(/\D/g, '').length < 8) return errPage({ err: 'Please enter your name, a valid email and a mobile number.', h: publicHotel(b.hotel) }, res);
  let code, v;
  db.transaction(() => {
    v = validate(b); if (v.err) return;
    if (b.rules !== '1' && b.rules !== 'on') { v = { err: 'Please accept the pool rules.', h: v.h }; return; }
    code = newCode();
    const seen = hoursView(db, v.h, v.date);
    const info = db.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,party,rules_ack_at,rules_text,marketing_opt_in)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),?,?)`)
      .run(code, v.h.id, v.p.id, v.date, v.qty, v.p.price, v.p.price * v.qty + v.addonTotal, name, email, phone, v.people, rulesText(v.h, seen), b.marketing === '1' ? 1 : 0);
    const insAdd = db.prepare('INSERT INTO booking_addons(booking_id,addon_id,name,qty,unit_price,total) VALUES (?,?,?,?,?,?)');
    for (const ad of v.addons) insAdd.run(info.lastInsertRowid, ad.id, ad.name, ad.qty, ad.price, ad.line);
  }).immediate();
  if (v.err) return errPage(v, res);
  res.redirect(303, '/booking/' + code);
});

const bookingFull = code => db.prepare(`SELECT b.*, h.name hotel, h.slug, h.area, h.photos, h.id hotel_id_join, p.name pass, p.holds FROM bookings b JOIN hotels h ON h.id=b.hotel_id JOIN pass_types p ON p.id=b.pass_type_id WHERE b.code=?`).get(code);
app.get('/booking/:code', async (req, res) => {
  const b = bookingFull(req.params.code.toUpperCase());
  if (!b) return res.status(404).send(page('Not found', '<div class="wrap sec"><h2>Booking not found</h2></div>'));
  const qr = await QRCode.toDataURL(`HDC:${b.code}`, { margin: 1, width: 260, color: { dark: '#0B2545' } });
  const adds = bookingAddons(b.id);
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(b.hotel_id);
  const view = hoursView(db, hotel, b.date);
  const when = view.span || view.hoursLine;
  const party = b.party || b.qty * (b.holds || 1);
  res.send(page('Booking ' + b.code, `<div class="wrap sec narrow confirm">
<div class="ok-badge">${ICON.check}</div><h1 class="l-title center">You're booked in.</h1>
<p class="center muted">We've sent the details to ${esc(b.email)} (demo: no email is actually sent).</p>
<div class="ticket"><div class="t-top"><img src="/assets/photos/${JSON.parse(b.photos)[0]}" alt=""><div><h3>${esc(b.hotel)}</h3><p class="muted small">${esc(b.area)}, Sydney</p></div></div>
<div class="t-mid"><img class="qr" src="${qr}" alt="QR code for ${b.code}"><div class="code">${b.code}</div><p class="muted small">Show this at reception</p></div>
<dl><dt>Guest</dt><dd>${esc(b.guest_name)}</dd><dt>Date</dt><dd>${esc(nice(b.date))}${when ? ` · ${esc(when)}` : ''}</dd><dt>Seating</dt><dd>${esc(spotLabel({ name: b.pass, holds: b.holds }))} × ${b.qty}</dd><dt>People</dt><dd>${party}</dd><dt>Paid</dt><dd>${money(b.total)} <span class="muted small">(demo, no charge)</span></dd><dt>Rules</dt><dd>${b.rules_ack_at ? 'Accepted' : '—'}</dd><dt>Status</dt><dd>${b.checked_in_at ? 'Checked in ' + esc(b.checked_in_at) : 'Confirmed'}</dd></dl>
${adds.length ? `<div class="ticket-adds"><b>Add-ons</b><ul>${adds.map(a => `<li><span>${esc(a.name)} × ${a.qty}</span><b>${money(a.total)}</b></li>`).join('')}</ul></div>` : ''}</div>
<div class="center" style="margin-top:20px"><a class="btn btn-line" href="/">Book another day</a></div></div>`));
});

const hotelAuth = (req, res, next) => { const id = req.signedCookies.hotel; const h = id && db.prepare('SELECT * FROM hotels WHERE id=?').get(id); if (!h) return res.redirect('/hotel/login'); req.hotel = hotelRow(h); next(); };
function joinPage(error, body) {
  const state = body ? echoForm(body) : blankJoin();
  return page('List a hotel', `<div class="wrap sec offer-page"><p class="eyebrow-s">For hotels</p>
<h1 class="l-title">List a hotel</h1>
<p class="lead">Free to list. Set your seating, hours and pool rules. This demo keeps a new hotel pending until an admin approves it.</p>
${offeringForm({ action: '/hotel/join', hotel: state.hotel, spots: state.spots, hours: state.hours, account: true, error })}
<p class="muted small">Already joined? <a href="/hotel/login">Hotel login</a></p></div>`);
}
app.get('/hotel/join', (req, res) => res.send(joinPage('', null)));
app.post('/hotel/join', (req, res) => {
  const b = req.body;
  const login = String(b.login || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const password = String(b.password || '');
  const email = String(b.contact_email || '').trim();
  let hid;
  try {
    hid = db.transaction(() => {
      const bad = msg => { const e = new Error(msg); e.validation = true; throw e; };
      if (login.length < 3) bad('Choose a username of at least 3 letters.');
      if (password.length < 4) bad('Choose a password of at least 4 characters.');
      if (!/^\S+@\S+\.\S+$/.test(email)) bad('Enter a contact email.');
      if (db.prepare('SELECT 1 FROM hotels WHERE login=?').get(login)) bad('That username is taken.');
      const parsed = readForm(b);
      if (parsed.err) bad(parsed.err);
      let slug = slugify(parsed.profile.name), n = 2; const base = slug;
      while (db.prepare('SELECT 1 FROM hotels WHERE slug=?').get(slug)) slug = (base + '-' + (n++)).slice(0, 48);
      const photo = parsed.spots.map(s => s.photo).find(Boolean) || 'beach-resort-pool.jpg';
      const photos = [...new Set([safePhoto(photo) || 'beach-resort-pool.jpg', 'hero-loungers.jpg', 'infinity-palms.jpg'])];
      const id = db.prepare(`INSERT INTO hotels(slug,name,area,tagline,blurb,photos,amenities,hours,rating,login,password,status,contact_name,contact_email,marketing_opt_in)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, parsed.profile.name, parsed.profile.area, parsed.profile.tagline, parsed.profile.blurb,
        JSON.stringify(photos), JSON.stringify(amenitiesFrom(parsed)), '', null, login, password, 'pending', parsed.profile.contact_name, email, b.marketing === '1' ? 1 : 0).lastInsertRowid;
      const saved = writeOffering(db, id, parsed);
      if (saved && saved.err) bad(saved.err);
      return id;
    })();
  } catch (e) {
    if (e.validation) return res.status(400).send(joinPage(e.message, b));
    if (/UNIQUE/i.test(e.message || '')) return res.status(400).send(joinPage('That username is taken.', b));
    throw e;
  }
  ensureAddons(db);
  res.cookie('hotel', hid, { signed: true, httpOnly: true, sameSite: 'lax' });
  res.redirect('/hotel?msg=' + encodeURIComponent('Thanks. Your hotel is pending approval.'));
});
const LEGAL_LINKS = '<p class="legal-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refunds">Refunds</a></p>';
app.get('/hotel/login', (req, res) => {
  res.send(page('Hotel login', `<div class="wrap sec narrow"><div class="login-card"><h1 class="l-title">Hotel login</h1>
${req.query.e ? '<div class="alert">Wrong username or password.</div>' : ''}
<form method="post" action="/hotel/login"><label class="fl">Username<input name="user" required autocomplete="username"></label><label class="fl">Password<input name="pass" type="password" required autocomplete="current-password"></label>
<button class="btn btn-navy full">Log in</button></form>
<p class="center" style="margin-top:16px"><a href="/hotel/join">List a hotel</a></p>
${LEGAL_LINKS}</div></div>`, { bare: true }));
});
app.post('/hotel/login', (req, res) => {
  const h = db.prepare('SELECT * FROM hotels WHERE login=? AND password=?').get(String(req.body.user || '').trim(), req.body.pass);
  if (!h) return res.redirect('/hotel/login?e=1');
  res.cookie('hotel', h.id, { signed: true, httpOnly: true, sameSite: 'lax' }); res.redirect('/hotel');
});
app.get('/hotel/logout', (req, res) => { res.clearCookie('hotel'); res.redirect('/hotel/login'); });

const stat = (label, val, sub = '') => `<div class="stat"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
function seatCell(b) {
  const label = spotLabel({ name: b.pass, holds: b.holds });
  const party = b.party || b.qty * (b.holds || 1);
  const rules = b.rules_ack_at ? `<div class="muted small" title="${esc(b.rules_text || '')}">Rules accepted</div>` : '';
  const adds = b.addons ? `<div class="muted small">${esc(b.addons)}</div>` : '';
  return `<td>${esc(label)} × ${b.qty}<div class="muted small">${party} ${party === 1 ? 'person' : 'people'}</div>${rules}${adds}</td>`;
}
const hhmm = s => String(s || '').slice(11, 16);
function withNotes(rows) {
  if (!rows.length || rows[0].notes) return rows;
  const notes = db.prepare(`SELECT * FROM guest_notes WHERE booking_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`).all(...rows.map(r => r.id));
  const by = new Map();
  for (const n of notes) { if (!by.has(n.booking_id)) by.set(n.booking_id, []); by.get(n.booking_id).push(n); }
  return rows.map(r => ({ ...r, notes: by.get(r.id) || [] }));
}
function noteLabel(n) {
  const label = n.kind === 'incident' ? 'Incident' : 'No-show';
  return `${label} ${hhmm(n.created_at)}${n.note ? ' · ' + n.note : ''}`;
}
function noteBits(b) { return (b.notes || []).map(n => `<div class="muted small">${esc(noteLabel(n))}</div>`).join(''); }
function logForm(b, redirect, log) {
  if (!log) return '';
  return `<details class="log-note"><summary>No-show or incident</summary><form method="post" action="/hotel/note"><input type="hidden" name="code" value="${esc(b.code)}"><input type="hidden" name="r" value="${esc(redirect)}"><input name="note" maxlength="200" placeholder="Optional note" autocomplete="off"><div class="log-actions"><button class="btn btn-line btn-sm" name="kind" value="no_show">No-show</button><button class="btn btn-line btn-sm" name="kind" value="incident">Incident</button></div></form></details>`;
}
const guestTable = (rows, { checkin = true, hotelCol = false, redirect = '/hotel', log = true } = {}) => {
  rows = withNotes(rows);
  return rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th>${hotelCol ? '<th>Hotel</th>' : ''}<th>Date</th><th>Guest</th><th>Seating</th><th>Spots</th><th>Total</th><th>Status</th></tr></thead><tbody>
${rows.map(b => `<tr><td><a class="link" href="/booking/${b.code}">${b.code}</a></td>${hotelCol ? `<td>${esc(b.hotel)}</td>` : ''}<td>${esc(nice(b.date))}</td><td><b>${esc(b.guest_name)}</b><div class="muted small">${esc(b.email)} · ${esc(b.phone)}</div></td>${seatCell(b)}<td>${b.qty}</td><td>${money(b.total)}</td>
<td>${b.status === 'cancelled' ? '<span class="pill out">Cancelled</span>' : b.checked_in_at ? `<span class="pill ok">Checked in ${esc(hhmm(b.checked_in_at))}</span>` : checkin && b.date === today() ? `<form method="post" action="/hotel/checkin"><input type="hidden" name="code" value="${b.code}"><input type="hidden" name="r" value="${esc(redirect)}"><button class="btn btn-sm btn-navy">Check in</button></form>` : '<span class="pill">Confirmed</span>'}${noteBits(b)}${logForm(b, redirect, log)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No guests.</p>';
};
const BQ = `SELECT b.*, p.name pass, p.holds, h.name hotel, (SELECT group_concat(ba.name || ' × ' || ba.qty, ', ') FROM booking_addons ba WHERE ba.booking_id=b.id) addons FROM bookings b JOIN pass_types p ON p.id=b.pass_type_id JOIN hotels h ON h.id=b.hotel_id`;
function guestCards(rows, { checkin = true, hotelCol = false, redirect = '/hotel', log = true } = {}) {
  rows = withNotes(rows);
  if (!rows.length) return '<p class="muted">No guests.</p>';
  return `<div class="guest-cards">${rows.map(b => {
    const label = spotLabel({ name: b.pass, holds: b.holds });
    const party = b.party || b.qty * (b.holds || 1);
    const rules = b.rules_ack_at ? '<div class="muted small">Rules accepted</div>' : '';
    const adds = b.addons ? `<div class="muted small">${esc(b.addons)}</div>` : '';
    const action = b.status === 'cancelled' ? '<span class="pill out">Cancelled</span>'
      : b.checked_in_at ? `<span class="pill ok">Checked in ${esc(hhmm(b.checked_in_at))}</span>`
      : checkin && b.date === today() ? `<form method="post" action="/hotel/checkin"><input type="hidden" name="code" value="${esc(b.code)}"><input type="hidden" name="r" value="${esc(redirect)}"><button class="btn btn-navy btn-check">Check in</button></form>`
      : '<span class="pill">Confirmed</span>';
    return `<article class="guest-card"><div class="guest-card-top"><div><b>${esc(b.guest_name)}</b><div class="muted small">${esc(b.code)}${hotelCol ? ' · ' + esc(b.hotel) : ''} · ${esc(nice(b.date))}</div></div><b>${money(b.total)}</b></div>
<p>${esc(label)} × ${b.qty} · ${party} ${party === 1 ? 'person' : 'people'}</p>${rules}${adds}${noteBits(b)}${action}${logForm(b, redirect, log)}</article>`;
  }).join('')}</div>`;
}
function guestList(rows, opts = {}) {
  rows = withNotes(rows);
  return `<div class="guests-wide">${guestTable(rows, opts)}</div><div class="guests-narrow">${guestCards(rows, opts)}</div>`;
}
function todaySection(h, { big = false, live = '/hotel/today-list' } = {}) {
  const rows = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? ORDER BY b.checked_in_at IS NOT NULL, b.guest_name`).all(h.id, today());
  const spots = rows.reduce((a, b) => a + b.qty, 0);
  const people = rows.reduce((a, b) => a + (b.party || b.qty * (b.holds || 1)), 0);
  const redirect = big ? '/hotel/checkin' : '/hotel';
  const body = big ? guestCards(rows, { redirect }) : guestList(rows, { redirect });
  return `<section id="today" class="panel" data-live="${esc(live)}"><h2 class="ph2">Today's guests <span class="muted small">${rows.length} booking${rows.length === 1 ? '' : 's'} · ${spots} spots · ${people} people</span> <a class="link small no-print" href="/hotel/print">Print list</a></h2>${body}</section>`;
}
function dashShell(h, inner, { here = '', live = false } = {}) {
  const links = [['/hotel#today', 'Today'], ['/hotel/checkin', 'Check in'], ['/hotel/settings', 'Settings'], ['/hotel#lookup', 'Lookup'], ['/hotel#upcoming', 'Upcoming'], ['/hotel#avail', 'Availability'], ['/hotel#addons', 'Add-ons'], ['/hotel#blocked', 'Blocked dates']];
  return page(h.name, `<div class="dash"><aside class="side"><div class="side-h"><span class="badge-inline">${h.status === 'pending' ? 'Pending approval' : 'Demo listing'}</span><h3>${esc(h.name)}</h3><p class="small">${esc(h.area)}</p></div>
<nav>${links.map(([href, label]) => `<a href="${href}" class="${here === href ? 'on' : ''}">${label}</a>`).join('')}${h.status === 'pending' ? '' : `<a href="/h/${h.slug}" target="_blank">View listing</a>`}</nav></aside>
<div class="dash-main">${h.status === 'pending' ? '<div class="pending-note"><b>Pending approval.</b> This hotel appears on the site once an admin approves it.</div>' : ''}${inner}</div></div>${live ? LIVE_LIST : ''}`, { nav: 'hotel', bare: true });
}

app.get('/hotel/today-list', hotelAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const big = req.query.view === 'checkin';
  res.send(todaySection(req.hotel, { big, live: big ? '/hotel/today-list?view=checkin' : '/hotel/today-list' }));
});
function checkinLookup(hotel, code) {
  const c = String(code || '').toUpperCase().trim();
  const b = c && db.prepare(`${BQ} WHERE b.code=? AND b.hotel_id=?`).get(c, hotel.id);
  if (!b) return { st: 'missing', code: c };
  if (b.status === 'cancelled') return { st: 'cancel', b, code: c };
  if (b.checked_in_at) return { st: 'used', b, code: c, at: hhmm(b.checked_in_at) };
  if (b.date !== today()) return { st: 'date', b, code: c };
  return { st: 'ready', b, code: c };
}
function statusBanner(hotel, q) {
  if (!q.st) return '';
  const info = checkinLookup(hotel, q.code);
  const box = (cls, title, sub) => `<div class="scan-status ${cls}"><b>${title}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  if (q.st === 'valid' && info.b && info.b.checked_in_at && info.st !== 'cancel' && info.b.date === today()) return box('valid', 'Valid', `Checked in ${info.b.guest_name}`);
  if (info.st === 'used') return box('used', `Already used at ${info.at}`, info.b.guest_name);
  if (info.st === 'date') return box('bad', 'Wrong date', `This pass is for ${nice(info.b.date)}`);
  if (info.st === 'cancel') return box('bad', 'Cancelled', info.b.guest_name);
  if (info.st === 'missing') return box('bad', 'Not found', info.code ? `No booking ${info.code} at this hotel.` : 'No booking at this hotel.');
  return '';
}
app.get('/hotel/checkin', hotelAuth, (req, res) => {
  const h = req.hotel;
  res.send(dashShell(h, `${statusBanner(h, req.query)}
<p class="eyebrow-s">Check in</p><h1 class="l-title">Today</h1>
<p class="muted">Scan the guest's QR, or type the code. New bookings show up on their own.</p>
<button type="button" class="btn btn-navy full" id="scan-btn">Scan QR</button>
<div class="scan-box" id="scan-box" hidden><video id="scan-video" playsinline muted></video><button type="button" class="btn btn-line full" id="scan-stop">Stop camera</button></div>
<p class="muted small" id="scan-note"></p>
<form class="lookup check-code" method="post" action="/hotel/checkin"><label class="fl">Booking code<input name="code" placeholder="HDC-12345" autocomplete="off" required></label><input type="hidden" name="r" value="/hotel/checkin"><button class="btn btn-navy">Check in</button></form>
${todaySection(h, { big: true, live: '/hotel/today-list?view=checkin' })}
<script src="/vendor/jsQR.js"></script><script src="/checkin.js"></script>`, { here: '/hotel/checkin', live: true }));
});
app.get('/hotel/settings', hotelAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM hotels WHERE id=?').get(req.hotel.id);
  const locked = new Set(db.prepare('SELECT DISTINCT pass_type_id id FROM bookings WHERE hotel_id=?').all(row.id).map(r => r.id));
  res.send(dashShell(req.hotel, `${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<p class="eyebrow-s">Settings</p><h1 class="l-title">Your offering</h1>
<p class="muted">Seating, hours and pool rules. Guests see this on the listing.</p>
${offeringForm({ action: '/hotel/settings', hotel: row, spots: getPasses(row.id), hours: hoursFor(db, row.id), lockedIds: locked, error: req.query.e || '' })}`, { here: '/hotel/settings' }));
});
app.post('/hotel/settings', hotelAuth, (req, res) => {
  const result = db.transaction(() => saveOffering(db, req.hotel.id, req.body))();
  if (result.err) return res.redirect('/hotel/settings?e=' + encodeURIComponent(result.err));
  const extra = result.kept && result.kept.length ? ' Kept seating that already has bookings: ' + result.kept.join(', ') + '.' : '';
  res.redirect('/hotel/settings?msg=' + encodeURIComponent('Saved. Guests see this on the listing.' + extra));
});

app.get('/hotel', hotelAuth, (req, res) => {
  const h = req.hotel, t = today(), q = String(req.query.q || '').trim();
  const todayRows = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? ORDER BY b.checked_in_at IS NOT NULL, b.guest_name`).all(h.id, t);
  const upcoming = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date>? ORDER BY b.date, b.guest_name LIMIT 60`).all(h.id, t);
  const found = q ? db.prepare(`${BQ} WHERE b.hotel_id=? AND (b.code LIKE ? OR b.guest_name LIKE ? OR b.email LIKE ? OR b.phone LIKE ?) ORDER BY b.date DESC LIMIT 30`).all(h.id, ...Array(4).fill('%' + q + '%')) : null;
  const s = db.prepare("SELECT COALESCE(SUM(qty),0) spots, COALESCE(SUM(COALESCE(party, qty)),0) people, COALESCE(SUM(total),0) gross, COUNT(*) n FROM bookings WHERE hotel_id=? AND status!='cancelled'").get(h.id);
  const s30 = db.prepare("SELECT COALESCE(SUM(total),0) gross FROM bookings WHERE hotel_id=? AND status!='cancelled' AND date>=?").get(h.id, ymd(addDays(new Date(), -30)));
  const inToday = todayRows.filter(b => b.checked_in_at).reduce((a, b) => a + b.qty, 0), dueToday = todayRows.reduce((a, b) => a + b.qty, 0);
  const passes = getPasses(h.id);
  const bySeat = db.prepare(`SELECT p.name, p.holds, COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN b.qty END),0) spots, COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN COALESCE(b.party, b.qty * p.holds) END),0) people
    FROM pass_types p LEFT JOIN bookings b ON b.pass_type_id=p.id AND b.hotel_id=? AND b.status!='cancelled' WHERE p.hotel_id=? GROUP BY p.id ORDER BY p.sort`).all(h.id, h.id);
  const addonGross = db.prepare("SELECT COALESCE(SUM(ba.total),0) n FROM booking_addons ba JOIN bookings b ON b.id=ba.booking_id WHERE b.hotel_id=? AND b.status!='cancelled'").get(h.id).n;
  const addonsAll = getAddons(h.id);
  const blocked = db.prepare('SELECT * FROM blocked_dates WHERE hotel_id=? AND date>=? ORDER BY date').all(h.id, t);
  const days = Array.from({ length: 14 }, (_, i) => ymd(addDays(new Date(), i)));
  const grid = Object.fromEntries(days.map(d => [d, availability(h.id, d)]));
  res.send(dashShell(h, `
${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<div class="dash-head"><div><p class="eyebrow-s">Hotel dashboard</p><h1 class="l-title">G'day, ${esc(h.name.replace(' (Demo)', ''))}</h1><p class="muted">${esc(nice(t))} · ${inToday} of ${dueToday} spots checked in today</p></div>
<a class="btn btn-navy" href="/hotel/checkin">Check in a guest</a></div>
${opsBar(h, passes)}
<div class="stats">${stat('Spots booked', s.spots, `${s.n} bookings · ${s.people} people`)}${stat('Gross sales', money(s.gross), `Includes ${money(addonGross)} add-ons · last 30 days ${money(s30.gross)}`)}${stat('Hotel share (75%)', money(s.gross * HOTEL_SHARE), 'Paid out to you')}${stat('Platform commission (25%)', money(s.gross * (1 - HOTEL_SHARE)), 'Hotel Day Club fee')}</div>
<div class="seat-stats">${bySeat.map(r => `<span><b>${esc(spotLabel(r))}</b> ${r.spots} booked · ${r.people} people</span>`).join('')}</div>
${todaySection(h)}
<section id="lookup" class="panel"><h2 class="ph2">Booking lookup</h2><form class="lookup" method="get" action="/hotel#lookup"><input name="q" value="${esc(q)}" placeholder="Booking code (HDC-12345), name, email or phone"><button class="btn btn-navy">${ICON.search} Find</button>${q ? '<a class="link" href="/hotel">Clear</a>' : ''}</form>
${found ? `<p class="muted small">${found.length} result${found.length === 1 ? '' : 's'} for “${esc(q)}”</p>${guestList(found, { redirect: '/hotel?q=' + encodeURIComponent(q) + '#lookup' })}` : ''}</section>
<section id="upcoming" class="panel"><h2 class="ph2">Upcoming guests</h2>${guestList(upcoming, { checkin: false })}</section>
<section id="avail" class="panel"><h2 class="ph2">Next 14 days</h2><div class="tbl-wrap"><table class="tbl avail"><thead><tr><th>Seating</th>${days.map(d => `<th>${nice(d).replace(' ', '<br>')}</th>`).join('')}</tr></thead><tbody>
${passes.map(p => `<tr><td><b>${esc(spotLabel(p))}</b><div class="muted small">cap ${p.daily_cap}</div></td>${days.map(d => { const a = grid[d].find(x => x.id === p.id); if (a.blocked) return `<td class="bl">${/same-day|closed for today/i.test(a.blocked) ? 'Cutoff' : 'Closed'}</td>`; return `<td class="${a.sold >= p.daily_cap ? 'full' : ''}">${a.sold}/${p.daily_cap}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="muted small">Booked out of the daily limit. Swipe sideways for later days.</p></section>
<section id="addons" class="panel"><h2 class="ph2">Add-ons</h2>
<p class="muted small">Optional extras. Turn one on, then set the price and how many you can take in a day.</p>
<form method="post" action="/hotel/addons"><div class="addon-edit">
${addonsAll.map(a => {
  const closed = closureReason(db, h, t);
  const left = a.enabled ? (closed ? 0 : Math.max(0, a.daily_cap - addonSold(a.id, t))) : null;
  return `<div class="addon-row"><label class="addon-on"><input type="checkbox" name="on" value="${a.id}" ${a.enabled ? 'checked' : ''}> Offer</label><div><b>${esc(a.name)}</b><div class="muted small">${esc(a.blurb)} · ${a.per === 'booking' ? 'per booking' : 'per person'}</div><div class="addon-nums"><label>Price<input class="num" type="number" min="0" step="1" name="aprice_${a.id}" value="${a.price}"></label><label>Each day<input class="num" type="number" min="0" step="1" name="acap_${a.id}" value="${a.daily_cap}"></label>${left == null ? '<span class="muted small">Off</span>' : `<span class="muted small">${left} left today</span>`}</div></div></div>`;
}).join('')}
</div><button class="btn btn-navy">Save add-ons</button></form></section>
<section id="blocked" class="panel"><div class="blk-head"><h2 class="ph2">Blocked dates</h2></div>
<p class="muted small">A closed day is blocked for day passes. Seating, hours and pool rules are in <a href="/hotel/settings">Settings</a>.</p>
<ul class="blk-list">${blocked.map(b => `<li><span><b>${esc(nice(b.date))}</b> <span class="muted">${esc(b.reason || 'Closed')}</span></span><span class="pill out">Closed</span></li>`).join('') || '<li class="muted">No blocked dates.</li>'}</ul>
<button type="button" class="btn btn-navy" id="open-block-cal">Manage blocked dates</button>
<dialog id="block-cal" class="cal-pop" aria-labelledby="block-cal-title" data-today="${t}" data-blocked="${esc(JSON.stringify(blocked.map(b => ({ date: b.date, reason: b.reason || '' }))))}"><form method="post" action="/hotel/blocked" id="block-cal-form">
<div class="cal-top"><button type="button" class="cal-nav" data-dir="-1" aria-label="Previous month">‹</button><h3 id="block-cal-title"></h3><button type="button" class="cal-nav" data-dir="1" aria-label="Next month">›</button></div>
<div class="block-cal" id="block-cal-grid" role="grid" aria-label="Blocked dates calendar"></div>
<p class="cal-legend"><span><i class="sw on"></i> Blocked</span><span><i class="sw today"></i> Today</span><span><i class="sw anchor"></i> Range start</span></p>
<p class="cal-count" id="block-cal-count"></p>
<p class="muted small" id="block-cal-hint"></p>
<label class="fl">Reason for new dates<input name="reason" maxlength="80" placeholder="Private event, pool maintenance" autocomplete="off"></label>
<input type="hidden" name="dates" id="block-cal-dates" value="">
<div class="cal-actions"><button type="button" class="btn btn-line" id="block-cal-cancel">Cancel</button><button class="btn btn-navy" type="submit">Save</button></div>
</form></dialog>
<script src="/block-cal.js"></script></section>`, { live: true }));
});
app.post('/hotel/checkin', hotelAuth, (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  let info = checkinLookup(req.hotel, code);
  if (info.st === 'ready') {
    db.prepare("UPDATE bookings SET checked_in_at=datetime('now','localtime') WHERE id=?").run(info.b.id);
    info = checkinLookup(req.hotel, code);
    info.st = 'valid';
  }
  const msg = info.st === 'valid' ? `Checked in ${info.b.guest_name} (${code}).`
    : info.st === 'used' ? `Already used at ${info.at}.`
    : info.st === 'date' ? `Wrong date. This pass is for ${nice(info.b.date)}.`
    : info.st === 'cancel' ? `${code} is cancelled.`
    : `No booking ${code} at this hotel.`;
  const r = String(req.body.r || '/hotel'); const safe = r.startsWith('/hotel') ? r : '/hotel';
  const [p, hash] = safe.split('#');
  if (p.startsWith('/hotel/checkin')) return res.redirect(303, `/hotel/checkin?st=${info.st}&code=${encodeURIComponent(code)}`);
  res.redirect(303, p + (p.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg) + (hash ? '#' + hash : ''));
});
app.post('/hotel/note', hotelAuth, (req, res) => {
  const kind = req.body.kind === 'incident' ? 'incident' : req.body.kind === 'no_show' ? 'no_show' : '';
  const code = String(req.body.code || '').toUpperCase().trim();
  const b = kind && db.prepare('SELECT id FROM bookings WHERE code=? AND hotel_id=?').get(code, req.hotel.id);
  const note = String(req.body.note || '').trim().slice(0, 200);
  if (b) db.prepare('INSERT INTO guest_notes(booking_id,hotel_id,kind,note) VALUES (?,?,?,?)').run(b.id, req.hotel.id, kind, note);
  const label = kind === 'incident' ? 'Incident' : 'No-show';
  const msg = b ? `${label} logged for ${code}.` : `No booking ${code} at this hotel.`;
  const r = String(req.body.r || '/hotel'); const safe = r.startsWith('/hotel') ? r : '/hotel';
  const [p, hash] = safe.split('#');
  res.redirect(303, p + (p.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg) + (hash ? '#' + hash : ''));
});
function pauseDate(hotelId, date, mode) {
  const existing = db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(hotelId, date);
  const drop = () => db.prepare('DELETE FROM blocked_dates WHERE hotel_id=? AND date=?').run(hotelId, date);
  if (mode === 'toggle' && existing && existing.reason === 'Paused') { drop(); return { ok: true, msg: `Resumed ${nice(date)}. Guests can book it again.` }; }
  if (existing && existing.reason !== 'Paused') return { ok: false, msg: `${nice(date)} is already closed (${existing.reason}).` };
  if (existing) return { ok: true, msg: `${nice(date)} is already paused.` };
  db.prepare("INSERT INTO blocked_dates(hotel_id,date,reason) VALUES (?,?, 'Paused')").run(hotelId, date);
  return { ok: true, msg: `Paused ${nice(date)}. Guests can no longer book it.` };
}
function capDate(hotelId, date, raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    db.prepare('DELETE FROM day_caps WHERE hotel_id=? AND date=?').run(hotelId, date);
    return `${nice(date)} has no extra cap.`;
  }
  const n = parseInt(text, 10);
  if (!Number.isFinite(n) || n < 0 || n > 999) return 'Enter a number of spots from 0 to 999.';
  db.prepare('INSERT OR REPLACE INTO day_caps(hotel_id,date,cap) VALUES (?,?,?)').run(hotelId, date, n);
  return `Capped ${nice(date)} at ${n} spots.`;
}
function opsBar(h, passes) {
  const t = today(), tmr = ymd(addDays(new Date(), 1));
  const reason = d => (db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(h.id, d) || {}).reason;
  const cap = db.prepare('SELECT cap FROM day_caps WHERE hotel_id=? AND date=?').get(h.id, t);
  const sum = passes.reduce((s, p) => s + p.daily_cap, 0);
  const btn = (when, label) => `<form method="post" action="/hotel/pause"><input type="hidden" name="when" value="${when}"><button class="btn btn-line">${label}</button></form>`;
  return `<div class="ops-bar">${btn('today', reason(t) === 'Paused' ? 'Resume today' : 'Pause today')}${btn('tomorrow', reason(tmr) === 'Paused' ? 'Resume tomorrow' : 'Pause tomorrow')}
<form method="post" action="/hotel/cap" class="ops-cap"><label>Cap today<input name="cap" type="number" min="0" max="999" value="${cap ? cap.cap : sum}" required></label><button class="btn btn-navy">Reduce spots</button></form>
${cap ? `<form method="post" action="/hotel/cap"><input type="hidden" name="cap" value=""><button class="btn btn-line">Remove cap</button></form>` : ''}
<span class="ops-links"><a href="/hotel/email-preview">Tonight's email</a><a href="/hotel/print">Print list</a></span></div>`;
}
app.post('/hotel/pause', hotelAuth, (req, res) => {
  const when = req.body.when === 'tomorrow' ? ymd(addDays(new Date(), 1)) : today();
  const result = pauseDate(req.hotel.id, when, 'toggle');
  res.redirect(303, '/hotel?msg=' + encodeURIComponent(result.msg));
});
app.post('/hotel/cap', hotelAuth, (req, res) => {
  const when = req.body.when === 'tomorrow' ? ymd(addDays(new Date(), 1)) : today();
  res.redirect(303, '/hotel?msg=' + encodeURIComponent(capDate(req.hotel.id, when, req.body.cap)));
});
function opsToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 14 * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}
function readOps(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}
app.get('/hotel/email-preview', hotelAuth, (req, res) => {
  const h = req.hotel, tmr = ymd(addDays(new Date(), 1));
  const rows = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? AND b.status!='cancelled' ORDER BY b.guest_name`).all(h.id, tmr);
  const spots = rows.reduce((s, b) => s + b.qty, 0);
  const sum = getPasses(h.id).reduce((s, p) => s + p.daily_cap, 0);
  const caps = [...new Set([8, Math.max(1, Math.round(sum / 2)), Math.max(1, sum - 4)].filter(n => n > 0 && n < sum))].sort((a, b) => a - b).slice(0, 3);
  const pause = opsToken({ h: h.id, a: 'pause', d: tmr });
  const capLinks = (caps.length ? caps : [Math.max(1, sum)]).map(n => `<a class="btn btn-line" href="/hotel/go/${opsToken({ h: h.id, a: 'cap', d: tmr, n })}">Cap at ${n}</a>`).join('');
  res.send(dashShell(h, `<p class="eyebrow-s">Tonight's email</p><h1 class="l-title">Guest list for ${esc(nice(tmr))}</h1>
<p class="muted">This is the note we would send the night before. The links work, and they stay valid for 14 days.</p>
<article class="email-card"><p class="muted small">To ${esc(h.contact_email || h.login)} · ${esc(h.name)}</p>
<h2>Tomorrow at the pool</h2>
<p>${rows.length} booking${rows.length === 1 ? '' : 's'} · ${spots} spots</p>
${rows.length ? `<ul class="email-guests">${rows.map(b => `<li><b>${esc(b.guest_name)}</b> <span class="muted">${esc(b.code)} · ${esc(spotLabel({ name: b.pass, holds: b.holds }))} × ${b.qty}${b.addons ? ' · ' + esc(b.addons) : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No day-pass guests tomorrow.</p>'}
<div class="email-acts"><a class="btn btn-navy" href="/hotel/go/${pause}">Pause tomorrow</a>${capLinks}<a class="btn btn-line" href="/hotel/print?date=${tmr}">Print this list</a></div>
</article>`, { here: '' }));
});
app.get('/hotel/go/:token', (req, res) => {
  const purpose = `${req.get('purpose') || ''} ${req.get('sec-purpose') || ''} ${req.get('sec-fetch-purpose') || ''}`.toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview') || req.get('sec-fetch-dest') === 'empty') return res.status(204).end();
  const data = readOps(req.params.token);
  const hotel = data && db.prepare('SELECT * FROM hotels WHERE id=?').get(data.h);
  if (!hotel || !/^\d{4}-\d{2}-\d{2}$/.test(data.d || '')) return res.status(400).send(page('Link expired', `<div class="wrap sec narrow"><h1 class="l-title">This link has expired</h1><p class="muted">Open tonight's email again from the dashboard, or <a href="/hotel/login">log in</a>.</p></div>`, { bare: true }));
  const msg = data.a === 'cap' ? capDate(hotel.id, data.d, data.n) : pauseDate(hotel.id, data.d, 'pause').msg;
  res.cookie('hotel', hotel.id, { signed: true, httpOnly: true, sameSite: 'lax' });
  res.send(page('Saved', `<div class="wrap sec narrow"><h1 class="l-title">${esc(msg)}</h1><p class="muted">${esc(hotel.name)} · ${esc(nice(data.d))}</p><p style="margin-top:18px"><a class="btn btn-navy" href="/hotel">Back to dashboard</a></p></div>`, { bare: true }));
});
app.get('/hotel/print', hotelAuth, (req, res) => {
  const h = req.hotel;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today();
  const rows = withNotes(db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? AND b.status!='cancelled' ORDER BY b.guest_name`).all(h.id, date));
  res.send(page('Guest list', `<div class="wrap sec print-sheet"><div class="no-print"><a class="link" href="/hotel">← Dashboard</a></div>
<h1 class="l-title">${esc(h.name)}</h1><p class="muted">${esc(nice(date))} · ${rows.length} booking${rows.length === 1 ? '' : 's'}</p>
<p class="no-print" style="margin:14px 0"><button class="btn btn-navy" type="button" onclick="print()">Print</button></p>
<div class="tbl-wrap"><table class="tbl print-list"><thead><tr><th></th><th>Guest</th><th>Code</th><th>Seating</th><th>People</th><th>Notes</th></tr></thead><tbody>
${rows.map(b => `<tr><td><span class="print-tick"></span></td><td><b>${esc(b.guest_name)}</b></td><td>${esc(b.code)}</td><td>${esc(spotLabel({ name: b.pass, holds: b.holds }))} × ${b.qty}</td><td>${b.party || b.qty * (b.holds || 1)}</td><td>${esc((b.notes || []).map(noteLabel).join('; '))}${b.addons ? ' ' + esc(b.addons) : ''}</td></tr>`).join('') || '<tr><td colspan="6">No guests.</td></tr>'}
</tbody></table></div></div>`, { nav: 'hotel', bare: true }));
});
app.post('/hotel/addons', hotelAuth, (req, res) => {
  const on = new Set((Array.isArray(req.body.on) ? req.body.on : req.body.on ? [req.body.on] : []).map(n => parseInt(n, 10)));
  const up = db.prepare('UPDATE addons SET enabled=?, price=?, daily_cap=? WHERE id=? AND hotel_id=?');
  db.transaction(() => getAddons(req.hotel.id).forEach(a => {
    const price = parseInt(req.body['aprice_' + a.id], 10), cap = parseInt(req.body['acap_' + a.id], 10);
    up.run(on.has(a.id) ? 1 : 0, Number.isFinite(price) ? Math.max(0, price) : a.price, Number.isFinite(cap) ? Math.max(0, cap) : a.daily_cap, a.id, req.hotel.id);
  }))();
  res.redirect(303, '/hotel?msg=' + encodeURIComponent('Add-ons saved. Guests see the changes straight away.') + '#addons');
});
app.post('/hotel/block', hotelAuth, (req, res) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) db.prepare('INSERT OR REPLACE INTO blocked_dates(hotel_id,date,reason) VALUES (?,?,?)').run(req.hotel.id, req.body.date, String(req.body.reason || 'Closed').slice(0, 80) || 'Closed');
  res.redirect(303, '/hotel?msg=' + encodeURIComponent('Blocked ' + nice(req.body.date) + '. Guests can no longer book it.') + '#blocked');
});
app.post('/hotel/unblock', hotelAuth, (req, res) => {
  db.prepare('DELETE FROM blocked_dates WHERE hotel_id=? AND date=?').run(req.hotel.id, req.body.date);
  res.redirect(303, '/hotel?msg=' + encodeURIComponent('Unblocked ' + nice(req.body.date) + '.') + '#blocked');
});
app.post('/hotel/blocked', hotelAuth, (req, res) => {
  const reason = String(req.body.reason || '').trim().slice(0, 80);
  const start = new Date();
  const horizon = ymd(new Date(start.getFullYear(), start.getMonth() + 19, 0));
  const todayStr = today();
  const dates = [...new Set(String(req.body.dates || '').split(',').map(s => s.trim()))]
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= todayStr && d <= horizon);
  const existing = db.prepare('SELECT date, reason FROM blocked_dates WHERE hotel_id=? AND date>=? AND date<=?').all(req.hotel.id, todayStr, horizon);
  const prev = new Map(existing.map(r => [r.date, r.reason || '']));
  const keep = new Set(dates);
  const del = db.prepare('DELETE FROM blocked_dates WHERE hotel_id=? AND date=?');
  const up = db.prepare('INSERT OR REPLACE INTO blocked_dates(hotel_id,date,reason) VALUES (?,?,?)');
  db.transaction(() => {
    for (const row of existing) if (!keep.has(row.date)) del.run(req.hotel.id, row.date);
    for (const d of dates) up.run(req.hotel.id, d, prev.has(d) ? (prev.get(d) || reason || 'Closed') : (reason || 'Closed'));
  })();
  const added = dates.filter(d => !prev.has(d)).length;
  const removed = existing.filter(r => !keep.has(r.date)).length;
  const bit = (n, verb) => `${verb} ${n} date${n === 1 ? '' : 's'}`;
  const msg = !added && !removed ? 'No changes to blocked dates.'
    : !added ? `${bit(removed, 'Unblocked')}. Guests can book those days again.`
    : !removed ? `${bit(added, 'Blocked')}. Guests can no longer book them.`
    : `${bit(added, 'Blocked')} and ${bit(removed, 'unblocked')}. Guests can no longer book closed days.`;
  res.redirect(303, '/hotel?msg=' + encodeURIComponent(msg) + '#blocked');
});

const adminAuth = (req, res, next) => req.signedCookies.admin === 'jason' ? next() : res.redirect('/admin/login');
app.get('/admin/login', (req, res) => res.send(page('Admin login', `<div class="wrap sec narrow"><div class="login-card"><h1 class="l-title">Admin login</h1>${req.query.e ? '<div class="alert">Wrong username or password.</div>' : ''}
<form method="post" action="/admin/login"><label class="fl">Username<input name="user" required autocomplete="username"></label><label class="fl">Password<input name="pass" type="password" required autocomplete="current-password"></label><button class="btn btn-navy full">Log in</button></form>
${LEGAL_LINKS}</div></div>`, { bare: true })));
app.post('/admin/login', (req, res) => {
  if (req.body.user !== ADMIN_USER || req.body.pass !== adminPassword()) return res.redirect('/admin/login?e=1');
  res.cookie('admin', 'jason', { signed: true, httpOnly: true, sameSite: 'lax' }); res.redirect('/admin');
});
app.get('/admin/logout', (req, res) => { res.clearCookie('admin'); res.redirect('/'); });
app.post('/admin/approve', adminAuth, (req, res) => {
  const id = parseInt(req.body.id, 10);
  const h = id && db.prepare('SELECT name FROM hotels WHERE id=? AND status=?').get(id, 'pending');
  if (h) db.prepare("UPDATE hotels SET status='active' WHERE id=?").run(id);
  res.redirect('/admin?msg=' + encodeURIComponent(h ? `Approved ${h.name}.` : 'Nothing to approve.'));
});
app.get('/admin', adminAuth, (req, res) => {
  const hid = parseInt(req.query.hotel) || 0, q = String(req.query.q || '').trim();
  const pending = db.prepare("SELECT * FROM hotels WHERE status='pending' ORDER BY id DESC").all();
  const per = db.prepare(`SELECT h.id, h.name, h.area, COUNT(b.id) n, COALESCE(SUM(b.qty),0) passes, COALESCE(SUM(b.total),0) gross,
    COALESCE(SUM(CASE WHEN b.date=? THEN b.qty END),0) today, COALESCE(SUM(CASE WHEN b.checked_in_at IS NOT NULL THEN b.qty END),0) checked
    FROM hotels h LEFT JOIN bookings b ON b.hotel_id=h.id AND b.status!='cancelled' WHERE COALESCE(h.status,'active')='active' GROUP BY h.id ORDER BY gross DESC`).all(today());
  const tot = per.reduce((a, r) => ({ n: a.n + r.n, passes: a.passes + r.passes, gross: a.gross + r.gross, today: a.today + r.today }), { n: 0, passes: 0, gross: 0, today: 0 });
  const addonAll = db.prepare("SELECT COALESCE(SUM(ba.total),0) n FROM booking_addons ba JOIN bookings b ON b.id=ba.booking_id WHERE b.status!='cancelled'").get().n;
  const where = [], args = []; if (hid) { where.push('b.hotel_id=?'); args.push(hid); } if (q) { where.push('(b.code LIKE ? OR b.guest_name LIKE ? OR b.email LIKE ?)'); args.push(...Array(3).fill('%' + q + '%')); }
  const rows = db.prepare(`${BQ} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.created_at DESC, b.id DESC LIMIT 100`).all(...args);
  const notes = db.prepare(`SELECT n.*, b.code, b.guest_name, b.date, h.name hotel FROM guest_notes n JOIN bookings b ON b.id=n.booking_id JOIN hotels h ON h.id=n.hotel_id ORDER BY n.id DESC LIMIT 40`).all();
  const pendingHtml = pending.map(h => {
    const spots = getPasses(h.id);
    return `<div class="pending-row"><div><b>${esc(h.name)}</b><div class="muted small">${esc(h.area)} · ${esc(h.contact_name || 'No contact name')} · ${esc(h.contact_email || '')}</div>
<div class="muted small">${esc(h.hours || '')}</div><div class="small">${spots.map(s => `${esc(spotLabel(s))} · ${money(s.price)} · ${s.daily_cap} a day`).join('<br>')}</div></div>
<form method="post" action="/admin/approve"><input type="hidden" name="id" value="${h.id}"><button class="btn btn-navy">Approve</button></form></div>`;
  }).join('');
  res.send(page('Admin', `<div class="wrap sec">
${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<p class="eyebrow-s">Platform admin · Jason</p><h1 class="l-title">All bookings</h1>
${pending.length ? `<section class="panel"><h2 class="ph2">Pending approval</h2>${pendingHtml}</section>` : ''}
<div class="stats">${stat('Bookings', tot.n, tot.passes + ' spots')}${stat('Gross sales', money(tot.gross), `Includes ${money(addonAll)} add-ons`)}${stat('Paid to hotels (75%)', money(tot.gross * HOTEL_SHARE))}${stat('Platform commission (25%)', money(tot.gross * (1 - HOTEL_SHARE)), 'Hotel Day Club revenue')}</div>
<p class="muted small" style="margin:-8px 0 16px">Gross includes add-ons. Commission stays at 25% of that gross.</p>
<section class="panel"><h2 class="ph2">By hotel</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Hotel</th><th>Bookings</th><th>Spots</th><th>Today</th><th>Gross</th><th>Hotel 75%</th><th>Commission 25%</th></tr></thead><tbody>
${per.map(r => `<tr><td><a class="link" href="/admin?hotel=${r.id}#all"><b>${esc(r.name)}</b></a><div class="muted small">${esc(r.area)}</div></td><td>${r.n}</td><td>${r.passes}</td><td>${r.today}</td><td>${money(r.gross)}</td><td>${money(r.gross * HOTEL_SHARE)}</td><td><b>${money(r.gross * (1 - HOTEL_SHARE))}</b></td></tr>`).join('')}
<tr class="tot"><td>Total</td><td>${tot.n}</td><td>${tot.passes}</td><td>${tot.today}</td><td>${money(tot.gross)}</td><td>${money(tot.gross * HOTEL_SHARE)}</td><td>${money(tot.gross * (1 - HOTEL_SHARE))}</td></tr></tbody></table></div></section>
<section class="panel" id="all"><h2 class="ph2">Latest bookings</h2><form class="lookup" method="get" action="/admin#all"><select name="hotel"><option value="">All hotels</option>${per.map(r => `<option value="${r.id}" ${r.id === hid ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select><input name="q" value="${esc(q)}" placeholder="Code, name or email"><button class="btn btn-navy">Filter</button></form>
${guestList(rows, { checkin: false, hotelCol: true, log: false })}<p class="muted small">Showing the latest ${rows.length} (max 100).</p></section>
<section class="panel"><h2 class="ph2">Guest notes</h2>${notes.length ? notes.map(n => `<div class="pending-row"><div><b>${n.kind === 'incident' ? 'Incident' : 'No-show'}</b> · ${esc(n.guest_name)} · ${esc(n.code)}<div class="muted small">${esc(n.hotel)} · ${esc(nice(n.date))} · ${esc(hhmm(n.created_at))}${n.note ? ' · ' + esc(n.note) : ''}</div></div></div>`).join('') : '<p class="muted">No notes yet. Hotels log a no-show or an incident from the guest list.</p>'}</section></div>`, { nav: 'admin' }));
});

app.get('/how-it-works', (req, res) => {
  res.send(page('How it works', `<div class="wrap hiw-hero">
<p class="eyebrow-s">How it works</p>
<h1 class="l-title">A hotel day, without the overnight.</h1>
<p class="lead">Book a hotel pool, daybed or spa for the day. No room needed. Hotels set their own seating, prices and how many guests they take.</p>
<p class="hiw-jumps"><a href="#guests">For guests</a><a href="#partners">For hotels</a><a href="#faq">Questions</a></p>
</div>
<div class="wrap hiw-block" id="guests">
<h2>For guests</h2>
<div class="how-grid">
<div><span class="n">1</span><h3>Browse</h3><p class="muted">Search by neighbourhood, date and seating. Each listing shows what's included, the pool rules, and how many spots are left.</p></div>
<div><span class="n">2</span><h3>Book</h3><p class="muted">Pick a sun lounger, daybed, cabana or whatever that hotel offers. Add parking, gym access or a food and drink credit if you want. Tick the pool rules. The total updates before you confirm. This demo doesn't charge a card.</p></div>
<div><span class="n">3</span><h3>Show your QR code</h3><p class="muted">At the front desk when the hotel opens for day passes. The hours are on your confirmation. Reception checks you in and hands you a wristband.</p></div>
<div><span class="n">4</span><h3>Enjoy</h3><p class="muted">Your spot, for the hours that hotel has set. Add-ons stay optional.</p></div>
</div>
<p style="margin-top:18px"><a class="btn btn-coral" href="/#explore">Browse pools</a></p>
</div>
${WAVE.replace('fill="#fff"', 'fill="#0B2545"').replace('class="wave"', 'class="wave wave-band"')}<section class="hiw-band" id="partners"><div class="wrap">
<h2>For hotels</h2>
<p class="hiw-lead">Free to list. You decide the seating, the prices and the numbers, and you get paid monthly.</p>
<div class="partner-grid">
<div class="partner-card"><b>Free to join</b><p>No signup fee and no monthly charge.</p></div>
<div class="partner-card"><b>You set the offering</b><p>Seating types, how many people each holds, daily numbers, hours and pool rules.</p></div>
<div class="partner-card"><b>Guest list the night before</b><p>We email the next day's guest list the evening before. The same list is on your dashboard, ready for check-in.</p></div>
<div class="partner-card"><b>You keep food and drink spend</b><p>What guests buy at your bar or café stays with you.</p></div>
<div class="partner-card"><b>Paid monthly</b><p>Seating and add-on sales are paid out once a month. You keep 75%. Hotel Day Club keeps 25%.</p></div>
</div>
<p class="hiw-cta"><a class="btn btn-coral" href="/hotel/join">List a hotel</a> <a class="btn btn-line" href="/hotel">Hotel login</a></p>
</div></section>
<div class="wrap hiw-block" id="faq">
<h2>Questions</h2>
<div class="faq">
<details open><summary>Cancellations</summary><p>Free cancellation up to 24 hours before (hotel terms apply).</p></details>
<details><summary>What to bring</summary><p>Photo ID when the hotel asks for it, swimwear and sunscreen. The listing says whether a towel is included.</p></details>
<details><summary>Age limits</summary><p>Each hotel sets its own age policy and kids' hours. They're on the listing, and you accept them at checkout.</p></details>
<details><summary>Weather</summary><p>Indoor pools and pools under a roof stay open in the rain. If a hotel has to close for weather, the day can be moved or the booking cancelled. Dates a hotel has blocked can't be booked.</p></details>
</div>
</div>`));
});

if (db.prepare('SELECT COUNT(*) n FROM hotels').get().n === 0) seed(db);
else ensureAddons(db);
ensureSchedules(db);
syncHoursLabels(db);
db.prepare("UPDATE hotels SET password=? WHERE login LIKE 'demo-%'").run(demoHotelPassword());
adminPassword();

function inlineMd(text) {
  let s = esc(text);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+?)([.,;:]?)(?=\s|$)/g, '$1<a href="$2">$2</a>$3');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}
function tableCells(row) {
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
function isRuleRow(row) {
  return tableCells(row).every(c => /^:?-+:?$/.test(c));
}
function mdToHtml(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let html = '', list = false, i = 0;
  const endList = () => { if (list) { html += '</ul>'; list = false; } };
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { endList(); i++; continue; }
    if (t === '---' || t === '***') { endList(); html += '<hr>'; i++; continue; }
    if (t.startsWith('>')) {
      endList();
      const parts = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        parts.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const paras = [];
      let buf = [];
      for (const part of parts) {
        if (!part) { if (buf.length) paras.push(buf.join(' ')); buf = []; }
        else buf.push(part);
      }
      if (buf.length) paras.push(buf.join(' '));
      html += `<blockquote>${paras.map(p => `<p>${inlineMd(p)}</p>`).join('')}</blockquote>`;
      continue;
    }
    if (t.startsWith('|')) {
      endList();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim());
      const head = tableCells(rows[0] || '');
      const body = rows.slice(1).filter(r => !isRuleRow(r));
      html += `<div class="tbl-wrap"><table><thead><tr>${head.map(c => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${tableCells(r).map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      endList();
      html += `<h${Math.min(4, h[1].length + 1)}>${inlineMd(h[2])}</h${Math.min(4, h[1].length + 1)}>`;
      i++;
      continue;
    }
    const li = t.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!list) { html += '<ul>'; list = true; }
      html += `<li>${inlineMd(li[1])}</li>`;
      i++;
      continue;
    }
    endList();
    html += `<p>${inlineMd(t)}</p>`;
    i++;
  }
  endList();
  return html;
}
function legalDoc(heading, file) {
  const raw = fs.readFileSync(path.join(__dirname, 'legal', file), 'utf8');
  return page(heading, `<div class="wrap sec"><h1 class="l-title">${esc(heading)}</h1><article class="legal-doc">${mdToHtml(raw)}</article></div>`);
}
app.get('/privacy', (req, res) => res.send(legalDoc('Privacy policy (draft)', 'privacy-policy.md')));
app.get('/terms', (req, res) => res.send(legalDoc('Customer terms (draft)', 'customer-terms.md')));
app.get('/refunds', (req, res) => res.send(legalDoc('Cancellation and refunds (draft)', 'cancellation-refund-policy.md')));

app.listen(PORT, () => console.log(`Hotel Day Club demo on http://localhost:${PORT}`));
