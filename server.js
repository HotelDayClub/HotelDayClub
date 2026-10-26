const express = require('express');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { seed, ensureAddons, ensureSchedules, seedPerformance } = require('./seed');
const {
  seatPhoto, SEAT_PHOTO, loadInclusions, ensureInclusions, saveInclusions, syncAddonEdit,
  includedHtml, addonsHtml, inclusionsForm, beatsHtml, hoursHtml, policyHtml,
} = require('./inclusions');
const { ensureArrival, saveArrival, arrivalHtml, arrivalForm } = require('./arrival');
const { listingHtml } = require('./listingView');
const { buildAnalytics, renderAnalytics, recordListingView, normalRange } = require('./analytics');
const { adminPassword, verifyPassword, safeEqual, migrateHotelPasswords, maskName, maskEmail } = require('./passwords');
const { staffCookie, clearStaffCookie, resolveCookieSecret } = require('./session');
const { ymd, addDays, esc, money, nice } = require('./util');
const { DESTINATIONS, destIcon, destinationBySlug } = require('./destinations');
const seo = require('./seo');
const compress = require('./compress');
const { parseSignup, saveSignup, notifyWebhook, rateLimited, waitlistCsv } = require('./waitlist');
const paths = require('./paths');
const backups = require('./backups');
const { bookingsCsv, hotelsCsv } = require('./dataExport');
const {
  KINDS, spotLabel, closureReason, rulesCard, rulesText,
  hoursFor, hoursView, hoursLines, syncHoursLabels, saveOffering, offeringForm, LIVE_LIST,
  fmtTime, cancelNote, riskCard, riskText, riskTick, swimNote, hotelLatePossible, lateWindow,
} = require('./offering');
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3030;
const SECRET = resolveCookieSecret();
const ADMIN_USER = 'jason';
const HOTEL_SHARE = 0.75;
app.use(seo.canonicalRedirect);
app.use(compress);
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(SECRET));
function staticCache(res, filePath) {
  if (/\.(?:jpe?g|png|webp|gif|svg|ico|woff2?)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=2592000');
  else if (/\.(?:css|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
}
app.get('/favicon.ico', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('Content-Type', 'image/x-icon');
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(seo.robotsTxt());
});
app.get('/site.webmanifest', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'public', 'site.webmanifest'));
});
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  const lastmod = ymd(new Date());
  const paths = [];
  if (seo.siteIndexable()) {
    paths.push('/', '/for-hotels', '/how-it-works', '/faq');
    if (seo.legalPagesIndexable()) paths.push('/privacy', '/terms', '/refunds', '/risk');
    paths.push('/guides');
    for (const g of seo.GUIDES) paths.push('/guides/' + g.slug);
    for (const d of DESTINATIONS) paths.push('/destinations/' + d.slug);
    const hotels = db.prepare("SELECT slug FROM hotels WHERE COALESCE(status,'active')='active' AND COALESCE(is_demo,0)=0 ORDER BY slug").all();
    for (const h of hotels) paths.push('/h/' + h.slug);
  }
  res.send(seo.sitemapDocument(paths.map(p => ({ loc: seo.absolute(p), lastmod }))));
});
app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  try {
    const row = db.prepare('SELECT 1 AS ok').get();
    if (!row || row.ok !== 1) throw new Error('unexpected result');
    res.json({ ok: true, db: true });
  } catch (err) {
    console.error('healthz: database read failed: ' + err.message);
    res.status(503).json({ ok: false, db: false });
  }
});
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: staticCache }));
if (paths.dataDir()) {
  const uploadRoot = paths.uploadsDir();
  app.get('/uploads/:name', (req, res, next) => {
    const name = path.basename(String(req.params.name || ''));
    if (!/^[\w.-]+\.(?:jpe?g|png|webp|gif)$/i.test(name)) return next();
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(name, { root: uploadRoot }, err => { if (err) next(); });
  });
}
app.get('/vendor/jsQR.js', (req, res) => {
  res.type('js');
  res.sendFile(require.resolve('jsqr'));
});

const today = () => ymd(new Date());
const hotelRow = h => {
  if (!h) return h;
  const row = { ...h, photos: JSON.parse(h.photos || '[]'), amenities: JSON.parse(h.amenities || '[]') };
  delete row.password;
  return row;
};
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
      id: p.id, code: p.code, name: p.name, kind: p.kind || '', holds: p.holds || 1, featured: p.featured ? 1 : 0,
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
function presentAddon(hotel, date, a) {
  if (!a || a.code !== 'late') return a;
  const win = lateWindow(db, hotel, date);
  if (!win) return null;
  return {
    ...a,
    name: `Late access ${fmtTime(win.end)}–${fmtTime(win.until)}`,
    blurb: `From ${fmtTime(win.end)} until the pool closes at ${fmtTime(win.until)}. It does not overlap room guests only.`,
  };
}
function addonAvailability(hid, date) {
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(hid);
  const why = hotel ? closureReason(db, hotel, date) : null;
  const past = date < today();
  return getAddons(hid, true).map(a => {
    const shown = presentAddon(hotel, date, a);
    if (!shown) return null;
    const s = addonSold(a.id, date);
    return { id: shown.id, code: shown.code, name: shown.name, blurb: shown.blurb, price: shown.price, per: shown.per,
      remaining: why || past ? 0 : Math.max(0, shown.daily_cap - s) };
  }).filter(Boolean);
}
function addonCodes(q) {
  const raw = q.addon;
  const list = raw == null || raw === '' ? [] : (Array.isArray(raw) ? raw : [raw]);
  return [...new Set(list.map(s => String(s).trim()).filter(Boolean))];
}
function chosenAddons(hid, date, people, q) {
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(hid);
  const rows = [];
  for (const code of addonCodes(q)) {
    const a = db.prepare('SELECT * FROM addons WHERE hotel_id=? AND code=? AND enabled=1').get(hid, code);
    if (!a) return { err: 'That add-on is not available.' };
    const shown = presentAddon(hotel, date, a);
    if (!shown) return { err: a.code === 'late' ? "Late access can't overlap room guests only or run past the pool's closing time." : 'That add-on is not available.' };
    const qty = a.per === 'booking' ? 1 : people;
    const left = Math.max(0, a.daily_cap - addonSold(a.id, date));
    if (left < qty) return { err: left === 0 ? `${shown.name} is sold out for this date.` : `${shown.name} doesn't have enough left for this date.` };
    rows.push({ id: a.id, code: a.code, name: shown.name, price: a.price, per: a.per, qty, line: a.price * qty });
  }
  return { addons: rows, addonTotal: rows.reduce((s, a) => s + a.line, 0) };
}
const bookingAddons = id => db.prepare('SELECT name, qty, unit_price, total FROM booking_addons WHERE booking_id=? ORDER BY name').all(id);
const newCode = () => {
  let c;
  do { c = 'HDC-' + crypto.randomBytes(16).toString('hex').toUpperCase(); }
  while (db.prepare('SELECT 1 FROM bookings WHERE code=?').get(c));
  return c;
};

const ICON = {
  search: '<svg class="ico sm" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg class="ico sm" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  lock: '<svg class="ico sm" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};
