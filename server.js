const express = require('express');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const path = require('path');
const db = require('./db');
const { seed, ensureAddons } = require('./seed');
const { ymd, addDays, esc, money, nice } = require('./util');
const app = express();
const PORT = process.env.PORT || 3030;
const SECRET = process.env.COOKIE_SECRET || 'hdc-demo-secret';
const ADMIN = { user: 'jason', pass: 'admin1234' };
const HOTEL_SHARE = 0.75;
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- data helpers ----------
const today = () => ymd(new Date());
const hotelRow = h => h && ({ ...h, photos: JSON.parse(h.photos), amenities: JSON.parse(h.amenities) });
const getHotels = () => db.prepare('SELECT * FROM hotels ORDER BY id').all().map(hotelRow);
const getHotel = slug => hotelRow(db.prepare('SELECT * FROM hotels WHERE slug=?').get(slug));
const getPasses = hid => db.prepare('SELECT * FROM pass_types WHERE hotel_id=? ORDER BY sort').all(hid);
const isBlocked = (hid, date) => db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(hid, date);
const sold = (pid, date) => db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(pid, date).n;
function availability(hid, date) {
  const blocked = isBlocked(hid, date);
  const past = date < today();
  return getPasses(hid).map(p => {
    const s = sold(p.id, date);
    return { id: p.id, code: p.code, name: p.name, price: p.price, cap: p.daily_cap, sold: s,
      remaining: blocked || past ? 0 : Math.max(0, p.daily_cap - s), blocked: blocked ? blocked.reason : null, past };
  });
}
const getAddons = (hid, enabledOnly = false) => db.prepare(`SELECT * FROM addons WHERE hotel_id=? ${enabledOnly ? 'AND enabled=1' : ''} ORDER BY sort, id`).all(hid);
const addonSold = (aid, date) => db.prepare("SELECT COALESCE(SUM(ba.qty),0) n FROM booking_addons ba JOIN bookings b ON b.id=ba.booking_id WHERE ba.addon_id=? AND b.date=? AND b.status!='cancelled'").get(aid, date).n;
function addonAvailability(hid, date) {
  const blocked = isBlocked(hid, date);
  const past = date < today();
  return getAddons(hid, true).map(a => {
    const s = addonSold(a.id, date);
    return { id: a.id, code: a.code, name: a.name, blurb: a.blurb, price: a.price, cap: a.daily_cap, per: a.per, sold: s,
      remaining: blocked || past ? 0 : Math.max(0, a.daily_cap - s) };
  });
}
function addonCodes(q) {
  const raw = q.addon;
  const list = raw == null || raw === '' ? [] : (Array.isArray(raw) ? raw : [raw]);
  return [...new Set(list.map(s => String(s).trim()).filter(Boolean))];
}
function chosenAddons(hid, date, guestQty, q) {
  const rows = [];
  for (const code of addonCodes(q)) {
    const a = db.prepare('SELECT * FROM addons WHERE hotel_id=? AND code=? AND enabled=1').get(hid, code);
    if (!a) return { err: 'That add-on is not available.' };
    const qty = a.per === 'booking' ? 1 : guestQty;
    const left = Math.max(0, a.daily_cap - addonSold(a.id, date));
    if (left < qty) return { err: left === 0 ? `${a.name} is sold out that day.` : `Only ${left} ${a.name} left that day.` };
    rows.push({ id: a.id, code: a.code, name: a.name, price: a.price, per: a.per, qty, line: a.price * qty });
  }
  return { addons: rows, addonTotal: rows.reduce((s, a) => s + a.line, 0) };
}
const bookingAddons = id => db.prepare('SELECT name, qty, unit_price, total FROM booking_addons WHERE booking_id=? ORDER BY name').all(id);
const newCode = () => { let c; do { c = 'HDC-' + (10000 + Math.floor(Math.random() * 90000)); } while (db.prepare('SELECT 1 FROM bookings WHERE code=?').get(c)); return c; };

