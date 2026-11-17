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
  includedLines, includedNote, addonsHtml, inclusionsForm, beatsHtml, policyInner, guestFoodLine, PASS_FOOD_LINE, FOOD_DRINK,
} = require('./inclusions');
const { ensureArrival, saveArrival, arrivalForm, directionsHref } = require('./arrival');
const { HotelExplore, load: loadExplore, saveExplore, ensureExplore } = require('./hotelExplore');
const { ensureAccess, saveAccess, accessForm, accessBlock, forPass, byPass, hotelAreas, linkedIds } = require('./access');
const { HotelAmenities } = require('./hotelAmenities');
const { listingHtml, reassureStrip, ListingPanel, dayStepLinks } = require('./listingView');
const { ListingD2 } = require('./listingDir2');
const { HomeQuick } = require('./homeQuick');
const { LinkStyles } = require('./linkStyles');
const { buildAnalytics, renderAnalytics, recordListingView, normalRange } = require('./analytics');
const { adminPassword, verifyPassword, safeEqual, hashPassword, migrateHotelPasswords, maskName, maskEmail } = require('./passwords');
const { staffCookie, clearStaffCookie, resolveCookieSecret } = require('./session');
const { ymd, addDays, esc, money, nice } = require('./util');
const { demoSite, operatorEmail, confirmationBlurb, PUBLISHED_ABN } = require('./siteMode');
const { LegalVersions, ConsentLog, CheckoutConsent } = require('./consent');
const { CheckoutFlow } = require('./checkout');
const brand = require('./brand');
const { codeFromQrToken } = require('./qr');
const { bookingPageBody, bookingMissingBody } = require('./bookingPage');
const { AdminShell } = require('./adminShell');
const { eventWindow, bookingIcs, passCalendarLink, hotelToday, guestSiteDateBounds, HotelClock } = require('./calendar');
const { parseBookingCode } = require('./public/checkin-parse');
const { ShortCode } = require('./shortCode');
const { DateHold } = require('./dateHold');
const { sendBookingConfirmation, sendContactAlert, sendCancellation, bookingHasParking } = require('./notices');
const { BookingCancel } = require('./cancelBooking');
const { PauseBooked } = require('./pauseBooked');
const { DESTINATIONS, destIcon, destinationBySlug, guestAreaName } = require('./destinations');
const { SearchQuery } = require('./search');
const seo = require('./seo');
const compress = require('./compress');
const { parseSignup, saveSignup, notifyWebhook, rateLimited, waitlistCsv } = require('./waitlist');
const { spotsCount, spotsLabel } = require('./listingScarcity');
const { TOPICS, parseMessage, contactLimited, saveMessage, topicLabel, sameSitePost } = require('./contact');
const paths = require('./paths');
const backups = require('./backups');
const { StaticAssets } = require('./staticAssets');
const { PhotoAssets } = require('./photoAssets');
const { bookingsCsv, hotelsCsv, hotelBookingsCsv } = require('./dataExport');
const { GuestPrivacy } = require('./guestPrivacy');
const {
  KINDS, spotLabel, closureReason, rulesCard, rulesText,
  hoursFor, hoursView, hoursLines, syncHoursLabels, saveOffering, offeringForm, LIVE_LIST, dayPlan,
  fmtTime, cancelNote, riskCard, riskText, swimNote, GuestCheckIn, FOOD_RULE, FREE_CANCEL, hotelLatePossible, lateWindow, amenitiesFrom, dayHoursText,
  venueMissing, PICK_DATE_CANCEL, arrivalOptions, normalizeArrival, arrivalText,
} = require('./offering');
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3030;
const SECRET = resolveCookieSecret();
const ADMIN_USER = 'jason';
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
    paths.push('/', '/search', '/for-hotels', '/how-it-works', '/faq', '/contact', '/about');
    if (seo.legalPagesIndexable()) paths.push('/privacy', '/terms', '/refunds', '/risk');
    paths.push('/guides');
    for (const g of seo.GUIDES) paths.push('/guides/' + g.slug);
    for (const d of DESTINATIONS) {
      if (destinationHasListings(d)) paths.push('/destinations/' + d.slug);
    }
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