function logoLink(tone) {
  const light = tone === 'light';
  const src = light ? '/assets/hdc-lockup-light.svg' : '/assets/hdc-lockup-dark.svg';
  return `<a class="logo" href="/"><img src="${src}" alt="Hotel Day Club" width="187" height="32"></a>`;
}
const DEFAULT_CONTACT_EMAIL = 'hello@hoteldayclub.com.au';
const DEFAULT_ABN = '98 227 458 028';
function contactEmail() {
  const raw = String(process.env.CONTACT_EMAIL || DEFAULT_CONTACT_EMAIL).trim();
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(raw) ? raw : DEFAULT_CONTACT_EMAIL;
}
function contactMail() {
  const email = esc(contactEmail());
  return `<a href="mailto:${email}">${email}</a>`;
}
function talkHref() {
  return `mailto:${contactEmail()}?subject=${encodeURIComponent('Hotel Day Club - partnership enquiry')}`;
}
function businessAbn() {
  const digits = String(process.env.ABN || '').replace(/\D/g, '');
  const use = /^\d{11}$/.test(digits) ? digits : DEFAULT_ABN.replace(/\D/g, '');
  return `${use.slice(0, 2)} ${use.slice(2, 5)} ${use.slice(5, 8)} ${use.slice(8)}`;
}
const DEFAULT_GA_ID = 'G-9F5ZH1T4YN';
function gaMeasurementId() {
  if (Object.prototype.hasOwnProperty.call(process.env, 'GA_MEASUREMENT_ID')) {
    const raw = String(process.env.GA_MEASUREMENT_ID).trim();
    if (!raw || /^(0|false|off|none)$/i.test(raw)) return '';
    return /^G-[A-Z0-9]+$/.test(raw) ? raw : '';
  }
  return process.env.NODE_ENV === 'production' ? DEFAULT_GA_ID : '';
}
function gaSnippet(safePath) {
  const id = gaMeasurementId();
  if (!id) return '';
  // Booking pages keep the code in the address bar for the guest. The hit sent to Google uses a fixed path and title so the code is not collected.
  const config = safePath
    ? `gtag('config','${id}',{page_path:'${safePath}',page_location:location.origin+'${safePath}',page_title:'Booking'});`
    : `gtag('config','${id}');`;
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${config}</script>`;
}
function siteFooter(tone) {
  const abn = `<p class="muted small abn-line">Hotel Day Club · ABN ${esc(businessAbn())}</p>`;
  const logo = tone === 'light' ? logoLink('light') : logoLink('dark');
  return `<footer class="app-ftr"><div class="wrap ftr-in"><div>${logo}<p class="muted small">Contact ${contactMail()}</p></div>
<nav class="ftr-links"><a href="/destinations/sydney">Sydney</a><a href="/destinations/gold-coast">Gold Coast</a><a href="/how-it-works">How day passes work</a><a href="/faq">Questions</a><a href="/guides">Guides</a><a href="/for-hotels">For hotels</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refunds">Refunds</a><a href="/risk">Risk warning</a></nav>
<p class="muted small">Demo only. Hotels shown are fictional example listings with stock photos. No payments are taken.</p>${abn}</div></footer>`;
}
const FONT_LINKS = `<link rel="preload" href="/golden/fonts/f3.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/golden/fonts/f5.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/golden/fonts.css">`;
const HOME_SCRIPT = `<script>
(function(){
var S=[["8:00","Swim & gym"],["12:00","Long lunch"],["15:00","Spa afternoon"],["18:00","Golden hour"]],media=[0,0,2,3],cur=1;
var hero=document.querySelector('.hero'),bs=document.querySelectorAll('.times button');
function set(i){cur=i;if(!hero)return;hero.dataset.slot=String(i);bs.forEach(function(b,k){b.classList.toggle('on',k===i);b.setAttribute('aria-pressed',k===i?'true':'false')});
var ct=document.getElementById('ct'),cl=document.getElementById('cl');if(ct)ct.textContent=S[i][0];if(cl)cl.textContent=S[i][1];
document.querySelectorAll('.layer').forEach(function(l){l.classList.toggle('on',+l.dataset.slot===media[i])});}
bs.forEach(function(b){b.addEventListener('click',function(){set(+b.dataset.i)})});set(1);
var rm=matchMedia('(prefers-reduced-motion: reduce)').matches,c=navigator.connection||{},small=matchMedia('(max-width:800px)').matches;
var slow=!!(c.saveData||/2g/.test(c.effectiveType||''));
addEventListener('load',function(){
  if(rm||small||slow) return;
  var v=document.createElement('video');
  v.className='layer';v.muted=true;v.loop=true;v.playsInline=true;v.setAttribute('playsinline','');v.preload='auto';v.setAttribute('aria-hidden','true');v.dataset.slot='0';
  v.src='/golden/vid/hero.mp4';
  var box=document.querySelector('.media'); if(!box) return;
  box.insertBefore(v, box.querySelector('.tint'));
  if(media[cur]===0) v.classList.add('on');
  var play=v.play(); if(play&&play.catch) play.catch(function(){});
});
var els=document.querySelectorAll('[data-rv]');
function show(el){el.classList.add('in')}
if(rm||!('IntersectionObserver' in window)){els.forEach(show)}else{
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){show(e.target);io.unobserve(e.target)}})},{threshold:.05,rootMargin:'0px 0px -8% 0px'});
  els.forEach(function(e){io.observe(e)});
  setTimeout(function(){els.forEach(show)},1200);
}
var dlg=document.getElementById('waitlist');
function openWl(){if(dlg&&typeof dlg.showModal==='function'&&!dlg.open)dlg.showModal();}
document.querySelectorAll('a[href="#waitlist"]').forEach(function(a){a.addEventListener('click',function(e){if(!dlg)return;e.preventDefault();openWl();});});
if(dlg){
  var x=dlg.querySelector('[data-close]'); if(x) x.addEventListener('click',function(){dlg.close()});
  dlg.addEventListener('click',function(e){if(e.target===dlg)dlg.close()});
  if(location.hash==='#waitlist'||dlg.dataset.open==='1') openWl();
}
window.__set=set;
})();
</script>`;
function page(title, body, opts = {}) {
  const nav = opts.nav || 'guest';
  const bare = !!opts.bare;
  const analytics = !!opts.analytics;
  const analyticsPath = opts.analyticsPath || '';
  const home = !!opts.home;
  const index = opts.index !== undefined ? opts.index : nav === 'guest';
  const right = nav === 'hotel' ? '<a class="hotel-link show" href="/hotel/logout">Log out</a>'
    : nav === 'admin' ? '<a class="hotel-link show" href="/admin/logout">Log out</a>' : '';
  const guestNav = `<nav class="hdr-nav"><a href="/how-it-works">How it works</a><a href="/for-hotels">For hotels</a><a class="pill" href="${home ? '#waitlist' : '/#waitlist'}">Join the waitlist</a></nav>`;
  const tags = analytics && nav === 'guest' ? gaSnippet(analyticsPath) : '';
  const preconnect = tags ? '<link rel="preconnect" href="https://www.googletagmanager.com">' : '';
  const canonicalUrl = opts.canonical === false || !opts.path ? '' : seo.absolute(opts.path);
  const meta = seo.headMeta({
    documentTitle: seo.fullTitle(opts.documentTitle || title),
    description: opts.description || '',
    robots: seo.robotsContent(index),
    canonicalUrl,
    image: opts.image || '',
    imageAlt: opts.imageAlt || '',
    imageWidth: opts.image ? opts.imageWidth : 1200,
    imageHeight: opts.image ? opts.imageHeight : 630,
    jsonld: opts.jsonld || null,
  });
  const pickerCss = '<link rel="stylesheet" href="/pickers.css">';
  const css = home
    ? `${FONT_LINKS}<link rel="preload" as="image" href="/golden/img/hero-poster.webp" type="image/webp" fetchpriority="high">${pickerCss}<link rel="stylesheet" href="/golden/home.css">`
    : `${FONT_LINKS}${pickerCss}<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/golden/site.css">`;
  const bodyClass = home ? 'home' : nav === 'guest' ? 'guest' : 'staff';
  const header = home ? '' : `<header class="hdr"><div class="wrap hdr-in">${logoLink('dark')}${nav === 'guest' ? guestNav : '<nav class="hdr-nav"></nav>'}<div class="hdr-right">${right}</div></div></header>`;
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${preconnect}${meta}${tags}${home ? '<script>document.documentElement.classList.add("js");if(!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("rv");</script>' : '<script>document.documentElement.classList.add("js")</script>'}${css}</head><body class="${bodyClass}">
<div class="demo-banner">Demo site — listings are examples, no real bookings or payments.</div>
${header}<main>${body}</main>
${bare ? '' : siteFooter(home ? 'light' : 'dark')}<script src="/pickers.js"></script>${home ? HOME_SCRIPT : ''}
</body></html>`;
}
const card = (h, date) => {
  const av = date ? availability(h.id, date) : null;
  const prices = getPasses(h.id).map(p => p.price);
  const from = prices.length ? Math.min(...prices) : 0;
  let spots = '';
  if (av) { const left = av.day_left != null ? av.day_left : av.reduce((a, p) => a + p.remaining, 0); spots = av[0] && av[0].blocked ? '<span class="spots out">Closed</span>' : left === 0 ? '<span class="spots out">Sold out</span>' : `<span class="spots">${left} left</span>`; }
  const photo = h.photos[0] || '';
  return `<a class="card" href="/h/${h.slug}${date ? '?date=' + date : ''}"><div class="ph">${photo ? `<img src="/assets/photos/${esc(photo)}" alt="${esc(Number(h.is_demo) === 1 ? 'Example photo of a hotel pool in ' + h.area + ', not a real hotel' : 'Photo of ' + h.name)}" width="1200" height="900">` : ''}</div>
<div class="c-body"><div class="c-top"><h3>${esc(h.name)}</h3><span class="rate">New</span></div>
<div class="c-sub">${esc(h.area)}</div>
<div class="c-price">From <b>${money(from)}</b> ${spots}</div></div></a>`;
};
const WAVE = '<svg class="wave" viewBox="0 0 1440 72" preserveAspectRatio="none" aria-hidden="true"><path fill="#fff" d="M0 40c180 28 320-36 520-20s340 48 520 20 280-40 400-16V72H0Z"/></svg>';
const seatList = passes => `<div class="seat-list">${passes.map(p => `<div class="seat-row">${p.photo ? `<img src="/assets/photos/${esc(p.photo)}" alt="${esc('Example photo of ' + spotLabel(p))}">` : '<div class="seat-ph"></div>'}
<div><b>${esc(spotLabel(p))}</b><div class="muted small">${esc(p.description || '')}</div></div>
<div class="seat-price"><b>${money(p.price)}</b><div class="muted small">${p.daily_cap} a day</div></div></div>`).join('')}</div>`;

function exampleCount(n) {
  return `${n} example listing${n === 1 ? '' : 's'}`;
}
const WANTS = [
  { id: '', name: 'Any', icon: 'any' },
  { id: 'pool', name: 'Pool', icon: 'pool' },
  { id: 'gym', name: 'Gym', icon: 'gym' },
  { id: 'spa', name: 'Spa', icon: 'spa' },
  { id: 'pool-spa', name: 'Pool + Spa', icon: 'both' },
];
function hotelOffers(hotel, want) {
  if (!want) return true;
  const items = loadInclusions(db, hotel.id);
  const on = code => {
    const mode = (items.find(i => i.code === code) || {}).mode;
    return mode && mode !== 'off';
  };
  const pool = on('pool');
  const gym = on('gym');
  const spa = on('spa') || on('sauna');
  if (want === 'pool') return pool;
  if (want === 'gym') return gym;
  if (want === 'spa') return spa;
  if (want === 'pool-spa') return pool && spa;
  return true;
}
function homePage({ where = '', date = '', want = '', dest = '', destination = '', joined = false, error = '', values = {} } = {}) {
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';
  if (!WANTS.some(w => w.id === want)) want = '';
  const hotels = getHotels();
  const areas = [...new Set(hotels.map(h => h.area))];
  const destObj = DESTINATIONS.find(d => d.id === dest) || null;
  const pickedDest = Object.prototype.hasOwnProperty.call(values, 'destination') && values.destination !== undefined
    ? values.destination
    : destination;
  let list = hotels.filter(h => !where || h.area === where);
  if (destObj) list = list.filter(h => destObj.areas.includes(h.area));
  if (want) list = list.filter(h => hotelOffers(h, want));
  if (date) list = list.filter(h => !closureReason(db, h, date));
  const filtered = Boolean(where || date || want || destObj);
  const wantLabel = (WANTS.find(w => w.id === want) || {}).name || '';
  const counts = DESTINATIONS.map(d => ({ ...d, count: hotels.filter(h => d.areas.includes(h.area)).length }));
  const destCards = counts.map(d => {
    const href = `/destinations/${encodeURIComponent(d.slug)}`;
    const status = d.count
      ? `<span class="dest-count">${exampleCount(d.count)}</span>`
      : '<span class="dest-soon">Coming soon</span><span class="dest-none">No listings yet</span>';
    const go = d.count ? 'View example listings' : 'Join the waitlist';
    return `<li><a class="dest-card" href="${href}"${destObj && destObj.id === d.id ? ' aria-current="true"' : ''}>
