const { esc, money } = require('./util');
const { instantConfirmationText } = require('./siteMode');
const { KINDS } = require('./offering');
const { seatPhoto, includedNote, amenityLines } = require('./inclusions');
const { supervisionNote } = require('./offering');
const { accessDetail } = require('./access');

const KIND_NAME = Object.fromEntries(KINDS.map(k => [k.code, k.name]));
const KIND_ORDER = KINDS.map(k => k.code);
const KIND_ALT = { lounger: 'sun lounger', daybed: 'daybed', cabana: 'cabana', chair: 'pool chair', entry: 'spa or pool entry', custom: 'pool pass' };
function kindAlt(kind) { return KIND_ALT[kind] || 'day pass'; }
function isDemo(h) { return Number(h && h.is_demo) === 1; }
function shortName(h) { return String(h.name || '').replace(/\s*\(Demo\)\s*$/, ''); }
function passAlt(p, h) {
  const kind = kindAlt(p.kind);
  return isDemo(h) ? `Example photo of a ${kind}, not this hotel` : `${kind} at ${shortName(h)}`;
}
function kindRank(kind) {
  const i = KIND_ORDER.indexOf(kind || 'custom');
  return i < 0 ? KIND_ORDER.length : i;
}

function passCard(p, av, h, pick) {
  const a = av.find(x => x.id === p.id);
  const dis = !a || a.remaining < 1;
  const on = pick && p.code === pick.code && !dis;
  const state = !a || a.blocked || a.past ? 'Unavailable' : a.remaining < 1 ? 'Sold out' : 'Available';
  const pop = p.featured && !isDemo(h) ? '<span class="pop">Most popular</span>' : '';
  const holds = Number(p.holds) || 1;
  const holdsText = holds > 1 ? `<span class="pc-holds">${holds} guests</span>` : '';
  const id = esc(p.code);
  const desc = String(p.description || '').trim();
  return `<article class="pass-card${dis ? ' dis' : ''}" data-kind="${esc(p.kind || 'custom')}">
<input type="radio" id="pass-${id}" name="pass" value="${esc(p.code)}" data-kind="${esc(p.kind || 'custom')}" data-price="${p.price}" data-holds="${holds}" ${dis ? 'disabled' : ''} ${on ? 'checked' : ''}>
<button type="button" class="pass-open" id="pass-btn-${id}" data-code="${id}" aria-expanded="false" aria-controls="pass-detail-${id}">
<span class="pc-copy">${pop}<b>${esc(p.name)}</b>${desc ? `<span class="pc-desc">${esc(desc)}</span>` : ''}<span class="pc-meta"><span class="pc-price">From ${money(p.price)}</span>${holdsText}<span class="avail">${state}</span></span></span>
<img src="${esc(seatPhoto(p.kind))}" alt="${esc(passAlt(p, h))}" width="480" height="360" loading="lazy" decoding="async">
</button>
</article>`;
}

function passDetail(p, h, items, accessAreas) {
  const holds = Number(p.holds) || 1;
  const id = esc(p.code);
  const desc = String(p.description || '').trim();
  const demo = isDemo(h);
  const areas = accessAreas || [];
  const lines = amenityLines(items, holds, areas);
  const amenities = lines.length ? `<ul class="pass-inc-list">${lines.map(line => `<li>${esc(line.text)}</li>`).join('')}</ul>` : '';
  const access = accessDetail(areas, { demo, amenities });
  return `<article class="pass-detail" id="pass-detail-${id}" data-code="${id}" role="region" aria-labelledby="pass-title-${id}" hidden>
<figure class="pass-detail-photo"><img src="${esc(seatPhoto(p.kind))}" alt="${esc(passAlt(p, h))}" width="960" height="640" loading="lazy" decoding="async">${demo ? '<figcaption>Example photo, not this hotel.</figcaption>' : ''}</figure>
<h3 id="pass-title-${id}" tabindex="-1">${esc(p.name)}</h3>
${desc ? `<p class="pass-desc">${esc(desc)}</p>` : ''}
${access}
</article>`;
}

