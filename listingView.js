const { esc, money, nice } = require('./util');
const { instantConfirmationText } = require('./siteMode');
const { spotLabel } = require('./offering');
const { seatPhoto, includedLines, includedNote } = require('./inclusions');

const KIND_ALT = { lounger: 'sun lounger', daybed: 'daybed', cabana: 'cabana', chair: 'pool chair', entry: 'spa or pool entry', custom: 'pool pass' };
function kindAlt(kind) { return KIND_ALT[kind] || 'day pass'; }
function isDemo(h) { return Number(h && h.is_demo) === 1; }
function shortName(h) { return String(h.name || '').replace(/\s*\(Demo\)\s*$/, ''); }
function passAlt(p, h) {
  const kind = kindAlt(p.kind);
  return isDemo(h) ? `Example photo of a ${kind}, not this hotel` : `${kind} at ${shortName(h)}`;
}

function passCards(passes, av, h, items) {
  const open = av.filter(p => p.remaining > 0);
  const pick = open.find(p => p.featured) || open[0] || av[0];
  const note = includedNote(items);
  return passes.map(p => {
    const a = av.find(x => x.id === p.id);
    const dis = !a || a.remaining < 1;
    const on = pick && p.code === pick.code && !dis;
    const state = !a || a.blocked || a.past ? 'Unavailable' : a.remaining < 1 ? 'Sold out' : 'Available';
    const pop = p.featured ? '<span class="pop">Most popular</span>' : '';
    const holds = Number(p.holds) || 1;
    const holdsText = holds === 1 ? '1 guest' : `${holds} guests`;
    const id = esc(p.code);
    const lines = includedLines(items, holds);
    const desc = String(p.description || '').trim();
    const detail = lines.length || desc || note;
    const panel = detail ? `<button type="button" class="pass-toggle" id="pass-btn-${id}" aria-expanded="false" aria-controls="pass-inc-${id}">What's included</button>
<div class="pass-inc" id="pass-inc-${id}" role="region" aria-labelledby="pass-btn-${id}" hidden>
${desc ? `<p class="pass-desc">${esc(desc)}</p>` : ''}
${lines.length ? `<ul class="pass-inc-list">${lines.map(line => `<li>${esc(line.text)}</li>`).join('')}</ul>` : ''}
${note ? `<p class="pass-note">${esc(note)}</p>` : ''}
</div>` : '';
    return `<article class="pass-card${dis ? ' dis' : ''}">
<input type="radio" id="pass-${id}" name="pass" value="${esc(p.code)}" data-kind="${esc(p.kind || 'custom')}" data-price="${p.price}" data-holds="${holds}" ${dis ? 'disabled' : ''} ${on ? 'checked' : ''}>
${pop}
<label class="pass-face" for="pass-${id}">
<img src="${esc(seatPhoto(p.kind))}" alt="${esc(passAlt(p, h))}" width="480" height="360" loading="lazy" decoding="async">
<span class="pc-body"><b>${esc(spotLabel(p))}</b><span class="pc-holds">${holdsText}</span><span class="pc-price">${money(p.price)}</span><span class="avail">${state}</span></span>
</label>
${panel}
</article>`;
  }).join('');
}