<span class="dest-ico">${destIcon(d.icon)}</span>
<span class="dest-name">${esc(d.name)}</span>
<span class="dest-status">${status}</span>
<span class="dest-go">${go}</span>
</a></li>`;
  }).join('');
  let exploreTitle = 'Example listings';
  if (destObj && !list.length) exploreTitle = `No example listings in ${esc(destObj.name)} yet`;
  else if (destObj) exploreTitle = `${exampleCount(list.length)} · ${esc(destObj.name)}`;
  else if (where || date || want) exploreTitle = `${list.length} place${list.length === 1 ? '' : 's'} ${where ? 'in ' + esc(where) : 'around Australia'}${wantLabel && wantLabel !== 'Any' ? ' · ' + esc(wantLabel) : ''}${date ? ' on ' + esc(nice(date)) : ''}`;
  const emptyCopy = destObj
    ? `There are no example listings in ${esc(destObj.name)} yet. <a class="link" href="/?destination=${encodeURIComponent(destObj.id)}#waitlist">Join the waitlist</a>`
    : 'Nothing matches. Try another date, or pool, gym or spa.';
  const form = values || {};
  const destOptions = DESTINATIONS.map(d => `<option value="${esc(d.id)}" data-icon="${esc(d.icon)}"${pickedDest === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
  const lead = joined ? `<script>if(typeof gtag==='function')gtag('event','generate_lead');</script>` : '';
  const openWait = Boolean(joined || error || pickedDest);
  const exampleCards = list.map(h => {
    const prices = getPasses(h.id).map(p => p.price);
    const from = prices.length ? Math.min(...prices) : 0;
    const photo = h.photos[0] || '';
    const base = String(photo).replace(/\.jpe?g$/i, '');
    const webp = path.join(__dirname, 'public', 'golden', 'img', 'cards', base + '.webp');
    const img = photo && fs.existsSync(webp)
      ? `<img src="/golden/img/cards/${esc(base)}.webp" alt="${esc('Example photo of a hotel pool in ' + h.area + ', not a real hotel')}" width="800" height="600" loading="lazy" decoding="async">`
      : photo ? `<img src="/assets/photos/${esc(photo)}" alt="${esc('Example photo of a hotel pool in ' + h.area + ', not a real hotel')}" width="1200" height="900" loading="lazy" decoding="async">` : '';
    return `<a class="ex" href="/h/${h.slug}${date ? '?date=' + encodeURIComponent(date) : ''}">${img}<span class="tag">Example</span><h3>${esc(h.name)}</h3><p>${esc(h.area)} · From ${money(from)} · Demo</p></a>`;
  }).join('');
  const slot = (src, alt, time, title, copy) => `<div class="slot"><picture><source type="image/webp" srcset="/golden/img/${src}.webp"><img src="/golden/img/${src}.jpg" alt="${alt}" width="900" height="600" loading="lazy" decoding="async"></picture><span class="t">${time}</span><div class="b"><h3>${title}</h3><p>${copy}</p></div></div>`;
  return page('Take the day off', `<nav class="top">${logoLink('dark')}<div class="links"><a href="/how-it-works">How it works</a><a href="/for-hotels">For hotels</a><a class="pill" href="#waitlist">Join the waitlist</a></div></nav>
<header class="hero" data-slot="1"><div class="ph"><div class="media">
<picture class="layer on" data-slot="0"><source type="image/webp" srcset="/golden/img/hero-poster.webp"><img fetchpriority="high" src="/golden/img/hero-poster.jpg" alt="Sunlit hotel pool water" width="1280" height="720" decoding="async"></picture>
<picture class="layer zoom" data-slot="2"><source type="image/webp" srcset="/golden/img/3-sm.webp"><img src="/golden/img/3-sm.jpg" alt="Spa treatment room" width="900" height="600" loading="lazy" decoding="async"></picture>
<picture class="layer zoom" data-slot="3"><source type="image/webp" srcset="/golden/img/1-sm.webp"><img src="/golden/img/1-sm.jpg" alt="Hotel pool at dusk" width="900" height="900" loading="lazy" decoding="async"></picture>
<div class="tint"></div></div>
<div class="clock"><span id="ct">12:00</span><small id="cl">Long lunch</small></div><span class="credit">Stock media · example only</span></div>
<div class="copy"><span class="kicker">Hotel pools, gyms &amp; spas across Australia</span>
<h1>Take the day <em>off.</em><br>Swim till&nbsp;six.</h1>
<p class="lead">A hotel pool, gym, daybed or spa for the day — minutes from home, no room needed.</p>
<div class="times"><button type="button" data-i="0" aria-pressed="false">Swim &amp; gym</button><button type="button" data-i="1" class="on" aria-pressed="true">Long lunch</button><button type="button" data-i="2" aria-pressed="false">Spa afternoon</button><button type="button" data-i="3" aria-pressed="false">Golden hour</button></div>
<form class="search" action="/#explore" method="get">
<div class="seg"><label for="w">Where</label><select id="w" class="hdc-pick" name="where"><option value="" data-icon="pin">All of Australia</option>${areas.map(a => `<option value="${esc(a)}" data-icon="pin"${a === where ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
<div class="seg"><label for="d">When</label><input id="d" class="hdc-date" type="date" name="date" min="${today()}" max="${ymd(addDays(new Date(), 90))}" value="${esc(date)}"></div>
<div class="seg"><label for="p">What</label><select id="p" class="hdc-pick" name="want">${WANTS.map(w => `<option value="${w.id}" data-icon="${w.icon}"${want === w.id ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
<button type="submit">Search</button></form></div></header>
<div class="marquee" aria-label="Pool day, gym session, spa afternoon, daybed for two, cabana with friends, golden-hour swim"><div class="track" aria-hidden="true"><span>Pool day</span>✺<span>Gym session</span>✺<span>Spa afternoon</span>✺<span>Daybed for two</span>✺<span>Cabana with friends</span>✺<span>Golden-hour swim</span>✺<span>Pool day</span>✺<span>Gym session</span>✺<span>Spa afternoon</span>✺<span>Daybed for two</span>✺<span>Cabana with friends</span>✺<span>Golden-hour swim</span>✺</div></div>
<section data-rv><span class="kicker sand">Plan your day by the hour</span><h2>One day. <em>Four</em> ways to spend it.</h2>
<div class="day">
${slot('gym-sm', 'Hotel gym with free weights', '8 am', 'Swim &amp; gym', 'A gym session, then laps before the city wakes up.')}
${slot('4-sm', 'Hotel daybed beside a pool', '12 pm', 'Daybed &amp; long lunch', 'Order from the pool bar, stay put till three.')}
${slot('3-sm', 'Spa treatment table', '3 pm', 'Spa afternoon', 'Steam, sauna, a treatment if the hotel offers one.')}
${slot('1-sm', 'Hotel pool at dusk', '6 pm', 'Golden hour', 'Last swim as the lights come on.')}
</div></section>
<section class="steps" data-rv><div><span class="kicker">How it works</span><h2>Book the pool, <em>not</em> the room.</h2></div>
<ol><li><span>01</span><div><b>Find a hotel</b><p>Pools, gyms and spas — each listing shows hours, the pass and exactly what's included.</p></div></li>
<li><span>02</span><div><b>Pick a pass and a day</b><p>See the price before you confirm.</p></div></li>
<li><span>03</span><div><b>Show up, switch off</b><p>Check in at the desk and the day is yours.</p></div></li></ol></section>
<section id="explore" data-rv><div class="sec-row"><div><span class="kicker sand">Example listings · not real hotels</span><h2>${exploreTitle === 'Example listings' ? "A taste of what's <em>coming.</em>" : exploreTitle}</h2></div>${filtered ? '<a class="clear" href="/#explore">Clear filters</a>' : ''}</div>
<p class="home-note">Shown while the site is in demo mode. These hotels are fictional. No real bookings are taken. <a href="/guides">Read the day pass guides</a>.</p>
<div class="list">${exampleCards || `<p class="home-note">${emptyCopy}</p>`}</div></section>
<section id="destinations" data-rv><span class="kicker sand">Explore by destination</span><h2>Popular destinations</h2>
<p class="home-note">The number on a card counts fictional example listings in this demo for that area. It does not mean a hotel has signed up. Coming soon means there is nothing listed there yet.</p>
<ul class="dests">${destCards}</ul></section>
<section class="faq" data-rv><div><span class="kicker sand">Good to know</span><h2>Questions, <em>answered.</em></h2></div>
<div class="faq-list"><details open><summary>Do I need to stay at the hotel?</summary><p>No. A day pass gives you the pool, gym or spa for set hours — no room booking needed.</p></details>
<details><summary>Is Hotel Day Club taking bookings?</summary><p>Not yet. Join the waitlist and we'll email you when passes open near you.</p></details>
<details><summary>What's included?</summary><p>Each hotel sets its own inclusions — pool, gym, spa and towels — and every listing spells out what your pass covers.</p></details>
<p class="faq-more"><a href="/faq">All questions</a></p></div></section>
<div class="hotels" id="hotels"><div><span class="kicker">For hotels</span><h2>Quiet pool on a Tuesday? <em>Fill it.</em></h2><p>List spare pool, gym and spa capacity for local day guests, on your terms. You choose the hours, the prices and how many guests you take.</p></div><a class="btn" href="/for-hotels">Talk to us</a></div>
<noscript><style>#waitlist{display:block;position:static;margin:24px auto 40px}</style></noscript>
<dialog id="waitlist" aria-labelledby="wl-title" data-open="${openWait ? '1' : '0'}"><div class="wl-in">
<button type="button" class="wl-x" data-close>Close</button>
<h2 id="wl-title">Join the waitlist</h2>
<p class="wl-lead">Hotel Day Club is not taking real bookings yet. Leave your email and we will write when day passes are available near you. If you run a hotel, talk to us on the <a href="/for-hotels">For hotels</a> page. No fee to join. We do not sell this list.</p>
${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ''}
${joined ? `<div class="wl-ok" role="status"><h3>You're on the list</h3><p>Thanks. We'll email you when we have news about day passes near you. If you run a hotel, the <a href="/for-hotels">For hotels</a> page is the way to reach us.</p></div>${lead}` : ''}
<form class="wl" method="post" action="/waitlist">
<div class="hp" aria-hidden="true"><label>Company website<input name="company_website" tabindex="-1" autocomplete="off" value=""></label></div>
<label class="fl">Email<input name="email" type="email" required autocomplete="email" maxlength="254" value="${esc(form.email || '')}"></label>
<label class="fl">First name <span class="opt">(optional)</span><input name="first_name" autocomplete="given-name" maxlength="60" value="${esc(form.first_name || '')}"></label>
<label class="fl">Suburb or postcode <span class="opt">(optional)</span><input name="place" maxlength="80" value="${esc(form.place || '')}"></label>
<label class="fl">Destination <span class="opt">(optional)</span><select id="wl-dest" class="hdc-pick" name="destination"><option value="" data-icon="pin">No particular place</option>${destOptions}</select></label>
<fieldset class="wl-roles"><legend>Joining as</legend>
<label class="wl-choice"><input type="radio" name="role" value="guest"${form.role === 'guest' ? ' checked' : ''} required> I'm a guest</label>
<label class="wl-choice"><input type="radio" name="role" value="hotel"${form.role === 'hotel' ? ' checked' : ''}> I'm a hotel</label>
</fieldset>
<label class="fl">Hotel name <span class="opt">(optional, hotels only)</span><input name="hotel_name" maxlength="120" value="${esc(form.hotel_name || '')}"></label>
<button class="btn" type="submit">Join the waitlist</button>
<p class="wl-note">We use this to contact you about day passes near you. To unsubscribe or ask us to delete it, email ${contactMail()}. <a href="/privacy">Privacy policy</a>.</p>
</form></div></dialog>`, { analytics: true, home: true, index: true, ...seo.pageCopy('home'), jsonld: seo.homeJsonLd(contactEmail()) });
}
app.get('/', (req, res) => {
  const { where = '', date = '', want = '', dest = '', destination = '' } = req.query;
  res.send(homePage({
    where: String(where),
    date: String(date),
    want: String(want),
    dest: String(dest),
    destination: String(destination),
    joined: req.query.waitlist === '1',
  }));
});
app.post('/waitlist', async (req, res) => {
  const parsed = parseSignup(req.body || {}, DESTINATIONS);
  const sendForm = (status, extra) => res.status(status).send(homePage({ error: extra.error, values: parsed.values || {} }));
  if (rateLimited(req.ip || 'unknown')) {
    if (parsed.honeypot) return res.redirect(303, '/?waitlist=1#waitlist');
    return sendForm(429, { error: 'Please wait a few minutes, then try the form again.' });
  }
  if (parsed.honeypot) return res.redirect(303, '/?waitlist=1#waitlist');
  if (parsed.error) return sendForm(400, parsed);
  try {
    saveSignup(db, parsed.row);
  } catch (err) {
    console.error('waitlist: database save failed ' + err.message + ' ' + JSON.stringify({
      email: parsed.row.email,
      first_name: parsed.row.first_name,
      place: parsed.row.place,
      role: parsed.row.role,
      hotel_name: parsed.row.hotel_name,
      destination: parsed.row.destination,
    }));
  }
  await notifyWebhook(parsed.row);
  res.redirect(303, '/?waitlist=1#waitlist');
});

app.get('/h/:slug', (req, res) => {
  const h = publicHotel(req.params.slug); if (!h) return sendNotFound(res);
  recordListingView(db, h.id, today(), req);
  const maxDate = ymd(addDays(new Date(), 90));
  let date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) && req.query.date >= today() && req.query.date <= maxDate ? req.query.date : today();
  const passes = getPasses(h.id);
  const av = availability(h.id, date);
  const from = passes.length ? Math.min(...passes.map(p => p.price)) : 0;
  const items = loadInclusions(db, h.id);
  const closed = [];
  for (let i = 0; i < 90; i++) {
    const d = ymd(addDays(new Date(), i));
    if (closureReason(db, h, d)) closed.push(d);
  }
  const demo = Number(h.is_demo) === 1;
  const photo = h.photos[0] ? seo.absolute('/assets/photos/' + h.photos[0]) : seo.DEFAULT_IMAGE;
  res.send(page(h.name, listingHtml({
    h, date, minDate: today(), maxDate, closed: closed.join(','), passes, av, from,
    hoursLine: hoursView(db, h, date).hoursLine,
    cancel: cancelNote(db, h, date),
    beats: beatsHtml(items),
    included: includedHtml(items),
    addonList: addonsHtml(items),
    hours: hoursHtml(hoursLines(db, h)),
    policy: policyHtml(h),
    arrival: arrivalHtml(h),
  }), {
    analytics: true,
    index: demo ? 'follow' : true,
    path: '/h/' + h.slug,
    documentTitle: seo.listingTitle(h.name),
    description: seo.listingDescription(h),
    image: photo,
    imageAlt: demo ? 'Stock photo, not this hotel' : seo.shortName(h.name),
    jsonld: seo.listingJsonLd(h, { from, image: photo }),
  }));
});

app.get('/api/availability', (req, res) => {
  const h = publicHotel(req.query.hotel); if (!h) return res.status(404).json({ error: 'not found' });
  const date = req.query.date || today();
  const passes = availability(h.id, date);
  res.json({ hotel: h.slug, date, passes, day_left: passes.day_left ?? null, addons: addonAvailability(h.id, date), cancel: cancelNote(db, h, date) });
});

function validate(q) {
  const h = publicHotel(q.hotel); if (!h) return { err: 'Hotel not found.' };
  const date = String(q.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { err: 'Pick a date.', h };
  const qty = Math.max(1, Math.min(6, parseInt(q.qty, 10) || 1));
  const p = getPasses(h.id).find(x => x.code === q.pass); if (!p) return { err: 'Pick a pass.', h };
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
const errPage = (v, res) => res.status(409).send(page('Not available', `<div class="wrap sec narrow"><div class="alert">${esc(v.err)}</div>${v.h ? `<a class="btn btn-navy" href="/h/${v.h.slug}">Back to ${esc(v.h.name)}</a>` : ''}</div>`, { analytics: true, index: false, canonical: false }));

app.get('/checkout', (req, res) => {
  const v = validate(req.query); if (v.err) return errPage(v, res);
  const { h, p, date, qty, people } = v;
  const grand = p.price * qty + v.addonTotal;
  const cancel = cancelNote(db, h, date);
  const picked = new Set(v.addons.map(x => x.code));
  const offer = addonAvailability(h.id, date);
  const addonFields = offer.length ? `<details class="extras" id="addon-block"><summary><span class="extra-label">Add extras <span class="extra-opt">(optional)</span></span></summary><div class="extra-list" id="co-addons">${offer.map(ad => {
    const need = ad.per === 'booking' ? 1 : people;
    const dis = ad.remaining < need;
    const on = !dis && picked.has(ad.code);
    const price = !dis && Number(ad.price) > 0 ? `<span class="extra-price">${money(ad.price)}</span>` : '';
    const note = dis ? '<span class="extra-note">Sold out for this date</span>' : '';
    return `<label class="extra${dis ? ' is-off' : ''}"><input type="checkbox" name="addon" value="${esc(ad.code)}" data-price="${Number(ad.price) || 0}" data-per="${esc(ad.per)}" ${dis ? 'disabled' : ''} ${on ? 'checked' : ''}><span class="extra-name">${esc(ad.name)}</span>${price}${note}</label>`;
  }).join('')}</div></details>` : '';
  res.send(page('Checkout', `<div class="wrap sec checkout">
<a class="link small" href="/h/${h.slug}?date=${date}">← Back to listing</a><h1 class="l-title">Confirm and pay</h1>
<div class="co-grid"><form class="co-form" method="post" action="/book">
${['hotel', 'date', 'qty'].map(k => `<input type="hidden" name="${k}" value="${esc(req.query[k])}">`).join('')}<input type="hidden" name="pass" value="${p.code}">
<p class="demo-caution">Demo site, please don't enter real personal or payment details</p>
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
<p class="cancel-note">${esc(cancel)} <a href="/refunds">Cancellation and refunds</a></p>
${riskCard(h)}
<label class="tick"><input type="checkbox" name="rules" value="1" required> <span>I've read and accept these pool rules.</span></label>
<label class="tick"><input type="checkbox" name="terms" value="1" required> <span>I accept the <a href="/terms">customer terms</a>, the <a href="/refunds">cancellation and refund policy</a>, and the <a href="/privacy">privacy notice</a>.</span></label>
<label class="tick"><input type="checkbox" name="risk" value="1" required> <span>${esc(riskTick(h))}</span></label>
<label class="tick"><input type="checkbox" name="marketing" value="1"> <span>Email me about day passes. Optional, and separate from this booking.</span></label>
<p class="privacy-note">We use your name, email and mobile to hold this booking and show it to the hotel. Some providers store data overseas. <a href="/privacy">Privacy policy</a></p>
<button class="btn btn-coral full" id="co-btn" type="submit">Confirm booking · ${money(grand)} (demo)</button></form>
<aside class="co-sum"><img src="/assets/photos/${h.photos[0]}" alt="${esc(Number(h.is_demo) === 1 ? 'Stock photo, not this hotel' : 'Photo of ' + seo.shortName(h.name))}" width="1200" height="900"><div class="pad"><h3>${esc(h.name)}</h3><p class="muted small">${esc(h.area)}</p>
<dl><dt>Date</dt><dd>${esc(nice(date))}</dd><dt>Pass</dt><dd>${esc(spotLabel(p))} × ${qty}</dd><dt>Guests</dt><dd>${people}</dd></dl>
<p class="cancel-note">${esc(cancel)}</p>
<ul class="addon-lines" id="addon-lines">${v.addons.map(ad => `<li><span>${esc(ad.name)} × ${ad.qty}</span><b>${money(ad.line)}</b></li>`).join('')}</ul>
<div class="bb-total"><span>Total</span><b id="co-total">${money(grand)}</b></div><p class="muted small">Prices include GST. Demo only.</p></div></aside></div></div>
<script>
const pass=${p.price}, spots=${qty}, people=${people};
const fmt=n=>'$'+n.toLocaleString('en-AU');
function paint(){let extra=0;const lines=[];
 document.querySelectorAll('#co-addons input:checked').forEach(i=>{const price=+i.dataset.price,q=i.dataset.per==='booking'?1:people;extra+=price*q;const name=i.parentElement.querySelector('.extra-name').textContent;const cost=price>0?'<b>'+fmt(price*q)+'</b>':'';lines.push('<li><span>'+name+' × '+q+'</span>'+cost+'</li>')});
 const total=pass*spots+extra;
 const box=document.getElementById('addon-lines'); if(box) box.innerHTML=lines.join('');
 const el=document.getElementById('co-total'); if(el) el.textContent=fmt(total);
 const btn=document.getElementById('co-btn'); if(btn) btn.textContent='Confirm booking · '+fmt(total)+' (demo)';
}
document.querySelectorAll('#co-addons input').forEach(i=>i.onchange=paint);paint();
</script>`, { analytics: true, index: false, canonical: false }));
});

app.post('/book', (req, res) => {
  const b = req.body;
  const name = String(b.name || '').trim(), email = String(b.email || '').trim(), phone = String(b.phone || '').trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || phone.replace(/\D/g, '').length < 8) return errPage({ err: 'Please enter your name, a valid email and a mobile number.', h: publicHotel(b.hotel) }, res);
  let code, v;
  db.transaction(() => {
    v = validate(b); if (v.err) return;
    const ticked = key => b[key] === '1' || b[key] === 'on';
    if (!ticked('rules')) { v = { err: 'Please accept the pool rules.', h: v.h }; return; }
    if (!ticked('terms')) { v = { err: 'Please accept the customer terms.', h: v.h }; return; }
    if (!ticked('risk')) { v = { err: 'Please accept the risk warning.', h: v.h }; return; }
    code = newCode();
    const seen = hoursView(db, v.h, v.date);
    const note = cancelNote(db, v.h, v.date);
    const info = db.prepare(`INSERT INTO bookings(code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,party,rules_ack_at,rules_text,marketing_opt_in,terms_ack_at,risk_ack_at,risk_text,cancel_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),?,?,datetime('now','localtime'),datetime('now','localtime'),?,?)`)
      .run(code, v.h.id, v.p.id, v.date, v.qty, v.p.price, v.p.price * v.qty + v.addonTotal, name, email, phone, v.people, rulesText(v.h, seen), b.marketing === '1' ? 1 : 0, riskText(v.h), note);
    const insAdd = db.prepare('INSERT INTO booking_addons(booking_id,addon_id,name,qty,unit_price,total) VALUES (?,?,?,?,?,?)');
    for (const ad of v.addons) insAdd.run(info.lastInsertRowid, ad.id, ad.name, ad.qty, ad.price, ad.line);
  }).immediate();
  if (v.err) return errPage(v, res);
  res.redirect(303, '/booking/' + code);
});

const bookingFull = code => db.prepare(`SELECT b.*, h.name hotel, h.slug, h.area, h.photos, h.address, h.lat, h.lng, h.id hotel_id_join, p.name pass, p.holds FROM bookings b JOIN hotels h ON h.id=b.hotel_id JOIN pass_types p ON p.id=b.pass_type_id WHERE b.code=?`).get(code);
const bookingHits = new Map();
const BOOKING_WINDOW_MS = 15 * 60 * 1000;
const BOOKING_MAX = 30;
function bookingLimited(ip) {
  const now = Date.now();
  let row = bookingHits.get(ip);
  if (!row || now - row.start > BOOKING_WINDOW_MS) {
    row = { start: now, n: 0 };
    bookingHits.set(ip, row);
  }
  row.n += 1;
  if (bookingHits.size > 4000) {
    for (const [key, value] of bookingHits) if (now - value.start > BOOKING_WINDOW_MS) bookingHits.delete(key);
  }
  return row.n > BOOKING_MAX;
}
function bookingPrivate(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
}
function rejectBookingLookup(res) {
  bookingPrivate(res);
  res.set('Retry-After', '900');
  return res.status(429).type('text/plain; charset=utf-8').send('Too many booking lookups. Try again in 15 minutes.');
}
function directionsHref(hotel) {
  const lat = Number(hotel.lat);
  const lng = Number(hotel.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) {
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=17/${lat}/${lng}`;
  }
  const address = String(hotel.address || '').trim();
  if (!address) return '';
  return 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(address);
}
function icsEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function bookingIcs(b, hotel) {
  const day = String(b.date || '').replace(/-/g, '');
  const end = day && /^\d{8}$/.test(day) ? ymd(addDays(new Date(b.date + 'T00:00:00'), 1)).replace(/-/g, '') : day;
  const where = String(hotel.address || hotel.area || '').trim();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hotel Day Club//EN',
    'BEGIN:VEVENT',
    `UID:${icsEscape(b.code)}@hoteldayclub.com.au`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${icsEscape('Day pass at ' + (hotel.name || 'Hotel Day Club'))}`,
    `DESCRIPTION:${icsEscape('Booking ' + b.code + '. Show this code at reception.')}`,
    where ? `LOCATION:${icsEscape(where)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ];
  return lines.filter(Boolean).join('\r\n');
}
app.get('/booking/:code/calendar.ics', (req, res) => {
  if (bookingLimited(req.ip || 'unknown')) return rejectBookingLookup(res);
  const b = bookingFull(String(req.params.code || '').toUpperCase());
  bookingPrivate(res);
  if (!b) return res.status(404).type('text/plain; charset=utf-8').send('Booking not found.');
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(b.hotel_id);
  res.type('text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${b.code}.ics"`);
  res.send(bookingIcs(b, hotel));
});
app.get('/booking/:code', async (req, res) => {
  if (bookingLimited(req.ip || 'unknown')) return rejectBookingLookup(res);
  const b = bookingFull(String(req.params.code || '').toUpperCase());
  if (!b) return sendNotFound(res, { analyticsPath: '/booking' });
  const qr = await QRCode.toDataURL(`HDC:${b.code}`, { margin: 1, width: 260, color: { dark: '#0B2545' } });
  const adds = bookingAddons(b.id);
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(b.hotel_id);
  const view = hoursView(db, hotel, b.date);
  const when = view.span || view.hoursLine;
  const party = b.party || b.qty * (b.holds || 1);
  const bookedAt = b.created_at ? new Date(String(b.created_at).replace(' ', 'T')) : new Date();
  const note = b.cancel_note || cancelNote(db, hotel, b.date, bookedAt);
  const shownName = maskName(b.guest_name);
  const shownEmail = maskEmail(b.email);
  const mapHref = directionsHref(hotel);
  const status = b.status === 'cancelled' ? 'Cancelled' : b.checked_in_at ? 'Checked in ' + b.checked_in_at : 'Confirmed';
  bookingPrivate(res);
  res.send(page('Booking confirmed', `<div class="wrap sec narrow confirm">
<div class="ok-badge">${ICON.check}</div><h1 class="l-title center">You're booked in.</h1>
<p class="center muted">Your confirmation is saved on this page. No email is sent in this demo.</p>
<div class="ticket"><div class="t-top"><img src="/assets/photos/${JSON.parse(b.photos)[0]}" alt="${esc(/\(Demo\)/.test(b.hotel) ? 'Stock photo, not this hotel' : 'Photo of ' + seo.shortName(b.hotel))}" width="1200" height="900"><div><h3>${esc(b.hotel)}</h3><p class="muted small">${esc(b.area)}, Australia</p></div></div>
<div class="t-mid"><img class="qr" src="${qr}" alt="QR code for ${esc(b.code)}"><div class="code">${esc(b.code)}</div><p class="muted small">Show this at reception</p></div>
<dl><dt>Guest</dt><dd>${esc(shownName)}</dd>${shownEmail ? `<dt>Email</dt><dd>${esc(shownEmail)}</dd>` : ''}<dt>Date</dt><dd>${esc(nice(b.date))}${when ? ` · ${esc(when)}` : ''}</dd><dt>Pass</dt><dd>${esc(spotLabel({ name: b.pass, holds: b.holds }))} × ${b.qty}</dd><dt>Guests</dt><dd>${party}</dd><dt>Paid</dt><dd>${money(b.total)} <span class="muted small">(demo, no charge)</span></dd><dt>Cancellation</dt><dd>${esc(note)}</dd><dt>Rules</dt><dd>${b.rules_ack_at ? 'Accepted' : '—'}</dd><dt>Terms</dt><dd>${b.terms_ack_at ? 'Accepted' : '—'}</dd><dt>Risk warning</dt><dd>${b.risk_ack_at ? 'Accepted' : '—'}</dd><dt>Status</dt><dd>${esc(status)}</dd></dl>
<p class="swim-note">${esc(swimNote(hotel))}</p>
${adds.length ? `<div class="ticket-adds"><b>Add-ons</b><ul>${adds.map(a => `<li><span>${esc(a.name)} × ${a.qty}</span><b>${money(a.total)}</b></li>`).join('')}</ul></div>` : ''}</div>
<p class="center" style="margin-top:16px"><a class="btn btn-line" href="/booking/${encodeURIComponent(b.code)}/calendar.ics">Add to calendar</a>${mapHref ? ` <a class="btn btn-line" href="${esc(mapHref)}">Directions</a>` : ''}</p>
<div class="center" style="margin-top:12px"><a class="btn btn-line" href="/">Book another day</a></div></div>`, { analytics: true, analyticsPath: '/booking', index: false, canonical: false }));
});

const hotelAuth = (req, res, next) => { const id = req.signedCookies.hotel; const h = id && db.prepare('SELECT * FROM hotels WHERE id=?').get(id); if (!h) return res.redirect('/hotel/login'); req.hotel = hotelRow(h); next(); };
app.get('/for-hotels', (req, res) => {
  const href = esc(talkHref());
  res.send(page('For hotels', `<div class="wrap fh">
<p class="fh-kicker">For hotels</p>
<h1>A quiet pool, <em>put to use.</em></h1>
<p class="fh-lead">Hotel Day Club is for hotels in Australia. Local guests come for the pool, the gym or the spa for the day. They do not need a room.</p>
<div class="fh-grid">
<article class="fh-card"><h2>Fill the quiet hours</h2><p>Weekday pool, gym and spa time often has room in it. Day guests can take that time.</p></article>
<article class="fh-card"><h2>Welcome local guests</h2><p>They are new people through the door. While they are with you, they may spend on food and drinks.</p></article>
</div>
<article class="fh-card fh-wide"><h2>You stay in control</h2><p>What the hotel offers is tailored with you. The details are agreed together, and nothing is set until you are happy with it.</p></article>
</div>
<section class="fh-pilot"><div class="wrap">
<p class="fh-kicker">A short pilot</p>
<h2>See if it suits the hotel.</h2>
<p>A brief trial is a simple way to find out. We shape it with you, then you decide. Write to us and we will be in touch.</p>
<a class="btn btn-coral" href="${href}">Talk to us</a>
<p class="fh-mail">Email ${contactMail()}</p>
</div></section>`, { analytics: true, index: true, ...seo.pageCopy('hotels'), jsonld: seo.graph(seo.crumbs([{ name: 'For hotels', path: '/for-hotels' }])) }));
});
app.get('/hotel/join', (req, res) => res.redirect(302, '/for-hotels'));
app.post('/hotel/join', (req, res) => res.redirect(303, '/for-hotels'));
const LEGAL_LINKS = '<p class="legal-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refunds">Refunds</a></p>';
app.get('/hotel/login', (req, res) => {
  res.send(page('Hotel login', `<div class="wrap sec narrow"><div class="login-card"><h1 class="l-title">Hotel login</h1>
${req.query.e ? '<div class="alert">Wrong username or password.</div>' : ''}
<form method="post" action="/hotel/login"><label class="fl">Username<input name="user" required autocomplete="username"></label><label class="fl">Password<input name="pass" type="password" required autocomplete="current-password"></label>
<button class="btn btn-navy full">Log in</button></form>
<p class="center" style="margin-top:16px"><a href="/for-hotels">For hotels</a></p>
${LEGAL_LINKS}</div></div>`, { bare: true, index: false, canonical: false }));
});
app.post('/hotel/login', (req, res) => {
  const login = String(req.body.user || '').trim();
  const pass = String(req.body.pass || '');
  const h = db.prepare('SELECT * FROM hotels WHERE login=?').get(login);
  if (!verifyPassword(pass, h && h.password) || !h) return res.redirect('/hotel/login?e=1');
  staffCookie(res, 'hotel', String(h.id));
  res.redirect('/hotel');
});
app.get('/hotel/logout', (req, res) => { clearStaffCookie(res, 'hotel'); res.redirect('/hotel/login'); });

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
  const links = [['/hotel#today', 'Today'], ['/hotel/analytics', 'Analytics'], ['/hotel/checkin', 'Check in'], ['/hotel/settings', 'Settings'], ['/hotel#lookup', 'Lookup'], ['/hotel#upcoming', 'Upcoming'], ['/hotel#avail', 'Availability'], ['/hotel#addons', 'Add-ons'], ['/hotel#blocked', 'Blocked dates']];
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
  delete row.password;
  const locked = new Set(db.prepare('SELECT DISTINCT pass_type_id id FROM bookings WHERE hotel_id=?').all(row.id).map(r => r.id));
  res.send(dashShell(req.hotel, `${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<p class="eyebrow-s">Settings</p><h1 class="l-title">Your offering</h1>
<p class="muted">Passes, hours, what's included, getting there and pool rules. Guests see this on the listing.</p>
${offeringForm({ action: '/hotel/settings', hotel: row, spots: getPasses(row.id), hours: hoursFor(db, row.id), lockedIds: locked, error: req.query.e || '' })}
${inclusionsForm(loadInclusions(db, row.id))}
${arrivalForm(row)}`, { here: '/hotel/settings' }));
});
app.post('/hotel/settings', hotelAuth, (req, res) => {
  const result = db.transaction(() => saveOffering(db, req.hotel.id, req.body))();
  if (result.err) return res.redirect('/hotel/settings?e=' + encodeURIComponent(result.err));
  const extra = result.kept && result.kept.length ? ' Kept seating that already has bookings: ' + result.kept.join(', ') + '.' : '';
  res.redirect('/hotel/settings?msg=' + encodeURIComponent('Saved. Guests see this on the listing.' + extra));
});

