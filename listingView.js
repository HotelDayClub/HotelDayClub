const { esc, money, nice } = require('./util');
const { spotLabel } = require('./offering');
const { seatPhoto } = require('./inclusions');

function passCards(passes, av) {
  const open = av.filter(p => p.remaining > 0);
  const pick = open.find(p => p.featured) || open[0] || av[0];
  return passes.map(p => {
    const a = av.find(x => x.id === p.id);
    const dis = !a || a.remaining < 1;
    const on = pick && p.code === pick.code && !dis;
    const state = !a || a.blocked || a.past ? 'Unavailable' : a.remaining < 1 ? 'Sold out' : 'Available';
    const pop = p.featured ? '<span class="pop">Most popular</span>' : '';
    return `<label class="pass-card${dis ? ' dis' : ''}">
<input type="radio" name="pass" value="${esc(p.code)}" data-kind="${esc(p.kind || 'custom')}" data-price="${p.price}" data-holds="${p.holds || 1}" ${dis ? 'disabled' : ''} ${on ? 'checked' : ''}>
${pop}
<img src="${esc(seatPhoto(p.kind))}" alt="" width="480" height="360" loading="lazy" decoding="async">
<span class="pc-body"><b>${esc(spotLabel(p))}</b><span class="pc-desc">${esc(p.description || '')}</span><span class="pc-price">From ${money(p.price)}</span><span class="avail">${state}</span></span>
</label>`;
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
function render(){
 const q=+$('#qty').value;
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
 const prev=[...document.querySelectorAll('#addons-pick input:checked')].map(i=>i.value);
 const box=$('#addons-pick');
 const wrap=document.getElementById('extras');
 if(wrap) wrap.hidden=!addons.length;
 box.innerHTML=addons.map(a=>{const dis=a.remaining<need(a,q,holds);const on=!dis&&prev.indexOf(a.code)>=0;const price=!dis&&a.price>0?'<span class="extra-price">'+fmt(a.price)+'</span>':'';const note=dis?'<span class="extra-note">Sold out</span>':'';return '<label class="extra'+(dis?' is-off':'')+'"><input type="checkbox" name="addon" value="'+h(a.code)+'" '+(dis?'disabled':'')+(on?' checked':'')+'><span class="extra-name">'+h(a.name)+'</span>'+price+note+'</label>'}).join('');
 let extra=0;document.querySelectorAll('#addons-pick input:checked').forEach(i=>{const a=addons.find(x=>x.code===i.value);if(a)extra+=a.price*need(a,q,holds)});
 const people=p?q*holds:q;
 const sum=p?p.price*q+extra:0;
 $('#total').innerHTML=p?'<span>'+fmt(p.price)+' × '+q+(people>q?' · '+people+' guests':'')+(extra?' + add-ons':'')+'</span><b>'+fmt(sum)+'</b>':'';
 const bar=$('#bar-total'); if(bar) bar.textContent=p?fmt(sum):($('#from-price')?$('#from-price').textContent:'');
 $('#go').disabled=!p;
 const blocked=av[0]&&av[0].blocked;
 const any=av.some(x=>x.remaining>0);
 const st=$('#status'); st.className='status'+(blocked||!any?' out':'');
 st.textContent=blocked?blocked:!any?'Sold out this day':'Available this day';
 if(p) showSeat(SEATS[p.kind]||SEATS.custom);
 document.querySelectorAll('#passes input, #addons-pick input').forEach(r=>{r.onchange=render});
}
async function load(){const el=$('#date');if(!el)return;const r=await fetch('/api/availability?hotel=${slug}&date='+encodeURIComponent(el.value));const data=await r.json();av=data.passes||[];addons=data.addons||[];const note=document.getElementById('cancel-note');if(note)note.textContent=data.cancel||'';render()}
document.getElementById('date').addEventListener('change',load);
document.getElementById('qty').addEventListener('change',render);
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
   if(!box.querySelector('.map-fail')) box.insertAdjacentHTML('beforeend','<p class="map-fail">The map could not load. Use Get directions instead.</p>');
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
  const { h, date, minDate, maxDate, closed, passes, av, from, hoursLine, cancel, beats, included, addonList, hours, policy, arrival } = opts;
  const short = String(h.name || '').replace(/\s*\(Demo\)\s*$/, '');
  const pick = av.find(p => p.featured && p.remaining > 0) || av.find(p => p.remaining > 0) || av[0];
  const photos = (h.photos || []).map((p, i) => `<img class="g${i}" src="/assets/photos/${esc(p)}" alt="${i === 0 ? 'Stock photo, not this hotel' : ''}" width="1200" height="900" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`).join('');
  return `<div class="wrap listing">
<div class="gallery swipe" aria-label="Photos">${photos}
<button type="button" class="gal-nav prev" data-dir="prev" aria-label="Previous photo">‹</button>
<button type="button" class="gal-nav next" data-dir="next" aria-label="Next photo">›</button>
<span class="photo-credit">Stock photos · not this hotel</span></div>
<form action="/checkout" method="get" id="bf" class="l-body">
<input type="hidden" name="hotel" value="${esc(h.slug)}">
<div class="l-main">
<p class="eyebrow-s">Fictional demo listing</p>
<h1 class="l-title">Your day at ${esc(short)}</h1>
<div class="muted l-meta">New · ${esc(h.area)} · ${esc(hoursLine)}</div>
<p class="day-lead"><b>${esc(h.tagline)}.</b> ${esc(h.blurb)}</p>
<h2 class="day-kicker">Your day</h2>
${beats}
<h2 class="day-kicker">Choose a pass</h2>
<div class="pass-cards" id="passes">${passCards(passes, av)}</div>
${included}
${addonList}
${hours}
${policy}
${arrival}
<section class="l-sec" id="before"><h3>Good to know</h3>
<ul class="reassure"><li><b>Cancellation</b><span>${esc(cancel)} <a href="/refunds">Draft cancellation terms</a>.</span></li>
<li><b>Instant confirmation</b><span>The booking is confirmed as soon as you finish checkout. This demo does not take a card or a payment.</span></li></ul>
</section>
</div>
<aside class="book-box" id="book">
<div class="bb-price">From <b id="from-price">${money(from)}</b></div>
<p class="bb-label" id="date-label">Date</p>
<input type="date" class="hdc-date" data-inline="1" data-closed="${esc(closed)}" name="date" id="date" min="${minDate}" max="${maxDate}" value="${esc(date)}" required>
<div id="status" class="status"></div>
<figure class="seat-shot" id="seat-photo"><img id="seat-img" src="${esc(seatPhoto(pick && pick.kind))}" alt="" width="480" height="360" loading="lazy" decoding="async"><figcaption>Example photo, not this hotel.</figcaption></figure>
<label class="fl" for="qty">Guests<select name="qty" id="qty" class="hdc-pick">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
<details class="extras" id="extras"><summary><span class="extra-label">Add extras <span class="extra-opt">(optional)</span></span></summary><div class="extra-list" id="addons-pick"></div></details>
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

module.exports = { listingHtml };