function passSection(passes, av, h, items, accessByPass) {
  const open = av.filter(p => p.remaining > 0);
  const pick = open.find(p => p.featured) || open[0] || av[0];
  const kinds = [];
  passes.forEach(p => {
    const k = p.kind || 'custom';
    if (!kinds.includes(k)) kinds.push(k);
  });
  kinds.sort((a, b) => kindRank(a) - kindRank(b));
  const filters = kinds.length > 1
    ? `<div class="pass-filters" role="group" aria-label="Filter passes"><button type="button" class="pass-filter" data-kind="" aria-pressed="true">All</button>${kinds.map(k => `<button type="button" class="pass-filter" data-kind="${esc(k)}" aria-pressed="false">${esc(KIND_NAME[k] || 'Pass')}</button>`).join('')}</div>`
    : '';
  const groups = kinds.map(k => {
    const list = passes.filter(p => (p.kind || 'custom') === k);
    const title = kinds.length > 1 ? `<h3 class="pass-group-title">${esc(KIND_NAME[k] || 'Pass')}</h3>` : '';
    return `<section class="pass-group" data-kind="${esc(k)}">${title}<div class="pass-grid">${list.map(p => passCard(p, av, h, pick)).join('')}</div></section>`;
  }).join('');
  const details = passes.map(p => passDetail(p, h, items, (accessByPass && accessByPass[p.id]) || [])).join('');
  return `${filters}<div class="pass-groups" id="passes">${groups}</div><div id="pass-detail" hidden>${details}</div>`;
}