app.get('/hotel/analytics', hotelAuth, (req, res) => {
  seedPerformance(db);
  const report = buildAnalytics(db, req.hotel, { days: normalRange(req.query.range), today: today() });
  res.set('Cache-Control', 'no-store');
  res.send(dashShell(req.hotel, renderAnalytics(report), { here: '/hotel/analytics' }));
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
<div class="dash-actions"><a class="btn btn-line" href="/hotel/analytics">Analytics</a><a class="btn btn-navy" href="/hotel/checkin">Check in a guest</a></div></div>
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
<p class="muted small">Optional extras. Turn one on, then set the price and how many you can take in a day. Included items, parking and getting there are set in <a href="/hotel/settings">Settings</a>. Late access cannot overlap room guests only, and it cannot run past the pool's closing time.</p>
<form method="post" action="/hotel/addons"><div class="addon-edit">
${addonsAll.map(a => {
  const closed = closureReason(db, h, t);
  const left = a.enabled ? (closed ? 0 : Math.max(0, a.daily_cap - addonSold(a.id, t))) : null;
  const lateOk = a.code !== 'late' || hotelLatePossible(db, h);
  const lateNote = a.code !== 'late' ? '' : `<div class="muted small">${lateOk ? 'Only after room guests only has ended, and only until the pool closes.' : 'Leave this off. It would overlap room guests only or run past closing.'}</div>`;
  return `<div class="addon-row"><label class="addon-on"><input type="checkbox" name="on" value="${a.id}" ${a.enabled ? 'checked' : ''}> Offer</label><div><b>${esc(a.name)}</b><div class="muted small">${esc(a.blurb)} · ${a.per === 'booking' ? 'per booking' : 'per person'}</div>${lateNote}<div class="addon-nums"><label>Price<input class="num" type="number" min="0" step="1" name="aprice_${a.id}" value="${a.price ? a.price : ''}" placeholder="Blank" title="Leave blank if there is no charge"></label><label>Each day<input class="num" type="number" min="0" step="1" name="acap_${a.id}" value="${a.daily_cap}"></label>${left == null ? '<span class="muted small">Off</span>' : `<span class="muted small">${left} left today</span>`}</div></div></div>`;
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
  if (!hotel || !/^\d{4}-\d{2}-\d{2}$/.test(data.d || '')) return res.status(400).send(page('Link expired', `<div class="wrap sec narrow"><h1 class="l-title">This link has expired</h1><p class="muted">Open tonight's email again from the dashboard, or <a href="/hotel/login">log in</a>.</p></div>`, { bare: true, index: false, canonical: false }));
  const msg = data.a === 'cap' ? capDate(hotel.id, data.d, data.n) : pauseDate(hotel.id, data.d, 'pause').msg;
  staffCookie(res, 'hotel', String(hotel.id));
  res.send(page('Saved', `<div class="wrap sec narrow"><h1 class="l-title">${esc(msg)}</h1><p class="muted">${esc(hotel.name)} · ${esc(nice(data.d))}</p><p style="margin-top:18px"><a class="btn btn-navy" href="/hotel">Back to dashboard</a></p></div>`, { bare: true, index: false, canonical: false }));
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
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(req.hotel.id);
  const allowLate = hotelLatePossible(db, hotel);
  const up = db.prepare('UPDATE addons SET enabled=?, price=?, daily_cap=? WHERE id=? AND hotel_id=?');
  let blocked = false;
  db.transaction(() => getAddons(req.hotel.id).forEach(a => {
    const rawPrice = String(req.body['aprice_' + a.id] ?? '').trim();
    const price = rawPrice === '' ? 0 : parseInt(rawPrice, 10);
    const cap = parseInt(req.body['acap_' + a.id], 10);
    let enabled = on.has(a.id) ? 1 : 0;
    if (a.code === 'late' && enabled && !allowLate) { enabled = 0; blocked = true; }
    const usePrice = rawPrice === '' ? 0 : (Number.isFinite(price) ? Math.max(0, price) : (a.price || 0));
    const useCap = Number.isFinite(cap) ? Math.max(0, cap) : a.daily_cap;
    enabled = syncAddonEdit(db, req.hotel.id, a.code, enabled, usePrice, useCap);
    up.run(enabled, usePrice, useCap, a.id, req.hotel.id);
  }))();
  const msg = blocked ? "Late access stays off. It can't overlap room guests only or run past the pool's closing time." : 'Add-ons saved. Guests see the changes straight away.';
  res.redirect(303, '/hotel?msg=' + encodeURIComponent(msg) + '#addons');
});
app.post('/hotel/inclusions', hotelAuth, (req, res) => {
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(req.hotel.id);
  const result = saveInclusions(db, req.hotel.id, req.body, { allowLate: hotelLatePossible(db, hotel) });
  const msg = result.lateBlocked ? "Late stay stays off. It can't overlap room guests only or run past the pool's closing time." : "Saved what's included.";
  res.redirect(303, '/hotel/settings?msg=' + encodeURIComponent(msg) + '#included');
});
app.post('/hotel/arrival', hotelAuth, (req, res) => {
  const result = saveArrival(db, req.hotel.id, req.body);
  if (result.err) return res.redirect('/hotel/settings?e=' + encodeURIComponent(result.err) + '#arrive-edit');
  res.redirect(303, '/hotel/settings?msg=' + encodeURIComponent('Saved getting there.') + '#arrive-edit');
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
const adminFails = new Map();
const ADMIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_FAILS = 5;
function adminFailure(ip) {
  const now = Date.now();
  let row = adminFails.get(ip);
  if (!row || now - row.start > ADMIN_WINDOW_MS) row = { start: now, n: 0 };
  row.n += 1;
  adminFails.set(ip, row);
  return row.n >= ADMIN_MAX_FAILS;
}
function adminLocked(ip) {
  const row = adminFails.get(ip);
  if (!row) return false;
  if (Date.now() - row.start > ADMIN_WINDOW_MS) { adminFails.delete(ip); return false; }
  return row.n >= ADMIN_MAX_FAILS;
}
app.get('/admin/login', (req, res) => {
  const alert = req.query.e === 'lock'
    ? '<div class="alert">Too many tries. Wait 15 minutes, then try again.</div>'
    : req.query.e ? '<div class="alert">Wrong username or password.</div>' : '';
  res.send(page('Admin login', `<div class="wrap sec narrow"><div class="login-card"><h1 class="l-title">Admin login</h1>${alert}
<form method="post" action="/admin/login"><label class="fl">Username<input name="user" required autocomplete="username"></label><label class="fl">Password<input name="pass" type="password" required autocomplete="current-password"></label><button class="btn btn-navy full">Log in</button></form>
${LEGAL_LINKS}</div></div>`, { bare: true, index: false, canonical: false }));
});
app.post('/admin/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (adminLocked(ip)) return res.redirect('/admin/login?e=lock');
  const userOk = safeEqual(String(req.body.user || ''), ADMIN_USER);
  const passOk = safeEqual(String(req.body.pass || ''), adminPassword());
  if (!userOk || !passOk) {
    adminFailure(ip);
    return res.redirect('/admin/login?e=' + (adminLocked(ip) ? 'lock' : '1'));
  }
  adminFails.delete(ip);
  staffCookie(res, 'admin', 'jason');
  res.redirect('/admin');
});
app.get('/admin/logout', (req, res) => { clearStaffCookie(res, 'admin'); res.redirect('/'); });
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
  const waitRows = db.prepare('SELECT * FROM waitlist ORDER BY id DESC LIMIT 500').all();
  const pendingHtml = pending.map(h => {
    const spots = getPasses(h.id);
    return `<div class="pending-row"><div><b>${esc(h.name)}</b><div class="muted small">${esc(h.area)} · ${esc(h.contact_name || 'No contact name')} · ${esc(h.contact_email || '')}</div>
<div class="muted small">${esc(h.hours || '')}</div><div class="small">${spots.map(s => `${esc(spotLabel(s))} · ${money(s.price)} · ${s.daily_cap} a day`).join('<br>')}</div></div>
<form method="post" action="/admin/approve"><input type="hidden" name="id" value="${h.id}"><button class="btn btn-navy">Approve</button></form></div>`;
  }).join('');
  res.send(page('Admin', `<div class="wrap sec">
${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<p class="eyebrow-s">Platform admin · Jason</p><h1 class="l-title">All bookings</h1>
<p><a class="btn btn-line" href="/admin/backups">Backups and exports</a></p>
${pending.length ? `<section class="panel"><h2 class="ph2">Pending approval</h2>${pendingHtml}</section>` : ''}
<div class="stats">${stat('Bookings', tot.n, tot.passes + ' spots')}${stat('Gross sales', money(tot.gross), `Includes ${money(addonAll)} add-ons`)}${stat('Paid to hotels (75%)', money(tot.gross * HOTEL_SHARE))}${stat('Platform commission (25%)', money(tot.gross * (1 - HOTEL_SHARE)), 'Hotel Day Club revenue')}</div>
<p class="muted small" style="margin:-8px 0 16px">Gross includes add-ons. Commission stays at 25% of that gross.</p>
<section class="panel"><h2 class="ph2">By hotel</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Hotel</th><th>Bookings</th><th>Spots</th><th>Today</th><th>Gross</th><th>Hotel 75%</th><th>Commission 25%</th></tr></thead><tbody>
${per.map(r => `<tr><td><a class="link" href="/admin?hotel=${r.id}#all"><b>${esc(r.name)}</b></a><div class="muted small">${esc(r.area)}</div></td><td>${r.n}</td><td>${r.passes}</td><td>${r.today}</td><td>${money(r.gross)}</td><td>${money(r.gross * HOTEL_SHARE)}</td><td><b>${money(r.gross * (1 - HOTEL_SHARE))}</b></td></tr>`).join('')}
<tr class="tot"><td>Total</td><td>${tot.n}</td><td>${tot.passes}</td><td>${tot.today}</td><td>${money(tot.gross)}</td><td>${money(tot.gross * HOTEL_SHARE)}</td><td>${money(tot.gross * (1 - HOTEL_SHARE))}</td></tr></tbody></table></div></section>
<section class="panel" id="all"><h2 class="ph2">Latest bookings</h2><form class="lookup" method="get" action="/admin#all"><select name="hotel"><option value="">All hotels</option>${per.map(r => `<option value="${r.id}" ${r.id === hid ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select><input name="q" value="${esc(q)}" placeholder="Code, name or email"><button class="btn btn-navy">Filter</button></form>
${guestList(rows, { checkin: false, hotelCol: true, log: false })}<p class="muted small">Showing the latest ${rows.length} (max 100).</p></section>
<section class="panel"><h2 class="ph2">Guest notes</h2>${notes.length ? notes.map(n => `<div class="pending-row"><div><b>${n.kind === 'incident' ? 'Incident' : 'No-show'}</b> · ${esc(n.guest_name)} · ${esc(n.code)}<div class="muted small">${esc(n.hotel)} · ${esc(nice(n.date))} · ${esc(hhmm(n.created_at))}${n.note ? ' · ' + esc(n.note) : ''}</div></div></div>`).join('') : '<p class="muted">No notes yet. Hotels log a no-show or an incident from the guest list.</p>'}</section>
<section class="panel" id="waitlist"><h2 class="ph2">Waitlist</h2>
<p class="muted small">${paths.dataDir()
  ? 'These rows are stored in the database on the persistent disk. They are not shown on the public site. Download a CSV or a database backup if you want a copy off this server.'
  : 'These rows are stored on this server only. They are not shown on the public site. Download the CSV before a redeploy if the spreadsheet connection is not set up. This disk is cleared when the app is redeployed.'}</p>
<p><a class="btn btn-navy" href="/admin/waitlist.csv">Download CSV</a></p>
${waitRows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Name</th><th>Place</th><th>Role</th><th>Hotel</th><th>Destination</th><th>Added</th><th></th></tr></thead><tbody>
${waitRows.map(w => `<tr><td>${esc(w.email)}</td><td>${esc(w.first_name)}</td><td>${esc(w.place)}</td><td>${esc(w.role)}</td><td>${esc(w.hotel_name)}</td><td>${esc(w.destination)}</td><td>${esc(w.created_at)}</td><td><form method="post" action="/admin/waitlist/delete"><input type="hidden" name="id" value="${w.id}"><button class="btn btn-line">Delete</button></form></td></tr>`).join('')}
</tbody></table></div>` : '<p class="muted">No waitlist signups stored on this server.</p>'}
</section></div>`, { nav: 'admin' }));
});
app.get('/admin/waitlist.csv', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT email, first_name, place, role, hotel_name, destination, created_at, updated_at FROM waitlist ORDER BY id').all();
  sendCsv(res, 'waitlist.csv', waitlistCsv(rows));
});
app.post('/admin/waitlist/delete', adminAuth, (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (id) db.prepare('DELETE FROM waitlist WHERE id=?').run(id);
  res.redirect('/admin?msg=' + encodeURIComponent(id ? 'Removed that waitlist signup.' : 'Nothing to remove.') + '#waitlist');
});

function privateDownload(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Referrer-Policy', 'no-referrer');
}
function sendCsv(res, filename, body) {
  privateDownload(res);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}
app.get('/admin/backups', adminAuth, (req, res) => {
  const latest = backups.latestBackup();
  const when = latest ? backups.formatSydney(new Date(latest.mtimeMs)) : 'No backup yet';
  const size = latest ? backups.formatBytes(latest.bytes) : '—';
  const auto = paths.dataDir()
    ? 'Automatic backups are on. A copy runs at 3:30am Sydney time, and also at startup when the newest file is older than 24 hours. The newest 14 files are kept.'
    : 'Automatic backups are off because DATA_DIR is not set. Back up now still saves a file next to the database. On the free plan that file is wiped with the server disk.';
  res.set('Cache-Control', 'no-store');
  res.send(page('Backups', `<div class="wrap sec">
${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<p class="eyebrow-s">Platform admin · Jason</p><h1 class="l-title">Backups</h1>
<p><a class="link" href="/admin">Back to all bookings</a></p>
<section class="panel"><h2 class="ph2">Database copy</h2>
<p>Last backup: <b>${esc(when)}</b></p>
<p>Size: <b>${esc(size)}</b>${latest ? ` · ${esc(latest.name)}` : ''}</p>
<p class="muted small">${esc(auto)} The file is a consistent SQLite snapshot. It includes bookings, hotels, waitlist rows and guest notes. Download it if you want a copy off this server. It is not a public link.</p>
<form method="post" action="/admin/backups"><button class="btn btn-navy">Back up now</button></form>
<p style="margin-top:14px"><a class="btn btn-line" href="/admin/backups/latest">Download latest backup</a></p>
</section>
<section class="panel"><h2 class="ph2">Spreadsheets</h2>
<p class="muted small">These CSV files are for your own copy, for example in Google Drive. Hotels are exported without passwords. Guest notes stay in the database backup.</p>
<p><a class="btn btn-navy" href="/admin/export/bookings.csv">Download bookings CSV</a> <a class="btn btn-line" href="/admin/export/hotels.csv">Download hotels CSV</a> <a class="btn btn-line" href="/admin/waitlist.csv">Download waitlist CSV</a></p>
</section></div>`, { nav: 'admin' }));
});
app.post('/admin/backups', adminAuth, async (req, res) => {
  try {
    const made = await backups.requestBackup(db, 'manual');
    res.redirect('/admin/backups?msg=' + encodeURIComponent(`Backup saved (${made.name}, ${backups.formatBytes(made.bytes)}).`));
  } catch (err) {
    res.redirect('/admin/backups?msg=' + encodeURIComponent('Backup failed. Check the server log.'));
  }
});
app.get('/admin/backups/latest', adminAuth, (req, res) => {
  const latest = backups.latestBackup();
  if (!latest) return res.redirect('/admin/backups?msg=' + encodeURIComponent('No backup yet. Use Back up now.'));
  privateDownload(res);
  res.download(latest.file, latest.name);
});
app.get('/admin/export/bookings.csv', adminAuth, (req, res) => {
  const rows = db.prepare(`SELECT b.code, h.name AS hotel, h.slug AS hotel_slug, b.date, b.qty, b.party, b.guest_name, b.email, b.phone,
    b.status, b.unit_price, b.total, b.created_at, b.checked_in_at, b.marketing_opt_in,
    b.rules_ack_at, b.terms_ack_at, b.risk_ack_at, b.cancel_note, b.seeded
    FROM bookings b JOIN hotels h ON h.id=b.hotel_id ORDER BY b.id`).all();
  sendCsv(res, 'bookings.csv', bookingsCsv(rows));
});
app.get('/admin/export/hotels.csv', adminAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, slug, name, area, status, login, contact_name, contact_email, address FROM hotels ORDER BY id`).all();
  sendCsv(res, 'hotels.csv', hotelsCsv(rows));
});

app.get('/how-it-works', (req, res) => {
  res.send(page('How it works', `<div class="wrap hiw-hero">
<p class="eyebrow-s">How it works</p>
<h1 class="l-title">A hotel day, without the overnight.</h1>
<p class="lead">Book a hotel pool, daybed or spa for the day. No room needed. Hotels set their own passes, prices and how many guests they take.</p>
<p class="hiw-jumps"><a href="#guests">For guests</a><a href="#partners">For hotels</a><a href="#faq">Questions</a></p>
</div>
<div class="wrap hiw-block" id="guests">
<h2>For guests</h2>
<div class="how-grid">
<div><span class="n">1</span><h3>Browse</h3><p class="muted">Search by neighbourhood, date and what you want: pool, gym or spa. Each listing shows what's included and the pool rules.</p></div>
<div><span class="n">2</span><h3>Book</h3><p class="muted">Pick a sun lounger, daybed, cabana or whatever that hotel offers. Add parking, gym access or a food and drink credit if you want. Tick the pool rules, the terms and the risk warning. The total updates before you confirm. This demo doesn't charge a card.</p></div>
<div><span class="n">3</span><h3>Show your QR code</h3><p class="muted">At the front desk when the hotel opens for day passes. The hours are on your confirmation. Reception checks you in and hands you a wristband.</p></div>
<div><span class="n">4</span><h3>Enjoy</h3><p class="muted">Your spot, for the hours that hotel has set. Add-ons stay optional.</p></div>
</div>
<p style="margin-top:18px"><a class="btn btn-coral" href="/#explore">Browse pools</a></p>
<p><a href="/guides">Guides to hotel day passes</a></p>
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
<p class="hiw-cta"><a class="btn btn-coral" href="/for-hotels">Talk to us</a> <a class="btn btn-line" href="/hotel">Hotel login</a></p>
</div></section>
<div class="wrap hiw-block" id="faq">
<h2>Questions</h2>
<div class="faq">
<details open><summary>Cancellations</summary><p>Free cancellation until 24 hours before your access hours start. Checkout and your confirmation show that time for the date you chose. A booking made inside that window can't be cancelled for free. A free date change may be available once, subject to availability. <a href="/refunds">Cancellation and refunds</a>.</p></details>
<details><summary>What to bring</summary><p>Photo ID when the hotel asks for it, swimwear and sunscreen. The listing says whether a towel is included.</p></details>
<details><summary>Age limits</summary><p>You need to be 18 or over to book. Each hotel sets its own age policy and kids' hours. They're on the listing, and in the risk warning, before you pay.</p></details>
<details><summary>Weather</summary><p>Rain on its own is not a closure. If the hotel closes the pool, you choose a full refund or a free rebooking. <a href="/faq">All questions</a>.</p></details>
</div>
</div>`, { analytics: true, index: true, ...seo.pageCopy('how'), jsonld: seo.graph(seo.crumbs([{ name: 'How it works', path: '/how-it-works' }])) }));
});

// Full demo seed runs only when there are no hotels. A database that already has rows is not replaced.
if (db.prepare('SELECT COUNT(*) n FROM hotels').get().n === 0) seed(db);
else ensureAddons(db);
ensureSchedules(db);
ensureInclusions(db);
ensureArrival(db);
seedPerformance(db);
syncHoursLabels(db);
db.prepare("UPDATE hotels SET is_demo=1 WHERE login LIKE 'demo-%' OR name LIKE '%(Demo)%'").run();
migrateHotelPasswords(db);
adminPassword();

function inlineMd(text) {
  let s = esc(text);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)"']+|\/[^\s)"']*)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(>])(https?:\/\/[^\s<)"'*]+)/g, '$1<a href="$2">$2</a>');
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
const LEGAL_PAGES = {
  'privacy-policy.md': 'privacy',
  'customer-terms.md': 'terms',
  'cancellation-refund-policy.md': 'refunds',
  'guest-risk-acknowledgement.md': 'risk',
};
function legalDoc(heading, file) {
  const raw = fs.readFileSync(path.join(__dirname, 'legal', file), 'utf8');
  const article = mdToHtml(raw).split('{{CONTACT_EMAIL}}').join(contactMail()).split('{{ABN}}').join(esc(businessAbn()));
  const copy = seo.pageCopy(LEGAL_PAGES[file]);
  return page(heading, `<div class="wrap sec"><h1 class="l-title">${esc(heading)}</h1><p class="draft-notice">Draft terms for demo purposes, pending legal review.</p><article class="legal-doc">${article}</article></div>`, {
    analytics: true,
    index: seo.legalPagesIndexable() ? true : 'follow',
    ...copy,
    jsonld: seo.graph(seo.crumbs([{ name: copy.crumb, path: copy.path }])),
  });
}
app.get('/privacy', (req, res) => res.send(legalDoc('Privacy policy (draft)', 'privacy-policy.md')));
app.get('/terms', (req, res) => res.send(legalDoc('Customer terms (draft)', 'customer-terms.md')));
app.get('/refunds', (req, res) => res.send(legalDoc('Cancellation and refunds (draft)', 'cancellation-refund-policy.md')));
app.get('/risk', (req, res) => res.send(legalDoc('Risk warning (draft)', 'guest-risk-acknowledgement.md')));
app.get('/faq', (req, res) => {
  const copy = seo.pageCopy('faq');
  res.send(page('Questions', seo.faqHtml(contactMail()), {
    analytics: true,
    index: true,
    ...copy,
    jsonld: seo.faqJsonLd(contactEmail()),
  }));
});

function destinationPage(d) {
  const hotels = getHotels().filter(h => d.areas.includes(h.area));
  const cards = hotels.map(h => {
    const prices = getPasses(h.id).map(p => p.price);
    const from = prices.length ? Math.min(...prices) : 0;
    return `<article class="fh-card"><h2><a href="/h/${esc(h.slug)}">${esc(seo.shortName(h.name))}</a></h2><p>Fictional example listing in ${esc(h.area)}. Stock photos. Not a hotel that has signed up. From ${money(from)}.</p></article>`;
  }).join('');
  const body = hotels.length
    ? `<p>These are fictional example listings, not hotels that have signed up.</p><div class="fh-grid">${cards}</div>`
    : `<p>Coming soon. No listings here yet.</p><p><a class="btn btn-coral" href="/?destination=${encodeURIComponent(d.id)}#waitlist">Join the waitlist</a></p>`;
  return `<div class="wrap sec"><h1 class="l-title">${esc(d.title)}</h1><p class="lead">${esc(d.intro)}</p>${body}</div>`;
}
app.get('/destinations/:slug', (req, res) => {
  const d = destinationBySlug(req.params.slug);
  if (!d) return sendNotFound(res);
  res.send(page(d.name, destinationPage(d), {
    analytics: true,
    index: true,
    path: '/destinations/' + d.slug,
    documentTitle: seo.fullTitle(d.title),
    description: d.description,
    jsonld: seo.graph(seo.crumbs([{ name: d.name, path: '/destinations/' + d.slug }])),
  }));
});
app.get('/guides', (req, res) => {
  const copy = seo.pageCopy('guides');
  res.send(page('Guides', seo.guideIndexHtml(), {
    analytics: true,
    index: true,
    ...copy,
    jsonld: seo.graph(seo.crumbs([{ name: 'Guides', path: '/guides' }])),
  }));
});
app.get('/guides/:slug', (req, res) => {
  const guide = seo.guideBySlug(req.params.slug);
  if (!guide) return sendNotFound(res);
  res.send(page(guide.h1, seo.guideHtml(guide), {
    analytics: true,
    index: true,
    path: '/guides/' + guide.slug,
    documentTitle: seo.fullTitle(guide.title),
    description: guide.description,
    jsonld: seo.articleJsonLd(guide),
    ogType: 'article',
  }));
});

function sendNotFound(res, extra = {}) {
  const body = `<div class="wrap sec"><h1 class="l-title">Page not found</h1>
<p class="lead">That page is not on Hotel Day Club.</p>
<p><a href="/">Home</a> · <a href="/how-it-works">How it works</a> · <a href="/faq">FAQ</a> · <a href="/destinations/sydney">Sydney</a> · <a href="/destinations/gold-coast">Gold Coast</a></p></div>`;
  res.status(extra.status || 404).send(page('Page not found', body, {
    analytics: extra.analytics === false ? false : true,
    analyticsPath: extra.analyticsPath || '',
    index: false,
    canonical: false,
    documentTitle: seo.fullTitle('Page not found'),
    description: 'That page is not on Hotel Day Club.',
  }));
}
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
  sendNotFound(res, { analyticsPath: req.path.startsWith('/booking/') ? '/booking' : '' });
});

app.listen(PORT, () => {
  console.log(`Hotel Day Club demo on http://localhost:${PORT}`);
  console.log('data: database at ' + paths.dbPath());
  backups.startScheduler(db);
});