const clockNow = () => (process.env.HDC_NOW ? new Date(process.env.HDC_NOW) : new Date());
const today = (hotel, now) => {
  const fix = process.env.HDC_DEMO_TODAY;
  if (fix && /^\d{4}-\d{2}-\d{2}$/.test(fix)) return fix;
  const clock = now === undefined ? clockNow() : (now instanceof Date ? now : new Date(now));
  return HotelClock.today(hotel || {}, clock);
};
const guestBookBounds = now => guestSiteDateBounds(now === undefined ? clockNow() : (now instanceof Date ? now : new Date(now)));
const hotelRow = h => {
  if (!h) return h;
  const row = { ...h, photos: JSON.parse(h.photos || '[]'), amenities: JSON.parse(h.amenities || '[]') };
  delete row.password;
  return row;
};
const getHotels = () => db.prepare("SELECT * FROM hotels WHERE COALESCE(status,'active')='active' ORDER BY id").all().map(hotelRow);
function destinationHasListings(d) {
  return getHotels().some(h => d.areas.includes(h.area));
}
function chosenDate(raw, hotel) {
  const date = String(raw || '');
  const start = today(hotel);
  const maxDate = ymd(addDays(new Date(start + 'T12:00:00'), 90));
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date <= maxDate) return date;
  return '';
}
function openAvailability(hid) {
  return getPasses(hid).map(p => ({
    id: p.id, code: p.code, name: p.name, kind: p.kind || '', holds: p.holds || 1, featured: p.featured ? 1 : 0,
    description: p.description || '', photo: p.photo || '', price: p.price, cap: p.daily_cap, sold: 0,
    remaining: p.daily_cap, blocked: null, past: false,
  }));
}
const getHotel = slug => hotelRow(db.prepare('SELECT * FROM hotels WHERE slug=?').get(slug));
const publicHotel = slug => { const h = getHotel(slug); return h && (!h.status || h.status === 'active') ? h : null; };
const getPasses = hid => db.prepare('SELECT * FROM pass_types WHERE hotel_id=? ORDER BY sort, id').all(hid);
const isBlocked = (hid, date) => db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(hid, date);
const sold = (pid, date) => db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'").get(pid, date).n;
function availability(hid, date) {
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(hid);
  const why = hotel ? closureReason(db, hotel, date) : null;
  const past = date < today(hotel);
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
const getAddons = (hid, enabledOnly = false) => db.prepare(`SELECT * FROM addons WHERE hotel_id=? ${enabledOnly ? 'AND enabled=1' : ''} ORDER BY sort, id`).all(hid).filter(a => !FOOD_DRINK.has(a.code));
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
  const past = date < today(hotel);
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
    if (FOOD_DRINK.has(code)) return { err: 'That add-on is not available.' };
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
function logoLink(tone, opts = {}) {
  const light = tone === 'light';
  const src = light ? '/assets/hdc-lockup-light.svg' : '/assets/hdc-lockup-dark.svg';
  if (light && opts.dualOnDark) {
    return `<a class="logo" href="/"><img class="logo-light" src="${src}" alt="Hotel Day Club" width="187" height="32"><img class="logo-dark" src="/assets/hdc-lockup-dark.svg" alt="Hotel Day Club" width="187" height="32"></a>`;
  }
  if (light) {
    return `<a class="logo" href="/"><img src="${src}" alt="Hotel Day Club" width="187" height="32"></a>`;
  }
  return `<a class="logo" href="/"><img src="${src}" alt="Hotel Day Club" width="187" height="32"></a>`;
}
function contactEmail() {
  return operatorEmail();
}
function contactMail() {
  const email = esc(contactEmail());
  return `<a href="mailto:${email}">${email}</a>`;
}
function talkHref() {
  return `mailto:${contactEmail()}?subject=${encodeURIComponent('Hotel Day Club - partnership enquiry')}`;
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
class DestinationTiles {
  static status(d) {
    if (d.count) return `<span class="dest-count">${exampleCount(d.count)}</span>`;
    return `<span class="dest-pill">${d.launch ? 'Coming soon' : 'No listings yet'}</span>`;
  }
}
class SiteFooter {
  static year(now = new Date()) {
    return now.getFullYear();
  }

  static column(id, label, links, extra) {
    const cls = extra ? `ftr-links ${extra}` : 'ftr-links';
    return `<div class="ftr-col"><h2 class="ftr-h">${label}</h2><button type="button" class="ftr-toggle" aria-expanded="false" aria-controls="${id}">${label}</button><nav id="${id}" class="${cls}" aria-label="${label}">${links}</nav></div>`;
  }

  static html() {
    const destLinks = DESTINATIONS.map(d => `<a href="/destinations/${esc(d.slug)}">${esc(d.name)}</a>`).join('');
    const guideLinks = [`<a href="/guides">All guides</a>`, ...seo.GUIDES.map(g => `<a href="/guides/${esc(g.slug)}">${esc(g.h1)}</a>`)].join('');
    const siteLinks = '<a href="/about">About</a><a href="/how-it-works">How day passes work</a><a href="/faq">Questions</a><a href="/contact">Contact</a><a href="/for-hotels">For hotels</a><a href="/hotel/login">Hotel login</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refunds">Refunds</a><a href="/risk">Risk warning</a>';
    return `<footer class="app-ftr"><div class="wrap ftr-in"><div class="ftr-top"><div class="ftr-brand">${logoLink('dark')}<p>Contact ${contactMail()}</p></div>
<div class="ftr-cols">
${this.column('ftr-dest', 'Destinations', destLinks, 'dest-links')}
${this.column('ftr-guides', 'Guides', guideLinks)}
${this.column('ftr-site', 'Site', siteLinks)}
</div></div>
<p class="ftr-help"><b>Help when you need it</b> <a href="/contact">Questions? Email us.</a></p>
<div class="ftr-bottom"><p>Demo only. Fictional hotels, stock photos, no payments.</p><p>© ${this.year()} Hotel Day Club</p></div></div></footer>${this.script()}`;
  }

  static script() {
    return `<script>(function(){document.querySelectorAll('.ftr-toggle').forEach(function(btn){btn.addEventListener('click',function(){var open=btn.getAttribute('aria-expanded')==='true';btn.setAttribute('aria-expanded',open?'false':'true');});});})();</script>`;
  }
}
const HOME_SCRIPT = `<script>
(function(){
var S=[["8:00","Swim & gym"],["15:00","Spa afternoon"],["18:00","Golden hour"]],media=[0,1,2],cur=0;
var hero=document.querySelector('.hero'),bs=document.querySelectorAll('.times button');
function set(i){cur=i;if(!hero)return;hero.dataset.slot=String(i);bs.forEach(function(b,k){b.classList.toggle('on',k===i);b.setAttribute('aria-pressed',k===i?'true':'false')});
var ct=document.getElementById('ct'),cl=document.getElementById('cl');
if(!ct||!cl){ct=cl=null;}if(ct)ct.textContent=S[i][0];if(cl)cl.textContent=S[i][1];
document.querySelectorAll('.layer').forEach(function(l){l.classList.toggle('on',+l.dataset.slot===media[i])});}
bs.forEach(function(b){b.addEventListener('click',function(){set(+b.dataset.i)})});set(0);
var rm=matchMedia('(prefers-reduced-motion: reduce)').matches;
var net=navigator.connection||{},slow=!!(net.saveData||/2g/.test(net.effectiveType||''));
var box=document.querySelector('.media');
function syncMotion(){if(!box)return;var allow=!rm&&!slow;box.classList.toggle('motion',allow);box.classList.toggle('paused',!allow||document.hidden);}
syncMotion();
document.addEventListener('visibilitychange',syncMotion);
if(net.addEventListener)net.addEventListener('change',function(){slow=!!(net.saveData||/2g/.test(net.effectiveType||''));syncMotion();});
var els=document.querySelectorAll('[data-rv]');
function show(el){el.classList.add('in')}
if(rm||!('IntersectionObserver' in window)){els.forEach(show)}else{
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){show(e.target);io.unobserve(e.target)}})},{threshold:.05,rootMargin:'0px 0px -8% 0px'});
  els.forEach(function(e){io.observe(e)});
  setTimeout(function(){els.forEach(show)},250);
}
var hd=document.getElementById('site-hdr');
function hs(){if(!hd)return;document.documentElement.style.setProperty('--hdr-h',hd.offsetHeight+'px');hd.classList.toggle('is-solid',window.scrollY>8);}
hs();window.addEventListener('scroll',hs,{passive:true});window.addEventListener('resize',hs);
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
const FIND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
const MENU_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const MENU_SCRIPT = `<script>(function(){var d=document.querySelector('.hdr-menu');if(!d)return;var s=d.querySelector('summary');function sync(){if(s)s.setAttribute('aria-expanded',d.open?'true':'false');}d.addEventListener('toggle',sync);sync();document.querySelectorAll('.msheet a').forEach(function(a){a.addEventListener('click',function(){d.open=false;sync();});});})();</script>`;
function guestChrome(currentPath, waitHref) {
  const onSearch = currentPath === '/search';
  const here = onSearch ? ' aria-current="page"' : '';
  const nav = `<nav class="hdr-nav" aria-label="Site"><a href="/search"${here}>Find a day pass</a><a href="/how-it-works">How it works</a><a href="/for-hotels">For hotels</a></nav>`;
  const sheet = `<div class="hdr-m"><a class="ibtn" href="/search" aria-label="Find a day pass"${here}>${FIND_ICON}</a><details class="hdr-menu"><summary class="ibtn" aria-controls="site-menu" aria-expanded="false">${MENU_ICON}Menu</summary><div class="msheet" id="site-menu"><a href="/search"${here}>Find a day pass</a><a href="/how-it-works">How it works</a><a href="/for-hotels">For hotels</a><a class="pill" href="${waitHref}">Join the waitlist</a></div></details></div>`;
  return { nav, sheet };
}
function page(title, body, opts = {}) {
  const nav = opts.nav || 'guest';
  const bare = !!opts.bare;
  const analytics = !!opts.analytics;
  const analyticsPath = opts.analyticsPath || '';
  const home = !!opts.home;
  const index = opts.index !== undefined ? opts.index : nav === 'guest';
  const waitHref = home ? '#waitlist' : '/#waitlist';
  const right = opts.headerRight ? opts.headerRight
    : nav === 'hotel' ? '<a class="hotel-link show" href="/hotel/logout">Log out</a>'
    : nav === 'admin' ? '<a class="hotel-link show" href="/admin/logout">Log out</a>'
    : `<a class="pill" href="${waitHref}">Join the waitlist</a>`;
  const chrome = nav === 'guest' ? guestChrome(opts.path || '', waitHref) : { nav: '<nav class="hdr-nav" aria-label="Site"></nav>', sheet: '' };
  const extraCss = opts.css ? StaticAssets.stylesheet(opts.css) : '';
  const extraJs = opts.js ? StaticAssets.script(opts.js) : '';
  const headerExtra = opts.headerHtml || '';
  const tags = analytics && nav === 'guest' ? gaSnippet(analyticsPath) : '';
  const preconnect = tags ? '<link rel="preconnect" href="https://www.googletagmanager.com">' : '';
  const canonicalUrl = opts.canonical === false || !opts.path ? '' : seo.absolute(opts.path);
  const meta = seo.headMeta({
    documentTitle: opts.titleReady ? (opts.documentTitle || title) : seo.fullTitle(opts.documentTitle || title),
    description: opts.description || '',
    robots: seo.robotsContent(index),
    canonicalUrl,
    image: opts.image || '',
    imageAlt: opts.imageAlt || '',
    imageWidth: opts.image ? opts.imageWidth : 1200,
    imageHeight: opts.image ? opts.imageHeight : 630,
    jsonld: opts.jsonld || null,
  });
  const pickerCss = StaticAssets.stylesheet('/pickers.css');
  const tokensCss = StaticAssets.stylesheet('/tokens.css');
  const guestD2 = !!opts.guestD2;
  const guestD2Css = guestD2 ? StaticAssets.stylesheet('/guest-d2.css') : '';
  const polishCss = nav === 'guest' ? StaticAssets.stylesheet('/polish.css') : '';
  const baseCss = nav === 'guest' || nav === 'hotel' ? StaticAssets.stylesheet('/base.css') : '';
  const homeCss = home && nav === 'guest' ? StaticAssets.stylesheet('/golden/home.css') : '';
  const adminCss = nav === 'admin'
    ? `${StaticAssets.stylesheet('/styles.css')}${StaticAssets.stylesheet('/app.css')}${StaticAssets.stylesheet('/golden/site.css')}${StaticAssets.stylesheet('/header.css')}`
    : '';
  const hotelCss = nav === 'hotel' ? StaticAssets.stylesheet('/app.css') : '';
  const guestPageCss = nav === 'guest' && !home && extraCss ? extraCss : '';
  const hotelPageCss = nav === 'hotel' && extraCss ? extraCss : '';
  const css = home && nav === 'guest'
    ? `${StaticAssets.fontLinks()}<link rel="preload" as="image" href="/golden/img/hero-swim-sm.webp" type="image/webp" media="(max-width:800px)" fetchpriority="high"><link rel="preload" as="image" href="/golden/img/hero-swim.webp" type="image/webp" media="(min-width:801px)" fetchpriority="high">${tokensCss}${pickerCss}${baseCss}${homeCss}${guestD2Css}${polishCss}`
    : nav === 'guest'
    ? `${StaticAssets.fontLinks()}${tokensCss}${pickerCss}${baseCss}${guestPageCss}${guestD2Css}${polishCss}`
    : nav === 'hotel'
    ? `${StaticAssets.fontLinks()}${tokensCss}${pickerCss}${baseCss}${hotelCss}${hotelPageCss}${guestD2Css}${polishCss}`
    : `${StaticAssets.fontLinks()}${tokensCss}${pickerCss}${adminCss}${extraCss}${guestD2Css}${polishCss}`;
  const bodyExtra = [guestD2 ? 'guest-d2' : '', opts.bodyClassExtra || ''].filter(Boolean).join(' ');
  const bodyClass = [opts.bodyClass || (home ? 'home' : nav === 'guest' ? 'guest' : 'staff'), bodyExtra].filter(Boolean).join(' ');
  const headerLogo = home ? logoLink('light', { dualOnDark: true }) : logoLink('light');
  const header = `<header class="hdr" id="site-hdr"><div class="wrap hdr-in">${headerLogo}${chrome.nav}${headerExtra}<div class="hdr-right">${right}</div>${chrome.sheet}</div></header>`;
  const htmlAttrs = [
    'lang="en-AU"',
    opts.htmlHero ? `data-hero="${esc(String(opts.htmlHero))}"` : '',
    opts.htmlDataN != null && opts.htmlDataN !== '' ? `data-n="${esc(String(opts.htmlDataN))}"` : '',
    opts.htmlClass ? `class="${esc(String(opts.htmlClass))}"` : '',
  ].filter(Boolean).join(' ');
  return `<!doctype html><html ${htmlAttrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${preconnect}${meta}${tags}${home ? '<script>document.documentElement.classList.add("js");if(!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("rv");</script>' : '<script>document.documentElement.classList.add("js")</script>'}${css}</head><body class="${bodyClass}">
${demoSite() ? '<div class="demo-banner">Demo site: listings are examples, no real bookings or payments.</div>' : ''}
${header}<main>${body}</main>
${bare ? '' : SiteFooter.html()}${StaticAssets.script('/pickers.js')}${home ? HOME_SCRIPT : ''}${nav === 'guest' ? MENU_SCRIPT : ''}${extraJs}
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
function exampleCard(h, date) {
  const prices = getPasses(h.id).map(p => p.price);
  const from = prices.length ? Math.min(...prices) : 0;
  const photo = h.photos[0] || '';
  const base = String(photo).replace(/\.jpe?g$/i, '');
  const webp = path.join(__dirname, 'public', 'golden', 'img', 'cards', base + '.webp');
  const img = photo && fs.existsSync(webp)
    ? `<img src="/golden/img/cards/${esc(base)}.webp" alt="${esc('Example photo of a hotel pool in ' + h.area + ', not a real hotel')}" width="800" height="600" loading="lazy" decoding="async">`
    : photo ? `<img src="/assets/photos/${esc(photo)}" alt="${esc('Example photo of a hotel pool in ' + h.area + ', not a real hotel')}" width="1200" height="900" loading="lazy" decoding="async">` : '';
  const facts = amenitiesFrom(h).filter(line => line !== h.age_policy).slice(0, 3);
  const sub = guestAreaName(h.area) + (h.age_policy ? ' · ' + h.age_policy : '');
  const href = `/h/${h.slug}${date ? '?date=' + encodeURIComponent(date) : ''}`;
  const short = [];
  for (const f of facts) {
    if (f.length > 22 || short.join('').length + f.length > 34) continue;
    short.push(f);
  }
  const chips = short.length ? `<ul class="ex-chips">${short.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
  return `<a class="ex" href="${href}"><span class="ex-ph">${img}<span class="tag">Example</span></span><span class="ex-top"><h3>${esc(displayName(h))}</h3><span class="ex-price"><small>from</small> ${money(from)}</span></span><p class="ex-area">${esc(sub)}</p>${chips}</a>`;
}
function displayName(h) {
  return String((h && h.name) || '').replace(/\s*\(Demo\)\s*$/i, '');
}
const { faqPlusDetail } = require('./faqUi');
const FAQ_PLUS = (q, a) => faqPlusDetail(q, a);
function homePopularHtml() {
  const hotels = getHotels();
  const first = hotels[0];
  const day = first ? today(first) : today();
  const cutoff = hotels.length === 0 || hotels.every(h => Boolean(closureReason(db, h, today(h))));
  return HomeQuick.popular(day, { cutoff });
}
function whereOptions(selectedId) {
  return DESTINATIONS.map(d => `<option value="${esc(d.id)}" data-icon="${esc(d.icon)}"${d.id === selectedId ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
}
function homePage({ destination = '', joined = false, error = '', values = {} } = {}) {
  const hotels = getHotels();
  const pickedDest = Object.prototype.hasOwnProperty.call(values, 'destination') && values.destination !== undefined
    ? values.destination
    : destination;
  const counts = DESTINATIONS.map(d => ({ ...d, count: hotels.filter(h => d.areas.includes(h.area)).length }));
  const listed = counts.filter(d => d.count);
  const tileHtml = (d, i) => {
    const h = hotels.find(x => d.areas.includes(x.area) && x.photos && x.photos[0]);
    const base = h ? String(h.photos[0]).replace(/\.jpe?g$/i, '') : '';
    const webp = base && fs.existsSync(path.join(__dirname, 'public', 'golden', 'img', 'cards', base + '.webp'));
    const src = !h ? '' : webp ? `/golden/img/cards/${esc(base)}.webp` : `/assets/photos/${esc(h.photos[0])}`;
    const img = src ? `<img src="${src}" alt="Example photo for ${esc(d.name)}" width="800" height="600" loading="lazy" decoding="async">` : '';
    const mosaic = listed.length === 5 || listed.length === 6;
    const cls = `${i === 0 && mosaic ? ' dt-big' : ''}${i === 5 && listed.length === 6 ? ' dt-tail' : ''}`;
    return `<li class="dt${cls}"><a class="dest-tile" href="/destinations/${encodeURIComponent(d.slug)}">${img}<span class="dt-txt"><span class="dest-name">${esc(d.name)}</span><span class="dest-status">${exampleCount(d.count)}</span></span></a></li>`;
  };
  const destTiles = listed.length ? `<ul class="dest-tiles dt-n${listed.length}">${listed.map(tileHtml).join('')}</ul>` : '';
  const soon = counts.filter(d => !d.count);
  const destSoon = soon.length ? `<div class="dest-soon"><b>Coming soon</b><ul>${soon.map(d => `<li><a class="dest-chip" href="/destinations/${encodeURIComponent(d.slug)}">${esc(d.name)}</a></li>`).join('')}</ul><a class="text-link" href="#waitlist">Tell me when<span aria-hidden="true"> →</span></a></div>` : '';
  const form = values || {};
  const destOptions = DESTINATIONS.map(d => `<option value="${esc(d.id)}" data-icon="${esc(d.icon)}"${pickedDest === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
  const lead = joined ? `<script>if(typeof gtag==='function')gtag('event','generate_lead');</script>` : '';
  const openWait = Boolean(joined || error || pickedDest);
  const exampleCards = hotels.slice(0, 6).map(h => exampleCard(h, '')).join('');
  const guestDates = guestBookBounds();
  const slot = (src, alt, time, title, copy) => `<div class="slot"><picture><source type="image/webp" srcset="/golden/img/${src}.webp"><img src="/golden/img/${src}.jpg" alt="${alt}" width="900" height="600" loading="lazy" decoding="async"></picture><span class="t">${time}</span><div class="b"><h3>${title}</h3><p>${copy}</p></div></div>`;
  return page('Hotel day passes in Australia', `<header class="hero hero-d2 hero-d1" data-slot="0"><div class="ph"><div class="media">
<picture class="layer on" data-slot="0"><source media="(max-width:800px)" type="image/webp" srcset="/golden/img/hero-swim-sm.webp"><source media="(max-width:800px)" srcset="/golden/img/hero-swim-sm.jpg"><source type="image/webp" srcset="/golden/img/hero-swim.webp"><img fetchpriority="high" src="/golden/img/hero-swim.jpg" alt="Ocean pool at sunrise" width="1920" height="1080" decoding="async"></picture>
<div class="shimmer" aria-hidden="true"></div><div class="tint"></div></div>
<span class="credit">Stock media · example only</span></div>
<div class="copy">
<h1 class="hero-line">Take the day <em>off.</em><br>Stay till&nbsp;close.</h1>
<p class="hero-sub">Book a day at a hotel pool, gym or spa. No room needed.</p>
<form class="search" action="/search" method="get">
<div class="seg"><label for="w">Where</label><select id="w" class="hdc-pick" name="destination" aria-label="Where"><option value="" data-icon="pin">All of Australia</option>${whereOptions('')}</select></div>
<div class="seg"><label for="d">When</label><input id="d" class="hdc-date" type="date" name="date" min="${guestDates.min}" max="${guestDates.max}" value=""></div>
<div class="seg"><label for="p">What</label><select id="p" class="hdc-pick" name="want">${WANTS.map(w => `<option value="${w.id}" data-icon="${w.icon}">${esc(w.name)}</option>`).join('')}</select></div>
<button type="submit">Search</button></form>
${homePopularHtml()}</div></header>
${reassureStrip(false, { home: true })}
<section id="explore" data-rv><div class="sec-row"><div><span class="kicker sand">Example listings</span><h2>A day by the water</h2>
<p class="home-note">Fictional hotels with stock photos, shown to preview the experience.</p></div>${LinkStyles.sectionAction('/search', 'See all day passes')}</div>
<div class="list">${exampleCards || '<p class="home-note">No example listings yet.</p>'}</div></section>
<section data-rv><span class="kicker sand">Plan your day</span><h2>A hotel day, your way</h2>
<p class="home-note">One example day. The hotel sets the hours.</p>
<div class="day">
${slot('gym-sm', 'Hotel gym with free weights', '8 am', 'Swim &amp; gym', 'A gym session, then laps before the city wakes up.')}
${slot('4-sm', 'Hotel daybed beside a pool', '12 pm', 'Daybed by the pool', 'Stretch out in the shade.')}
${slot('3-sm', 'Spa treatment table', '3 pm', 'Spa afternoon', 'Steam, sauna, a treatment if the hotel offers one.')}
${slot('1-sm', 'Hotel pool at dusk', '6 pm', 'Golden hour', 'Last swim as the lights come on.')}
</div></section>
<section id="destinations" data-rv><div class="sec-row"><div><span class="kicker sand">Explore by destination</span><h2>Where to spend the day</h2></div>${LinkStyles.sectionAction('/search', 'All destinations')}</div>
${destTiles}
${destSoon}</section>
<section class="steps steps-d1" data-rv><div class="steps-in"><span class="kicker">How it works</span><h2>Three steps to the pool</h2>
<ol><li><span>01</span><div><b>Find a hotel</b><p>Each listing shows hours, price and what's included.</p></div></li>
<li><span>02</span><div><b>Pick a pass and a day</b><p>See the price before you confirm.</p></div></li>
<li><span>03</span><div><b>Show up, switch off</b><p>Check in at the desk and the day is yours.</p></div></li></ol></div></section>
<section class="faq faq-d1" data-rv><div><span class="kicker sand">Good to know</span><h2>Questions about hotel day passes</h2>
<p class="home-note">Short answers. The full list is in the help centre.</p>
<p class="faq-more">${LinkStyles.sectionAction('/faq', 'All questions')}</p></div>
<div class="faq-list">${FAQ_PLUS('Do I need to stay at the hotel?', 'No. A day pass covers the pool, gym or spa for set hours.')}
${FAQ_PLUS('Is Hotel Day Club taking bookings?', "Not yet. Join the waitlist and we'll email you when passes open near you.")}
${FAQ_PLUS("What's included?", 'Each hotel sets its own inclusions. Every listing shows what your pass covers. Food and drink are not sold through Hotel Day Club. You buy and pay for them at the venue.')}
${FAQ_PLUS('Can I cancel?', 'Yes. Free cancellation up to 24 hours before your access hours start. The <a href="/refunds">cancellation and refund policy</a> has the detail.')}</div></section>
<section class="wl-band" id="waitlist-band" aria-labelledby="wl-band-h"><div class="wrap wl-band-in"><h2 id="wl-band-h">Join the waitlist</h2>
<p class="wl-lead">Not taking bookings yet. Leave your email and we'll tell you when passes open near you. Free to join. We never sell this list.</p>
<form class="wl-inline" method="post" action="/waitlist">
<input type="hidden" name="role" value="guest">
<div class="hp" aria-hidden="true"><label>Company website<input name="company_website" tabindex="-1" autocomplete="off" value=""></label></div>
<label class="wl-email"><span class="sr-only">Email</span><input name="email" type="email" required autocomplete="email" maxlength="254" placeholder="you@example.com"></label>
<button class="btn" type="submit">Join the waitlist</button></form></div></section>
<div class="hotels hotels-d1" id="hotels"><div class="hotels-copy"><span class="kicker">For hotels</span><h2>A quiet pool, put to use.</h2><p>List spare pool, gym and spa capacity. You set the hours, prices and guest numbers.</p><a class="btn" href="/for-hotels">Talk to us</a></div><picture class="hotels-ph"><source type="image/webp" srcset="/golden/img/fh-loungers-sm.webp"><img src="/golden/img/fh-loungers-sm.jpg" alt="Sun loungers and umbrellas beside a hotel pool" width="800" height="534" loading="lazy" decoding="async"></picture></div>
<noscript><style>#waitlist{display:block;position:static;margin:24px auto 40px}</style></noscript>
<dialog id="waitlist" aria-labelledby="wl-title" data-open="${openWait ? '1' : '0'}"><div class="wl-in">
<button type="button" class="wl-x" data-close>Close</button>
<h2 id="wl-title">Join the waitlist</h2>
<p class="wl-lead">Not taking bookings yet. Leave your email and we'll tell you when passes open near you. Free to join. We never sell this list.</p>
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
<label class="tick"><input type="checkbox" name="marketing" value="1"${form.marketing === '1' ? ' checked' : ''}> <span>${CheckoutConsent.marketingHtml()}</span></label>
<div class="wl-note">
<p>${CheckoutConsent.guestNoticeHtml(contactMail())}</p>
<p>${CheckoutConsent.hotelNoticeHtml(contactMail())}</p>
</div>
<button class="btn" type="submit">Join the waitlist</button>
</form></div></dialog>`, { analytics: true, home: true, index: true, guestD2: true, ...seo.pageCopy('home'), jsonld: seo.homeJsonLd(contactEmail()) });
}
function searchHidden(params, skip) {
  const bits = [];
  const add = (key, value) => {
    if (key === skip || value == null || value === '' || value === 0) return;
    bits.push(`<input type="hidden" name="${key}" value="${esc(value)}">`);
  };
  add('destination', params.destination && params.destination.id);
  add('date', params.date);
  if (!params.date && params.range) {
    add('from', params.range.from);
    add('to', params.range.to);
  }
  add('mood', params.mood);
  add('want', params.want);
  add('guests', params.guests);
  add('price', params.price);
  add('age', params.age);
  add('sort', params.sort);
  return bits.join('');
}
const FILTER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const MORE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function hoursSpan(plan) {
  if (!plan || !plan.open) return '';
  return fmtTime(plan.opens) + '\u2013' + fmtTime(plan.effective || plan.closes);
}
function hotelDays(hotel, selected) {
  const start = new Date(today(hotel) + 'T12:00:00');
  const pills = [];
  let openCount = 0;
  for (let i = 0; i < 14; i++) {
    const date = ymd(addDays(start, i));
    const plan = dayPlan(db, hotel, date);
    const why = closureReason(db, hotel, date);
    const closed = !plan || !plan.open || Boolean(why);
    if (!closed) openCount += 1;
    const d = new Date(date + 'T00:00:00');
    pills.push({
      date,
      label: WEEKDAYS[d.getDay()] + ' ' + d.getDate(),
      hours: closed ? 'Closed' : hoursSpan(plan),
      closed,
      selected: date === selected,
    });
  }
  return { pills, openCount };
}
function cardOffer(hotel, date, want) {
  const passes = getPasses(hotel.id);
  const from = SearchQuery.fromPrice(passes);
  if (!date) return { sold: false, price: from, activity: '' };
  const rows = availability(hotel.id, date);
  const left = rows.filter(p => p.remaining > 0 && !p.blocked && !p.past);
  if (!left.length) return { sold: true, price: 0, activity: '' };
  const activity = want ? ((SearchQuery.WANTS.find(w => w.id === want) || {}).label || '') : '';
  return { sold: false, price: Math.min(...left.map(p => Number(p.price))), activity };
}
function spotsLeft(hotel, date) {
  const rows = availability(hotel.id, date);
  return rows.reduce((sum, p) => sum + (p.blocked || p.past ? 0 : p.remaining), 0);
}
function searchPasses(hotel, date) {
  const passes = getPasses(hotel.id);
  if (!date || closureReason(db, hotel, date)) return passes;
  const left = new Map(availability(hotel.id, date).map(row => [row.id, row.remaining]));
  return passes.map(p => ({ ...p, remaining: left.has(p.id) ? left.get(p.id) : 0 }));
}
function cardImage(photo, alt, index) {
  if (!photo) return '';
  const eager = index >= 0 && index < 3;
  const priority = index === 0 ? ' fetchpriority="high"' : '';
  const loading = eager ? 'eager' : 'lazy';
  const base = String(photo).replace(/\.jpe?g$/i, '');
  const webpFile = path.join(__dirname, 'public', 'golden', 'img', 'cards', base + '.webp');
  const jpg = StaticAssets.assetUrl(`/assets/photos/${esc(photo)}`);
  const attrs = `alt="${esc(alt)}" width="600" height="400" loading="${loading}" decoding="async"${priority}`;
  if (fs.existsSync(webpFile)) {
    const webp = StaticAssets.assetUrl(`/golden/img/cards/${esc(base)}.webp`);
    return `<picture><source type="image/webp" srcset="${webp} 600w" sizes="(min-width:600px) and (max-width:800px) 50vw, (max-width:699px) 100vw, 360px"><img src="${jpg}" ${attrs}></picture>`;
  }
  return `<img src="${jpg}" ${attrs}>`;
}
function dayPillsHtml(hotel, selected, qty) {
  const { pills, openCount } = hotelDays(hotel, selected);
  if (!openCount) return '<p class="day-empty">No open days in the next 2 weeks</p>';
  const selectedOpen = pills.some(p => p.selected && !p.closed);
  let given = false;
  const items = pills.map(pill => {
    if (pill.closed) {
      return `<span class="daypill off" aria-disabled="true"><b><s>${esc(pill.label)}</s></b><span>Closed</span></span>`;
    }
    const stop = !given && (pill.selected || !selectedOpen);
    if (stop) given = true;
    const pressed = pill.selected ? ' aria-pressed="true" aria-current="date"' : ' aria-pressed="false"';
    const qtyBit = qty ? '&qty=' + encodeURIComponent(String(qty)) : '';
    return `<a class="daypill${pill.selected ? ' on' : ''}" href="/h/${esc(hotel.slug)}?date=${esc(pill.date)}${qtyBit}"${pressed} tabindex="${stop ? '0' : '-1'}"><b>${esc(pill.label)}</b><span>${esc(pill.hours)}</span></a>`;
  }).join('');
  return `<div class="days"><div class="day-row" role="group" aria-label="Days for ${esc(hotel.name)}">${items}</div><button type="button" class="day-more ibtn" aria-label="More days for ${esc(hotel.name)}" hidden>${MORE_ICON}</button></div>`;
}
const TICK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FAMILY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="7" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 20v-4a4 4 0 0 1 8 0M13 20v-4a4 4 0 0 1 8 0M10 20v-1a2 2 0 0 1 4 0v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function searchCard(hotel, params, index, kidsChip) {
  const photo = (hotel.photos && hotel.photos[0]) || '';
  const alt = Number(hotel.is_demo) === 1
    ? 'Example photo of a hotel pool in ' + hotel.area + ', not a real hotel'
    : 'Photo of ' + hotel.name;
  const offer = cardOffer(hotel, params.date, params.want);
  const days = hotelDays(hotel, params.date);
  const qty = SearchQuery.bookingQty(searchPasses(hotel, params.date), params.guests);
  const openDay = params.date
    ? (days.pills.find(p => p.date === params.date && !p.closed) || days.pills.find(p => !p.closed))
    : days.pills.find(p => !p.closed);
  const span = openDay && !openDay.closed ? `${nice(openDay.date)} · ${openDay.hours}` : '';
  const query = [];
  if (params.date) query.push('date=' + encodeURIComponent(params.date));
  if (params.want) query.push('want=' + encodeURIComponent(params.want));
  if (qty) query.push('qty=' + encodeURIComponent(String(qty)));
  const listing = '/h/' + hotel.slug + (query.length ? '?' + query.join('&') : '');
  const href = offer.sold && params.date ? '/h/' + hotel.slug + '#book' : listing + '#book';
  const area = guestAreaName(hotel.area) + (hotel.age_policy ? ' · ' + hotel.age_policy : '');
  const facts = amenitiesFrom(hotel).filter(line => line !== hotel.age_policy).slice(0, 3);
  const short = [];
  for (const f of facts) {
    if (f.length > 22 || short.join('').length + f.length > 34) continue;
    short.push(f);
  }
  const chips = short.length ? `<ul class="ex-chips">${short.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
  const price = offer.sold
    ? ''
    : `<span class="ex-price"><small>from</small> ${money(offer.price)}</span>`;
  const sold = offer.sold && params.date
    ? `<p class="soldtxt">Sold out on ${esc(nice(params.date))}</p>`
    : '';
  const when = span ? `<p class="ex-when">${esc(span)}</p>` : '';
  const kids = kidsChip ? `<p class="kidchip">${FAMILY_ICON}<span>${esc(kidsChip)}</span></p>` : '';
  const pill = offer.sold
    ? '<span class="book-pill">See other dates</span>'
    : `<span class="book-pill">Book<span class="vh"> ${esc(displayName(hotel))}</span></span>`;
  return `<a class="ex${offer.sold ? ' is-sold' : ''}" href="${esc(href)}"><span class="ex-ph">${cardImage(photo, alt, index)}<span class="tag">Example</span></span><span class="ex-top"><h3>${esc(displayName(hotel))}</h3>${price}</span>${sold}<p class="ex-area">${esc(area)}</p>${when}${chips}${kids}${pill}</a>`;
}
function radioGroup(name, options, current, klass) {
  const now = String(current || '');
  return options.map(opt => {
    const on = now === String(opt.value);
    return `<label class="${klass}"><input type="radio" name="${esc(name)}" value="${esc(opt.value)}"${on ? ' checked' : ''}><span>${esc(opt.label)}</span></label>`;
  }).join('');
}
function hiddenField(name, value) {
  if (value == null || value === '' || value === 0) return '';
  return `<input type="hidden" name="${name}" value="${esc(value)}">`;
}
function rangeDay(h, range) {
  const start = today(h);
  for (const day of SearchQuery.rangeDays(range.from, range.to)) {
    if (day < start) continue;
    if (!closureReason(db, h, day)) return day;
  }
  return '';
}
function loadSearch(query) {
  const hotels = getHotels();
  const parsed = SearchQuery.parse(query, DESTINATIONS);
  const dayById = new Map();
  if (parsed.range) for (const h of hotels) dayById.set(h.id, rangeDay(h, parsed.range));
  const dateOf = h => (parsed.range ? dayById.get(h.id) || '' : parsed.date);
  const passesById = new Map(hotels.map(h => [h.id, searchPasses(h, dateOf(h))]));
  const closedById = new Map();
  const minutesById = new Map();
  const remainingById = parsed.date || parsed.range ? new Map() : null;
  for (const h of hotels) {
    const on = dateOf(h);
    if (parsed.date) {
      closedById.set(h.id, Boolean(closureReason(db, h, parsed.date)));
      remainingById.set(h.id, spotsLeft(h, parsed.date));
    } else if (parsed.range) {
      closedById.set(h.id, !on);
      remainingById.set(h.id, on ? spotsLeft(h, on) : 0);
    }
    const rows = db.prepare('SELECT weekday, open, opens, closes FROM hotel_hours WHERE hotel_id=?').all(h.id);
    const plan = on ? dayPlan(db, h, on) : null;
    minutesById.set(h.id, on ? SearchQuery.spanMinutes(plan) : SearchQuery.openMinutes(rows, h.room_only_from));
  }
  const result = SearchQuery.run({
    hotels,
    passesById,
    closedById,
    minutesById,
    remainingById,
    offers: hotelOffers,
    destinations: DESTINATIONS,
    query,
  });
  result.dateOf = dateOf;
  return result;
}
function searchPage(query) {
  const result = loadSearch(query);
  const params = result.params;
  const selectedDest = params.destination ? params.destination.id : '';
  const guestOptions = ['<option value="">Any</option>'].concat(result.guestChoices.map(n => `<option value="${n}"${params.guests === n ? ' selected' : ''}>${n}</option>`)).join('');
  const priceOptions = ['<option value="">Any price</option>'].concat(result.priceChoices.map(n => `<option value="${n}"${params.price === n ? ' selected' : ''}>Under $${n}</option>`)).join('');
  const ageOptions = ['<option value="">Any age</option>'].concat(result.ageChoices.map(a => `<option value="${esc(a.id)}"${params.age === a.id ? ' selected' : ''}>${esc(a.label)}</option>`)).join('');
  const sortOptions = SearchQuery.SORTS.map(s => `<option value="${esc(s.id)}"${params.sort === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
  const chips = result.chips.filter(chip => chip.key !== 'mood').map(chip => `<a class="chip" href="${esc(chip.href)}" aria-label="${esc(chip.remove)}">${esc(chip.label)} <b aria-hidden="true">×</b></a>`).join('');
  const clear = result.showClear ? '<a class="clear" href="/search">Clear all</a>' : '';
  const cards = result.list.map((h, i) => searchCard(h, { ...params, date: result.dateOf(h) || params.date }, i, result.kidsChips.get(h.id))).join('');
  const otherCards = result.others.map(h => searchCard(h, { date: '', want: '' }, -1)).join('');
  let empty = '';
  if (result.empty === 'destination') {
    const id = encodeURIComponent(params.destination.id);
    const name = esc(params.destination.name);
    empty = `<div class="empty"><p>There are no example listings in ${name} yet.</p><a class="btn" href="/?destination=${id}#waitlist">Join the waitlist</a></div>`;
  } else if (result.empty === 'closed') {
    empty = '<div class="empty"><p>No example hotels are open on this date.</p></div>';
  } else if (result.empty === 'nomatch') {
    empty = '<div class="empty"><p>No passes match. Try a higher price, another date or fewer filters.</p><a class="btn quiet" href="/search">Clear all filters</a></div>';
  }
  const others = result.empty ? `<h2 class="other">Other example listings</h2><div class="list others">${otherCards}</div>` : '';
  const keepSort = params.sort ? `<input type="hidden" name="sort" value="${esc(params.sort)}">` : '';
  const resultClass = result.list.length === 1 ? 'list results is-single' : 'list results';
  const { min: minDate, max: maxDate } = guestBookBounds();
  const heroKeep = hiddenField('mood', params.mood) + hiddenField('want', params.want) + hiddenField('price', params.price) + hiddenField('age', params.age) + hiddenField('sort', params.sort);
  const mood = result.moods.map(m => {
    const href = SearchQuery.href({ ...params, mood: m.on ? '' : m.id });
    return `<a class="ichip mood" href="${esc(href)}" aria-pressed="${m.on ? 'true' : 'false'}" data-key="mood" data-value="${esc(m.id)}">${m.on ? TICK_ICON : ''}${esc(m.label)}</a>`;
  }).join('');
  const summary = SearchQuery.summary(params);
  const pillTitle = SearchQuery.pillWhen(params);
  const pillSub = SearchQuery.pillSub(params);
  const guestMax = SearchQuery.BOOKING_SPOTS;
  const guestShown = params.guests ? String(params.guests) : 'Any';
  const countN = result.list.length;
  const countHeading = SearchQuery.countLine(countN);
  const badge = result.drawerCount ? `<span class="cnt">${result.drawerCount}</span>` : '';
  const mapPins = result.list.map(h => {
    const lat = Number(h.lat);
    const lng = Number(h.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const q = [];
    if (params.date) q.push('date=' + encodeURIComponent(params.date));
    if (params.want) q.push('want=' + encodeURIComponent(params.want));
  if (params.guests) q.push('qty=' + encodeURIComponent(String(params.guests)));
    const href = '/h/' + h.slug + (q.length ? '?' + q.join('&') : '');
    return { lat, lng, name: displayName(h), area: guestAreaName(h.area), href };
  }).filter(Boolean);
  const mapToggle = mapPins.length
    ? `<div class="view-toggle" role="group" aria-label="Results view"><button type="button" class="view-btn is-on" id="search-view-list" aria-pressed="true">List</button><button type="button" class="view-btn" id="search-view-map" aria-pressed="false">Map</button></div>`
    : '';
  const mapBlock = mapPins.length
    ? `<script type="application/json" id="search-map-data">${JSON.stringify(mapPins).replace(/</g, '\\u003c')}</script><div class="search-map-wrap" id="search-map-wrap" hidden><div id="search-map" class="search-map" role="region" aria-label="Map of listings"></div></div>`
    : '';
  const resetHref = SearchQuery.href({ date: params.date });
  const wantRadios = radioGroup('want', [{ value: '', label: 'Any' }].concat(WANTS.filter(w => w.id).map(w => ({ value: w.id, label: w.name }))), params.want, 'fchip');
  const priceRadios = radioGroup('price', [{ value: '', label: 'Any price' }].concat(result.priceChoices.map(n => ({ value: String(n), label: 'Under $' + n }))), params.price ? String(params.price) : '', 'ropt');
  const ageRadios = radioGroup('age', [{ value: '', label: 'Any age' }].concat(result.ageChoices.map(a => ({ value: a.id, label: a.label }))), params.age, 'ropt');
  const sortRadios = radioGroup('sort', SearchQuery.SORTS.map(s => ({ value: s.id, label: s.label })), params.sort, 'ropt');
  const guestAria = summary.guests === 'Any' ? 'any guests' : (summary.guests === '1' ? '1 guest' : summary.guests + ' guests');
  const pillFace = summary.face === 'Search'
    ? `${FIND_ICON}<span class="cpill-tx">Search</span>`
    : `<span class="cpill-tx">${esc(summary.face)}</span>`;
  const headerHtml = `<div class="cslot"></div><button type="button" class="cpill" hidden aria-haspopup="dialog" aria-controls="search-sheet" aria-label="Edit search: ${esc(summary.where)}, ${esc(summary.when)}, ${esc(guestAria)}">${pillFace}</button>`;
  const body = `<div class="search-page"><form class="sbar" action="/search" method="get">
${keepSort}
<div class="seg"><label for="w">Where</label><select id="w" class="hdc-pick" name="destination" aria-label="Where"><option value="" data-icon="pin"${selectedDest ? '' : ' selected'}>All of Australia</option>${whereOptions(selectedDest)}</select></div>
<div class="seg"><label for="when">When</label><input id="when" class="hdc-date" type="date" name="date" min="${minDate}" max="${maxDate}" value="${esc(params.date)}"></div>
<div class="seg"><label for="p">What</label><select id="p" class="hdc-pick" name="want">${WANTS.map(w => `<option value="${esc(w.id)}" data-icon="${esc(w.icon)}"${params.want === w.id ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
<div class="seg"><label for="guests">Guests</label><select id="guests" class="hdc-pick" name="guests">${guestOptions}</select></div>
<div class="seg"><label for="price">Price</label><select id="price" class="hdc-pick" name="price">${priceOptions}</select></div>
<div class="seg"><label for="age">Age</label><select id="age" class="hdc-pick" name="age">${ageOptions}</select></div>
<button type="submit">Search</button>
</form>
<div class="srch-hero n9-hero"><div class="hero-slot"><form class="bigsearch" action="/search" method="get" role="search" aria-label="Search day passes">${heroKeep}
<label class="seg"><span id="where-label">Where</span><select id="where-hero" class="hdc-pick" name="destination" aria-labelledby="where-label"><option value="" data-icon="pin"${selectedDest ? '' : ' selected'}>Anywhere in Australia</option>${whereOptions(selectedDest)}</select></label>
<label class="seg"><span id="when-label">When</span><input id="when-hero" class="hdc-date" type="date" name="date" min="${minDate}" max="${maxDate}" value="${esc(params.date)}" aria-labelledby="when-label"></label>
<label class="seg"><span id="guests-label">Guests</span><select id="guests-hero" class="hdc-pick" name="guests" aria-labelledby="guests-label">${guestOptions}</select></label>
<button type="submit">${FIND_ICON}<span>Search</span></button>
</form></div></div>
<button type="button" class="search-sum" aria-haspopup="dialog" aria-controls="search-sheet" aria-label="Edit search: ${esc(pillSub)}"><span class="t"><b>${esc(pillTitle)}</b><small>${esc(pillSub)}</small></span><span class="go" aria-hidden="true">${FIND_ICON}</span></button>
<div class="toolrow">${mapToggle}<button type="button" class="fbtn" id="filters-btn" aria-haspopup="dialog" aria-controls="filter-drawer" aria-expanded="false">${FILTER_ICON}<span>Filters</span>${badge}</button><div class="ichips" role="group" aria-label="Mood">${mood}</div>
<form class="sort-form" action="/search" method="get">${searchHidden(params, 'sort')}<label class="sort-label"><span class="sort-name">Sort</span><select class="hdc-pick" name="sort" aria-label="Sort listings" onchange="this.form.submit()">${sortOptions}</select></label><noscript><button type="submit">Sort</button></noscript></form></div>
${mapBlock}
<div data-live><div class="rhead cnt"><h1 id="search-count" role="status" aria-live="polite">${esc(countHeading)}</h1>${params.mood ? `<a class="mclear" href="${esc(SearchQuery.href({ ...params, mood: '' }))}">Clear</a>` : ''}</div>
${params.guestsCapped ? '<p class="cap-note" role="status">Up to 6 people per booking.</p>' : ''}
${chips ? `<div class="chips" aria-label="Active filters">${chips}${clear}</div>` : ''}
${empty || `<div class="${resultClass}">${cards}</div>`}${others}
<p class="note">Fictional example hotels. ${LinkStyles.textLink('/guides', 'Read the day pass guides')}.</p>
</div>
<div class="sheet-bd" data-close-drawer hidden></div>
<form id="filter-drawer" class="drawer" action="/search" method="get" role="dialog" aria-modal="true" aria-labelledby="filters-h" hidden>
<div class="dh"><h2 id="filters-h" tabindex="-1">Filters</h2><a class="tlink" href="${esc(resetHref)}">Reset</a><button class="ibtn" type="button" data-close-drawer aria-label="Close filters">Close</button></div>
<div class="dbody">
<fieldset><legend>Sort</legend><div class="rgrid">${sortRadios}</div></fieldset>
<fieldset><legend>What</legend><div class="fgrid">${wantRadios}</div></fieldset>
<fieldset><legend>Price</legend><div class="rgrid">${priceRadios}</div></fieldset>
<fieldset><legend>Age</legend><div class="rgrid">${ageRadios}</div></fieldset>
<fieldset><legend>Guests</legend><div class="step" data-max="${guestMax}"><button class="ibtn" type="button" data-step="-1" aria-label="Fewer guests">&#8722;</button><output aria-live="polite">${esc(guestShown)}</output><button class="ibtn" type="button" data-step="1" aria-label="More guests">+</button><input type="hidden" name="guests" value="${params.guests ? esc(params.guests) : ''}"></div><p class="step-note">Up to ${guestMax} per booking.</p></fieldset>
</div>
<div class="df">${hiddenField('destination', selectedDest)}${hiddenField('date', params.date)}${params.date || !params.range ? '' : hiddenField('from', params.range.from) + hiddenField('to', params.range.to)}${hiddenField('mood', params.mood)}<p class="hint" id="filter-hint" role="status"${countN ? ' hidden' : ''}>No matches. Try fewer filters.</p><button class="apply" type="submit" data-count="${countN}" aria-live="polite"${countN ? '' : ' disabled aria-describedby="filter-hint"'}>Show ${countN} results</button></div>
</form>
<div id="search-sheet" class="ssheet" role="dialog" aria-modal="true" aria-labelledby="ssheet-h" hidden>
<div class="ssheet-bar"><h2 id="ssheet-h" tabindex="-1">Edit search</h2><button class="ibtn" type="button" data-close-sheet aria-label="Close search">Close</button></div>
<div class="ssheet-body"></div>
</div>
</div>
<script>(function(){var c=document.querySelector('.ichips');var on=c&&c.querySelector('.mood[aria-pressed="true"]');if(on)c.scrollLeft=Math.max(0,on.offsetLeft-120)})();</script>`;
  return page(result.heading, body, {
    titleReady: true,
    documentTitle: result.title,
    description: 'Example day passes in Australia. Choose a place, a date, guests, a price and an age. These listings are fictional.',
    path: '/search',
    index: true,
    css: '/search.css',
    js: '/search-ui.js',
    headerHtml,
    guestD2: true,
  });
}
app.get('/', (req, res) => {
  const next = SearchQuery.homeRedirect(req.query);
  if (next) return res.redirect(301, next);
  res.send(homePage({
    destination: String(req.query.destination || ''),
    joined: req.query.waitlist === '1',
  }));
});
app.get('/search', (req, res) => {
  res.send(searchPage(req.query));
});
app.get('/api/search-count', (req, res) => {
  res.json({ count: loadSearch(req.query).list.length });
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

app.get('/h/:slug/seat/:code', (req, res) => {
  const h = publicHotel(req.params.slug);
  if (!h) return sendNotFound(res);
  const slug = encodeURIComponent(h.slug);
  const pass = getPasses(h.id).find(p => p.code === String(req.params.code || ''));
  if (!pass) return res.redirect(301, `/h/${slug}#passes`);
  const params = new URLSearchParams();
  params.set('pass', pass.code);
  for (const key of ['date', 'qty']) {
    const val = String(req.query[key] || '').slice(0, 12);
    if (val) params.set(key, val);
  }
  res.redirect(301, `/h/${slug}?${params.toString()}#book`);
});

function listingHold(h, req, startDay) {
  if (String(req.query.notice || '') !== '1') return null;
  const raw = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const pass = getPasses(h.id).find(p => p.code === String(req.query.pass || '').slice(0, 40));
  if (!pass) return null;
  const maxUnits = SearchQuery.maxUnits(pass.holds);
  const qty = Math.max(1, Math.min(maxUnits, parseInt(req.query.qty, 10) || 1));
  const maxBook = ymd(addDays(new Date(startDay + 'T12:00:00'), DateHold.lookAhead()));
  if (raw > maxBook) {
    const next = DateHold.nextOpen(availability, h.id, pass.id, qty, startDay, maxBook);
    return DateHold.view({ hotel: h, pass, qty, date: raw, kind: 'closed', reason: 'Beyond booking window', next });
  }
  const row = availability(h.id, raw).find(p => p.id === pass.id);
  const kind = DateHold.classify(row);
  if (!kind) return null;
  const next = DateHold.nextOpen(availability, h.id, pass.id, qty, startDay, raw);
  return DateHold.view({ hotel: h, pass, qty, date: raw, kind, reason: row && row.blocked, next });
}
function listingOffer(h, date, qty, passCode, rows) {
  if (!date || !rows || !rows.length || rows.some(r => r.past)) return null;
  const qtyN = Math.max(1, Math.min(SearchQuery.BOOKING_SPOTS, parseInt(qty, 10) || 1));
  const blocked = rows.some(r => r.blocked);
  const allOut = rows.every(r => Number(r.remaining) < qtyN);
  if (!blocked && !allOut) return null;
  const startDay = today(h);
  const next = DateHold.earliestOpen(availability, h.id, rows, qtyN, startDay, date);
  const copy = DateHold.offerCopy(blocked ? 'closed' : 'soldout', nice(date), next ? nice(next) : '');
  return {
    ...copy,
    href: next ? ListingPanel.dayHref(h.slug, next, { passCode, qty: qtyN }) : '',
    bar: `${copy.word} · ${nice(date)}`,
  };
}
function listingStep(h, date, qty, passCode) {
  const startDay = today(h);
  const maxDate = ymd(addDays(new Date(startDay + 'T12:00:00'), 90));
  const step = dayStepLinks({ slug: h.slug, date, minDate: startDay, maxDate, passCode, qty });
  step.hours = date ? ListingPanel.dayHours(db, h, hoursLines(db, h), date) : '';
  return step;
}
app.get('/h/:slug', (req, res) => {
  const h = publicHotel(req.params.slug); if (!h) return sendNotFound(res);
  const startDay = today(h);
  recordListingView(db, h.id, startDay, req);
  const maxDate = ymd(addDays(new Date(startDay + 'T12:00:00'), 90));
  const hold = listingHold(h, req, startDay);
  const date = hold ? hold.date : chosenDate(req.query.date, h);
  const passes = getPasses(h.id);
  const av = date ? availability(h.id, date) : openAvailability(h.id);
  const from = passes.length ? Math.min(...passes.map(p => p.price)) : 0;
  const items = loadInclusions(db, h.id);
  const foodLine = guestFoodLine(db, h);
  const closed = {};
  const dayHours = {};
  const origin = new Date(startDay + 'T12:00:00');
  for (let i = 0; i <= 90; i++) {
    const d = ymd(addDays(origin, i));
    const why = closureReason(db, h, d, clockNow());
    if (why) closed[d] = String(why);
    else {
      const span = dayHoursText(db, h, d);
      if (span) dayHours[d] = span;
    }
  }
  const demo = Number(h.is_demo) === 1;
  const photo = h.photos[0] ? seo.absolute('/assets/photos/' + h.photos[0]) : seo.DEFAULT_IMAGE;
  const late = d => cancelNote(db, h, d, clockNow()) === ListingD2.LATE_NOTE;
  const passCode = String(req.query.pass || '').slice(0, 40);
  const cancelText = date ? cancelNote(db, h, date, clockNow()) : FREE_CANCEL;
  res.send(page(h.name, listingHtml({
    h, date, minDate: startDay, maxDate, closed, dayHours, passes, av, from, late,
  cancelText,
    included: items,
    groups: HotelAmenities.groups(db, h.id, { people: 1 }),
    addons: getAddons(h.id, true),
    hourRows: hoursLines(db, h),
    passCode,
    qty: req.query.qty,
    hold,
    explore: loadExplore(db, h.id),
    db,
  }), {
    analytics: true,
    index: demo ? 'follow' : true,
    path: '/h/' + h.slug,
    documentTitle: seo.listingTitle(h.name, demo),
    description: seo.listingDescription(h),
    image: photo,
    imageAlt: demo ? 'Stock photo, not this hotel' : seo.shortName(h.name),
    jsonld: seo.listingJsonLd(h, { from, image: photo }),
    css: '/listing-dir2.css',
    htmlClass: 'pass-b',
    htmlDataN: (h.photos || []).length,
  }));
});

app.get('/api/availability', (req, res) => {
  const h = publicHotel(req.query.hotel); if (!h) return res.status(404).json({ error: 'not found' });
  const rawDate = String(req.query.date || '');
  const startDay = today(h);
  const date = chosenDate(rawDate, h) || (/^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate < startDay ? rawDate : '');
  const passCode = String(req.query.pass || '').slice(0, 40);
  const passRow = passCode ? getPasses(h.id).find(x => x.code === passCode) : null;
  const holds = Math.max(1, Number(passRow && passRow.holds) || 1);
  const maxUnits = SearchQuery.maxUnits(holds);
  const qty = Math.max(1, Math.min(maxUnits, parseInt(req.query.qty, 10) || 1));
  const step = listingStep(h, date, qty, passCode);
  if (!date) {
    const passes = openAvailability(h.id);
    return res.json({ hotel: h.slug, date: '', passes, day_left: null, addons: [], cancel: PICK_DATE_CANCEL, offer: null, step });
  }
  const passes = availability(h.id, date);
  const offer = listingOffer(h, date, qty, passCode, passes);
  const spots_banner = spotsLabel(spotsCount(passes, date));
  res.json({ hotel: h.slug, date, passes, day_left: passes.day_left ?? null, spots_banner, addons: addonAvailability(h.id, date), cancel: cancelNote(db, h, date, clockNow()), offer, step });
});

function validate(q) {
  const h = publicHotel(q.hotel); if (!h) return { err: 'Hotel not found.' };
  const dateRaw = String(q.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { err: 'Pick a date.', h, kind: 'pickdate' };
  const date = dateRaw;
  const p = getPasses(h.id).find(x => x.code === q.pass);
  if (!p) return { err: 'Pick a pass.', h, date, kind: 'pickpass' };
  const holds = Math.max(1, Number(p.holds) || 1);
  const maxUnits = SearchQuery.maxUnits(holds);
  const rawQty = Math.max(1, parseInt(q.qty, 10) || 1);
  const startDay = today(h);
  const maxBook = ymd(addDays(new Date(startDay + 'T12:00:00'), 90));
  if (date > maxBook) {
    return { err: 'You can book up to 90 days ahead.', h, p, date, qty: Math.min(rawQty, maxUnits), kind: 'closed', reason: 'Beyond booking window' };
  }
  if (rawQty > maxUnits || SearchQuery.bookingPeople(rawQty, holds) > SearchQuery.BOOKING_SPOTS) {
    return {
      err: 'Up to 6 people per booking.',
      h,
      p,
      date,
      qty: maxUnits,
      kind: 'people',
      reason: 'Up to 6 people per booking',
    };
  }
  const qty = rawQty;
  const people = SearchQuery.bookingPeople(qty, holds);
  const a = availability(h.id, date).find(x => x.id === p.id);
  if (a.past) return { err: 'That date has passed.', h, p, date, qty, kind: 'past' };
  if (a.blocked) {
    if (/same-day|closed for today/i.test(a.blocked)) return { err: a.blocked + '.', h, p, date, qty, kind: 'closed', reason: a.blocked };
    return { err: `${h.name} is closed on ${nice(date)} (${a.blocked}).`, h, p, date, qty, kind: 'closed', reason: a.blocked };
  }
  if (a.remaining < qty) {
    if (a.remaining === 0) return { err: `${spotLabel(p)} is sold out on ${nice(date)}.`, h, p, date, qty, kind: 'soldout' };
    return {
      err: `Only ${a.remaining} ${spotLabel(p)} left on ${nice(date)}.`,
      h,
      p,
      date,
      qty,
      kind: 'partial',
      remaining: a.remaining,
      clampQty: a.remaining,
    };
  }
  const add = chosenAddons(h.id, date, people, q);
  if (add.err) return { err: add.err, h };
  return { h, p, date, qty, people, a, addons: add.addons, addonTotal: add.addonTotal };
}
const errPage = (v, res) => res.status(409).send(page('Not available', `<div class="wrap sec narrow"><div class="alert">${esc(v.err)}</div>${v.h ? `<a class="btn btn-navy" href="/h/${v.h.slug}">Back to ${esc(v.h.name)}</a>` : ''}</div>`, { analytics: false, index: false, canonical: false }));
function holdReply(v, res) {
  if (!v || !v.h) return false;
  if (v.kind === 'pickdate' || v.kind === 'pickpass') {
    res.redirect(303, `/h/${encodeURIComponent(v.h.slug)}#book`);
    return true;
  }
  if (!v.kind || !v.p || !v.date) return false;
  const params = new URLSearchParams();
  params.set('date', v.date);
  params.set('pass', v.p.code);
  const clamp = v.clampQty != null ? v.clampQty : v.qty;
  params.set('qty', String(clamp || 1));
  if (['partial', 'people', 'closed', 'past', 'soldout'].includes(v.kind)) params.set('notice', '1');
  res.redirect(303, `/h/${encodeURIComponent(v.h.slug)}?${params.toString()}#book`);
  return true;
}

const bookHolds = new Map();
function issueBookToken(existing) {
  const now = Date.now();
  if (bookHolds.size > 500) {
    for (const [key, row] of bookHolds) if (now - row.at > 2 * 60 * 60 * 1000) bookHolds.delete(key);
  }
  const held = existing && bookHolds.get(existing);
  if (held && !held.code) return existing;
  const token = crypto.randomBytes(16).toString('hex');
  bookHolds.set(token, { pending: false, code: '', at: now });
  return token;
}
function bookFieldErrors(body) {
  const errors = {};
  if (!String(body.name || '').trim()) errors.name = 'Enter your name.';
  if (!/^\S+@\S+\.\S+$/.test(String(body.email || '').trim())) errors.email = 'Enter a valid email.';
  if (String(body.phone || '').replace(/\D/g, '').length < 8) errors.phone = 'Enter a mobile number.';
  const ticked = key => body[key] === '1' || body[key] === 'on';
  if (!ticked('accept')) errors.accept = 'Tick the box above to continue.';
  return errors;
}
function fieldError(errors, key) {
  return errors && errors[key] ? `<p class="field-error" id="err-${key}">${esc(errors[key])}</p>` : '';
}
function checkedArrival(hotel, date, raw, now = new Date()) {
  if (!hotel) return { value: 'unsure' };
  return normalizeArrival(raw, arrivalOptions(db, hotel, date, now));
}

function renderCheckout(query, res, extra = {}) {
  const v = validate(query);
  if (v.err) {
    if (holdReply(v, res)) return;
    if (!v.h) return sendNotFound(res);
    return errPage(v, res);
  }
  const draft = extra.draft || {};
  const errors = extra.errors || {};
  const bookToken = issueBookToken(extra.token);
  const { h, p, date, qty, people } = v;
  const grand = p.price * qty + v.addonTotal;
  const cancel = cancelNote(db, h, date);
  const foodLine = guestFoodLine(db, h);
  const incItems = loadInclusions(db, h.id);
  const incLines = includedLines(incItems, people);
  const parkNote = includedNote(incItems);
  const demo = Number(h.is_demo) === 1;
  const hotelLabel = seo.shortName(h.name);
  const passLabel = `${spotLabel(p)} × ${qty}`;
  const planSpan = dayHoursText(db, h, date);
  const passAreas = forPass(db, p.id).map(area => ({
    ...area,
    hours: Number(area.serves_food) ? area.hours : (planSpan || area.hours),
  }));
  const includedBody = `${incLines.length ? `<ul class="co-inc-list">${incLines.map(line => `<li>${esc(line.text)}</li>`).join('')}</ul>` : ''}${parkNote ? `<p class="pass-note">${esc(parkNote)}</p>` : ''}${accessBlock(passAreas.filter(area => !Number(area.serves_food)), { demo, compact: true })}`;
  const included = includedBody.trim() ? `<details class="co-inc"><summary>What's included</summary><div class="co-inc-body">${includedBody}</div></details>` : '';
  const rulesOpts = { ...hoursView(db, h, date), foodSentence: foodLine, checkout: true };
  const picked = new Set(v.addons.map(x => x.code));
  const offer = addonAvailability(h.id, date);
  const hasExtras = offer.length > 0;
  const steps = CheckoutFlow.steps(hasExtras);
  const addonFields = offer.length ? `<section class="co-card" id="extras"><h2><span class="co-step">${steps.extras}</span> Add extras <span class="extra-opt">(optional)</span></h2><div class="extra-list" id="co-addons">${offer.map(ad => {
    const need = ad.per === 'booking' ? 1 : people;
    const dis = ad.remaining < need;
    const on = !dis && picked.has(ad.code);
    const price = !dis && Number(ad.price) > 0 ? `<span class="extra-price">${money(ad.price)}</span>` : '';
    const note = dis ? '<span class="extra-note">Sold out for this date</span>' : '';
    return `<label class="extra${dis ? ' is-off' : ''}"><input type="checkbox" name="addon" value="${esc(ad.code)}" data-price="${Number(ad.price) || 0}" data-per="${esc(ad.per)}" ${dis ? 'disabled' : ''} ${on ? 'checked' : ''}><span class="extra-name">${esc(ad.name)}</span>${price}${note}</label>`;
  }).join('')}</div></section>` : '';
  const arrivalChoices = arrivalOptions(db, h, date);
  const pickedArrival = arrivalChoices.some(option => option.value === draft.arrival) ? draft.arrival : 'unsure';
  const arrivalInvalid = errors.arrival ? ' aria-invalid="true" aria-describedby="err-arrival arrival-help"' : ' aria-describedby="arrival-help"';
  const arrivalOptionsHtml = arrivalChoices.map(option => `<option value="${esc(option.value)}"${option.value === pickedArrival ? ' selected' : ''}>${esc(option.label)}</option>`).join('');
  const arrivalCard = `<section class="co-card" id="arrival-card"><h2><span class="co-step">${steps.arrival}</span> Arrival</h2>
<label class="fl" for="arrival">Expected arrival time
<select id="arrival" name="arrival"${arrivalInvalid}>${arrivalOptionsHtml}</select>
${fieldError(errors, 'arrival')}</label>
<p class="muted small" id="arrival-help">An estimate only. It lets the hotel plan for you; it is not a reserved time slot.</p>
</section>`;
  const confirmLabel = `Confirm booking · ${money(grand)}`;
  const on = key => draft[key] === '1' || draft[key] === 'on';
  const tick = (name, html, required) => CheckoutConsent.box({ name, html, required, checked: on(name), invalid: !!errors[name] });
  const remaining = CheckoutFlow.requiredTicks().filter(name => !on(name)).length;
  const reasonText = CheckoutFlow.reason(remaining);
  const seatHref = `/h/${encodeURIComponent(h.slug)}?date=${encodeURIComponent(date)}&pass=${encodeURIComponent(p.code)}&qty=${qty}#book`;
  const dateHref = `/h/${encodeURIComponent(h.slug)}?date=${encodeURIComponent(date)}#book`;
  const dateChange = CheckoutFlow.changeLink(dateHref, 'date');
  const passChange = CheckoutFlow.changeLink(seatHref, 'pass');
  const extraText = CheckoutFlow.extraHtml(v.addons);
  const extrasRow = hasExtras ? `<dt>Extras</dt><dd class="co-fact"><span class="co-fact-val" id="co-extras-val">${extraText}</span>${CheckoutFlow.changeLink('#extras', 'extras')}</dd>` : '';
  const asideBtn = CheckoutFlow.confirmControl({ id: 'co-btn', reasonId: 'co-reason-aside', label: confirmLabel, remaining, full: true, placement: 'aside' });
  const formBtn = CheckoutFlow.confirmControl({ id: 'co-btn-form', reasonId: 'co-reason-form', label: confirmLabel, remaining, full: true, placement: 'form' });
  const dockBtn = CheckoutFlow.confirmControl({ id: 'co-btn-dock', reasonId: 'co-reason-dock', label: confirmLabel, remaining, full: false, placement: 'dock' });
  const paymentCard = `<section class="co-card co-pay" id="co-pay"><h2><span class="co-step">${steps.payment}</span> Payment</h2><div class="demo-pay"><p>Demo site. No card is collected and nothing is charged.</p></div></section>`;
  res.status(extra.status || 200).send(page('Checkout', `<div class="wrap sec checkout">
<a class="link small" href="/h/${h.slug}?date=${date}">← Back to listing</a><h1 class="l-title">Book your day</h1>
<p class="muted small">Demo site. No card is charged and no real booking is created.</p>
<div class="co-layout">
<aside class="co-sum" id="co-sum">
<button type="button" class="co-sum-bar" id="co-sum-bar" aria-expanded="false" aria-controls="co-sum-body"><span>${esc(passLabel)}</span><b class="co-total">${money(grand)}</b></button>
<div class="co-sum-body" id="co-sum-body">
${PhotoAssets.imgTag(h.photos[0], { alt: demo ? 'Stock photo, not this hotel' : 'Photo of ' + seo.shortName(h.name), width: 640, height: 360, sizes: '640px' })}
<div class="pad">
<h2>${esc(hotelLabel)}</h2>
<p class="muted small">${esc(guestAreaName(h.area))}</p>
<dl><dt>Date</dt><dd class="co-fact"><span class="co-fact-val">${esc(nice(date))}</span>${dateChange}</dd><dt>Pass</dt><dd class="co-fact"><span class="co-fact-val co-pass-line">${esc(passLabel)} · ${esc(money(p.price * qty))}</span>${passChange}</dd><dt>Guests</dt><dd>${people}</dd>${extrasRow}</dl>
${included}
<div class="bb-total"><span>Total</span><b class="co-total" id="co-total">${money(grand)}</b></div>
<p class="muted small">Prices include GST. Demo only.</p>
${asideBtn}
</div></div></aside>
<form class="co-form" id="co-form" method="post" action="/book">
${['hotel', 'date', 'qty'].map(k => `<input type="hidden" name="${k}" value="${esc(query[k])}">`).join('')}<input type="hidden" name="pass" value="${p.code}"><input type="hidden" name="book_token" value="${esc(bookToken)}">
<p class="sr-only" id="co-reason-live" aria-live="polite">${esc(reasonText)}</p>
${extra.formError ? `<div class="alert" role="alert">${esc(extra.formError)}</div>` : ''}
<section class="co-card"><h2><span class="co-step">${steps.details}</span> Your details</h2>
<label class="fl">Full name<input name="name" required autocomplete="name" placeholder="Alex Citizen" value="${esc(draft.name || '')}" ${errors.name ? 'aria-invalid="true" aria-describedby="err-name"' : ''}>${fieldError(errors, 'name')}</label>
<div class="two"><label class="fl">Email<input name="email" type="email" required autocomplete="email" placeholder="alex@example.com" value="${esc(draft.email || '')}" ${errors.email ? 'aria-invalid="true" aria-describedby="err-email"' : ''}>${fieldError(errors, 'email')}</label>
<label class="fl">Mobile<input name="phone" type="tel" required pattern="[0-9+ \\-\\(\\)]{8,}" autocomplete="tel" placeholder="0412 345 678" value="${esc(draft.phone || '')}" ${errors.phone ? 'aria-invalid="true" aria-describedby="err-phone"' : ''}>${fieldError(errors, 'phone')}</label></div>
</section>
${arrivalCard}
${addonFields}
${paymentCard}
<section class="co-card co-before" id="co-consent"><h2><span class="co-step">${steps.before}</span> Before you book</h2>
${CheckoutConsent.keyPointsHtml(h)}
<details class="co-full">
<summary>${esc(CheckoutConsent.detailsSummary())}</summary>
${riskCard(h, { link: false })}
${rulesCard(h, rulesOpts)}
<div class="co-group">${CheckoutConsent.groupHtml()}</div>
</details>
<p class="privacy-note">${CheckoutConsent.noticeHtml(hotelLabel)}</p>
<p class="cancel-note">${esc(cancel)} <a href="/refunds">Cancellation and refunds</a></p>
${tick('accept', CheckoutConsent.acceptHtml(h), true)}${fieldError(errors, 'accept')}
<p class="co-acl">${esc(CheckoutConsent.aclText())}</p>
${tick('marketing', CheckoutConsent.checkoutMarketingHtml(), false)}
<div class="co-decide">${formBtn}</div>
</section>
</form>
<div class="co-dock"><div class="co-dock-total"><span>Total</span><b class="co-total">${money(grand)}</b></div>${dockBtn}</div>
</div></div>
<script>
${CheckoutFlow.storageApi()}
const required=${JSON.stringify(CheckoutFlow.requiredTicks())};
const consentNames=${JSON.stringify(CheckoutFlow.consentTicks())};
const pass=${p.price}, spots=${qty}, people=${people};
const fmt=n=>'$'+n.toLocaleString('en-AU');
let sending=false;
const form=document.getElementById('co-form');
function ticksLeft(){
  var n=0;
  required.forEach(function(name){ if(form[name] && !form[name].checked) n++; });
  return n;
}
function syncConsent(){
  if(sending) return;
  var left=ticksLeft();
  var text=checkoutReason(left);
  document.querySelectorAll('.co-btn').forEach(function(btn){
    var reasonId=btn.getAttribute('data-reason');
    if(left>0){
      btn.setAttribute('aria-disabled','true');
      if(reasonId) btn.setAttribute('aria-describedby', reasonId);
    } else {
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('aria-describedby');
    }
  });
  document.querySelectorAll('.co-reason').forEach(function(el){
    el.textContent=text;
    el.hidden=left<=0;
  });
  var live=document.getElementById('co-reason-live');
  if(live && live.textContent!==text) live.textContent=text;
}
function escHtml(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function paint(){let extra=0;const parts=[];
 document.querySelectorAll('#co-addons input:checked').forEach(i=>{const price=+i.dataset.price,q=i.dataset.per==='booking'?1:people;extra+=price*q;const name=i.parentElement.querySelector('.extra-name').textContent;parts.push(escHtml(name)+' × '+q+' · <span class="co-nowrap">'+fmt(price*q)+'</span>')});
 const total=pass*spots+extra;
 const extras=document.getElementById('co-extras-val'); if(extras) extras.innerHTML=parts.length?parts.join(', '):'None';
 const label='Confirm booking · '+fmt(total);
 document.querySelectorAll('.co-total').forEach(el=>{el.textContent=fmt(total)});
 if(!sending) document.querySelectorAll('.co-btn').forEach(btn=>{btn.textContent=label});
 syncConsent();
}
document.querySelectorAll('#co-addons input').forEach(i=>i.onchange=paint);
const sumBar=document.getElementById('co-sum-bar');
if(sumBar) sumBar.addEventListener('click',function(){const open=document.getElementById('co-sum').classList.toggle('is-open');sumBar.setAttribute('aria-expanded',open?'true':'false')});
const storeKey='hdc-checkout:'+form.hotel.value+':'+form.date.value+':'+form.pass.value+':'+form.qty.value;
function remembered(){try{return JSON.parse(sessionStorage.getItem(storeKey)||'null')}catch(e){return null}}
function remember(){
  try{sessionStorage.setItem(storeKey, JSON.stringify(checkoutPayload(form)))}catch(e){}
}
const saved=remembered();
if(saved && !form.name.value && !form.email.value && !form.phone.value){
  applyCheckoutMemory(form, saved);
}
form.addEventListener('input', remember);
form.addEventListener('change', function(){ remember(); syncConsent(); });
function clearInvalid(el){
  el.removeAttribute('aria-invalid');
  const ids=(el.getAttribute('aria-describedby')||'').split(/\\s+/).filter(Boolean);
  const keep=[];
  ids.forEach(function(id){const msg=document.getElementById(id); if(msg&&msg.classList.contains('field-error')) msg.remove(); else keep.push(id);});
  if(keep.length) el.setAttribute('aria-describedby', keep.join(' '));
  else el.removeAttribute('aria-describedby');
}
form.querySelectorAll('[aria-invalid="true"]').forEach(el=>{
  el.addEventListener('input', function(){clearInvalid(el);});
  el.addEventListener('change', function(){clearInvalid(el);});
});
const firstInvalid=form.querySelector('[aria-invalid="true"]');
if(firstInvalid) firstInvalid.focus();
form.addEventListener('submit', function(ev){
  if(ticksLeft()>0){ev.preventDefault(); syncConsent(); return;}
  if(sending){ev.preventDefault(); return;}
  sending=true;
  document.querySelectorAll('.co-btn').forEach(btn=>{btn.disabled=true; btn.setAttribute('aria-busy','true'); btn.textContent='Confirming…';});
});
window.addEventListener('pageshow', function(ev){
  if(!ev.persisted) return;
  sending=false;
  var raw=null;
  try{ raw=sessionStorage.getItem(storeKey); }catch(e){}
  if(raw==null) consentNames.forEach(function(name){ if(form[name]) form[name].checked=false; });
  document.querySelectorAll('.co-btn').forEach(btn=>{btn.disabled=false; btn.removeAttribute('aria-busy')});
  paint();
});
paint();
</script>`, { analytics: false, index: false, canonical: false }));
}
app.get('/checkout', (req, res) => renderCheckout(req.query, res));

app.post('/book', async (req, res) => {
  const b = req.body;
  const token = String(b.book_token || '');
  let hold = null;
  if (token) {
    hold = bookHolds.get(token);
    if (hold && hold.code) return res.redirect(303, '/booking/' + hold.code);
    if (!hold || hold.pending) {
      return errPage({ err: hold && hold.pending ? 'That booking is already being confirmed.' : 'This checkout has expired. Start again from the listing.', h: publicHotel(b.hotel) }, res);
    }
    hold.pending = true;
  }
  const errors = bookFieldErrors(b);
  let code, v, arrivalValue = 'unsure', arrivalBlocked = false;
  v = validate(b);
  if (!v.err && v.h) {
    const checked = checkedArrival(v.h, v.date, b.arrival);
    if (checked.malformed || checked.status === 400) {
      if (hold) hold.pending = false;
      return res.status(400).type('text/plain; charset=utf-8').send('Please choose a time from the list.');
    }
    if (checked.error) errors.arrival = checked.error;
    else arrivalValue = checked.value;
  }
  if (v.err || Object.keys(errors).length) {
    if (hold) hold.pending = false;
    if (v.err && holdReply(v, res)) return;
    if (v.err && !v.h) return sendNotFound(res);
    if (v.err) return renderCheckout(b, res, { draft: b, errors, token, status: 409, formError: v.err });
    return renderCheckout(b, res, { draft: b, errors, token, status: 409 });
  }
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim();
  const phone = String(b.phone || '').trim();
  db.transaction(() => {
    v = validate(b); if (v.err) return;
    const again = checkedArrival(v.h, v.date, b.arrival);
    if (again.malformed || again.status === 400) {
      v = { malformed: true };
      return;
    }
    if (again.error) {
      errors.arrival = again.error;
      arrivalBlocked = true;
      return;
    }
    arrivalValue = again.value;
    code = newCode();
    const shortCode = ShortCode.take(db);
    const seen = { ...hoursView(db, v.h, v.date), foodSentence: guestFoodLine(db, v.h) };
    const note = cancelNote(db, v.h, v.date);
    const rulesSnapshot = rulesText(v.h, { ...seen, checkout: true });
    const versions = LegalVersions.current();
    const consentAt = ConsentLog.utcNow();
    const consentIp = ConsentLog.clientIp(req);
    const marketingOn = ConsentLog.ticked(b, 'marketing') ? 1 : 0;
    const info = db.prepare(`INSERT INTO bookings(code,short_code,hotel_id,pass_type_id,date,qty,unit_price,total,guest_name,email,phone,party,rules_ack_at,rules_text,marketing_opt_in,terms_ack_at,risk_ack_at,risk_text,cancel_note,expected_arrival,terms_version,refunds_version,privacy_version,risk_version,consent_at,consent_ip,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,?,datetime('now'),datetime('now'),?,?,?,?,?,?,?,?,?,datetime('now'))`)
      .run(code, shortCode, v.h.id, v.p.id, v.date, v.qty, v.p.price, v.p.price * v.qty + v.addonTotal, name, email, phone, v.people, rulesSnapshot, marketingOn, riskText(v.h), note, arrivalValue, versions.terms, versions.refunds, versions.privacy, versions.risk, consentAt, consentIp);
    ConsentLog.write(db, info.lastInsertRowid, { at: consentAt, ip: consentIp, marketing: marketingOn === 1, rulesText: rulesSnapshot });
    const insAdd = db.prepare('INSERT INTO booking_addons(booking_id,addon_id,name,qty,unit_price,total) VALUES (?,?,?,?,?,?)');
    for (const ad of v.addons) insAdd.run(info.lastInsertRowid, ad.id, ad.name, ad.qty, ad.price, ad.line);
  }).immediate();
  if (v && v.malformed) {
    if (hold) hold.pending = false;
    return res.status(400).type('text/plain; charset=utf-8').send('Please choose a time from the list.');
  }
  if (arrivalBlocked) {
    if (hold) hold.pending = false;
    return renderCheckout(b, res, { draft: b, errors, token, status: 409 });
  }
  if (v.err) {
    if (hold) hold.pending = false;
    if (holdReply(v, res)) return;
    return renderCheckout(b, res, { draft: b, errors, token, status: 409, formError: v.err });
  }
  if (hold) {
    hold.code = code;
    hold.pending = false;
  }
  try {
    await sendBookingConfirmation(db, code);
  } catch (err) {
    console.error('booking confirmation email failed code=' + code);
  }
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
function parkingBlock(hotel, on) {
  if (!on || !hotel) return '';
  const entrance = String(hotel.parking_entrance || '').trim();
  const href = directionsHref(hotel);
  return `<div class="park-details">${entrance ? `<p>Parking entrance: ${esc(entrance)}</p>` : ''}${href ? `<p><a href="${esc(href)}">Directions</a></p>` : ''}<p>Show your booking code at the entrance</p></div>`;
}
app.get('/qr/:token.png', async (req, res) => {
  if (bookingLimited(req.ip || 'unknown')) return rejectBookingLookup(res);
  const token = String(req.params.token || '');
  const code = codeFromQrToken(token);
  const row = bookingFull(code || 'HDC-NO-SUCH');
  const booking = code && row && row.code === code && row.status !== 'cancelled' ? row : null;
  if (!booking) {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    return res.status(404).type('text/plain; charset=utf-8').send('Not found');
  }
  try {
    const png = await QRCode.toBuffer(checkinUrl(booking.code), { margin: 1, width: 360, color: { dark: brand['hdc-navy'], light: brand['hdc-bg'] } });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Content-Disposition', 'inline');
    return res.send(png);
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    return res.status(404).type('text/plain; charset=utf-8').send('Not found');
  }
});
app.get('/booking/:code/calendar.ics', (req, res) => {
  if (bookingLimited(req.ip || 'unknown')) return rejectBookingLookup(res);
  const asked = String(req.params.code || '').toUpperCase();
  if (ShortCode.is(asked)) return res.status(404).type('text/plain; charset=utf-8').send('Booking not found.');
  const b = bookingFull(asked);
  bookingPrivate(res);
  if (!b) return res.status(404).type('text/plain; charset=utf-8').send('Booking not found.');
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(b.hotel_id);
  res.type('text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${b.code}.ics"`);
  res.send(bookingIcs(b, hotel, eventWindow(db, hotel, b.date)));
});
app.get('/booking/:code', async (req, res) => {
  if (bookingLimited(req.ip || 'unknown')) return rejectBookingLookup(res);
  const asked = String(req.params.code || '').toUpperCase();
  if (ShortCode.is(asked)) return sendNotFound(res, { analytics: false, title: "We can't find that booking", body: bookingMissingBody(operatorEmail()), description: "We can't find that booking." });
  const b = bookingFull(asked);
  if (!b) return sendNotFound(res, { analytics: false, title: "We can't find that booking", body: bookingMissingBody(operatorEmail()), description: "We can't find that booking." });
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(b.hotel_id);
  const cancelled = b.status === 'cancelled';
  const qr = cancelled ? '' : await QRCode.toDataURL(checkinUrl(b.code), { margin: 1, width: 260, color: { dark: brand['hdc-navy'], light: brand['hdc-bg'] } });
  const adds = bookingAddons(b.id);
  const view = hoursView(db, hotel, b.date);
  const when = view.span || view.hoursLine;
  const party = b.party || b.qty * (b.holds || 1);
  const note = b.cancel_note || cancelNote(db, hotel, b.date, b.created_at || undefined);
  const hasParking = bookingHasParking(db, b.id, hotel.id);
  bookingPrivate(res);
  res.send(page(cancelled ? 'Booking cancelled' : 'Booking confirmed', bookingPageBody({
    b,
    hotel,
    qr,
    adds,
    when,
    party,
    note,
    lines: includedLines(loadInclusions(db, hotel.id), party),
    areas: forPass(db, b.pass_type_id),
    onsiteHtml: HotelAmenities.bookingHtml(db, hotel && hotel.id),
    shownName: maskName(b.guest_name),
    shownCode: b.short_code || b.code,
    shownEmail: maskEmail(b.email),
    mapHref: directionsHref(hotel),
    googleCal: passCalendarLink(b, hotel, eventWindow(db, hotel, b.date)),
    status: cancelled ? 'Cancelled' : b.checked_in_at ? HotelClock.guestCheckedIn(hotel, b.checked_in_at) : 'Confirmed',
    mayCancel: BookingCancel.guestMay(db, hotel, b),
    parkingHtml: cancelled ? '' : parkingBlock(hotel, hasParking),
  }), { analytics: false, index: false, canonical: false, css: '/booking-ticket.css', guestD2: true }));
});
app.post('/booking/:code/cancel', async (req, res) => {
  if (bookingLimited(req.ip || 'unknown')) return rejectBookingLookup(res);
  bookingPrivate(res);
  if (!sameSitePost(req)) return res.status(403).type('text/plain; charset=utf-8').send('Use the booking page on this site.');
  const code = String(req.params.code || '').toUpperCase();
  const b = bookingFull(code);
  if (!b) return sendNotFound(res, { analytics: false, title: "We can't find that booking", body: bookingMissingBody(operatorEmail()), description: "We can't find that booking." });
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(b.hotel_id);
  if (!BookingCancel.guestMay(db, hotel, b)) return res.redirect(303, '/booking/' + encodeURIComponent(b.code));
  const changed = BookingCancel.mark(db, b.id);
  if (changed) {
    try { await sendCancellation(db, b.code); } catch (err) { console.error('cancel email failed code=' + b.code); }
  }
  res.redirect(303, '/booking/' + encodeURIComponent(b.code));
});

const hotelAuth = (req, res, next) => { const id = req.signedCookies.hotel; const h = id && db.prepare('SELECT * FROM hotels WHERE id=?').get(id); if (!h) return res.redirect('/hotel/login'); req.hotel = hotelRow(h); next(); };
const hotelFails = new Map();
const HOTEL_WINDOW_MS = 15 * 60 * 1000;
const HOTEL_MAX_FAILS = 5;
function hotelFailure(ip) {
  const now = Date.now();
  let row = hotelFails.get(ip);
  if (!row || now - row.start > HOTEL_WINDOW_MS) row = { start: now, n: 0 };
  row.n += 1;
  hotelFails.set(ip, row);
  return row.n >= HOTEL_MAX_FAILS;
}
function hotelLocked(ip) {
  const row = hotelFails.get(ip);
  if (!row) return false;
  if (Date.now() - row.start > HOTEL_WINDOW_MS) { hotelFails.delete(ip); return false; }
  return row.n >= HOTEL_MAX_FAILS;
}
function hotelFailTarget(body, code) {
  if (String(body && body.return || '') === '/for-hotels') return '/for-hotels?e=' + code + '#login';
  const next = checkinNext(body && body.next);
  return '/hotel/login?e=' + code + (next ? '&next=' + encodeURIComponent(next) : '');
}
function checkinNext(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > 240) return '';
  let url;
  try { url = new URL(text, seo.ORIGIN); } catch { return ''; }
  if (url.origin !== seo.ORIGIN || url.pathname !== '/hotel/checkin') return '';
  const params = new URLSearchParams();
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  const q = String(url.searchParams.get('q') || '').replace(/[\r\n<>]/g, '').slice(0, 80);
  if (/^HDC-[A-Z0-9]+$/.test(code)) params.set('code', code);
  if (q) params.set('q', q);
  const search = params.toString();
  return '/hotel/checkin' + (search ? '?' + search : '');
}
function checkinUrl(code) {
  return seo.ORIGIN + '/hotel/checkin?code=' + encodeURIComponent(code);
}
function hotelLoginPanel(code, heading, next) {
  const tag = heading === 'h1' ? 'h1' : 'h2';
  const alert = code === 'lock'
    ? '<div class="alert" role="alert">Too many tries. Wait 15 minutes, then try again.</div>'
    : code ? '<div class="alert" role="alert">Wrong username or password.</div>' : '';
  const back = heading === 'h1' ? '' : '<input type="hidden" name="return" value="/for-hotels">';
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : '';
  return `<section class="login-card fh-login" id="login">
<${tag}>Hotel partner login</${tag}>
<p class="fh-login-help">For hotels we have invited. There is no sign-up on this page.</p>
${alert}
<form method="post" action="/hotel/login">${back}${nextField}
<label class="fl">Username<input name="user" required autocomplete="username"></label>
<label class="fl">Password<input name="pass" type="password" required autocomplete="current-password"></label>
<button class="btn btn-navy full" type="submit">Log in</button>
</form>
<p class="fh-forgot">Forgot password? <a href="mailto:${esc(contactEmail())}">Email us</a>.</p>
</section>`;
}
const FH_ICONS = {
  quiet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 20V10M10 20V5M15 20v-7M20 20H3"/></svg>',
  guests: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.8 14.2c2.3.2 4 1.8 4.6 4.8"/></svg>',
  control: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};
// The For hotels enquiry form reuses the contact backend as a partnership message.
function hotelEnquiryParse(body) {
  const raw = body || {};
  const clean = v => String(v || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  const hotel = clean(raw.hotel);
  const note = clean(raw.message);
  const values = { name: clean(raw.name).slice(0, 80), email: clean(raw.email).slice(0, 254), hotel: hotel.slice(0, 120), message: note.slice(0, 1800) };
  const message = `Hotel: ${hotel}. ${note || 'Enquiry from the For hotels page.'}`;
  const parsed = parseMessage({ name: raw.name, email: raw.email, company_website: raw.company_website, topic: 'partnership', message });
  if (parsed.honeypot || parsed.error) return { ...parsed, values };
  if (!hotel) return { error: 'Enter the hotel name.', values };
  if (hotel.length > 120) return { error: 'Hotel name is too long.', values };
  if (note.length > 1800) return { error: 'Message is too long. Keep it under 1,800 characters.', values };
  return { ...parsed, values };
}
function forHotelsHtml({ code = '', sent = false, error = '', values = {} } = {}) {
  const href = esc(talkHref());
  const v = values || {};
  const field = (label, name, attrs, val) => `<label class="fl"><span>${label}</span><input name="${name}" ${attrs} value="${esc(val || '')}"></label>`;
  const form = sent
    ? `<div class="fh-sent" role="status"><h3>Thanks, we have your note.</h3><p>We will be in touch by email soon.</p></div>`
    : `${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ''}<form class="fh-form" method="post" action="/contact">
<input type="hidden" name="form" value="hotel">
<div class="hp" aria-hidden="true"><label>Company website<input name="company_website" tabindex="-1" autocomplete="off" value=""></label></div>
${field('Your name', 'name', 'required maxlength="80" autocomplete="name"', v.name)}
${field('Hotel', 'hotel', 'required maxlength="120" autocomplete="organization"', v.hotel)}
${field('Work email', 'email', 'type="email" required maxlength="254" autocomplete="email"', v.email)}
<label class="fl"><span>Message <span class="opt">(optional)</span></span><textarea name="message" rows="3" maxlength="1800">${esc(v.message || '')}</textarea></label>
<button class="btn fh-submit" type="submit">Send enquiry</button>
<p class="fh-notice">${CheckoutConsent.hotelNoticeHtml(contactMail())}</p>
</form>`;
  const fig = (big, small) => `<li><b>${big}</b><span>${small}</span></li>`;
  const benefit = (icon, title, copy) => `<article class="fh-card"><span class="fh-ico">${FH_ICONS[icon]}</span><h3>${title}</h3><p>${copy}</p></article>`;
  const check = text => `<li>${FH_ICONS.tick}<span>${text}</span></li>`;
  return page('For hotels', `<div class="fh fh-d1">
<section class="wrap fh-hero">
<div class="fh-hero-copy">
<p class="fh-kicker">For hotels</p>
<h1>A quiet pool, <em>put to use.</em></h1>
<p class="fh-lead">Hotel Day Club is for hotels in Australia. Local guests book your pool, gym or spa for the day, on the days you choose. They do not need a room.</p>
<p class="fh-cta"><a class="btn btn-coral" href="#enquiry">Talk to us</a><a class="text-link" href="#dashboard">See how it works<span aria-hidden="true"> ↓</span></a></p>
</div>
<picture class="fh-hero-ph"><source type="image/webp" srcset="/golden/img/fh-loungers-sm.webp 800w, /golden/img/fh-loungers.webp 1400w" sizes="(max-width:800px) 100vw, 560px"><img src="/golden/img/fh-loungers.jpg" alt="Sun loungers and umbrellas beside a hotel pool" width="1400" height="934" fetchpriority="high" decoding="async"></picture>
</section>
<section class="fh-figs" aria-label="At a glance"><ul class="wrap">
${fig('$0', 'to list, no monthly fee')}
${fig('You set', 'days, spots, prices and hours')}
${fig('Pause', 'any day, from your dashboard')}
${fig('QR', 'check-in at your front desk')}
</ul></section>
<section class="wrap fh-why">
<p class="fh-kicker">Why hotels list</p>
<h2>Revenue from capacity you already have</h2>
<div class="fh-grid">
${benefit('quiet', 'Fill the quiet hours', 'Weekday pool, gym and spa time often has room in it. Day guests can take that time. Your in-house guests always come first.')}
${benefit('guests', 'Welcome local guests', 'They are new people through the door. Food and drink are never included in the pass. What they buy from you stays with the hotel.')}
${benefit('control', 'You stay in control', 'Free to list, no monthly fee. You set the seating, prices, numbers and hours. You get a monthly statement of your bookings. The terms are set out in your hotel agreement.')}
</div>
</section>
<section class="wrap fh-dash" id="dashboard">
<div class="fh-dash-copy">
<p class="fh-kicker">The hotel dashboard</p>
<h2>See today's guests at a glance</h2>
<ul class="fh-checks">
${check('Scan a QR code to check a guest in')}
${check('Night-before guest list by email')}
${check('Bookings, sales and fill rate in one place')}
${check('Pause a day or block dates yourself')}
</ul>
</div>
<figure class="fh-shot"><div class="fh-frame"><span class="fh-dots" aria-hidden="true"><i></i><i></i><i></i></span><picture><source type="image/webp" srcset="/golden/img/fh-dashboard.webp"><img src="/golden/img/fh-dashboard.jpg" alt="The hotel dashboard for a fictional demo hotel, showing today's check-ins, pause buttons and booking totals" width="1600" height="735" loading="lazy" decoding="async"></picture></div>
<figcaption>Sample data from the demo dashboard. The hotel and figures are fictional.</figcaption></figure>
</section>
<section class="wrap fh-product">
<p class="fh-kicker">On the day</p>
<h2>QR check-in and the guest list</h2>
<div class="fh-shot-row">
<figure class="fh-shot"><div class="fh-frame"><span class="fh-dots" aria-hidden="true"><i></i><i></i><i></i></span><picture><source type="image/webp" srcset="/golden/img/fh-checkin.webp"><img src="/golden/img/fh-checkin.jpg" alt="Demo QR check-in screen for a fictional hotel" width="1600" height="735" loading="lazy" decoding="async"></picture></div>
<figcaption>Sample QR check-in from the demo. Figures are fictional.</figcaption></figure>
<figure class="fh-shot"><div class="fh-frame"><span class="fh-dots" aria-hidden="true"><i></i><i></i><i></i></span><picture><source type="image/webp" srcset="/golden/img/fh-guestlist.webp"><img src="/golden/img/fh-guestlist.jpg" alt="Demo guest list for a fictional hotel" width="1600" height="735" loading="lazy" decoding="async"></picture></div>
<figcaption>Sample guest list from the demo. Figures are fictional.</figcaption></figure>
</div>
</section>
<section class="fh-enquiry" id="enquiry"><div class="wrap fh-enquiry-in">
<div class="fh-enquiry-copy">
<h2>See if it suits the hotel.</h2>
<p>Send us a note and we will walk you through how it would work for your hotel.</p>
<p>Hotels are invited. There is no sign-up form.</p>
<p class="fh-mail">Prefer email? <a href="${href}">Talk to us at ${esc(contactEmail())}</a></p>
</div>
<div class="fh-form-card">${form}</div>
</div></section>
<section class="wrap fh-login-row"><details class="fh-login-box"${code ? ' open' : ''}><summary>Hotel partner login</summary>${hotelLoginPanel(code)}</details></section>
</div>
<script>(function(){var d=document.querySelector('.fh-login-box');if(d&&location.hash==='#login')d.open=true;${error ? "var e=document.getElementById('enquiry');if(e)e.scrollIntoView();" : ''}})();</script>`, {
    analytics: true,
    index: true,
    headerRight: '<a class="hdr-login" href="/hotel/login">Hotel login</a><a class="pill" href="/#waitlist">Join the waitlist</a><a class="pill pill-rose" href="#enquiry">Talk to us</a>',
    guestD2: true,
    ...seo.pageCopy('hotels'),
    jsonld: seo.graph(seo.crumbs([{ name: 'For hotels', path: '/for-hotels' }])),
  });
}
app.get('/for-hotels', (req, res) => {
  const code = req.query.e === 'lock' ? 'lock' : req.query.e ? '1' : '';
  res.send(forHotelsHtml({ code, sent: req.query.sent === '1' }));
});
app.get('/hotel/join', (req, res) => res.redirect(302, '/for-hotels'));
app.post('/hotel/join', (req, res) => {
  if (!ownForm(req, res)) return;
  res.redirect(303, '/for-hotels');
});
const LEGAL_LINKS = '<p class="legal-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refunds">Refunds</a></p>';
app.get('/hotel/login', (req, res) => {
  const code = req.query.e === 'lock' ? 'lock' : req.query.e ? '1' : '';
  const next = checkinNext(req.query.next);
  res.send(page('Hotel partner login', `<div class="wrap sec narrow partner-login-page">
${hotelLoginPanel(code, 'h1', next)}
<p class="center partner-back"><a href="/for-hotels">For hotels</a></p>
${LEGAL_LINKS}</div>`, { bare: true, index: false, canonical: false }));
});
function ownForm(req, res) {
  if (sameSitePost(req)) return true;
  res.status(403).type('text/plain; charset=utf-8').send('Use the form on this site.');
  return false;
}
app.post('/hotel/login', (req, res) => {
  if (!ownForm(req, res)) return;
  const ip = req.ip || 'unknown';
  if (hotelLocked(ip)) return res.redirect(hotelFailTarget(req.body, 'lock'));
  const login = String(req.body.user || '').trim();
  const pass = String(req.body.pass || '');
  const h = db.prepare('SELECT * FROM hotels WHERE login=?').get(login);
  if (!verifyPassword(pass, h && h.password) || !h) {
    hotelFailure(ip);
    return res.redirect(hotelFailTarget(req.body, hotelLocked(ip) ? 'lock' : '1'));
  }
  hotelFails.delete(ip);
  staffCookie(res, 'hotel', String(h.id));
  res.redirect(checkinNext(req.body.next) || '/hotel');
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
function parkingTag(b) {
  return Number(b.parking_addon) === 1 || b.parking_mode === 'included' ? '<span class="pill park-tag">Parking</span>' : '';
}
function partyOf(b) {
  return b.party || b.qty * (b.holds || 1);
}
function arrivedMax(booked) { return booked + 4; }
function parseArrivedCount(raw, booked) {
  const text = String(raw == null ? '' : raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (n > arrivedMax(booked)) return null;
  return n;
}
function checkedInLabel(b, hotel, utc) {
  const time = utc ? HotelClock.iso(b.checked_in_at) : HotelClock.clock(hotel, b.checked_in_at);
  if (b.arrived_count == null || b.arrived_count === '') return `Checked in ${time}`;
  return `Checked in ${time} · ${Number(b.arrived_count)} arrived of ${partyOf(b)}`;
}
function arrivedOfBooked(rows) {
  let booked = 0, arrived = 0;
  for (const b of rows) {
    if (b.status === 'cancelled') continue;
    booked += partyOf(b);
    if (b.arrived_count != null && b.arrived_count !== '') arrived += Number(b.arrived_count);
  }
  return { booked, arrived };
}
function arrivedField(b) {
  const booked = partyOf(b);
  return `<label class="arrived-field">People arrived<input name="arrived" type="number" min="0" max="${arrivedMax(booked)}" step="1" inputmode="numeric" value="${booked}" required></label>`;
}
function statusCell(b, { checkin, redirect, day, compact, adminCancel, hotel }) {
  const cancel = adminCancel && b.status !== 'cancelled'
    ? `<form method="post" action="/admin/booking/cancel"><input type="hidden" name="code" value="${esc(b.code)}"><button class="btn btn-line btn-sm adm-btn-d">Cancel (demo)</button></form>`
    : '';
  if (b.status === 'cancelled') return adminCancel ? '<span class="adm-st adm-st-x">Cancelled</span>' : '<span class="pill out">Cancelled</span>';
  if (b.checked_in_at) {
    if (adminCancel) return `<span class="adm-st adm-st-ok">Arrived</span><div class="adm-muted small">${esc(checkedInLabel(b, hotel, true))}</div>${cancel}`;
    return `<span class="pill ok checkin-state">${esc(checkedInLabel(b, hotel, false))}</span>${cancel}`;
  }
  if (checkin && b.date === (day || today(hotel))) {
    const btn = compact ? 'btn btn-sm btn-navy' : 'btn btn-navy btn-check';
    return `<form method="post" action="/hotel/checkin"><input type="hidden" name="code" value="${esc(b.code)}"><input type="hidden" name="confirm" value="1"><input type="hidden" name="r" value="${esc(redirect)}">${arrivedField(b)}<button class="${btn}">Check in</button></form>${cancel}`;
  }
  return adminCancel ? `<span class="adm-st adm-st-ok">Confirmed</span>${cancel}` : `<span class="pill">Confirmed</span>${cancel}`;
}
function withNotes(rows) {
  if (!rows.length || rows[0].notes) return rows;
  const notes = db.prepare(`SELECT * FROM guest_notes WHERE booking_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`).all(...rows.map(r => r.id));
  const by = new Map();
  for (const n of notes) { if (!by.has(n.booking_id)) by.set(n.booking_id, []); by.get(n.booking_id).push(n); }
  return rows.map(r => ({ ...r, notes: by.get(r.id) || [] }));
}
function noteLabel(n, hotel, utc) {
  const label = n.kind === 'incident' ? 'Incident' : 'No-show';
  const time = utc ? HotelClock.iso(n.created_at) : HotelClock.clock(hotel, n.created_at);
  return `${label} ${time}${n.note ? ' · ' + n.note : ''}`;
}
function noteBits(b, hotel, utc) { return (b.notes || []).map(n => `<div class="muted small">${esc(noteLabel(n, hotel, utc))}</div>`).join(''); }
function logForm(b, redirect, log) {
  if (!log) return '';
  return `<details class="log-note"><summary>No-show or incident</summary><form method="post" action="/hotel/note"><input type="hidden" name="code" value="${esc(b.code)}"><input type="hidden" name="r" value="${esc(redirect)}"><input name="note" maxlength="200" placeholder="Optional note" autocomplete="off"><div class="log-actions"><button class="btn btn-line btn-sm" name="kind" value="no_show">No-show</button><button class="btn btn-line btn-sm" name="kind" value="incident">Incident</button></div></form></details>`;
}
function arrivalCell(value, mode) {
  return esc(arrivalText(value, mode === 'detail' ? 'detail' : 'short'));
}
function contactLine(b) {
  if (b.contact_hidden) return '';
  return `<div class="muted small">${esc(b.email)} · ${esc(b.phone)}</div>`;
}
function hotelRows(rows, { hotel, adminCancel }) {
  rows = withNotes(rows);
  if (hotel && !adminCancel) rows = GuestPrivacy.presentAll(rows, hotel);
  return rows;
}
const guestTable = (rows, { checkin = true, hotelCol = false, redirect = '/hotel', log = true, day = '', adminCancel = false, arrival = '', versions = false, hotel = null } = {}) => {
  rows = hotelRows(rows, { hotel, adminCancel });
  const head = arrival ? '<th>Arrival</th>' : '';
  const cell = b => arrival ? `<td>${arrival === 'detail' ? `Expected arrival: ${arrivalCell(b.expected_arrival, 'detail')}` : arrivalCell(b.expected_arrival, 'short')}</td>` : '';
  const versionLine = b => versions ? ConsentLog.adminLine(b) : '';
  return rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th>${hotelCol ? '<th>Hotel</th>' : ''}<th>Date</th><th>Guest</th>${head}<th>Seating</th><th>Spots</th><th>Total</th><th>Status</th></tr></thead><tbody>
${rows.map(b => `<tr><td><a class="link" href="/booking/${b.code}">${b.code}</a></td>${hotelCol ? `<td>${esc(b.hotel)}</td>` : ''}<td>${esc(nice(b.date))}</td><td><b>${esc(b.guest_name)}</b> ${parkingTag(b)}${contactLine(b)}${versionLine(b)}</td>${cell(b)}${seatCell(b)}<td>${b.qty}</td><td>${money(b.total)}</td>
<td>${statusCell(b, { checkin, redirect, day, compact: true, adminCancel, hotel })}${noteBits(b, hotel, adminCancel)}${logForm(b, redirect, log)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No guests.</p>';
};
const BQ = `SELECT b.*, p.name pass, p.holds, h.name hotel, (SELECT group_concat(ba.name || ' × ' || ba.qty, ', ') FROM booking_addons ba WHERE ba.booking_id=b.id) addons, (SELECT 1 FROM booking_addons ba JOIN addons a ON a.id=ba.addon_id WHERE ba.booking_id=b.id AND a.code='parking') parking_addon, (SELECT mode FROM inclusions i WHERE i.hotel_id=b.hotel_id AND i.code='parking') parking_mode FROM bookings b JOIN pass_types p ON p.id=b.pass_type_id JOIN hotels h ON h.id=b.hotel_id`;
function guestCards(rows, { checkin = true, hotelCol = false, redirect = '/hotel', log = true, day = '', adminCancel = false, arrival = '', versions = false, hotel = null } = {}) {
  rows = hotelRows(rows, { hotel, adminCancel });
  if (!rows.length) return '<p class="muted">No guests.</p>';
  return `<div class="guest-cards">${rows.map(b => {
    const label = spotLabel({ name: b.pass, holds: b.holds });
    const party = b.party || b.qty * (b.holds || 1);
    const rules = b.rules_ack_at ? '<div class="muted small">Rules accepted</div>' : '';
    const adds = b.addons ? `<div class="muted small">${esc(b.addons)}</div>` : '';
    const action = statusCell(b, { checkin, redirect, day, compact: false, adminCancel, hotel });
    const arrivalLine = !arrival ? '' : arrival === 'detail'
      ? `<p>Expected arrival: ${arrivalCell(b.expected_arrival, 'detail')}</p>`
      : `<p class="muted small">Arrival: ${arrivalCell(b.expected_arrival, 'short')}</p>`;
    const versionLine = versions ? ConsentLog.adminLine(b) : '';
    return `<article class="guest-card"><div class="guest-card-top"><div><b>${esc(b.guest_name)}</b> ${parkingTag(b)}<div class="muted small">${esc(b.code)}${hotelCol ? ' · ' + esc(b.hotel) : ''} · ${esc(nice(b.date))}</div>${versionLine}</div><b>${money(b.total)}</b></div>
<p>${esc(label)} × ${b.qty} · ${party} ${party === 1 ? 'person' : 'people'}</p>${arrivalLine}${rules}${adds}${noteBits(b, hotel, adminCancel)}${action}${logForm(b, redirect, log)}</article>`;
  }).join('')}</div>`;
}
function guestList(rows, opts = {}) {
  return `<div class="guests-wide">${guestTable(rows, opts)}</div><div class="guests-narrow">${guestCards(rows, opts)}</div>`;
}
function todaySection(h, { big = false, live = '/hotel/today-list', day = '' } = {}) {
  const on = day || today(h);
  const rows = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? ORDER BY b.checked_in_at IS NOT NULL, b.guest_name`).all(h.id, on);
  const spots = rows.reduce((a, b) => a + b.qty, 0);
  const people = rows.reduce((a, b) => a + (b.party || b.qty * (b.holds || 1)), 0);
  const tally = arrivedOfBooked(rows);
  const redirect = big ? '/hotel/checkin' : '/hotel';
  const body = big ? guestCards(rows, { redirect, day: on, arrival: 'short', hotel: h }) : guestList(rows, { redirect, day: on, arrival: 'short', hotel: h });
  return `<section id="today" class="panel" data-live="${esc(live)}"><h2 class="ph2">Today's guests <span class="muted small">${rows.length} booking${rows.length === 1 ? '' : 's'} · ${spots} spots · ${people} people · ${tally.arrived} arrived of ${tally.booked} booked</span> <a class="link small no-print" href="/hotel/print">Print list</a></h2>${body}</section>`;
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
app.get('/hotel/bookings.csv', hotelAuth, (req, res) => {
  const rows = db.prepare(`SELECT b.id, b.date AS date, b.code AS booking_code, b.guest_name, b.email, b.phone, p.name AS pass,
    COALESCE(b.party, b.qty * COALESCE(p.holds, 1)) AS guests, b.expected_arrival, b.status, b.total AS gross_sales
    FROM bookings b JOIN pass_types p ON p.id=b.pass_type_id
    WHERE b.hotel_id=? ORDER BY b.date, b.id`).all(req.hotel.id);
  sendCsv(res, 'bookings.csv', hotelBookingsCsv(GuestPrivacy.presentAll(withNotes(rows), req.hotel)));
});
function bookingDayState(b, hotel) {
  const day = hotelToday(hotel);
  if (b.status === 'cancelled') return 'cancel';
  if (b.checked_in_at) return 'used';
  if (b.date > day) return 'future';
  if (b.date < day) return 'past';
  return 'ready';
}
function checkinLookup(hotel, code) {
  const raw = String(code || '');
  const c = parseBookingCode(raw);
  const short = ShortCode.canonical(raw);
  if (!c && !short) return { st: 'missing', code: '' };
  let b = c ? db.prepare(`${BQ} WHERE b.code=?`).get(c) : null;
  if (!b && short) b = db.prepare(`${BQ} WHERE b.short_code=?`).get(short);
  if (!b) return { st: 'missing', code: c || short };
  if (Number(b.hotel_id) !== Number(hotel.id)) return { st: 'other', code: b.short_code || b.code };
  return { st: bookingDayState(b, hotel), b, code: b.code, at: b.checked_in_at ? HotelClock.clock(hotel, b.checked_in_at) : '' };
}
function checkinSearch(hotel, raw) {
  const q = String(raw || '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const like = '%' + q.toLowerCase() + '%';
  const digits = q.replace(/\D/g, '');
  const short = ShortCode.canonical(q);
  const day = hotelToday(hotel);
  const phoneLike = digits ? '%' + digits + '%' : '';
  return db.prepare(`${BQ} WHERE b.hotel_id=? AND (
      lower(b.code) LIKE ?
      OR (? != '' AND b.short_code = ?)
      OR (${GuestPrivacy.contactGate()} AND (
        lower(b.guest_name) LIKE ? OR lower(b.email) LIKE ?
        OR (? != '' AND replace(replace(replace(replace(replace(b.phone,' ',''),'-',''),'(',''),')',''),'+','') LIKE ?)
      ))
    ) ORDER BY CASE WHEN b.date=? THEN 0 WHEN b.date>? THEN 1 ELSE 2 END, b.date, b.guest_name LIMIT 40`)
    .all(hotel.id, like, short, short, GuestPrivacy.cutoff(hotel), like, like, digits, phoneLike, day, day);
}
const checkinHits = new Map();
function checkinLimited(ip) {
  const now = Date.now();
  let row = checkinHits.get(ip);
  if (!row || now - row.start > 15 * 60 * 1000) row = { start: now, n: 0 };
  row.n += 1;
  checkinHits.set(ip, row);
  if (checkinHits.size > 4000) {
    for (const [key, value] of checkinHits) if (now - value.start > 15 * 60 * 1000) checkinHits.delete(key);
  }
  return row.n > 30;
}
function checkinStatusText(info, hotel) {
  if (!info || !info.b) return '';
  if (info.st === 'cancel') return 'Cancelled';
  if (info.st === 'used') return checkedInLabel(info.b, hotel);
  if (info.st === 'future') return `This booking is for ${nice(info.b.date)}, not today.`;
  if (info.st === 'past') return `This booking was for ${nice(info.b.date)}.`;
  return 'Ready to check in';
}
function checkinCard(info, hotel) {
  if (!info || !info.code) return '';
  if (info.st === 'missing') return `<div class="scan-status bad" role="status"><b>Not found</b><span>No booking ${esc(info.code)} at this hotel.</span></div>`;
  if (info.st === 'other') return `<div class="scan-status bad" role="status"><b>Another hotel</b><span>This booking is for another hotel.</span></div>`;
  const b = GuestPrivacy.present(withNotes([info.b])[0], hotel);
  const pass = `${spotLabel({ name: b.pass, holds: b.holds })} × ${b.qty}`;
  const note = checkinStatusText(info, hotel);
  const tone = info.st === 'ready' ? 'valid' : info.st === 'used' ? 'used' : 'bad';
  const button = info.st === 'ready'
    ? `<form method="post" action="/hotel/checkin"><input type="hidden" name="code" value="${esc(info.code)}"><input type="hidden" name="confirm" value="1"><input type="hidden" name="r" value="/hotel/checkin">${arrivedField(b)}<button class="btn btn-navy btn-checkin">Check in</button></form>`
    : '';
  const statusLabel = info.st === 'ready' ? 'Confirmed' : info.st === 'used' ? checkedInLabel(b, hotel) : info.st === 'cancel' ? 'Cancelled' : 'Confirmed';
  return `<article class="checkin-card scan-status ${tone}"><p class="eyebrow-s">Booking ${esc(b.short_code || info.code)}</p><h2>${esc(b.guest_name)} ${parkingTag(b)}</h2><dl><dt>Pass</dt><dd>${esc(pass)}</dd><dt>Qty</dt><dd>${b.qty}</dd><dt>Date</dt><dd>${esc(nice(b.date))}</dd><dt>Arrival</dt><dd>${arrivalCell(b.expected_arrival, 'short')}</dd><dt>Status</dt><dd>${esc(statusLabel)}</dd></dl><p>${esc(note)}</p>${button}</article>`;
}
function checkinResultCard(b, hotel) {
  const info = { st: bookingDayState(b, hotel), b, code: b.code, at: b.checked_in_at ? HotelClock.clock(hotel, b.checked_in_at) : '' };
  return checkinCard(info, hotel);
}
function renderCheckin(req, res) {
  const h = req.hotel;
  const rawCode = String(req.query.code || '').trim().slice(0, 80);
  const code = ShortCode.canonical(rawCode) || parseBookingCode(rawCode) || rawCode;
  const q = String(req.query.q || '').trim().slice(0, 80);
  if ((rawCode || q) && checkinLimited(req.ip || 'unknown')) {
    res.set('Retry-After', '900');
    return res.status(429).send(dashShell(h, `<div class="alert" role="alert">Too many lookups. Wait 15 minutes, then try again.</div>`, { here: '/hotel/checkin' }));
  }
  const info = rawCode ? checkinLookup(h, rawCode) : null;
  const found = q ? checkinSearch(h, q) : null;
  const results = found ? (found.length
    ? `<p class="muted">${found.length} result${found.length === 1 ? '' : 's'}</p><div class="checkin-results">${found.map(row => checkinResultCard(row, h)).join('')}</div>`
    : '<p class="checkin-empty" role="status">No bookings match that search.</p>') : '';
  const arrivedErr = req.query.err === 'arrived' && info && info.b && info.st === 'ready'
    ? `<div class="alert" role="alert">Enter a whole number of people arrived, from 0 to ${arrivedMax(partyOf(info.b))}.</div>` : '';
  res.send(dashShell(h, `<div class="checkin-page">${req.query.st === 'valid' && info && info.st === 'used' ? '<div class="flash" role="status">Checked in.</div>' : ''}${arrivedErr}
<p class="eyebrow-s">Check in</p><h1 class="l-title">Today</h1>
<p class="muted">Scan the guest's QR, or search by name, email, phone or booking code.</p>
<button type="button" class="btn btn-navy full" id="scan-btn">Scan QR</button>
<div class="scan-box" id="scan-box" hidden><video id="scan-video" playsinline muted></video><button type="button" class="btn btn-line full" id="scan-stop">Stop camera</button></div>
<p class="muted small" id="scan-note" role="status"></p>
<form class="lookup check-code" method="get" action="/hotel/checkin"><label class="fl">Booking code<input name="code" value="${esc(code)}" placeholder="HDC-7Q4K-2M9X" autocomplete="off"></label><button class="btn btn-navy">Find booking</button></form>
${info ? checkinCard(info, h) : ''}
<form class="checkin-search" method="get" action="/hotel/checkin"><label class="fl">Search<input name="q" value="${esc(q)}" placeholder="Name, email, phone or code" autocomplete="off"></label><button class="btn btn-line">Search</button></form>
${results}
${todaySection(h, { big: true, live: '/hotel/today-list?view=checkin', day: hotelToday(h) })}
</div>
${StaticAssets.script('/checkin-parse.js')}${StaticAssets.script('/vendor/jsQR.js')}${StaticAssets.script('/checkin.js')}`, { here: '/hotel/checkin', live: true }));
}
app.get('/hotel/checkin', (req, res, next) => {
  const id = req.signedCookies.hotel;
  const h = id && db.prepare('SELECT * FROM hotels WHERE id=?').get(id);
  if (!h) {
    const back = checkinNext(req.originalUrl) || '/hotel/checkin';
    return res.redirect('/hotel/login?next=' + encodeURIComponent(back));
  }
  req.hotel = hotelRow(h);
  return renderCheckin(req, res, next);
});
app.get('/hotel/settings', hotelAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM hotels WHERE id=?').get(req.hotel.id);
  delete row.password;
  const locked = new Set(db.prepare('SELECT DISTINCT pass_type_id id FROM bookings WHERE hotel_id=?').all(row.id).map(r => r.id));
  res.send(dashShell(req.hotel, `${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<p class="eyebrow-s">Settings</p><h1 class="l-title">Your offering</h1>
<p class="muted">Passes, hours, what's included, amenities, included access, getting there and pool rules. Guests see this on the listing.</p>
${offeringForm({ action: '/hotel/settings', hotel: row, spots: getPasses(row.id), hours: hoursFor(db, row.id), lockedIds: locked, error: req.query.e || '' })}
${inclusionsForm(loadInclusions(db, row.id))}
${HotelAmenities.form(db, row)}
${accessForm(hotelAreas(db, row.id), getPasses(row.id), linkedIds(db, row.id))}
${HotelExplore.form(row, loadExplore(db, row.id))}
${arrivalForm(row)}`, { here: '/hotel/settings' }));
});
app.post('/hotel/settings', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const result = db.transaction(() => saveOffering(db, req.hotel.id, req.body))();
  if (result.err) return res.redirect('/hotel/settings?e=' + encodeURIComponent(result.err));
  const extra = result.kept && result.kept.length ? ' Kept seating that already has bookings: ' + result.kept.join(', ') + '.' : '';
  res.redirect('/hotel/settings?msg=' + encodeURIComponent('Saved. Guests see this on the listing.' + extra));
});

app.get('/hotel/analytics', hotelAuth, (req, res) => {
  seedPerformance(db);
  const report = buildAnalytics(db, req.hotel, { days: normalRange(req.query.range) });
  res.set('Cache-Control', 'no-store');
  res.send(dashShell(req.hotel, renderAnalytics(report), { here: '/hotel/analytics' }));
});

function soldWarnHtml(hotelId, passes, days, grid) {
  if (!days.length) return '';
  const caps = new Map(db.prepare('SELECT date, cap FROM day_caps WHERE hotel_id=? AND date>=? AND date<=?').all(hotelId, days[0], days[days.length - 1]).map(row => [row.date, row.cap]));
  const base = passes.reduce((sum, pass) => sum + (Number(pass.daily_cap) || 0), 0);
  const lines = [];
  for (const date of days) {
    const rows = grid[date] || [];
    if (!rows.length || rows[0].blocked) continue;
    const booked = rows.reduce((sum, row) => sum + row.sold, 0);
    const dayCap = caps.has(date) ? Number(caps.get(date)) : base;
    if (dayCap > 0 && booked * 100 >= dayCap * 80) lines.push(`${nice(date)} is ${Math.round(booked * 100 / dayCap)}% sold.`);
    for (const row of rows) {
      const cap = Number(row.cap) || 0;
      if (cap > 0 && row.sold * 100 >= cap * 80) lines.push(`${spotLabel(row)} is ${Math.round(row.sold * 100 / cap)}% sold on ${nice(date)}.`);
    }
  }
  if (!lines.length) return '';
  return `<div class="alert" id="sold-warn" role="status">${lines.map(line => `<p>${esc(line)}</p>`).join('')}</div>`;
}
app.get('/hotel', hotelAuth, (req, res) => {
  const h = req.hotel, t = today(h), q = String(req.query.q || '').trim();
  const todayRows = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? ORDER BY b.checked_in_at IS NOT NULL, b.guest_name`).all(h.id, t);
  const upcoming = db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date>? ORDER BY b.date, b.guest_name LIMIT 60`).all(h.id, t);
  const short = ShortCode.canonical(q);
  const like = '%' + q + '%';
  const found = q ? db.prepare(`${BQ} WHERE b.hotel_id=? AND (
      b.code LIKE ?
      OR (? != '' AND b.short_code = ?)
      OR (${GuestPrivacy.contactGate()} AND (b.guest_name LIKE ? OR b.email LIKE ? OR b.phone LIKE ?))
    ) ORDER BY b.date DESC LIMIT 30`).all(h.id, like, short, short, GuestPrivacy.cutoff(h), like, like, like) : null;
  const s = db.prepare("SELECT COALESCE(SUM(qty),0) spots, COALESCE(SUM(COALESCE(party, qty)),0) people, COALESCE(SUM(total),0) gross, COUNT(*) n FROM bookings WHERE hotel_id=? AND status!='cancelled'").get(h.id);
  const s30 = db.prepare("SELECT COALESCE(SUM(total),0) gross FROM bookings WHERE hotel_id=? AND status!='cancelled' AND date>=?").get(h.id, ymd(addDays(new Date(t + 'T12:00:00'), -30)));
  const inToday = todayRows.filter(b => b.checked_in_at).reduce((a, b) => a + b.qty, 0), dueToday = todayRows.reduce((a, b) => a + b.qty, 0);
  const tally = arrivedOfBooked(todayRows);
  const passes = getPasses(h.id);
  const bySeat = db.prepare(`SELECT p.name, p.holds, COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN b.qty END),0) spots, COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN COALESCE(b.party, b.qty * p.holds) END),0) people
    FROM pass_types p LEFT JOIN bookings b ON b.pass_type_id=p.id AND b.hotel_id=? AND b.status!='cancelled' WHERE p.hotel_id=? GROUP BY p.id ORDER BY p.sort`).all(h.id, h.id);
  const addonGross = db.prepare("SELECT COALESCE(SUM(ba.total),0) n FROM booking_addons ba JOIN bookings b ON b.id=ba.booking_id WHERE b.hotel_id=? AND b.status!='cancelled'").get(h.id).n;
  const addonsAll = getAddons(h.id);
  const blocked = db.prepare('SELECT * FROM blocked_dates WHERE hotel_id=? AND date>=? ORDER BY date').all(h.id, t);
  const days = Array.from({ length: 14 }, (_, i) => ymd(addDays(new Date(t + 'T12:00:00'), i)));
  const grid = Object.fromEntries(days.map(d => [d, availability(h.id, d)]));
  res.send(dashShell(h, `
${req.query.msg ? `<div class="flash">${esc(req.query.msg)}</div>` : ''}
<div class="dash-head"><div><p class="eyebrow-s">Hotel dashboard</p><h1 class="l-title">G'day, ${esc(h.name.replace(' (Demo)', ''))}</h1><p class="muted">${esc(nice(t))} · ${inToday} of ${dueToday} spots checked in today · ${tally.arrived} arrived of ${tally.booked} booked</p></div>
<div class="dash-export"><div class="dash-actions"><a class="btn btn-line" href="/hotel/analytics">Analytics</a><a class="btn btn-line" href="/hotel/bookings.csv">Download bookings</a><a class="btn btn-navy" href="/hotel/checkin">Check in a guest</a></div>
${GuestPrivacy.note()}</div></div>
${soldWarnHtml(h.id, passes, days, grid)}
${opsBar(h, passes)}
<div class="stats">${stat('Spots booked', s.spots, `${s.n} bookings · ${s.people} people`)}${stat('Gross sales', money(s.gross), `Includes ${money(addonGross)} add-ons · last 30 days ${money(s30.gross)}`)}</div>
<div class="seat-stats">${bySeat.map(r => `<span><b>${esc(spotLabel(r))}</b> ${r.spots} booked · ${r.people} people</span>`).join('')}</div>
${todaySection(h)}
<section id="lookup" class="panel"><h2 class="ph2">Booking lookup</h2><form class="lookup" method="get" action="/hotel#lookup"><input name="q" value="${esc(q)}" placeholder="Booking code (HDC-7Q4K-2M9X), name, email or phone"><button class="btn btn-navy">${ICON.search} Find</button>${q ? '<a class="link" href="/hotel">Clear</a>' : ''}</form>
${GuestPrivacy.note()}
${found ? `<p class="muted small">${found.length} result${found.length === 1 ? '' : 's'} for “${esc(q)}”</p>${guestList(found, { redirect: '/hotel?q=' + encodeURIComponent(q) + '#lookup', arrival: 'detail', hotel: h })}` : ''}</section>
<section id="upcoming" class="panel"><h2 class="ph2">Upcoming guests</h2>${guestList(upcoming, { checkin: false, hotel: h })}</section>
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
${StaticAssets.script('/block-cal.js')}</section>`, { live: true }));
});
app.post('/hotel/checkin', hotelAuth, (req, res) => {
  if (!sameSitePost(req)) return res.status(403).type('text/plain; charset=utf-8').send('Use the check-in form on this site.');
  if (checkinLimited(req.ip || 'unknown')) {
    res.set('Retry-After', '900');
    return res.status(429).type('text/plain; charset=utf-8').send('Too many lookups. Wait 15 minutes, then try again.');
  }
  const rawCode = String(req.body.code || '').trim();
  if (req.body.confirm !== '1') {
    const preview = parseBookingCode(rawCode) || ShortCode.canonical(rawCode) || rawCode;
    return res.redirect(303, '/hotel/checkin?code=' + encodeURIComponent(preview));
  }
  let info = checkinLookup(req.hotel, rawCode);
  const code = info.b ? info.b.code : (parseBookingCode(rawCode) || ShortCode.canonical(rawCode) || rawCode);
  if (info.st === 'ready') {
    const booked = partyOf(info.b);
    const sent = Object.prototype.hasOwnProperty.call(req.body, 'arrived');
    const arrived = sent ? parseArrivedCount(req.body.arrived, booked) : booked;
    if (arrived == null) info.badArrived = true;
    else {
      db.prepare("UPDATE bookings SET checked_in_at=datetime('now'), arrived_count=? WHERE id=?").run(arrived, info.b.id);
      info = checkinLookup(req.hotel, rawCode);
      info.st = 'valid';
    }
  }
  if (info.badArrived) {
    const msg = `Enter a whole number of people arrived, from 0 to ${arrivedMax(partyOf(info.b))}.`;
    const r = String(req.body.r || '/hotel'); const safe = r.startsWith('/hotel') ? r : '/hotel';
    const [p, hash] = safe.split('#');
    if (p.startsWith('/hotel/checkin')) return res.redirect(303, `/hotel/checkin?code=${encodeURIComponent(code)}&err=arrived`);
    return res.redirect(303, p + (p.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg) + (hash ? '#' + hash : ''));
  }
  const msg = info.st === 'valid' ? `Checked in ${info.b.guest_name} (${code}).`
    : info.st === 'used' ? `Already checked in at ${info.at}.`
    : info.st === 'future' ? `This booking is for ${nice(info.b.date)}, not today.`
    : info.st === 'past' ? `This booking was for ${nice(info.b.date)}.`
    : info.st === 'cancel' ? `${code} is cancelled.`
    : info.st === 'other' ? 'This booking is for another hotel.'
    : `No booking ${code} at this hotel.`;
  const r = String(req.body.r || '/hotel'); const safe = r.startsWith('/hotel') ? r : '/hotel';
  const [p, hash] = safe.split('#');
  if (p.startsWith('/hotel/checkin')) return res.redirect(303, `/hotel/checkin?st=${info.st}&code=${encodeURIComponent(code)}`);
  res.redirect(303, p + (p.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg) + (hash ? '#' + hash : ''));
});
app.post('/hotel/note', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const kind = req.body.kind === 'incident' ? 'incident' : req.body.kind === 'no_show' ? 'no_show' : '';
  const code = String(req.body.code || '').toUpperCase().trim();
  const b = kind && db.prepare('SELECT id FROM bookings WHERE code=? AND hotel_id=?').get(code, req.hotel.id);
  const note = String(req.body.note || '').trim().slice(0, 200);
  if (b) db.prepare("INSERT INTO guest_notes(booking_id,hotel_id,kind,note,created_at) VALUES (?,?,?,?,datetime('now'))").run(b.id, req.hotel.id, kind, note);
  const label = kind === 'incident' ? 'Incident' : 'No-show';
  const msg = b ? `${label} logged for ${code}.` : `No booking ${code} at this hotel.`;
  const r = String(req.body.r || '/hotel'); const safe = r.startsWith('/hotel') ? r : '/hotel';
  const [p, hash] = safe.split('#');
  res.redirect(303, p + (p.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg) + (hash ? '#' + hash : ''));
});
function pauseConfirm(hotel, opts) {
  const groups = (opts.groups || []).map(group => ({
    ...group,
    bookings: GuestPrivacy.presentAll(
      withNotes((group.bookings || []).map(row => ({ ...row, date: row.date || group.date }))),
      hotel,
    ),
  }));
  return dashShell(hotel, PauseBooked.confirmInner({ ...opts, groups }));
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
  const t = today(h), tmr = HotelClock.offset(h, 1);
  const reason = d => (db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(h.id, d) || {}).reason;
  const cap = db.prepare('SELECT cap FROM day_caps WHERE hotel_id=? AND date=?').get(h.id, t);
  const sum = passes.reduce((s, p) => s + p.daily_cap, 0);
  const btn = (when, label) => `<form method="post" action="/hotel/pause"><input type="hidden" name="when" value="${when}"><button class="btn btn-line">${label}</button></form>`;
  return `<div class="ops-bar">${btn('today', reason(t) === 'Paused' ? 'Resume today' : 'Pause today')}${btn('tomorrow', reason(tmr) === 'Paused' ? 'Resume tomorrow' : 'Pause tomorrow')}
<form method="post" action="/hotel/cap" class="ops-cap"><label>Cap today<input name="cap" type="number" min="0" max="999" value="${cap ? cap.cap : sum}" required></label><button class="btn btn-navy">Reduce spots</button></form>
${cap ? `<form method="post" action="/hotel/cap"><input type="hidden" name="cap" value=""><button class="btn btn-line">Remove cap</button></form>` : ''}
<span class="ops-links"><a href="/hotel/email-preview">Tonight's email</a><a href="/hotel/print">Print list</a></span></div>`;
}
app.post('/hotel/pause', hotelAuth, async (req, res) => {
  if (!ownForm(req, res)) return;
  const tomorrow = req.body.when === 'tomorrow';
  const when = tomorrow ? HotelClock.offset(req.hotel, 1) : today(req.hotel);
  const confirming = req.body.confirm === '1';
  const result = PauseBooked.pause(db, req.hotel.id, when, { mode: confirming ? 'pause' : 'toggle', confirm: confirming });
  if (result.kind === 'confirm') {
    return res.send(pauseConfirm(req.hotel, {
      heading: `Pause ${nice(when)}?`,
      note: `This stops new bookings for ${nice(when)}. Existing bookings stay as they are.`,
      groups: [{ date: when, bookings: result.bookings }],
      action: '/hotel/pause',
      fields: { when: tomorrow ? 'tomorrow' : 'today', confirm: '1' },
      submitLabel: 'Pause this date',
      backHref: '/hotel',
    }));
  }
  if (result.alert) await PauseBooked.notify(db, req.hotel, when, result.bookings, 'Paused');
  res.redirect(303, '/hotel?msg=' + encodeURIComponent(result.msg));
});
app.post('/hotel/cap', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const when = req.body.when === 'tomorrow' ? HotelClock.offset(req.hotel, 1) : today(req.hotel);
  res.redirect(303, '/hotel?msg=' + encodeURIComponent(capDate(req.hotel.id, when, req.body.cap)));
});
function opsToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 36 * 60 * 60 * 1000 })).toString('base64url');
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
  const h = req.hotel, tmr = HotelClock.offset(h, 1);
  const rows = GuestPrivacy.presentAll(withNotes(db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? AND b.status!='cancelled' ORDER BY b.guest_name`).all(h.id, tmr)), h);
  const spots = rows.reduce((s, b) => s + b.qty, 0);
  const sum = getPasses(h.id).reduce((s, p) => s + p.daily_cap, 0);
  const caps = [...new Set([8, Math.max(1, Math.round(sum / 2)), Math.max(1, sum - 4)].filter(n => n > 0 && n < sum))].sort((a, b) => a - b).slice(0, 3);
  const pause = opsToken({ h: h.id, a: 'pause', d: tmr });
  const capLinks = (caps.length ? caps : [Math.max(1, sum)]).map(n => `<a class="btn btn-line" href="/hotel/go/${opsToken({ h: h.id, a: 'cap', d: tmr, n })}">Cap at ${n}</a>`).join('');
  res.send(dashShell(h, `<p class="eyebrow-s">Tonight's email</p><h1 class="l-title">Guest list for ${esc(nice(tmr))}</h1>
<p class="muted">This is the note we would send the night before. The links work for 36 hours. They do not sign you in.</p>
<article class="email-card"><p class="muted small">To ${esc(h.contact_email || h.login)} · ${esc(h.name)}</p>
<h2>Tomorrow at the pool</h2>
<p>${rows.length} booking${rows.length === 1 ? '' : 's'} · ${spots} spots</p>
${rows.length ? `<ul class="email-guests">${rows.map(b => `<li><b>${esc(b.guest_name)}</b> <span class="muted">${esc(b.code)} · ${esc(spotLabel({ name: b.pass, holds: b.holds }))} × ${b.qty}${b.addons ? ' · ' + esc(b.addons) : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No day-pass guests tomorrow.</p>'}
<div class="email-acts"><a class="btn btn-navy" href="/hotel/go/${pause}">Pause tomorrow</a>${capLinks}<a class="btn btn-line" href="/hotel/print?date=${tmr}">Print this list</a></div>
</article>`, { here: '' }));
});
function opsMiss(res) {
  return res.status(400).send(page('Link expired', `<div class="wrap sec narrow"><h1 class="l-title">This link has expired</h1><p class="muted">Open tonight's email again from the dashboard, or <a href="/hotel/login">log in</a>.</p></div>`, { bare: true, index: false, canonical: false }));
}
function opsDone(res, hotel, date, msg) {
  return res.send(page('Saved', `<div class="wrap sec narrow"><div class="flash" role="status">Saved</div><h1 class="l-title">${esc(msg)}</h1><p class="muted">${esc(hotel.name)} · ${esc(nice(date))}</p><p style="margin-top:18px"><a class="btn btn-navy" href="/hotel/login">Log in to the dashboard</a></p></div>`, { bare: true, index: false, canonical: false }));
}
function opsHotel(token) {
  const data = readOps(token);
  const hotel = data && db.prepare('SELECT * FROM hotels WHERE id=?').get(data.h);
  if (!hotel || !/^\d{4}-\d{2}-\d{2}$/.test(data.d || '')) return null;
  return { data, hotel };
}
function pauseLinkConfirm(res, token, hotel, date, bookings) {
  return res.send(pauseConfirm(hotelRow(hotel), {
    heading: `Pause ${nice(date)}?`,
    note: `This stops new bookings for ${nice(date)}. Existing bookings stay as they are.`,
    groups: [{ date, bookings }],
    action: '/hotel/go/' + token,
    fields: { confirm: '1' },
    submitLabel: 'Pause this date',
    backHref: '/hotel/login',
  }));
}
app.get('/hotel/go/:token', (req, res) => {
  const purpose = `${req.get('purpose') || ''} ${req.get('sec-purpose') || ''} ${req.get('sec-fetch-purpose') || ''}`.toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview') || req.get('sec-fetch-dest') === 'empty') return res.status(204).end();
  const found = opsHotel(req.params.token);
  if (!found) return opsMiss(res);
  const { data, hotel } = found;
  if (data.a === 'cap') return opsDone(res, hotel, data.d, capDate(hotel.id, data.d, data.n));
  const result = PauseBooked.pause(db, hotel.id, data.d, { mode: 'pause', confirm: false });
  if (result.kind === 'confirm') return pauseLinkConfirm(res, req.params.token, hotel, data.d, result.bookings);
  return opsDone(res, hotel, data.d, result.msg);
});
app.post('/hotel/go/:token', async (req, res) => {
  if (!ownForm(req, res)) return;
  const found = opsHotel(req.params.token);
  if (!found || found.data.a !== 'pause') return opsMiss(res);
  const { data, hotel } = found;
  const result = PauseBooked.pause(db, hotel.id, data.d, { mode: 'pause', confirm: req.body.confirm === '1' });
  if (result.kind === 'confirm') return pauseLinkConfirm(res, req.params.token, hotel, data.d, result.bookings);
  if (result.alert) await PauseBooked.notify(db, hotel, data.d, result.bookings, 'Paused');
  return opsDone(res, hotel, data.d, result.msg);
});
app.get('/hotel/print', hotelAuth, (req, res) => {
  const h = req.hotel;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today(h);
  const rows = GuestPrivacy.presentAll(withNotes(db.prepare(`${BQ} WHERE b.hotel_id=? AND b.date=? AND b.status!='cancelled' ORDER BY b.guest_name`).all(h.id, date)), h);
  res.send(page('Guest list', `<div class="wrap sec print-sheet"><div class="no-print"><a class="link" href="/hotel">← Dashboard</a></div>
<h1 class="l-title">${esc(h.name)}</h1><p class="muted">${esc(nice(date))} · ${rows.length} booking${rows.length === 1 ? '' : 's'}</p>
<p>${esc(GuestCheckIn.line())}</p>
<p class="no-print" style="margin:14px 0"><button class="btn btn-navy" type="button" onclick="print()">Print</button></p>
<div class="tbl-wrap"><table class="tbl print-list"><thead><tr><th></th><th>Guest</th><th>Code</th><th>Seating</th><th>People</th><th>Notes</th></tr></thead><tbody>
${rows.map(b => `<tr><td><span class="print-tick"></span></td><td><b>${esc(b.guest_name)}</b></td><td>${esc(b.code)}</td><td>${esc(spotLabel({ name: b.pass, holds: b.holds }))} × ${b.qty}</td><td>${b.party || b.qty * (b.holds || 1)}</td><td>${esc((b.notes || []).map(n => noteLabel(n, h)).join('; '))}${b.addons ? ' ' + esc(b.addons) : ''}</td></tr>`).join('') || '<tr><td colspan="6">No guests.</td></tr>'}
</tbody></table></div></div>`, { nav: 'hotel', bare: true }));
});
app.post('/hotel/addons', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
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
  HotelAmenities.syncIncluded(db, req.hotel.id);
  const msg = blocked ? "Late access stays off. It can't overlap room guests only or run past the pool's closing time." : 'Add-ons saved. Guests see the changes straight away.';
  res.redirect(303, '/hotel?msg=' + encodeURIComponent(msg) + '#addons');
});
app.post('/hotel/access', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const result = saveAccess(db, req.hotel.id, req.body);
  if (result.err) return res.redirect('/hotel/settings?e=' + encodeURIComponent(result.err) + '#included-access');
  res.redirect(303, '/hotel/settings?msg=' + encodeURIComponent('Saved included access.') + '#included-access');
});
app.post('/hotel/amenities', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const result = HotelAmenities.save(db, req.hotel.id, req.body, 'hotel:' + req.hotel.id);
  if (result.err) return res.redirect('/hotel/settings?e=' + encodeURIComponent(result.err) + '#amenities');
  res.redirect(303, '/hotel/settings?msg=' + encodeURIComponent('Saved amenities.') + '#amenities');
});
app.post('/hotel/inclusions', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(req.hotel.id);
  const result = saveInclusions(db, req.hotel.id, req.body, { allowLate: hotelLatePossible(db, hotel) });
  HotelAmenities.syncIncluded(db, req.hotel.id);
  const msg = result.lateBlocked ? "Late stay stays off. It can't overlap room guests only or run past the pool's closing time." : "Saved what's included.";
  res.redirect(303, '/hotel/settings?msg=' + encodeURIComponent(msg) + '#included');
});
app.post('/hotel/arrival', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const result = saveArrival(db, req.hotel.id, req.body);
  if (result.err) return res.redirect('/hotel/settings?e=' + encodeURIComponent(result.err) + '#arrive-edit');
  res.redirect(303, '/hotel/settings?msg=' + encodeURIComponent('Saved getting there.') + '#arrive-edit');
});
app.post('/hotel/explore', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const result = saveExplore(db, req.hotel.id, req.body);
  if (result.err) return res.redirect('/hotel/settings?e=' + encodeURIComponent(result.err) + '#explore-edit');
  const msg = result.ok ? 'Updated Explore cards.' : 'Saved. Guests see this on the listing.';
  res.redirect(303, '/hotel/settings?msg=' + encodeURIComponent(msg) + '#explore-edit');
});
app.post('/hotel/block', hotelAuth, async (req, res) => {
  if (!ownForm(req, res)) return;
  const date = String(req.body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.redirect(303, '/hotel?msg=' + encodeURIComponent('Blocked ' + nice(date) + '. Guests can no longer book it.') + '#blocked');
  const reason = String(req.body.reason || 'Closed').slice(0, 80) || 'Closed';
  const existing = db.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?').get(req.hotel.id, date);
  const bookings = existing ? [] : PauseBooked.active(db, req.hotel.id, date);
  if (bookings.length && req.body.confirm !== '1') {
    return res.send(pauseConfirm(req.hotel, {
      heading: `Block ${nice(date)}?`,
      note: `This stops new bookings for ${nice(date)}. Existing bookings stay as they are. Nothing is saved until you confirm.`,
      groups: [{ date, bookings }],
      action: '/hotel/block',
      fields: { date, reason, confirm: '1' },
      submitLabel: 'Block this date',
      backHref: '/hotel#blocked',
    }));
  }
  db.prepare('INSERT OR REPLACE INTO blocked_dates(hotel_id,date,reason) VALUES (?,?,?)').run(req.hotel.id, date, reason);
  if (bookings.length) await PauseBooked.notify(db, req.hotel, date, bookings, reason);
  res.redirect(303, '/hotel?msg=' + encodeURIComponent('Blocked ' + nice(date) + '. Guests can no longer book it.') + '#blocked');
});
app.post('/hotel/unblock', hotelAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  db.prepare('DELETE FROM blocked_dates WHERE hotel_id=? AND date=?').run(req.hotel.id, req.body.date);
  res.redirect(303, '/hotel?msg=' + encodeURIComponent('Unblocked ' + nice(req.body.date) + '.') + '#blocked');
});
app.post('/hotel/blocked', hotelAuth, async (req, res) => {
  if (!ownForm(req, res)) return;
  const reason = String(req.body.reason || '').trim().slice(0, 80);
  const start = new Date();
  const horizon = ymd(new Date(start.getFullYear(), start.getMonth() + 19, 0));
  const todayStr = today(req.hotel);
  const dates = [...new Set(String(req.body.dates || '').split(',').map(s => s.trim()))]
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= todayStr && d <= horizon);
  const existing = db.prepare('SELECT date, reason FROM blocked_dates WHERE hotel_id=? AND date>=? AND date<=?').all(req.hotel.id, todayStr, horizon);
  const prev = new Map(existing.map(r => [r.date, r.reason || '']));
  const addedDates = dates.filter(d => !prev.has(d));
  const groups = PauseBooked.closingDates(db, req.hotel.id, addedDates);
  if (groups.length && req.body.confirm !== '1') {
    return res.send(pauseConfirm(req.hotel, {
      heading: groups.length === 1 ? `Block ${nice(groups[0].date)}?` : 'Block dates that already have guests?',
      note: 'Nothing is saved until you confirm. This stops new bookings on the dates you selected. Existing bookings stay as they are.',
      groups,
      action: '/hotel/blocked',
      fields: { dates: dates.join(','), reason, confirm: '1' },
      submitLabel: groups.length === 1 ? 'Block this date' : 'Block these dates',
      backHref: '/hotel#blocked',
    }));
  }
  const keep = new Set(dates);
  const del = db.prepare('DELETE FROM blocked_dates WHERE hotel_id=? AND date=?');
  const up = db.prepare('INSERT OR REPLACE INTO blocked_dates(hotel_id,date,reason) VALUES (?,?,?)');
  const stored = reason || 'Closed';
  db.transaction(() => {
    for (const row of existing) if (!keep.has(row.date)) del.run(req.hotel.id, row.date);
    for (const d of dates) up.run(req.hotel.id, d, prev.has(d) ? (prev.get(d) || stored) : stored);
  })();
  for (const group of groups) await PauseBooked.notify(db, req.hotel, group.date, group.bookings, stored);
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
  if (!ownForm(req, res)) return;
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
function adminGo(res, path, msg, hash) {
  res.redirect(path + '?msg=' + encodeURIComponent(msg) + (hash ? '#' + hash : ''));
}
function adminTotals() {
  const per = db.prepare(`SELECT h.id, h.name, h.area, COUNT(b.id) n, COALESCE(SUM(b.qty),0) passes, COALESCE(SUM(b.total),0) gross,
    COALESCE(SUM(CASE WHEN b.date=? THEN b.qty END),0) today
    FROM hotels h LEFT JOIN bookings b ON b.hotel_id=h.id AND b.status!='cancelled' WHERE COALESCE(h.status,'active')='active' GROUP BY h.id ORDER BY gross DESC`).all(today());
  const tot = per.reduce((a, r) => ({ n: a.n + r.n, passes: a.passes + r.passes, gross: a.gross + r.gross, today: a.today + r.today }), { n: 0, passes: 0, gross: 0, today: 0 });
  const addonAll = db.prepare("SELECT COALESCE(SUM(ba.total),0) n FROM booking_addons ba JOIN bookings b ON b.id=ba.booking_id WHERE b.status!='cancelled'").get().n;
  return { per, tot, addonAll };
}
function bookingFilter(req) {
  const hotel = parseInt(req.query.hotel, 10) || 0;
  const q = String(req.query.q || '').trim();
  const status = ['confirmed', 'arrived', 'cancelled'].includes(req.query.status) ? req.query.status : '';
  let page = parseInt(req.query.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  const where = [];
  const args = [];
  if (hotel) { where.push('b.hotel_id=?'); args.push(hotel); }
  if (q) {
    const short = ShortCode.canonical(q);
    where.push('(b.code LIKE ? OR b.guest_name LIKE ? OR b.email LIKE ? OR (? != \'\' AND b.short_code = ?))');
    args.push('%' + q + '%', '%' + q + '%', '%' + q + '%', short, short);
  }
  if (status === 'cancelled') where.push("b.status='cancelled'");
  else if (status === 'arrived') where.push("b.status!='cancelled' AND b.checked_in_at IS NOT NULL");
  else if (status === 'confirmed') where.push("b.status!='cancelled' AND b.checked_in_at IS NULL");
  return { hotel, q, status, page, where, args };
}
function hotelStatusPill(status) {
  if (status === 'pending') return '<span class="adm-st adm-st-wait">Pending</span>';
  if (!status || status === 'active') return '<span class="adm-st adm-st-ok">Active</span>';
  const label = String(status).charAt(0).toUpperCase() + String(status).slice(1);
  return `<span class="adm-st adm-st-off">${esc(label)}</span>`;
}
function hotelActions(hotel) {
  if (hotel.status === 'pending') {
    return `<form method="post" action="/admin/approve"><input type="hidden" name="id" value="${hotel.id}"><button class="btn adm-btn-p">Approve</button></form>`;
  }
  if (String(hotel.login || '').startsWith('demo-')) return '<div class="adm-muted">Demo password is set on the server.</div>';
  return `<a class="btn" href="#reset-${hotel.id}">Reset password</a>`;
}
function hotelConfirm(hotel) {
  if (hotel.status === 'pending' || String(hotel.login || '').startsWith('demo-')) return '';
  return `<div class="confirm" id="reset-${hotel.id}" role="alertdialog" aria-labelledby="reset-title-${hotel.id}">
<h3 id="reset-title-${hotel.id}">Reset password for ${esc(hotel.name)}?</h3>
<p>The old password stops working straight away. Tell the hotel the new one yourself; the site does not email it.</p>
<form method="post" action="/admin/hotel-password"><input type="hidden" name="id" value="${hotel.id}">
<label class="f">New password<input name="password" type="password" minlength="4" maxlength="200" required autocomplete="new-password" aria-label="New password for ${esc(hotel.name)}"></label>
<button class="btn adm-btn-d">Set password</button>
<a class="btn" href="/admin/hotels">Cancel</a>
</form></div>`;
}
function pendingDetail(hotel) {
  if (hotel.status !== 'pending') return '';
  const spots = getPasses(hotel.id);
  const who = [hotel.contact_name || 'No contact name', hotel.contact_email || ''].filter(Boolean).map(esc).join(' · ');
  const passes = spots.map(s => `${esc(spotLabel(s))} · ${money(s.price)} · ${s.daily_cap} a day`).join('<br>');
  return `<div class="adm-muted">${who}</div>${hotel.hours ? `<div class="adm-muted">${esc(hotel.hours)}</div>` : ''}<div class="small">${passes}</div>`;
}
app.post('/admin/hotel-password', adminAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const id = parseInt(req.body.id, 10);
  const password = String(req.body.password || '');
  const hotel = id && db.prepare('SELECT id, name, login FROM hotels WHERE id=?').get(id);
  if (!hotel) return adminGo(res, '/admin/hotels', 'Hotel not found.');
  if (String(hotel.login || '').startsWith('demo-')) return adminGo(res, '/admin/hotels', 'The demo hotel password is set on the server.');
  if (password.length < 4 || password.length > 200) return adminGo(res, '/admin/hotels', 'Use a password of 4 to 200 characters.');
  db.prepare('UPDATE hotels SET password=? WHERE id=?').run(hashPassword(password), hotel.id);
  return adminGo(res, '/admin/hotels', `Password set for ${hotel.name}.`);
});
app.post('/admin/booking/cancel', adminAuth, async (req, res) => {
  if (!ownForm(req, res)) return;
  const code = String(req.body.code || '').trim().toUpperCase();
  const b = db.prepare('SELECT id, code FROM bookings WHERE code=?').get(code);
  if (!b) return adminGo(res, '/admin/bookings', 'Booking not found.');
  const changed = BookingCancel.mark(db, b.id);
  if (changed) {
    try { await sendCancellation(db, b.code); } catch (err) { console.error('cancel email failed code=' + b.code); }
  }
  const msg = changed ? `${b.code} is cancelled in this demo. No payment was taken.` : `${b.code} was already cancelled.`;
  return adminGo(res, '/admin/bookings', msg);
});
app.post('/admin/venues/hide', adminAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const result = HotelAmenities.adminToggle(db, req.body, 'admin:jason');
  const text = result.err || result.msg || 'Updated.';
  return adminGo(res, '/admin', text, 'venues');
});
app.post('/admin/approve', adminAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const id = parseInt(req.body.id, 10);
  const h = id && db.prepare('SELECT * FROM hotels WHERE id=? AND status=?').get(id, 'pending');
  if (!h) return adminGo(res, '/admin/hotels', 'Nothing to approve.');
  const gaps = venueMissing(h);
  if (gaps.length) return adminGo(res, '/admin/hotels', `${h.name} is not live yet. Set ${gaps.join(', ')} first.`);
  db.prepare("UPDATE hotels SET status='active' WHERE id=?").run(id);
  return adminGo(res, '/admin/hotels', `Approved ${h.name}.`);
});
app.get('/admin', adminAuth, (req, res) => {
  const counts = AdminShell.counts(db);
  const { per, tot, addonAll } = adminTotals();
  const recent = db.prepare(`${BQ} ORDER BY b.created_at DESC, b.id DESC LIMIT 5`).all();
  const notes = db.prepare(`SELECT n.*, b.code, b.guest_name, b.date, h.name hotel FROM guest_notes n JOIN bookings b ON b.id=n.booking_id JOIN hotels h ON h.id=n.hotel_id ORDER BY n.id DESC LIMIT 40`).all();
  const noteBody = notes.length ? notes.map(n => `<div class="pending-row"><div><b>${n.kind === 'incident' ? 'Incident' : 'No-show'}</b> · ${esc(n.guest_name)} · ${esc(n.code)}<div class="adm-muted small">${esc(n.hotel)} · ${esc(nice(n.date))} · ${esc(HotelClock.iso(n.created_at))}${n.note ? ' · ' + esc(n.note) : ''}</div></div></div>`).join('') : '<p class="adm-muted">No notes yet. Hotels log a no-show or an incident from the guest list.</p>';
  const inner = `${AdminShell.flash(req.query.msg)}
${AdminShell.heading('Overview', 'All active hotels. Cancelled bookings are not counted.')}
${AdminShell.tiles(tot, addonAll)}
${AdminShell.byHotel(per, tot)}
<div class="adm-split">${AdminShell.attention(counts)}${AdminShell.recent(recent)}</div>
${PauseBooked.adminSection(db)}
<section class="adm-card"><h2>Guest notes</h2>${noteBody}</section>
${HotelAmenities.adminHtml(db)}`;
  res.send(AdminShell.page('/admin', inner, { title: 'Overview', ...counts }));
});
app.get('/admin/bookings', adminAuth, (req, res) => {
  const counts = AdminShell.counts(db);
  const { tot, addonAll } = adminTotals();
  const filter = bookingFilter(req);
  const whereSql = filter.where.length ? 'WHERE ' + filter.where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM bookings b ${whereSql}`).get(...filter.args).n;
  const pages = Math.max(1, Math.ceil(total / 10));
  const page = Math.min(filter.page, pages);
  const rows = db.prepare(`${BQ} ${whereSql} ORDER BY b.created_at DESC, b.id DESC LIMIT 10 OFFSET ?`).all(...filter.args, (page - 1) * 10);
  const hotels = db.prepare('SELECT id, name FROM hotels ORDER BY name').all();
  const list = rows.length
    ? guestList(rows, { checkin: false, hotelCol: true, log: false, adminCancel: true, arrival: 'short', versions: true })
    : '<p>No bookings match. <a href="/admin/bookings">Clear filters.</a></p>';
  const inner = `${AdminShell.flash(req.query.msg)}
${AdminShell.heading('Bookings', 'Newest first. Search by code, guest name or email.')}
${AdminShell.tiles(tot, addonAll)}
${AdminShell.filters({ q: filter.q, hotel: filter.hotel, status: filter.status, hotels })}
${list}
${AdminShell.pager({ q: filter.q, hotel: filter.hotel, status: filter.status, page, total, count: rows.length })}`;
  res.send(AdminShell.page('/admin/bookings', inner, { title: 'Bookings', ...counts }));
});
app.get('/admin/hotels', adminAuth, (req, res) => {
  const counts = AdminShell.counts(db);
  const hotels = db.prepare("SELECT * FROM hotels ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, name, id").all();
  const rows = hotels.map(h => `<tr>
<td data-label="Hotel"><span><b>${esc(h.name)}</b><div class="adm-muted">${esc(h.area || '')}</div>${pendingDetail(h)}</span></td>
<td data-label="Status">${hotelStatusPill(h.status)}</td>
<td data-label="Login">${esc(h.login || '')}</td>
<td data-label="Actions">${hotelActions(h)}</td>
</tr>`).join('');
  const inner = `${AdminShell.flash(req.query.msg)}
${AdminShell.heading('Hotels', 'Approve a new hotel, or set a password for a hotel that is not a demo.')}
<section class="adm-card"><div class="adm-table adm-stack"><table>
<thead><tr><th>Hotel</th><th>Status</th><th>Login</th><th>Actions</th></tr></thead>
<tbody>${rows}</tbody></table></div>
${hotels.map(hotelConfirm).join('')}</section>`;
  res.send(AdminShell.page('/admin/hotels', inner, { title: 'Hotels', ...counts }));
});
app.get('/admin/waitlist.csv', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT email, first_name, place, role, hotel_name, destination, marketing_opt_in, created_at, updated_at FROM waitlist ORDER BY id').all()
    .map(row => ({ ...row, created_at: HotelClock.iso(row.created_at), updated_at: HotelClock.iso(row.updated_at) }));
  sendCsv(res, 'waitlist.csv', waitlistCsv(rows));
});
app.post('/admin/waitlist/delete', adminAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const id = parseInt(req.body.id, 10);
  if (id) db.prepare('DELETE FROM waitlist WHERE id=?').run(id);
  return adminGo(res, '/admin/messages', id ? 'Removed that waitlist signup.' : 'Nothing to remove.', 'waitlist');
});
function contactMessagesHtml() {
  const rows = db.prepare('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200').all();
  const waiting = rows.filter(r => !r.handled).length;
  const note = paths.dataDir()
    ? 'Saved in the database on the persistent disk. The app does not send these by email.'
    : 'Saved in the database on this server. The app does not send these by email. This disk is cleared when the app is redeployed.';
  const body = rows.length ? `<div class="msg-list">${rows.map(r => `<article class="adm-msg${r.handled ? '' : ' is-new'}">
<div class="adm-msg-top"><b>${esc(r.name)}</b><span class="adm-st ${r.handled ? 'adm-st-off' : 'adm-st-wait'}">${r.handled ? 'Handled' : 'New'}</span></div>
<p class="adm-muted">${esc(r.email)}${r.booking_code ? ` · Code ${esc(r.booking_code)}` : ''} · ${esc(topicLabel(r.topic))} · ${esc(HotelClock.iso(r.created_at))}</p>
<p>${esc(r.message)}</p>
${r.handled ? '' : `<form method="post" action="/admin/messages/handled"><input type="hidden" name="id" value="${r.id}"><button class="btn">Mark as handled</button></form>`}
</article>`).join('')}</div>` : '<p class="adm-muted">No messages yet.</p>';
  return `<section class="adm-card" id="messages"><h2>Contact messages${waiting ? ` · ${waiting} new` : ''}</h2>
<p class="adm-muted small">${esc(note)}</p>
${body}</section>`;
}
function waitlistSection() {
  const waitRows = db.prepare('SELECT * FROM waitlist ORDER BY id DESC LIMIT 500').all();
  const note = paths.dataDir()
    ? 'These rows are stored in the database on the persistent disk. They are not shown on the public site. Download a CSV or a database backup if you want a copy off this server.'
    : 'These rows are stored on this server only. They are not shown on the public site. Download the CSV before a redeploy if the spreadsheet connection is not set up. This disk is cleared when the app is redeployed.';
  const table = waitRows.length ? `<div class="adm-table adm-stack"><table><thead><tr><th>Email</th><th>Name</th><th>Place</th><th>Role</th><th>Hotel</th><th>Destination</th><th>Alerts</th><th>Added</th><th>Actions</th></tr></thead><tbody>
${waitRows.map(w => `<tr><td data-label="Email">${esc(w.email)}</td><td data-label="Name">${esc(w.first_name)}</td><td data-label="Place">${esc(w.place)}</td><td data-label="Role">${esc(w.role)}</td><td data-label="Hotel">${esc(w.hotel_name)}</td><td data-label="Destination">${esc(w.destination)}</td><td data-label="Alerts">${Number(w.marketing_opt_in) === 1 ? 'Yes' : 'No'}</td><td data-label="Added">${esc(HotelClock.iso(w.created_at))}</td><td data-label="Actions"><form method="post" action="/admin/waitlist/delete"><input type="hidden" name="id" value="${w.id}"><button class="btn adm-btn-d">Delete</button></form></td></tr>`).join('')}
</tbody></table></div>` : '<p class="adm-muted">No waitlist signups stored on this server.</p>';
  return `<section class="adm-card" id="waitlist"><div class="adm-card-h"><h2>Waitlist</h2><a class="btn adm-btn-p" href="/admin/waitlist.csv">Download CSV</a></div>
<p class="adm-muted small">${note}</p>
${table}</section>`;
}
app.get('/admin/messages', adminAuth, (req, res) => {
  const counts = AdminShell.counts(db);
  const inner = `${AdminShell.flash(req.query.msg)}
${AdminShell.heading('Messages', 'Contact messages and the launch waitlist. Neither is shown on the public site.')}
<nav class="adm-subnav" aria-label="On this page"><a href="#messages">Contact messages</a><a href="#waitlist">Waitlist</a></nav>
${contactMessagesHtml()}
${waitlistSection()}`;
  res.send(AdminShell.page('/admin/messages', inner, { title: 'Messages', ...counts }));
});
app.post('/admin/messages/handled', adminAuth, (req, res) => {
  if (!ownForm(req, res)) return;
  const id = parseInt(req.body.id, 10);
  const row = id && db.prepare('SELECT id FROM contact_messages WHERE id=?').get(id);
  if (row) db.prepare("UPDATE contact_messages SET handled=1, handled_at=datetime('now') WHERE id=?").run(id);
  return adminGo(res, '/admin/messages', row ? 'Marked that message as handled.' : 'Nothing to update.', 'messages');
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
  const size = latest ? backups.formatBytes(latest.bytes) : 'None';
  const auto = paths.dataDir()
    ? 'Automatic backups are on. A copy runs at 3:30am Sydney time, and also at startup when the newest file is older than 24 hours. The newest 14 files are kept.'
    : 'Automatic backups are off because DATA_DIR is not set. Back up now still saves a file next to the database. On the free plan that file is wiped with the server disk.';
  const counts = AdminShell.counts(db);
  const inner = `${AdminShell.flash(req.query.msg)}
${AdminShell.heading('Backups', 'A copy of the database, plus spreadsheets for your own files.')}
<section class="adm-card"><h2>Database copy</h2>
<p>Last backup: <b>${esc(when)}</b></p>
<p>Size: <b>${esc(size)}</b>${latest ? ` · ${esc(latest.name)}` : ''}</p>
<p class="adm-muted small">${esc(auto)} The file is a consistent SQLite snapshot. It includes bookings, hotels, waitlist rows, contact messages and guest notes. Download it if you want a copy off this server. It is not a public link.</p>
<form method="post" action="/admin/backups"><button class="btn adm-btn-p">Back up now</button></form>
<p style="margin-top:14px"><a class="btn" href="/admin/backups/latest">Download latest backup</a></p>
</section>
<section class="adm-card"><h2>Spreadsheets</h2>
<p class="adm-muted small">These CSV files are for your own copy, for example in Google Drive. Hotels are exported without passwords. Guest notes stay in the database backup.</p>
<p class="adm-row-actions"><a class="btn adm-btn-p" href="/admin/export/bookings.csv">Download bookings CSV</a> <a class="btn" href="/admin/export/hotels.csv">Download hotels CSV</a> <a class="btn" href="/admin/waitlist.csv">Download waitlist CSV</a></p>
</section>`;
  res.set('Cache-Control', 'no-store');
  res.send(AdminShell.page('/admin/backups', inner, { title: 'Backups', ...counts }));
});
app.post('/admin/backups', adminAuth, async (req, res) => {
  if (!ownForm(req, res)) return;
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
  const rows = db.prepare(`SELECT b.code, h.name AS hotel, h.slug AS hotel_slug, b.date, b.qty, b.party, b.expected_arrival, b.guest_name, b.email, b.phone,
    b.status, b.unit_price, b.total, b.created_at, b.checked_in_at, b.arrived_count, b.marketing_opt_in,
    b.rules_ack_at, b.terms_ack_at, b.risk_ack_at, b.terms_version, b.refunds_version, b.privacy_version, b.risk_version, b.consent_at, b.consent_ip, b.cancel_note, b.seeded
    FROM bookings b JOIN hotels h ON h.id=b.hotel_id ORDER BY b.id`).all();
  sendCsv(res, 'bookings.csv', bookingsCsv(rows));
});
app.get('/admin/export/hotels.csv', adminAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, slug, name, area, status, login, contact_name, contact_email, address FROM hotels ORDER BY id`).all();
  sendCsv(res, 'hotels.csv', hotelsCsv(rows));
});

app.get('/about', (req, res) => {
  const copy = seo.pageCopy('about');
  const body = `<div class="wrap sec narrow about-page">
<p class="contact-kicker">About</p>
<h1 class="l-title">Hotel Day Club</h1>
<p class="lead">We help people book a few hours at a hotel pool, spa or gym without staying overnight.</p>
<div class="legal-doc about-copy">
<p>Hotel Day Club is a simple way to use a hotel's wellness spaces on quieter days. If you live nearby, you can swim, relax or work out when the hotel has room to spare.</p>
<p>Hotels set their own hours, prices and how many day guests they take. They earn from capacity that might otherwise sit empty. Overnight guests always come first.</p>
<p>We are launching in Australia with a small group of founding hotels. This site is a demo: the listings are examples, photos are stock, and no payment is taken here yet.</p>
<p>Questions? <a href="/contact">Contact us</a> or read <a href="/how-it-works">how day passes work</a>.</p>
</div></div>`;
  res.send(page('About Hotel Day Club', body, {
    analytics: true,
    index: true,
    path: '/about',
    bodyClass: 'guest about-page',
    guestD2: true,
    ...copy,
    jsonld: seo.graph(seo.crumbs([{ name: 'About', path: '/about' }])),
  }));
});

app.get('/how-it-works', (req, res) => {
  const copy = seo.pageCopy('how');
  const { HelpCentre } = require('./helpCentre');
  const mail = contactMail();
  const body = HelpCentre.pageHtml(mail);
  res.send(page('Help centre', body, {
    analytics: true,
    index: true,
    path: '/how-it-works',
    bodyClass: 'guest hc-page',
    css: '/help-centre.css',
    guestD2: true,
    ...copy,
    jsonld: seo.graph(seo.crumbs([{ name: 'Help centre', path: '/how-it-works' }])),
  }));
});

function contactHtml({ error, values, sent }) {
  const copy = seo.pageCopy('contact');
  const opts = {
    analytics: true,
    index: true,
    guestD2: true,
    ...copy,
    jsonld: seo.graph(seo.crumbs([{ name: 'Contact', path: '/contact' }])),
  };
  const mail = contactMail();
  if (sent) {
    return page('Contact', `<div class="wrap sec narrow contact-page">
<p class="contact-kicker">Contact</p>
<h1 class="l-title">Thanks, we have your message</h1>
<p class="lead">We'll reply by email to the address you gave us.</p>
<div class="login-card contact-card contact-ok" role="status">
<div class="flash">Message sent</div>
<p>You can also write to ${mail}.</p>
<p><a href="/">Back to the homepage</a></p>
</div></div>`, opts);
  }
  const v = values || {};
  const topics = TOPICS.map(t => `<option value="${esc(t.value)}"${v.topic === t.value ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
  return page('Contact', `<div class="wrap sec narrow contact-page">
<p class="contact-kicker">Contact</p>
<h1 class="l-title">How can we help?</h1>
<p class="lead">Questions about a booking, a change, a cancellation, or listing a hotel in Australia? Send a note. We'll reply by email.</p>
<div class="login-card contact-card">
${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/contact">
<div class="hp" aria-hidden="true"><label>Company website<input name="company_website" tabindex="-1" autocomplete="off" value=""></label></div>
<label class="fl">Name<input name="name" required autocomplete="name" maxlength="80" value="${esc(v.name || '')}"></label>
<label class="fl">Email<input name="email" type="email" required autocomplete="email" maxlength="254" value="${esc(v.email || '')}"></label>
<label class="fl">Booking code <span class="opt">(optional)</span><input name="booking_code" maxlength="40" autocomplete="off" value="${esc(v.booking_code || '')}"></label>
<label class="fl">Topic<select name="topic" required><option value="">Choose a topic</option>${topics}</select></label>
<label class="fl">Message<textarea name="message" required maxlength="2000">${esc(v.message || '')}</textarea></label>
<label class="tick"><input type="checkbox" name="marketing" value="1"${v.marketing === '1' ? ' checked' : ''}> <span>${CheckoutConsent.marketingHtml()}</span></label>
<button class="btn btn-navy full" type="submit">Send message</button>
<p class="contact-note">We use your name, email and this message only to reply to you. <a href="/privacy">Privacy Policy</a>.</p>
<p class="contact-note hotel-notice">${CheckoutConsent.hotelNoticeHtml(mail)}</p>
</form>
<p class="contact-alt">Or email ${mail}.</p>
</div></div>`, opts);
}
app.get('/contact', (req, res) => {
  res.send(contactHtml({ sent: req.query.sent === '1' }));
});
app.post('/contact', async (req, res) => {
  const hotelForm = String((req.body || {}).form || '') === 'hotel';
  const parsed = hotelForm ? hotelEnquiryParse(req.body || {}) : parseMessage(req.body || {});
  const done = hotelForm ? '/for-hotels?sent=1#enquiry' : '/contact?sent=1';
  const show = (status, extra) => res.status(status).send(hotelForm
    ? forHotelsHtml({ error: extra.error, values: parsed.values || {} })
    : contactHtml({ error: extra.error, values: parsed.values || {} }));
  if (contactLimited(req.ip || 'unknown')) {
    if (parsed.honeypot) return res.redirect(303, done);
    return show(429, { error: 'Please wait a few minutes, then try the form again.' });
  }
  if (parsed.honeypot) return res.redirect(303, done);
  if (!sameSitePost(req)) return show(403, { error: 'That message could not be sent. Use the form on this page.' });
  if (parsed.error) return show(400, parsed);
  let messageId;
  try {
    messageId = saveMessage(db, parsed.row);
  } catch (err) {
    console.error('contact: database save failed ' + err.message);
    return show(500, { error: 'We could not save that message. Email us and we will reply.' });
  }
  try {
    await sendContactAlert(db, messageId);
  } catch (err) {
    console.error('contact alert email failed id=' + messageId);
  }
  res.redirect(303, done);
});

// Full demo seed runs only when there are no hotels. A database that already has rows is not replaced.
if (db.prepare('SELECT COUNT(*) n FROM hotels').get().n === 0) seed(db);
else ensureAddons(db);
db.prepare("UPDATE hotels SET is_demo=1 WHERE login LIKE 'demo-%' OR name LIKE '%(Demo)%'").run();
ensureSchedules(db);
ensureInclusions(db);
ensureAccess(db);
HotelAmenities.ensure(db);
ensureArrival(db);
ensureExplore(db);
seedPerformance(db);
syncHoursLabels(db);
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
class LegalContents {
  static headings(src) {
    const found = [];
    const used = new Set();
    for (const line of String(src).replace(/\r\n/g, '\n').split('\n')) {
      const match = line.trim().match(/^##\s+(.+)$/);
      if (!match) continue;
      const text = match[1].trim();
      const base = this.slug(text);
      let id = base;
      let n = 2;
      while (used.has(id)) id = `${base}-${n++}`;
      used.add(id);
      found.push({ id, text });
    }
    return found;
  }

  static slug(text) {
    const base = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
    return base || 'section';
  }

  static nav(headings) {
    const links = headings.map(h => `<a href="#${esc(h.id)}">${esc(h.text)}</a>`).join('');
    return `<nav class="legal-toc" aria-label="On this page"><p>On this page</p>${links}</nav>`;
  }
}
function mdToHtml(src) {
  const headings = LegalContents.headings(src);
  let headingAt = 0;
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
      const level = Math.min(4, h[1].length + 1);
      const id = h[1].length === 2 && headings[headingAt] ? ` id="${esc(headings[headingAt++].id)}"` : '';
      html += `<h${level}${id}>${inlineMd(h[2])}</h${level}>`;
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
  const article = mdToHtml(raw).split('{{CONTACT_EMAIL}}').join(contactMail()).split('{{ABN}}').join(esc(PUBLISHED_ABN));
  const copy = seo.pageCopy(LEGAL_PAGES[file]);
  return page(heading, `<div class="wrap sec legal-page"><h1 class="l-title">${esc(heading)}</h1><div class="legal-grid">${LegalContents.nav(LegalContents.headings(raw))}<article class="legal-doc">${article}</article></div></div>`, {
    analytics: true,
    index: seo.legalPagesIndexable() ? true : 'follow',
    guestD2: true,
    ...copy,
    jsonld: seo.graph(seo.crumbs([{ name: copy.crumb, path: copy.path }])),
  });
}
app.get('/privacy', (req, res) => res.send(legalDoc('Privacy policy', 'privacy-policy.md')));
app.get('/terms', (req, res) => res.send(legalDoc('Customer terms', 'customer-terms.md')));
app.get('/refunds', (req, res) => res.send(legalDoc('Cancellation and refunds', 'cancellation-refund-policy.md')));
app.get('/risk', (req, res) => res.send(legalDoc('Risk warning', 'guest-risk-acknowledgement.md')));
app.get('/faq', (req, res) => {
  const copy = seo.pageCopy('faq');
  res.send(page('Hotel day pass questions', seo.faqHtml(contactMail()), {
    analytics: true,
    index: true,
    guestD2: true,
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
    ? `<div class="fh-grid">${cards}</div>`
    : `<p>No day passes in ${esc(d.name)} yet. Join the waitlist and we'll email you when one opens.</p><p><a class="btn btn-coral" href="/?destination=${encodeURIComponent(d.id)}#waitlist">Join the waitlist</a></p>`;
  return `<div class="wrap sec"><h1 class="l-title">${esc(d.title)}</h1><p class="lead">${esc(d.intro)}</p>${body}</div>`;
}
app.get('/destinations/:slug', (req, res) => {
  const d = destinationBySlug(req.params.slug);
  if (!d) return sendNotFound(res);
  res.send(page(d.name, destinationPage(d), {
    analytics: true,
    index: destinationHasListings(d) ? true : 'follow',
    path: '/destinations/' + d.slug,
    guestD2: true,
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
    guestD2: true,
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
    guestD2: true,
    documentTitle: seo.fullTitle(guide.title),
    description: guide.description,
    jsonld: seo.articleJsonLd(guide),
    ogType: 'article',
  }));
});

class ServerError {
  static page() {
    return page('Something went wrong', `<div class="wrap sec narrow error-page">
<p class="eyebrow-s">500</p>
<h1 class="l-title">Something went wrong</h1>
<p class="lead">This page did not load. Try again in a minute.</p>
<p>If it keeps happening, email ${contactMail()}.</p>
<p class="error-acts"><a class="btn btn-teal" href="">Try again</a><a class="btn btn-line" href="/">Home</a><a class="btn btn-line" href="/contact">Contact</a></p>
</div>`, {
      bare: true,
      index: false,
      canonical: false,
      analytics: false,
      description: 'This page did not load.',
    });
  }
}
function sendNotFound(res, extra = {}) {
  const title = extra.title || 'Page not found';
  const body = extra.body || `<div class="wrap sec narrow error-page">
<p class="eyebrow-s">404</p>
<h1 class="l-title">Page not found</h1>
<p class="lead">That page is not on Hotel Day Club.</p>
<p class="error-links"><a class="btn btn-line" href="/">Home</a><a class="btn btn-line" href="/how-it-works">How it works</a><a class="btn btn-line" href="/faq">FAQ</a><a class="btn btn-line" href="/guides">Guides</a><a class="btn btn-line" href="/contact">Contact</a></p>
</div>`;
  res.status(extra.status || 404).send(page(title, body, {
    analytics: extra.analytics === false ? false : true,
    analyticsPath: extra.analyticsPath || '',
    index: false,
    canonical: false,
    documentTitle: seo.fullTitle(extra.documentTitle || title),
    description: extra.description || 'That page is not on Hotel Day Club.',
  }));
}
if (process.env.HDC_ERROR_PROBE === '1') {
  app.get('/__hdc_error', (req, res, next) => next(new Error('probe-secret-stack')));
}
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
  const bookingPath = req.path.startsWith('/booking/');
  sendNotFound(res, { analytics: bookingPath ? false : true, analyticsPath: '' });
});
app.use((err, req, res, next) => {
  void next;
  console.error(err && err.stack ? err.stack : err);
  if (res.headersSent) {
    res.end();
    return;
  }
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'something went wrong' });
  res.status(500).send(ServerError.page());
});

app.listen(PORT, () => {
  console.log(`Hotel Day Club demo on http://localhost:${PORT}`);
  console.log('data: database at ' + paths.dbPath());
  backups.startScheduler(db);
});