// ---------- layout ----------
const ICON = {
  search: '<svg class="ico sm" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  star: '<svg class="ico sm" viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/></svg>',
  check: '<svg class="ico sm" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  pin: '<svg class="ico sm" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  lock: '<svg class="ico sm" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};
const LOGO = '<a class="logo" href="/"><img src="/assets/logo-mark.svg" alt="">Hotel Day <em>Club</em></a>';
function page(title, body, { nav = 'guest', bare = false } = {}) {
  const right = nav === 'hotel' ? '<a class="hotel-link show" href="/hotel/logout">Log out</a>'
    : nav === 'admin' ? '<a class="hotel-link show" href="/admin/logout">Log out</a>'
    : '<a class="hotel-link show" href="/hotel">Hotel login</a><a class="hotel-link show hide-sm" href="/admin">Admin</a>';
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Hotel Day Club</title><link rel="icon" href="/assets/logo-mark.svg"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"></head><body class="${nav === 'guest' ? 'guest' : ''}">
${nav === 'guest' ? '' : '<div class="concept"><b>Demo build</b> · fictional example listings, stock photos, no real payments</div>'}
<header class="hdr"><div class="wrap hdr-in">${LOGO}
<nav class="hdr-nav"><a href="/how-it-works">How it works</a></nav>
<div class="hdr-right">${right}</div></div></header>
<main>${body}</main>
${bare ? '' : `<footer class="app-ftr"><div class="wrap ftr-in"><div>${LOGO}<p class="muted">Hotel life, by the day.</p></div>
<nav class="ftr-links"><a href="/#explore">Explore</a><a href="/how-it-works">How it works</a><a href="/hotel">Hotel login</a></nav>
<p class="muted small">Demo only. Hotels shown are fictional example listings with stock photos; they don't represent any real Sydney hotel. No payments are taken.</p></div></footer>`}
</body></html>`;
}
const card = (h, date) => {
  const av = date ? availability(h.id, date) : null;
  const from = Math.min(...getPasses(h.id).map(p => p.price));
  let spots = '';
  if (av) { const left = av.reduce((a, p) => a + p.remaining, 0); spots = av[0].blocked ? '<span class="spots out">Closed</span>' : left === 0 ? '<span class="spots out">Sold out</span>' : `<span class="spots">${left} left</span>`; }
  return `<a class="card" href="/h/${h.slug}${date ? '?date=' + date : ''}"><div class="ph"><img src="/assets/photos/${h.photos[0]}" alt="" loading="lazy"></div>
<div class="c-body"><div class="c-top"><h3>${esc(h.name)}</h3><span class="rate">${ICON.star}${h.rating.toFixed(2)}</span></div>
<div class="c-sub">${esc(h.area)}</div>
<div class="c-price">From <b>${money(from)}</b> ${spots}</div></div></a>`;
};
const WAVE = '<svg class="wave" viewBox="0 0 1440 72" preserveAspectRatio="none" aria-hidden="true"><path fill="#fff" d="M0 40c180 28 320-36 520-20s340 48 520 20 280-40 400-16V72H0Z"/></svg>';

// ---------- guest ----------
app.get('/', (req, res) => {
  const hotels = getHotels();
  const areas = [...new Set(hotels.map(h => h.area))];
  const { where = '', date = '', pass = '' } = req.query;
  let list = hotels.filter(h => !where || h.area === where);
  if (pass) list = list.filter(h => !date || availability(h.id, date).find(p => p.code === pass && p.remaining > 0));
  const filtered = where || date || pass;
  res.send(page('Hotel pools & spas by the day', `<section class="hero"><div class="hero-card" style="background-image:url(/assets/photos/beach-resort-pool.jpg)">
<span class="photo-credit">Stock photo · not a partner hotel</span>
<div class="hero-copy wrap"><h1>A hotel <em>day</em> out, minutes from home.</h1>
<p>A pool, daybed or spa. No room needed.</p></div>${WAVE}</div>
<div class="wrap search-wrap"><form class="search app-search" action="/#explore" method="get">
<div class="seg"><label for="w">Where</label><select id="w" name="where"><option value="">All of Sydney</option>${areas.map(a => `<option ${a === where ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
<div class="seg"><label for="d">When</label><input id="d" type="date" name="date" min="${today()}" value="${esc(date)}"></div>
<div class="seg"><label for="p">Pass</label><select id="p" name="pass"><option value="">Any pass</option><option value="pool" ${pass === 'pool' ? 'selected' : ''}>Pool Pass</option><option value="daybed" ${pass === 'daybed' ? 'selected' : ''}>Pool + Daybed</option><option value="spa" ${pass === 'spa' ? 'selected' : ''}>Spa + Pool</option></select></div>
<button class="search-go" type="submit" aria-label="Search">${ICON.search}<span>Search</span></button></form></div></section>
<div class="wrap">
<section id="explore" class="sec"><div class="sec-row"><h2>${filtered ? `${list.length} place${list.length === 1 ? '' : 's'} ${where ? 'in ' + esc(where) : 'around Sydney'}${date ? ' on ' + esc(nice(date)) : ''}` : 'Pools to try this week'}</h2>${filtered ? '<a class="link" href="/#explore">Clear filters</a>' : ''}</div>
<div class="grid">${list.map(h => card(h, date)).join('') || '<p class="muted">Nothing matches. Try another date or pass.</p>'}</div></section>
<section id="how" class="sec how"><h2>Three steps</h2><div class="how-grid">
<div><span class="n">1</span><h3>Pick a pool</h3><p class="muted">Browse hotel pools, daybeds and spas across Sydney.</p></div>
<div><span class="n">2</span><h3>Choose your day</h3><p class="muted">See live spots left. Hotels cap numbers so it never feels crowded.</p></div>
<div><span class="n">3</span><h3>Show your QR</h3><p class="muted">Check in at reception, then the lounger is yours.</p></div></div>
<p class="how-more"><a class="link" href="/how-it-works">Read how it works</a></p></section></div>`));
});