function listingScript(slug) {
  return `<script>
const SEATS=${JSON.stringify(require('./inclusions').SEAT_PHOTO)};
const $=s=>document.querySelector(s);
let av=[],addons=[];
function fmt(n){return '$'+n.toLocaleString('en-AU')}
function h(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function need(a,q,holds){return a.per==='booking'?1:q*(holds||1)}
function showSeat(src){const img=$('#seat-img');if(!img||!src||img.getAttribute('src')===src)return;img.classList.add('is-swap');setTimeout(function(){img.src=src;img.classList.remove('is-swap')},160)}
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
 if(p) showSeat(SEATS[p.kind]||SEATS.custom);
 document.querySelectorAll('#passes input, #addons-pick input').forEach(r=>{r.onchange=render});
}
function setPassOpen(card, on){
 if(!card) return;
 const btn=card.querySelector('.pass-toggle');
 const panel=card.querySelector('.pass-inc');
 if(!btn||!panel) return;
 btn.setAttribute('aria-expanded', on?'true':'false');
 panel.hidden=!on;
}
function openPass(card){
 document.querySelectorAll('#passes .pass-card').forEach(c=>setPassOpen(c, c===card));
}
const passBox=document.getElementById('passes');
if(passBox){
 passBox.addEventListener('click', function(e){
  const btn=e.target.closest('.pass-toggle');
  if(btn){
   const card=btn.closest('.pass-card');
   const on=btn.getAttribute('aria-expanded')==='true';
   if(on) setPassOpen(card, false);
   else {
    openPass(card);
    const radio=card.querySelector('input[name="pass"]');
    if(radio && !radio.disabled && !radio.checked){ radio.checked=true; render(); }
   }
   return;
  }
  if(e.target.closest('.pass-face')) openPass(e.target.closest('.pass-card'));
 });
 passBox.addEventListener('change', function(e){
  if(e.target && e.target.name==='pass' && e.target.checked) openPass(e.target.closest('.pass-card'));
 });
 passBox.addEventListener('keydown', function(e){
  if(e.key!=='Escape') return;
  const card=e.target.closest('.pass-card');
  if(!card) return;
  const btn=card.querySelector('.pass-toggle');
  if(btn && btn.getAttribute('aria-expanded')==='true'){ setPassOpen(card, false); btn.focus(); }
 });
}
 async function load(){const el=$('#date');if(!el)return;const r=await fetch('/api/availability?hotel=${slug}&date='+encodeURIComponent(el.value));const data=await r.json();av=data.passes||[];addons=data.addons||[];const note=document.getElementById('cancel-note');if(note)note.textContent=data.cancel||'';render();if(!el.value){const st=$('#status');if(st){st.className='status';st.textContent='Pick a date'}}}
document.getElementById('date').addEventListener('change',load);
document.querySelector('select[name="qty"]').addEventListener('change',render);
document.querySelectorAll('.gal-nav').forEach(btn=>btn.addEventListener('click',()=>{const gal=document.querySelector('.gallery.swipe');if(!gal)return;const w=gal.clientWidth*0.86;gal.scrollBy({left:btn.dataset.dir==='next'?w:-w,behavior:'smooth'})}));
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
  const { h, date, minDate, maxDate, closed, passes, av, from, hoursLine, cancel, know, beats, included, addonList, hours, policy, arrival } = opts;
  const items = Array.isArray(included) ? included : [];
  const parkNote = includedNote(items);
  const short = shortName(h);
  const demo = isDemo(h);
  const pick = av.find(p => p.featured && p.remaining > 0) || av.find(p => p.remaining > 0) || av[0];
  const galAlt = demo ? 'Stock photo, not this hotel' : `Photo of ${short}`;
  const photos = (h.photos || []).map((p, i) => `<img class="g${i}" src="/assets/photos/${esc(p)}" alt="${esc(galAlt)}" width="1200" height="900" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`).join('');
  const seatKind = kindAlt(pick && pick.kind);
  const seatAlt = demo ? `Example photo of a ${seatKind}, not this hotel` : `${seatKind} at ${short}`;
  return `<div class="wrap listing">
<div class="gallery swipe" aria-label="Photos">${photos}
<button type="button" class="gal-nav prev" data-dir="prev" aria-label="Previous photo">‹</button>
<button type="button" class="gal-nav next" data-dir="next" aria-label="Next photo">›</button>
${demo ? '<span class="photo-credit">Stock photos · not this hotel</span>' : ''}</div>
${reassureStrip(true)}
<form action="/checkout" method="get" id="bf" class="l-body">
<input type="hidden" name="hotel" value="${esc(h.slug)}">
<div class="l-main">
<p class="eyebrow-s">${demo ? 'Fictional demo listing' : esc(h.area)}</p>
<h1 class="l-title">Your day at ${esc(short)}</h1>
<div class="muted l-meta">New · ${esc(h.area)} · ${esc(hoursLine)}</div>
<p class="day-lead"><b>${esc(h.tagline)}.</b> ${esc(h.blurb)}</p>
<h2 class="day-kicker">Your day</h2>
${beats}
<h2 class="day-kicker">Choose a pass</h2>
<div class="pass-cards" id="passes">${passCards(passes, av, h, items)}</div>
${addonList}
${hours}
${policy}
${arrival}
<section class="l-sec" id="before"><h3>Good to know</h3>
<ul class="reassure"><li><b>Cancellation</b><span>${esc(know || cancel)} <a href="/refunds">Draft cancellation terms</a>.</span></li>
${parkNote ? `<li><b>Parking</b><span>${esc(parkNote)}</span></li>` : ''}
<li><b>Instant confirmation</b><span>${esc(instantConfirmationText())}</span></li></ul>
</section>
</div>
<aside class="book-box" id="book">
<div class="bb-price">From <b id="from-price">${money(from)}</b></div>
<p class="bb-label" id="date-label">Date</p>
<input type="date" class="hdc-date" data-inline="1" data-closed="${esc(closed)}" name="date" id="date" min="${minDate}" max="${maxDate}" value="${esc(date)}" required>
<div id="status" class="status"></div>
<figure class="seat-shot" id="seat-photo"><img id="seat-img" src="${esc(seatPhoto(pick && pick.kind))}" alt="${esc(seatAlt)}" width="480" height="360" loading="lazy" decoding="async">${demo ? '<figcaption>Example photo, not this hotel.</figcaption>' : `<figcaption>${esc(short)}</figcaption>`}</figure>
<label class="fl" for="qty">Guests<select name="qty" id="qty" class="hdc-pick">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${n === 1 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
<div class="bb-total" id="total"></div>
<p class="cancel-note" id="cancel-note">${esc(cancel)}</p>
<button class="btn btn-coral full" id="go" type="submit">Book your day</button>
<p class="muted small center">You won't be charged. Demo payment only.</p>
</aside>
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