function listingScript(slug) {
  return `<script>
const $=s=>document.querySelector(s);
let av=[],addons=[];
function fmt(n){return '$'+n.toLocaleString('en-AU')}
function h(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function need(a,q,holds){return a.per==='booking'?1:q*(holds||1)}
function guests(){
 const sel=document.querySelector('select[name="qty"]');
 const n=sel?parseInt(sel.value,10):NaN;
 return n>0?n:1;
}
function render(){
 const q=guests();
 document.querySelectorAll('#passes .pass-card').forEach(card=>{
  const input=card.querySelector('input');
  const p=av.find(x=>x.code===input.value);
  const dis=!p||p.remaining<q;
  input.disabled=dis;
  card.classList.toggle('dis',dis);
  const avail=card.querySelector('.avail');
  if(avail) avail.textContent=!p||p.blocked||p.past?'Unavailable':p.remaining<1?'Sold out':dis?'Unavailable':'Available';
 });
 if(!document.querySelector('#passes input:checked:not([disabled])')){const f=document.querySelector('#passes input:not([disabled])');if(f)f.checked=true}
 const c=document.querySelector('#passes input:checked');
 const p=c&&av.find(x=>x.code===c.value);
 const holds=p?p.holds||1:1;
 const box=$('#addons-pick');
 const wrap=document.getElementById('extras');
 const dated=!!($('#date')&&$('#date').value);
 if(dated&&box){
  const prev=[...box.querySelectorAll('input:checked')].map(i=>i.value);
  box.innerHTML=addons.map(a=>{const dis=a.remaining<need(a,q,holds);const on=!dis&&prev.indexOf(a.code)>=0;const price=!dis&&a.price>0?'<span class="extra-price">'+fmt(a.price)+'</span>':'';const note=dis?'<span class="extra-note">Sold out for this date</span>':'';return '<label class="extra'+(dis?' is-off':'')+'"><input type="checkbox" name="addon" value="'+h(a.code)+'" data-price="'+(+a.price||0)+'" data-per="'+h(a.per||'guest')+'" '+(dis?'disabled':'')+(on?' checked':'')+'><span class="extra-name">'+h(a.name)+'</span>'+price+note+'</label>'}).join('');
  if(wrap) wrap.hidden=!addons.length;
 }
 let extra=0;document.querySelectorAll('#addons-pick input:checked').forEach(i=>{const price=+i.dataset.price||0;const qty=i.dataset.per==='booking'?1:q*(holds||1);extra+=price*qty});
 const people=p?q*holds:q;
 const sum=p?p.price*q+extra:0;
 $('#total').innerHTML=p?'<span>'+fmt(p.price)+' × '+q+(people>q?' · '+people+' guests':'')+(extra?' + '+fmt(extra)+' extras':'')+'</span><b>'+fmt(sum)+'</b>':'';
 const bar=$('#bar-total'); if(bar) bar.textContent=p?fmt(sum):($('#from-price')?$('#from-price').textContent:'');
 $('#go').disabled=!p;
 const blocked=av[0]&&av[0].blocked;
 const any=av.some(x=>x.remaining>0);
 const st=$('#status'); st.className='status'+(blocked||!any?' out':'');
 st.textContent=blocked?blocked:!any?'Sold out this day':'Available this day';
 document.querySelectorAll('#passes input, #addons-pick input').forEach(r=>{r.onchange=render});
 const openBtn=document.querySelector('.pass-open[aria-expanded="true"]');
 if(openBtn){
  const radio=document.getElementById('pass-'+openBtn.dataset.code);
  if(radio&&radio.disabled) closeDetail();
 }
}
function closeDetail(){
 document.querySelectorAll('.pass-open').forEach(b=>b.setAttribute('aria-expanded','false'));
 document.querySelectorAll('.pass-detail').forEach(p=>{p.hidden=true});
 const box=document.getElementById('pass-detail');
 if(box) box.hidden=true;
}
function openDetail(code){
 let shown=null;
 document.querySelectorAll('.pass-open').forEach(b=>b.setAttribute('aria-expanded', b.dataset.code===code?'true':'false'));
 document.querySelectorAll('.pass-detail').forEach(p=>{
  const on=p.dataset.code===code;
  p.hidden=!on;
  if(on) shown=p;
 });
 const box=document.getElementById('pass-detail');
 if(box) box.hidden=!shown;
 if(!shown) return;
 const title=shown.querySelector('h3');
 if(title) title.focus();
 shown.scrollIntoView({block:'nearest'});
}
const passBox=document.getElementById('passes');
if(passBox){
 passBox.addEventListener('click', function(e){
  const btn=e.target.closest('.pass-open');
  if(!btn) return;
  const code=btn.dataset.code;
  if(btn.getAttribute('aria-expanded')==='true'){ closeDetail(); return; }
  const radio=document.getElementById('pass-'+code);
  if(radio && !radio.disabled && !radio.checked){ radio.checked=true; render(); }
  openDetail(code);
 });
}
const filters=document.querySelector('.pass-filters');
if(filters){
 filters.addEventListener('click', function(e){
  const btn=e.target.closest('.pass-filter');
  if(!btn) return;
  const kind=btn.dataset.kind||'';
  filters.querySelectorAll('.pass-filter').forEach(b=>b.setAttribute('aria-pressed', b===btn?'true':'false'));
  document.querySelectorAll('.pass-group').forEach(g=>{ g.hidden=!!(kind && g.dataset.kind!==kind); });
  const open=document.querySelector('.pass-open[aria-expanded="true"]');
  if(open){
   const group=open.closest('.pass-group');
   if(group && group.hidden) closeDetail();
  }
 });
}
document.addEventListener('keydown', function(e){
 if(e.key!=='Escape') return;
 if(e.target.closest && e.target.closest('.map-sheet')) return;
 const open=document.querySelector('.pass-open[aria-expanded="true"]');
 if(!open) return;
 closeDetail();
 open.focus();
});
 async function load(){const el=$('#date');if(!el)return;const r=await fetch('/api/availability?hotel=${slug}&date='+encodeURIComponent(el.value));const data=await r.json();av=data.passes||[];addons=data.addons||[];const note=document.getElementById('cancel-note');if(note)note.textContent=data.cancel||'';render();if(!el.value){const st=$('#status');if(st){st.className='status';st.textContent='Pick a date'}}}
document.getElementById('date').addEventListener('change',load);
document.querySelector('select[name="qty"]').addEventListener('change',render);
document.querySelectorAll('.gal-nav').forEach(btn=>btn.addEventListener('click',()=>{const gal=document.querySelector('.gallery.swipe');if(!gal)return;const w=gal.clientWidth*0.86;const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;gal.scrollBy({left:btn.dataset.dir==='next'?w:-w,behavior:reduce?'auto':'smooth'})}));
const peek=document.querySelector('.map-peek');
const sheet=document.querySelector('.map-sheet');
if(peek&&sheet){
 document.body.appendChild(sheet);
 let map, loading;
 function draw(){
  const lat=+peek.dataset.lat, lng=+peek.dataset.lng;
  if(!map){
   map=L.map(sheet.querySelector('.map-canvas'),{scrollWheelZoom:true});
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
   const icon=L.divIcon({className:'map-pin',html:'<span></span>',iconSize:[18,18],iconAnchor:[9,9]});
   L.marker([lat,lng],{icon:icon,alt:'Hotel location',title:peek.dataset.label||'Hotel'}).addTo(map);
  }
  map.setView([lat,lng],16);
  setTimeout(function(){map.invalidateSize()},80);
 }
 function ensure(){
  if(window.L) return Promise.resolve();
  if(loading) return loading;
  loading=new Promise(function(resolve,reject){
   const css=document.createElement('link');
   css.rel='stylesheet'; css.href='/vendor/leaflet/leaflet.css';
   css.onload=function(){};
   document.head.appendChild(css);
   const s=document.createElement('script');
   s.src='/vendor/leaflet/leaflet.js';
   s.onload=function(){resolve()};
   s.onerror=function(){reject()};
   document.body.appendChild(s);
  });
  return loading;
 }
 function openMap(){
  peek.setAttribute('aria-expanded','true');
  if(!sheet.open) sheet.showModal();
  sheet.querySelector('.map-close').focus();
  ensure().then(draw).catch(function(){
   const box=sheet.querySelector('.map-canvas');
   if(!box.querySelector('.map-fail')) box.insertAdjacentHTML('beforeend','<p class="map-fail">The map could not load. The address is on the page.</p>');
  });
 }
 peek.addEventListener('click',openMap);
 sheet.querySelector('.map-close').addEventListener('click',function(){sheet.close()});
 sheet.addEventListener('close',function(){peek.setAttribute('aria-expanded','false');peek.focus()});
}
load();setInterval(load,15000);
</script>`;
}