app.get('/h/:slug', (req, res) => {
  const h = getHotel(req.params.slug); if (!h) return res.status(404).send(page('Not found', '<div class="wrap sec"><h2>Listing not found</h2></div>'));
  const date = req.query.date && req.query.date >= today() ? req.query.date : today();
  const passes = getPasses(h.id);
  const blocked = db.prepare('SELECT date FROM blocked_dates WHERE hotel_id=? AND date>=? ORDER BY date').all(h.id, today()).map(b => b.date);
  res.send(page(h.name, `<div class="wrap listing">
<div class="l-hd"><p class="eyebrow-s">Fictional demo listing</p><h1 class="l-title">${esc(h.name)}</h1>
<div class="muted l-meta">${ICON.star} ${h.rating.toFixed(2)} · ${esc(h.area)} · ${esc(h.hours)}</div></div>
<div class="gallery">${h.photos.map((p, i) => `<img class="g${i}" src="/assets/photos/${p}" alt="">`).join('')}<span class="photo-credit">Stock photos · not this hotel</span></div>
<div class="l-body"><div class="l-main">
<h2>${esc(h.tagline)}</h2><p class="lead">${esc(h.blurb)}</p>
<h3 class="mt">What's included</h3><ul class="amen">${h.amenities.map(a => `<li>${ICON.check} ${esc(a)}</li>`).join('')}</ul>
<h3 class="mt">Passes</h3><div class="pass-list">${passes.map(p => `<div class="pass-row"><div><b>${esc(p.name)}</b><div class="muted small">${esc(p.description)}</div></div><b>${money(p.price)}</b></div>`).join('')}</div>
<h3 class="mt">Good to know</h3><ul class="rules-l"><li>Check in from 10am, out by 4pm. Bring photo ID.</li><li>Spa passes are 18+. No lifeguard on duty.</li><li>Free cancellation up to 24h before (demo policy).</li></ul>
</div>
<aside class="book-box" id="book"><form action="/checkout" method="get" id="bf">
<input type="hidden" name="hotel" value="${h.slug}">
<div class="bb-price">From <b>${money(Math.min(...passes.map(p => p.price)))}</b> <span class="muted">per person</span></div>
<label class="fl">Date<input type="date" name="date" id="date" min="${today()}" max="${ymd(addDays(new Date(), 90))}" value="${date}" required></label>
<div id="status" class="status"></div>
<div class="pass-pick" id="passes"></div>
<label class="fl">Guests<select name="qty" id="qty">${[1, 2, 3, 4, 5, 6].map(n => `<option>${n}</option>`).join('')}</select></label>
<details id="addon-block" class="addon-fold" hidden><summary><span>Add-ons</span><span class="muted" id="addon-sum">Optional</span></summary><div class="addon-pick" id="addons-pick"></div></details>
<div class="bb-total" id="total"></div>
<button class="btn btn-coral full" id="go" type="submit">Reserve</button>
<p class="muted small center">You won't be charged. Demo payment only.</p>
${blocked.length ? `<p class="muted small">Closed: ${blocked.map(nice).join(', ')}</p>` : ''}
</form></aside></div></div>
<script>
const $=s=>document.querySelector(s);let av=[],addons=[];
function fmt(n){return '$'+n.toLocaleString('en-AU')}
function h(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function need(a,q){return a.per==='booking'?1:q}
function render(){const q=+$('#qty').value;const sel=document.querySelector('input[name=pass]:checked');
 $('#passes').innerHTML=av.map(p=>{const dis=p.remaining<q;return '<label class="pp'+(dis?' dis':'')+'"><input type="radio" name="pass" value="'+p.code+'" '+(dis?'disabled':'')+' '+((sel&&sel.value===p.code&&!dis)?'checked':'')+'><span><b>'+p.name+'</b><small>'+(p.remaining===0?'Sold out':p.remaining+' left')+'</small></span><b>'+fmt(p.price)+'</b></label>'}).join('');
 if(!document.querySelector('input[name=pass]:checked')){const f=document.querySelector('input[name=pass]:not([disabled])');if(f)f.checked=true}
 const fold=$('#addon-block');const wasOpen=fold.open;
 const prev=[...document.querySelectorAll('#addons-pick input:checked')].map(i=>i.value);
 fold.hidden=!addons.length;
 $('#addons-pick').innerHTML=addons.map(a=>{const dis=a.remaining<need(a,q);const on=!dis&&prev.indexOf(a.code)>=0;return '<label class="tog'+(dis?' dis':'')+'"><span><b>'+h(a.name)+'</b><small>'+(dis?'Sold out':fmt(a.price)+(a.per==='booking'?' per booking':' per guest'))+'</small></span><input type="checkbox" name="addon" value="'+a.code+'" '+(dis?'disabled':'')+(on?' checked':'')+'></label>'}).join('');
 const picked=document.querySelectorAll('#addons-pick input:checked').length;
 fold.open=wasOpen||picked>0;const sum=$('#addon-sum');if(sum)sum.textContent=picked?picked+' selected':'Optional';
 const c=document.querySelector('input[name=pass]:checked');const p=c&&av.find(x=>x.code===c.value);
 let extra=0;document.querySelectorAll('#addons-pick input:checked').forEach(i=>{const a=addons.find(x=>x.code===i.value);if(a)extra+=a.price*need(a,q)});
 $('#total').innerHTML=p?'<span>'+fmt(p.price)+' × '+q+(extra?' + add-ons':'')+'</span><b>'+fmt(p.price*q+extra)+'</b>':'';
 $('#go').disabled=!p;$('#go').textContent=p?'Reserve':'Not available';
 const b=av[0]&&av[0].blocked;const total=av.reduce((s,x)=>s+x.remaining,0);
 const st=$('#status');st.className='status'+(b||total===0?' out':'');
 st.textContent=b?'Closed: '+b:total===0?'Sold out this day':total+' spots left';
 document.querySelectorAll('#passes input, #addons-pick input').forEach(r=>r.onchange=render)}
async function load(){const r=await fetch('/api/availability?hotel=${h.slug}&date='+$('#date').value);const data=await r.json();av=data.passes;addons=data.addons||[];render()}
$('#date').onchange=load;$('#qty').onchange=render;load();setInterval(load,15000);
</script>`));
});

app.get('/api/availability', (req, res) => {
  const h = getHotel(req.query.hotel); if (!h) return res.status(404).json({ error: 'not found' });
  const date = req.query.date || today();
  res.json({ hotel: h.slug, date, passes: availability(h.id, date), addons: addonAvailability(h.id, date) });
});

function validate(q) {
  const h = getHotel(q.hotel); if (!h) return { err: 'Hotel not found.' };
  const date = String(q.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { err: 'Pick a date.', h };
  const qty = Math.max(1, Math.min(6, parseInt(q.qty) || 1));
  const p = getPasses(h.id).find(x => x.code === q.pass); if (!p) return { err: 'Pick a pass.', h };
  const a = availability(h.id, date).find(x => x.id === p.id);
  if (a.past) return { err: 'That date has passed.', h };
  if (a.blocked) return { err: `${h.name} is closed on ${nice(date)} (${a.blocked}).`, h };
  if (a.remaining < qty) return { err: a.remaining === 0 ? `${p.name} is sold out on ${nice(date)}.` : `Only ${a.remaining} ${p.name} spot${a.remaining === 1 ? '' : 's'} left on ${nice(date)}.`, h };
  const add = chosenAddons(h.id, date, qty, q);
  if (add.err) return { err: add.err, h };
  return { h, p, date, qty, a, addons: add.addons, addonTotal: add.addonTotal };
}
const errPage = (v, res) => res.status(409).send(page('Not available', `<div class="wrap sec narrow"><div class="alert">${esc(v.err)}</div>${v.h ? `<a class="btn btn-navy" href="/h/${v.h.slug}">Back to ${esc(v.h.name)}</a>` : ''}</div>`));

app.get('/checkout', (req, res) => {
  const v = validate(req.query); if (v.err) return errPage(v, res);
  const { h, p, date, qty, a } = v;
  const grand = p.price * qty + v.addonTotal;
  const picked = new Set(v.addons.map(x => x.code));
  const offer = addonAvailability(h.id, date);
  const addonFields = offer.length ? `<div class="addon-fold open"><p class="addon-note">Add-ons</p><div class="addon-pick" id="co-addons">${offer.map(ad => {
    const need = ad.per === 'booking' ? 1 : qty;
    const dis = ad.remaining < need;
    const on = !dis && picked.has(ad.code);
    return `<label class="tog${dis ? ' dis' : ''}"><span><b>${esc(ad.name)}</b><small>${dis ? 'Sold out' : `${money(ad.price)} ${ad.per === 'booking' ? 'per booking' : 'per guest'}`}</small></span><input type="checkbox" name="addon" value="${esc(ad.code)}" data-price="${ad.price}" data-per="${esc(ad.per)}" ${dis ? 'disabled' : ''} ${on ? 'checked' : ''}></label>`;
  }).join('')}</div></div>` : '';
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
<label class="tick"><input type="checkbox" required> I'm happy with the pool rules (photo ID, 10am–4pm, no lifeguard).</label>
<button class="btn btn-coral full" id="co-btn" type="submit">Confirm booking · ${money(grand)} (demo)</button></form>
<aside class="co-sum"><img src="/assets/photos/${h.photos[0]}" alt=""><div class="pad"><h3>${esc(h.name)}</h3><p class="muted small">${esc(h.area)}</p>
<dl><dt>Date</dt><dd>${esc(nice(date))}</dd><dt>Pass</dt><dd>${esc(p.name)} × ${qty}</dd><dt>Guests</dt><dd>${qty}</dd><dt>Spots left</dt><dd>${a.remaining}</dd></dl>
<ul class="addon-lines" id="addon-lines">${v.addons.map(ad => `<li><span>${esc(ad.name)} × ${ad.qty}</span><b>${money(ad.line)}</b></li>`).join('')}</ul>
<div class="bb-total"><span>Total</span><b id="co-total">${money(grand)}</b></div><p class="muted small">Prices include GST. Demo only.</p></div></aside></div></div>
<script>
const pass=${p.price}, guests=${qty};
const fmt=n=>'$'+n.toLocaleString('en-AU');
function paint(){let extra=0;const lines=[];
 document.querySelectorAll('#co-addons input:checked').forEach(i=>{const price=+i.dataset.price,q=i.dataset.per==='booking'?1:guests;extra+=price*q;lines.push('<li><span>'+i.parentElement.querySelector('b').textContent+' × '+q+'</span><b>'+fmt(price*q)+'</b></li>')});
 const total=pass*guests+extra;
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
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || phone.replace(/\D/g, '').length < 8) return errPage({ err: 'Please enter your name, a valid email and a mobile number.', h: getHotel(b.hotel) }, res);
  let code, v;
  db.transaction(() => { // re-check inside the transaction so two guests can't take the last spot
    v = validate(b); if (v.err) return;
    code = newCode();
    const info = db.prepare('INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(code, v.h.id, v.p.id, v.date, v.qty, v.p.price, v.p.price * v.qty + v.addonTotal, name, email, phone);
    const insAdd = db.prepare('INSERT INTO booking_addons(booking_id,addon_id,name,qty,unit_price,total) VALUES (?,?,?,?,?,?)');
    for (const ad of v.addons) insAdd.run(info.lastInsertRowid, ad.id, ad.name, ad.qty, ad.price, ad.line);
  }).immediate();
  if (v.err) return errPage(v, res);
  res.redirect(303, '/booking/' + code);
});

const bookingFull = code => db.prepare(`SELECT b.*, h.name hotel, h.slug, h.area, h.photos, p.name pass FROM bookings b JOIN hotels h ON h.id=b.hotel_id JOIN pass_types p ON p.id=b.pass_type_id WHERE b.code=?`).get(code);
app.get('/booking/:code', async (req, res) => {
  const b = bookingFull(req.params.code.toUpperCase());
  if (!b) return res.status(404).send(page('Not found', '<div class="wrap sec"><h2>Booking not found</h2></div>'));
  const qr = await QRCode.toDataURL(`HDC:${b.code}`, { margin: 1, width: 260, color: { dark: '#0B2545' } });
  const adds = bookingAddons(b.id);
  const until = adds.some(a => a.name.startsWith('Late access')) ? '8pm' : '4pm';
  res.send(page('Booking ' + b.code, `<div class="wrap sec narrow confirm">
<div class="ok-badge">${ICON.check}</div><h1 class="l-title center">You're booked in.</h1>
<p class="center muted">We've sent the details to ${esc(b.email)} (demo: no email is actually sent).</p>
<div class="ticket"><div class="t-top"><img src="/assets/photos/${JSON.parse(b.photos)[0]}" alt=""><div><h3>${esc(b.hotel)}</h3><p class="muted small">${esc(b.area)}, Sydney</p></div></div>
<div class="t-mid"><img class="qr" src="${qr}" alt="QR code for ${b.code}"><div class="code">${b.code}</div><p class="muted small">Show this at reception</p></div>
<dl><dt>Guest</dt><dd>${esc(b.guest_name)}</dd><dt>Date</dt><dd>${esc(nice(b.date))} · 10am–${until}</dd><dt>Pass</dt><dd>${esc(b.pass)} × ${b.qty}</dd><dt>Paid</dt><dd>${money(b.total)} <span class="muted small">(demo, no charge)</span></dd><dt>Status</dt><dd>${b.checked_in_at ? 'Checked in ' + esc(b.checked_in_at) : 'Confirmed'}</dd></dl>
${adds.length ? `<div class="ticket-adds"><b>Add-ons</b><ul>${adds.map(a => `<li><span>${esc(a.name)} × ${a.qty}</span><b>${money(a.total)}</b></li>`).join('')}</ul></div>` : ''}</div>
<div class="center" style="margin-top:20px"><a class="btn btn-line" href="/">Book another day</a></div></div>`));
});

// ---------- hotel dashboard ----------
const hotelAuth = (req, res, next) => { const id = req.signedCookies.hotel; const h = id && db.prepare('SELECT * FROM hotels WHERE id=?').get(id); if (!h) return res.redirect('/hotel/login'); req.hotel = hotelRow(h); next(); };
app.get('/hotel/login', (req, res) => {
  const hs = getHotels();
  res.send(page('Hotel login', `<div class="wrap sec narrow"><div class="login-card"><h1 class="l-title">Hotel partner login</h1>
${req.query.e ? '<div class="alert">Wrong username or password.</div>' : ''}
<form method="post" action="/hotel/login"><label class="fl">Username<input name="user" required autocomplete="username"></label><label class="fl">Password<input name="pass" type="password" required autocomplete="current-password"></label>
<button class="btn btn-navy full">Log in</button></form>
<div class="demo-logins"><b>Demo logins</b> (password <code>demo1234</code>)<ul>${hs.map(h => `<li><form method="post" action="/hotel/login"><input type="hidden" name="user" value="${h.login}"><input type="hidden" name="pass" value="demo1234"><button class="linkbtn"><code>${h.login}</code></button> ${esc(h.name)}</form></li>`).join('')}</ul></div></div></div>`, { bare: true }));
});
app.post('/hotel/login', (req, res) => {
  const h = db.prepare('SELECT * FROM hotels WHERE login=? AND password=?').get(String(req.body.user || '').trim(), req.body.pass);
  if (!h) return res.redirect('/hotel/login?e=1');
  res.cookie('hotel', h.id, { signed: true, httpOnly: true, sameSite: 'lax' }); res.redirect('/hotel');
});
app.get('/hotel/logout', (req, res) => { res.clearCookie('hotel'); res.redirect('/hotel/login'); });

const stat = (label, val, sub = '') => `<div class="stat"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const guestTable = (rows, { checkin = true, hotelCol = false, redirect = '/hotel' } = {}) => rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th>${hotelCol ? '<th>Hotel</th>' : ''}<th>Date</th><th>Guest</th><th>Pass</th><th>Qty</th><th>Total</th><th>Status</th></tr></thead><tbody>
${rows.map(b => `<tr><td><a class="link" href="/booking/${b.code}">${b.code}</a></td>${hotelCol ? `<td>${esc(b.hotel)}</td>` : ''}<td>${esc(nice(b.date))}</td><td><b>${esc(b.guest_name)}</b><div class="muted small">${esc(b.email)} · ${esc(b.phone)}</div></td><td>${esc(b.pass)}${b.addons ? `<div class="muted small">${esc(b.addons)}</div>` : ''}</td><td>${b.qty}</td><td>${money(b.total)}</td>
<td>${b.checked_in_at ? `<span class="pill ok">Checked in ${esc(b.checked_in_at.slice(11, 16))}</span>` : checkin && b.date === today() ? `<form method="post" action="/hotel/checkin"><input type="hidden" name="code" value="${b.code}"><input type="hidden" name="r" value="${esc(redirect)}"><button class="btn btn-sm btn-navy">Check in</button></form>` : '<span class="pill">Confirmed</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No guests.</p>';
const BQ = `SELECT b.*, p.name pass, h.name hotel, (SELECT group_concat(ba.name || ' × ' || ba.qty, ', ') FROM booking_addons ba WHERE ba.booking_id=b.id) addons FROM bookings b JOIN pass_types p ON p.id=b.pass_type_id JOIN hotels h ON h.id=b.hotel_id`;

app.get('/hotel', hotelAuth, (req, res) => {
  const h = req.hotel, t = today(), q = String(req.query.q || '').trim();
  const todayRows = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? ORDER BY b.checked_in_at IS NOT NULL, b.guest_name`).all(h.id, t);
  const upcoming = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date>? ORDER BY b.date, b.guest_name LIMIT 60`).all(h.id, t);
  const found = q ? db.prepare(`${BQ} WHERE b.hotel_id=? AND (b.code LIKE ? OR b.guest_name LIKE ? OR b.email LIKE ? OR b.phone LIKE ?) ORDER BY b.date DESC LIMIT 30`).all(h.id, ...Array(4).fill('%' + q + '%')) : null;
  const s = db.prepare("SELECT COALESCE(SUM(qty),0) passes, COALESCE(SUM(total),0) gross, COUNT(*) n FROM bookings WHERE hotel_id=? AND status!='cancelled'").get(h.id);
  const s30 = db.prepare("SELECT COALESCE(SUM(qty),0) passes, COALESCE(SUM(total),0) gross FROM bookings WHERE hotel_id=? AND status!='cancelled' AND date>=?").get(h.id, ymd(addDays(new Date(), -30)));
  const inToday = todayRows.filter(b => b.checked_in_at).reduce((a, b) => a + b.qty, 0), dueToday = todayRows.reduce((a, b) => a + b.qty, 0);
  const passes = getPasses(h.id), av = availability(h.id, t);
  const addonGross = db.prepare("SELECT COALESCE(SUM(ba.total),0) n FROM booking_addons ba JOIN bookings b ON b.id=ba.booking_id WHERE b.hotel_id=? AND b.status!='cancelled'").get(h.id).n;
  const addonsAll = getAddons(h.id);
  const blocked = db.prepare('SELECT * FROM blocked_dates WHERE hotel_id=? AND date>=? ORDER BY date').all(h.id, t);
  const days = Array.from({ length: 14 }, (_, i) => ymd(addDays(new Date(), i)));
  res.send(page('Dashboard', `<div class="dash"><aside class="side"><div class="side-h"><span class="badge-inline">Demo listing</span><h3>${esc(h.name)}</h3><p class="small">${esc(h.area)}</p></div>
<nav><a href="#today">Today</a><a href="#lookup">Lookup</a><a href="#upcoming">Upcoming</a><a href="#avail">Availability</a><a href="#settings">Prices & caps</a><a href="#addons">Add-ons</a><a href="#blocked">Blocked dates</a><a href="/h/${h.slug}" target="_blank">View listing ↗</a></nav></aside>
<div class="dash-main">
${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<div class="dash-head"><div><p class="eyebrow-s">Hotel dashboard</p><h1 class="l-title">G'day, ${esc(h.name.replace(' (Demo)', ''))}</h1><p class="muted">${esc(nice(t))} · ${inToday} of ${dueToday} guests checked in today</p></div></div>
<div class="stats">${stat('Passes sold (all time)', s.passes, s.n + ' bookings')}${stat('Gross sales', money(s.gross), `Includes ${money(addonGross)} add-ons · last 30 days ${money(s30.gross)}`)}${stat('Hotel share (75%)', money(s.gross * HOTEL_SHARE), 'Paid out to you')}${stat('Platform commission (25%)', money(s.gross * (1 - HOTEL_SHARE)), 'Hotel Day Club fee')}</div>
<section id="lookup" class="panel"><h2 class="ph2">Booking lookup</h2><form class="lookup" method="get" action="/hotel#lookup"><input name="q" value="${esc(q)}" placeholder="Booking code (HDC-12345), name, email or phone"><button class="btn btn-navy">${ICON.search} Find</button>${q ? '<a class="link" href="/hotel">Clear</a>' : ''}</form>
${found ? `<p class="muted small">${found.length} result${found.length === 1 ? '' : 's'} for “${esc(q)}”</p>${guestTable(found, { redirect: '/hotel?q=' + encodeURIComponent(q) + '#lookup' })}` : ''}</section>
<section id="today" class="panel"><h2 class="ph2">Today's guests <span class="muted small">${todayRows.length} bookings · ${dueToday} guests</span></h2>${guestTable(todayRows)}</section>
<section id="avail" class="panel"><h2 class="ph2">Next 14 days</h2><div class="tbl-wrap"><table class="tbl avail"><thead><tr><th>Pass</th>${days.map(d => `<th>${nice(d).replace(' ', '<br>')}</th>`).join('')}</tr></thead><tbody>
${passes.map(p => `<tr><td><b>${esc(p.name)}</b><div class="muted small">cap ${p.daily_cap}</div></td>${days.map(d => { const bl = isBlocked(h.id, d); const n = sold(p.id, d); return `<td class="${bl ? 'bl' : n >= p.daily_cap ? 'full' : ''}">${bl ? 'Closed' : `${n}/${p.daily_cap}`}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="muted small">Sold / daily cap. Red means sold out, grey means closed.</p></section>
<section id="upcoming" class="panel"><h2 class="ph2">Upcoming guests</h2>${guestTable(upcoming)}</section>
<section id="addons" class="panel"><h2 class="ph2">Add-ons</h2>
<p class="muted small">Optional extras. Turn one on, then set your price and how many you can take in a day. Guests only see the ones that are on.</p>
<form method="post" action="/hotel/addons"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>On</th><th>Add-on</th><th>Price (AUD)</th><th>Daily cap</th><th>Left today</th></tr></thead><tbody>
${addonsAll.map(a => `<tr><td><input type="checkbox" name="on" value="${a.id}" ${a.enabled ? 'checked' : ''}></td><td><b>${esc(a.name)}</b><div class="muted small">${esc(a.blurb)} · ${a.per === 'booking' ? 'per booking' : 'per guest'}</div></td><td><input class="num" type="number" min="0" step="1" name="aprice_${a.id}" value="${a.price}"></td><td><input class="num" type="number" min="0" step="1" name="acap_${a.id}" value="${a.daily_cap}"></td><td>${a.enabled ? (isBlocked(h.id, t) ? 0 : Math.max(0, a.daily_cap - addonSold(a.id, t))) : '—'}</td></tr>`).join('')}</tbody></table></div>
<button class="btn btn-navy">Save add-ons</button></form></section>
<div class="two-col"><section id="settings" class="panel"><h2 class="ph2">Prices & daily caps</h2><form method="post" action="/hotel/settings">
<table class="tbl"><thead><tr><th>Pass</th><th>Price (AUD)</th><th>Daily cap</th><th>Left today</th></tr></thead><tbody>
${passes.map((p, i) => `<tr><td><b>${esc(p.name)}</b></td><td><input class="num" type="number" min="0" step="1" name="price_${p.id}" value="${p.price}"></td><td><input class="num" type="number" min="0" step="1" name="cap_${p.id}" value="${p.daily_cap}"></td><td>${av[i].remaining}</td></tr>`).join('')}</tbody></table>
<button class="btn btn-navy">Save changes</button></form></section>
<section id="blocked" class="panel"><div class="blk-head"><h2 class="ph2">Blocked dates</h2></div>
<p class="muted small">Guests can't book a closed day.</p>
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
<script src="/block-cal.js"></script></section></div>
</div></div>`, { nav: 'hotel', bare: true }));
});
app.post('/hotel/checkin', hotelAuth, (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  const b = db.prepare('SELECT * FROM bookings WHERE code=? AND hotel_id=?').get(code, req.hotel.id);
  let msg = !b ? `No booking ${code} at this hotel.` : b.checked_in_at ? `${code} was already checked in.` : null;
  if (b && !b.checked_in_at) { db.prepare("UPDATE bookings SET checked_in_at=datetime('now','localtime') WHERE id=?").run(b.id); msg = `Checked in ${b.guest_name} (${code}).`; }
  const r = String(req.body.r || '/hotel'); const safe = r.startsWith('/hotel') ? r : '/hotel';
  const [p, hash] = safe.split('#'); res.redirect(303, p + (p.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg) + (hash ? '#' + hash : ''));
});
app.post('/hotel/settings', hotelAuth, (req, res) => {
  const up = db.prepare('UPDATE pass_types SET price=?, daily_cap=? WHERE id=? AND hotel_id=?');
  db.transaction(() => getPasses(req.hotel.id).forEach(p => {
    const price = Math.max(0, parseInt(req.body['price_' + p.id])), cap = Math.max(0, parseInt(req.body['cap_' + p.id]));
    up.run(Number.isFinite(price) ? price : p.price, Number.isFinite(cap) ? cap : p.daily_cap, p.id, req.hotel.id);
  }))();
  res.redirect(303, '/hotel?msg=' + encodeURIComponent('Prices and caps saved. Availability updated straight away.') + '#settings');
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

// ---------- admin ----------
const adminAuth = (req, res, next) => req.signedCookies.admin === 'jason' ? next() : res.redirect('/admin/login');
app.get('/admin/login', (req, res) => res.send(page('Admin login', `<div class="wrap sec narrow"><div class="login-card"><h1 class="l-title">Admin login</h1>${req.query.e ? '<div class="alert">Wrong username or password.</div>' : ''}
<form method="post" action="/admin/login"><label class="fl">Username<input name="user" value="jason" required></label><label class="fl">Password<input name="pass" type="password" required></label><button class="btn btn-navy full">Log in</button></form>
<div class="demo-logins"><b>Demo login:</b> <code>jason</code> / <code>admin1234</code></div></div></div>`, { bare: true })));
app.post('/admin/login', (req, res) => {
  if (req.body.user !== ADMIN.user || req.body.pass !== ADMIN.pass) return res.redirect('/admin/login?e=1');
  res.cookie('admin', 'jason', { signed: true, httpOnly: true, sameSite: 'lax' }); res.redirect('/admin');
});
app.get('/admin/logout', (req, res) => { res.clearCookie('admin'); res.redirect('/'); });
app.get('/admin', adminAuth, (req, res) => {
  const hid = parseInt(req.query.hotel) || 0, q = String(req.query.q || '').trim();
  const per = db.prepare(`SELECT h.id, h.name, h.area, COUNT(b.id) n, COALESCE(SUM(b.qty),0) passes, COALESCE(SUM(b.total),0) gross,
    COALESCE(SUM(CASE WHEN b.date=? THEN b.qty END),0) today, COALESCE(SUM(CASE WHEN b.checked_in_at IS NOT NULL THEN b.qty END),0) checked
    FROM hotels h LEFT JOIN bookings b ON b.hotel_id=h.id AND b.status!='cancelled' GROUP BY h.id ORDER BY gross DESC`).all(today());
  const tot = per.reduce((a, r) => ({ n: a.n + r.n, passes: a.passes + r.passes, gross: a.gross + r.gross, today: a.today + r.today }), { n: 0, passes: 0, gross: 0, today: 0 });
  const addonAll = db.prepare("SELECT COALESCE(SUM(ba.total),0) n FROM booking_addons ba JOIN bookings b ON b.id=ba.booking_id WHERE b.status!='cancelled'").get().n;
  const where = [], args = []; if (hid) { where.push('b.hotel_id=?'); args.push(hid); } if (q) { where.push('(b.code LIKE ? OR b.guest_name LIKE ? OR b.email LIKE ?)'); args.push(...Array(3).fill('%' + q + '%')); }
  const rows = db.prepare(`${BQ} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.created_at DESC, b.id DESC LIMIT 100`).all(...args);
  res.send(page('Admin', `<div class="wrap sec">
<p class="eyebrow-s">Platform admin · Jason</p><h1 class="l-title">All bookings</h1>
<div class="stats">${stat('Bookings', tot.n, tot.passes + ' passes')}${stat('Gross sales', money(tot.gross), `Includes ${money(addonAll)} add-ons`)}${stat('Paid to hotels (75%)', money(tot.gross * HOTEL_SHARE))}${stat('Platform commission (25%)', money(tot.gross * (1 - HOTEL_SHARE)), 'Hotel Day Club revenue')}</div>
<p class="muted small" style="margin:-8px 0 16px">Gross includes add-ons. Commission stays at 25% of that gross.</p>
<section class="panel"><h2 class="ph2">By hotel</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Hotel</th><th>Bookings</th><th>Passes</th><th>Today</th><th>Gross</th><th>Hotel 75%</th><th>Commission 25%</th></tr></thead><tbody>
${per.map(r => `<tr><td><a class="link" href="/admin?hotel=${r.id}#all"><b>${esc(r.name)}</b></a><div class="muted small">${esc(r.area)}</div></td><td>${r.n}</td><td>${r.passes}</td><td>${r.today}</td><td>${money(r.gross)}</td><td>${money(r.gross * HOTEL_SHARE)}</td><td><b>${money(r.gross * (1 - HOTEL_SHARE))}</b></td></tr>`).join('')}
<tr class="tot"><td>Total</td><td>${tot.n}</td><td>${tot.passes}</td><td>${tot.today}</td><td>${money(tot.gross)}</td><td>${money(tot.gross * HOTEL_SHARE)}</td><td>${money(tot.gross * (1 - HOTEL_SHARE))}</td></tr></tbody></table></div></section>
<section class="panel" id="all"><h2 class="ph2">Latest bookings</h2><form class="lookup" method="get" action="/admin#all"><select name="hotel"><option value="">All hotels</option>${per.map(r => `<option value="${r.id}" ${r.id === hid ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select><input name="q" value="${esc(q)}" placeholder="Code, name or email"><button class="btn btn-navy">Filter</button></form>
${guestTable(rows, { checkin: false, hotelCol: true })}<p class="muted small">Showing the latest ${rows.length} (max 100).</p></section></div>`, { nav: 'admin' }));
});

app.get('/how-it-works', (req, res) => {
  res.send(page('How it works', `<div class="wrap hiw-hero">
<p class="eyebrow-s">How it works</p>
<h1 class="l-title">A hotel day, without the overnight.</h1>
<p class="lead">Book a hotel pool, daybed or spa for the day. No room needed. Hotels set their own prices and how many guests they take.</p>
<p class="hiw-jumps"><a href="#guests">For guests</a><a href="#partners">For hotels</a><a href="#faq">Questions</a></p>
</div>
<div class="wrap hiw-block" id="guests">
<h2>For guests</h2>
<div class="how-grid">
<div><span class="n">1</span><h3>Browse</h3><p class="muted">Search by neighbourhood, date and pass. Each listing shows what's included and how many spots are left.</p></div>
<div><span class="n">2</span><h3>Book</h3><p class="muted">Pick Pool, Daybed or Spa. Add parking, a cabana, gym access or a food and drink credit if you want. The total updates before you confirm. This demo doesn't charge a card.</p></div>
<div><span class="n">3</span><h3>Show your QR code</h3><p class="muted">At the front desk from 10am. The code is on your confirmation. Reception checks you in and hands you a wristband.</p></div>
<div><span class="n">4</span><h3>Enjoy</h3><p class="muted">Pool, towel and a lounger until 4pm. Add late access if you'd like to stay until 8pm.</p></div>
</div>
<p style="margin-top:18px"><a class="btn btn-coral" href="/#explore">Browse pools</a></p>
</div>
${WAVE.replace('fill="#fff"', 'fill="#0B2545"').replace('class="wave"', 'class="wave wave-band"')}<section class="hiw-band" id="partners"><div class="wrap">
<h2>For hotel partners</h2>
<p class="hiw-lead">Free to join. You decide the prices and the numbers, and you get paid monthly.</p>
<div class="partner-grid">
<div class="partner-card"><b>Free to join</b><p>No signup fee and no monthly charge.</p></div>
<div class="partner-card"><b>You set capacity and prices</b><p>Daily caps for each pass and add-on, and the price guests pay. Change them whenever you like.</p></div>
<div class="partner-card"><b>Guest list the night before</b><p>We email the next day's guest list the evening before. The same list is on your dashboard, ready for check-in.</p></div>
<div class="partner-card"><b>You keep food and drink spend</b><p>What guests buy at your bar or café stays with you.</p></div>
<div class="partner-card"><b>Paid monthly</b><p>Pass and add-on sales are paid out once a month. You keep 75%. Hotel Day Club keeps 25%.</p></div>
</div>
<p style="margin-top:18px"><a class="btn btn-coral" href="/hotel">Hotel login</a></p>
</div></section>
<div class="wrap hiw-block" id="faq">
<h2>Questions</h2>
<div class="faq">
<details open><summary>Cancellations</summary><p>Free cancellation up to 24 hours before the visit. After that the booking stands. That's the demo policy.</p></details>
<details><summary>What to bring</summary><p>Photo ID that matches the booking, swimwear and sunscreen. Passes include a towel. A spa pass includes a robe, or you can add a towel and robe pack.</p></details>
<details><summary>Age limits</summary><p>Spa passes are 18+. Some pools are glad to have children, and the listing says when a hotel is kid-friendly. There is no lifeguard on duty.</p></details>
<details><summary>Weather</summary><p>Indoor pools and pools under a roof stay open in the rain. If a hotel has to close for weather, the day can be moved or the booking cancelled. Dates a hotel has blocked can't be booked.</p></details>
</div>
</div>`));
});

// Render's free disk is wiped on restart. Fill demo data only when nothing is there yet.
if (db.prepare('SELECT COUNT(*) n FROM hotels').get().n === 0) seed(db);
else ensureAddons(db);

app.listen(PORT, () => console.log(`Hotel Day Club demo on http://localhost:${PORT}`));