function listingHtml(opts) {
  const { h, date, minDate, maxDate, closed, passes, av, from, hoursLine, cancel, know, included, addonList, hours, policy, arrival, accessByPass, foodLine } = opts;
  const items = Array.isArray(included) ? included : [];
  const parkNote = includedNote(items);
  const short = shortName(h);
  const demo = isDemo(h);
  const heading = demo ? `${short} (Demo)` : short;
  const watch = supervisionNote(h);
  const pick = av.find(p => p.featured && p.remaining > 0) || av.find(p => p.remaining > 0) || av[0];
  const galAlt = demo ? 'Stock photo, not this hotel' : `Photo of ${short}`;
  const photos = (h.photos || []).map((p, i) => `<img class="g${i}" src="/assets/photos/${esc(p)}" alt="${esc(galAlt)}" width="1200" height="900" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`).join('');
  const parkFold = parkNote ? `<details class="fold" id="parking"><summary>Parking</summary><p>${esc(parkNote)}</p></details>` : '';
  return `<div class="wrap listing">
<div class="gallery swipe" aria-label="Photos">${photos}
<button type="button" class="gal-nav prev" data-dir="prev" aria-label="Previous photo">‹</button>
<button type="button" class="gal-nav next" data-dir="next" aria-label="Next photo">›</button>
${demo ? '<span class="photo-credit">Stock photos · not this hotel</span>' : ''}</div>
<form action="/checkout" method="get" id="bf" class="l-body">
<input type="hidden" name="hotel" value="${esc(h.slug)}">
<div class="l-top">
<div class="listing-head">
<p class="eyebrow-s">${demo ? 'Fictional demo listing' : esc(h.area)}</p>
<h1 class="l-title">Your day at ${esc(heading)}</h1>
<div class="muted l-meta">New · ${esc(h.area)} · ${esc(hoursLine)}</div>
<p class="day-lead"><b>${esc(h.tagline)}.</b> ${esc(h.blurb)}</p>
${watch ? `<p class="guard-note">${esc(watch)}</p>` : ''}
</div>
<h2 class="day-kicker">Passes</h2>
${passSection(passes, av, h, items, accessByPass)}
<p class="pass-food">${esc(foodLine || 'Food and drink are not included in the pass.')}</p>
</div>
<aside class="book-box" id="book">
<div class="bb-price">From <b id="from-price">${money(from)}</b></div>
<p class="bb-label" id="date-label">Date</p>
<input type="date" class="hdc-date" data-inline="1" data-closed="${esc(closed)}" name="date" id="date" min="${minDate}" max="${maxDate}" value="${esc(date)}" required>
<div id="status" class="status"></div>
<label class="fl" for="qty">Guests<select name="qty" id="qty" class="hdc-pick">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${n === 1 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
<div class="bb-total" id="total"></div>
<p class="cancel-note" id="cancel-note">${esc(cancel)}</p>
<button class="btn btn-coral full" id="go" type="submit">Book your day</button>
<p class="muted small center">You won't be charged. Demo payment only.</p>
</aside>
<div class="l-more">
${addonList}
<div class="page-folds">
${parkFold}
<details class="fold" id="cancel-fold"><summary>Cancellation</summary><p>${esc(know || cancel)} <a href="/refunds">Draft cancellation terms</a>.</p></details>
${hours}
${policy}
</div>
${arrival}
${reassureStrip(true)}
<section class="l-sec" id="before"><h3>Good to know</h3>
<ul class="reassure"><li><b>Instant confirmation</b><span>${esc(instantConfirmationText())}</span></li></ul>
</section>
</div>
</form>
<div class="book-bar"><div class="bar-price"><span>Total</span><b id="bar-total">${money(pick ? pick.price : from)}</b></div><a class="btn btn-coral" href="#book">Book your day</a></div>
</div>
${listingScript(h.slug)}`;
}

const ASSURE = [
  {
    icon: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v3M16 3.5v3M4 10h16"/><path d="M8.8 15.2l2.1 2.1 4.6-4.8"/>',
    title: '24 hours to cancel',
    text: 'Free until 24 hours before your access hours start.',
  },
  {
    icon: '<circle cx="12" cy="12" r="3.2"/><path d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.5 6.5l1.6 1.6M15.9 15.9l1.6 1.6M17.5 6.5l-1.6 1.6M8.1 15.9l-1.6 1.6"/>',
    title: 'No room needed',
    text: 'A pool, gym or spa for the day.',
  },
  {
    icon: '<path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><path d="M10 10h1.6v1.6H10zM12.6 12.6H14V14h-1.4z"/>',
    title: 'Code at the desk',
    text: 'Show your QR code at check-in.',
  },
  {
    icon: '<path d="M7.2 8.2A5.2 5.2 0 1 1 6 13"/><path d="M5.2 5.4V9H9"/>',
    title: 'If the pool closes',
    text: 'You choose a full refund or a free rebooking.',
  },
  {
    icon: '<path d="M4 7.5h16v10H4z"/><path d="M4 8l8 6 8-6"/>',
    title: 'Help when you need it',
    text: "Questions about a booking, a change or a cancellation? Write to us and we'll reply by email.",
    href: '/contact',
  },
];

function reassureStrip(lite) {
  const items = ASSURE.map(item => {
    const inner = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><b>${item.title}</b><span>${item.text}</span>`;
    return item.href
      ? `<li><a class="assure-link" href="${item.href}">${inner}</a></li>`
      : `<li>${inner}</li>`;
  }).join('');
  return `<section class="assure${lite ? ' assure-lite' : ''}" aria-label="Before you book"><ul>${items}</ul></section>`;
}

module.exports = { listingHtml, reassureStrip };
