const { esc, money } = require('./util');
const { instantConfirmationText } = require('./siteMode');
const { KINDS, supervisionNote, safePhoto } = require('./offering');
const { includedNote, amenityLines } = require('./inclusions');
const { arrivalInner } = require('./arrival');
const { accessDetail } = require('./access');

const SOLD_COPY = 'Sold out for this date — pick another date or seat';

const KIND_NAME = Object.fromEntries(KINDS.map(k => [k.code, k.name]));
const KIND_ORDER = KINDS.map(k => k.code);
const KIND_ALT = { lounger: 'sun lounger', daybed: 'daybed', cabana: 'cabana', chair: 'pool chair', entry: 'spa or pool entry', custom: 'pool pass' };
const ITEM_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8.5 12.3 10.7 14.6 15.6 9.6"/></svg>';
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
function demoPrice(n) {
  return `${money(n)} <small>(demo)</small>`;
}
function peopleLabel(n) {
  const count = Math.max(1, Number(n) || 1);
  return `= ${count} ${count === 1 ? 'person' : 'people'}`;
}
function fitsText(holds) {
  const n = Number(holds) || 1;
  return n > 1 ? `Fits ${n} · ${n} guests` : `Fits ${n}`;
}
function passPhoto(p) {
  const file = safePhoto(String(p.photo || ''));
  return file ? `/assets/photos/${file}` : '';
}
function pickedPass(av, passCode) {
  const open = (av || []).filter(p => p.remaining > 0);
  const wanted = passCode && open.find(p => p.code === passCode);
  return wanted || open.find(p => p.featured) || open[0] || null;
}
function continueHref(h, date, code) {
  const params = new URLSearchParams({ hotel: h.slug, pass: code, qty: '1' });
  if (date) params.set('date', date);
  return `/checkout?${params.toString()}`;
}
function photoBlock(p, h) {
  const src = passPhoto(p);
  if (!src) return `<div class="pc-photo pc-photo-empty"><span>${esc(p.name)}</span></div>`;
  const badge = isDemo(h) ? '<span class="pc-badge">Example photo</span>' : '';
  return `<div class="pc-photo"><img src="${esc(src)}" alt="${esc(passAlt(p, h))}" width="640" height="480" loading="lazy" decoding="async">${badge}</div>`;
}
function selectButton(p, on, dis) {
  const label = on ? `${p.name} selected` : `Select ${p.name}`;
  return `<button type="button" class="pass-select" data-code="${esc(p.code)}" data-name="${esc(p.name)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(label)}"${dis ? ' disabled' : ''}><span class="t">${on ? '✓ Selected' : 'Select'}</span></button>`;
}
function chosenBlock(pick) {
  if (!pick) return '<div class="seat-chosen" id="seat-chosen" aria-live="polite"><span class="muted">Your seating</span><b>Pick a seat</b></div>';
  const holds = Number(pick.holds) || 1;
  const name = esc(pick.name) + (holds > 1 ? ` for ${holds}` : '');
  return `<div class="seat-chosen" id="seat-chosen" aria-live="polite"><span class="muted">Your seating</span><b>${name}</b><span>${money(pick.price)} each <small>(demo)</small></span></div>`;
}

function passCard(p, av, h, pick, date, items, accessAreas) {
  const a = av.find(x => x.id === p.id);
  const dis = !a || a.remaining < 1;
  const on = !!(pick && p.code === pick.code && !dis);
  const holds = Number(p.holds) || 1;
  const id = esc(p.code);
  const desc = String(p.description || '').trim();
  const chip = on ? '<span class="pc-chip"><span aria-hidden="true">✓</span> Selected</span>' : '';
  return `<article class="pass-card${dis ? ' is-sold' : ''}${on ? ' is-sel' : ''}" id="pass-card-${id}" data-kind="${esc(p.kind || 'custom')}" data-code="${id}">
<input type="radio" id="pass-${id}" name="pass" value="${esc(p.code)}" data-kind="${esc(p.kind || 'custom')}" data-price="${p.price}" data-holds="${holds}" tabindex="-1"${dis ? ' disabled' : ''}${on ? ' checked' : ''}>
${photoBlock(p, h)}
${chip}
<div class="pc-copy"><b>${esc(p.name)}</b>${desc ? `<span class="pc-desc">${esc(desc)}</span>` : ''}<span class="pc-meta"><span class="pc-price">From ${demoPrice(p.price)}</span><span class="pc-holds">${esc(fitsText(holds))}</span></span></div>
<div class="pc-acts">
${passDetail(p, h, items, accessAreas, date, on, dis)}
${selectButton(p, on, dis)}
</div>
<p class="pass-sold" role="status"${dis ? '' : ' hidden'}>${SOLD_COPY}</p>
</article>`;
}

function passDetail(p, h, items, accessAreas, date, on, dis) {
  const holds = Number(p.holds) || 1;
  const id = esc(p.code);
  const desc = String(p.description || '').trim();
  const demo = isDemo(h);
  const areas = accessAreas || [];
  const lines = amenityLines(items, holds, areas);
  const amenities = lines.length ? `<ul class="pass-inc-list">${lines.map(line => `<li>${esc(line.text)}</li>`).join('')}</ul>` : '';
  const access = accessDetail(areas, { demo, amenities });
  const cont = `<a class="pass-continue" data-code="${id}" href="${esc(continueHref(h, date, p.code))}"${dis ? ' hidden' : ''}>Continue to booking</a>`;
  return `<details class="pass-detail" id="pass-detail-${id}" data-code="${id}" role="region" aria-labelledby="pass-title-${id}">
<summary aria-haspopup="dialog">View details</summary>
<div class="pass-detail-body">
<h3 id="pass-title-${id}">${esc(p.name)}</h3>
${photoBlock(p, h)}
${desc ? `<p class="pass-desc">${esc(desc)}</p>` : ''}
<p class="pass-fit">${esc(fitsText(holds))}</p>
<p class="pass-price">${demoPrice(p.price)} <span>per spot</span></p>
${access}
<p class="pass-food">Food and drink are not included in the pass.</p>
<p class="pass-sold" role="status"${dis ? '' : ' hidden'}>${SOLD_COPY}</p>
<div class="pass-actions">${selectButton(p, on, dis)}${cont}</div>
</div>
</details>`;
}

function passSection(passes, av, h, items, accessByPass, date, passCode) {
  const pick = pickedPass(av, passCode);
  const kinds = [];
  passes.forEach(p => {
    const k = p.kind || 'custom';
    if (!kinds.includes(k)) kinds.push(k);
  });
  kinds.sort((a, b) => kindRank(a) - kindRank(b));
  const filters = kinds.length >= 4
    ? `<div class="pass-filters" role="group" aria-label="Filter passes"><button type="button" class="pass-filter" data-kind="" aria-pressed="true">All</button>${kinds.map(k => `<button type="button" class="pass-filter" data-kind="${esc(k)}" aria-pressed="false">${esc(KIND_NAME[k] || 'Pass')}</button>`).join('')}</div>`
    : '';
  const ordered = [];
  kinds.forEach(k => passes.filter(p => (p.kind || 'custom') === k).forEach(p => ordered.push(p)));
  if (pick) {
    const at = ordered.findIndex(p => p.code === pick.code);
    if (at > 0) ordered.unshift(ordered.splice(at, 1)[0]);
  }
  const cards = `<div class="pass-grid">${ordered.map(p => passCard(p, av, h, pick, date, items, (accessByPass && accessByPass[p.id]) || [])).join('')}</div>`;
  const dialog = `<dialog class="seat-dialog" id="seat-dialog" aria-labelledby="seat-dialog-title"><div class="sd-grab" aria-hidden="true"></div><div class="sd-top"><h2 id="seat-dialog-title"></h2><button type="button" class="sd-close">Close</button></div><div class="sd-body"></div></dialog>`;
  return `${filters}${cards}<p class="seat-note">Food and drink are not included in the pass.</p>${dialog}`;
}

function includedItems(passes, items, accessByPass) {
  const rows = [];
  const seen = new Set();
  for (const p of passes) {
    const lines = amenityLines(items, Number(p.holds) || 1, (accessByPass && accessByPass[p.id]) || []);
    for (const line of lines) {
      if (/towel/i.test(line.text)) rows.push(`${line.text} (${p.name})`);
      else if (!seen.has(line.text)) {
        seen.add(line.text);
        rows.push(line.text);
      }
    }
  }
  return rows;
}

function listingScript(slug) {
  return `<script>
const $=s=>document.querySelector(s);
const hotelSlug=${JSON.stringify(String(slug || ''))};
let av=[],addons=[];
let seatOpener=null, seatCode='';
function fmt(n){return '$'+n.toLocaleString('en-AU')}
function h(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function need(a,q,holds){return a.per==='booking'?1:q*(holds||1)}
function guests(){
 const sel=document.querySelector('select[name="qty"]');
 const n=sel?parseInt(sel.value,10):NaN;
 return n>0?n:1;
}
function markPass(card){
 const input=card.querySelector('input');
 const on=!!(input && input.checked && !input.disabled);
 card.classList.toggle('is-sel', on);
 let chip=card.querySelector('.pc-chip');
 if(on && !chip){
  chip=document.createElement('span');
  chip.className='pc-chip';
  chip.innerHTML='<span aria-hidden="true">✓</span> Selected';
  const photo=card.querySelector('.pc-photo');
  if(photo) photo.after(chip); else card.appendChild(chip);
 } else if(!on && chip) chip.remove();
 card.querySelectorAll('.pass-select').forEach(function(btn){
  btn.setAttribute('aria-pressed', on?'true':'false');
  const t=btn.querySelector('.t'); if(t) t.textContent=on?'✓ Selected':'Select';
  const name=btn.getAttribute('data-name')||'';
  btn.setAttribute('aria-label', on?name+' selected':'Select '+name);
 });
}
function render(){
 const q=guests();
 document.querySelectorAll('#passes .pass-card').forEach(card=>{
  const input=card.querySelector('input');
  const p=av.find(x=>x.code===input.value);
  const dis=!p||p.remaining<q;
  input.disabled=dis;
  card.classList.toggle('is-sold',dis);
  card.querySelectorAll('.pass-sold').forEach(function(n){ n.hidden=!dis; });
  card.querySelectorAll('.pass-select').forEach(function(btn){ btn.disabled=dis; });
  card.querySelectorAll('.pass-continue').forEach(function(a){ a.hidden=dis; });
  markPass(card);
 });
 if(!document.querySelector('#passes input:checked:not([disabled])')){const f=document.querySelector('#passes input:not([disabled])');if(f)f.checked=true}
 document.querySelectorAll('#passes .pass-card').forEach(markPass);
 const c=document.querySelector('#passes input:checked');
 const p=c&&av.find(x=>x.code===c.value);
 const holds=p?p.holds||1:1;
 const box=$('#addons-pick');
 const wrap=document.getElementById('extras');
 const dated=!!($('#date')&&$('#date').value);
 if(dated&&box){
  const prev=[...box.querySelectorAll('input:checked')].map(i=>i.value);
  box.innerHTML=addons.map(a=>{const dis=a.remaining<need(a,q,holds);const on=!dis&&prev.indexOf(a.code)>=0;const price=!dis&&a.price>0?'<span class="extra-price">'+fmt(a.price)+' <small>(demo)</small></span>':'';const note=dis?'<span class="extra-note">Sold out for this date</span>':'';return '<label class="extra'+(dis?' is-off':'')+'"><input type="checkbox" name="addon" value="'+h(a.code)+'" data-price="'+(+a.price||0)+'" data-per="'+h(a.per||'guest')+'" '+(dis?'disabled':'')+(on?' checked':'')+'><span class="extra-name">'+h(a.name)+'</span>'+price+note+'</label>'}).join('');
  if(wrap) wrap.hidden=!addons.length;
 }
 let extra=0;document.querySelectorAll('#addons-pick input:checked').forEach(i=>{const price=+i.dataset.price||0;const qty=i.dataset.per==='booking'?1:q*(holds||1);extra+=price*qty});
 const people=p?q*holds:q;
 const sum=p?p.price*q+extra:0;
 $('#total').innerHTML=p?'<span>'+fmt(p.price)+' × '+q+(people>q?' · '+people+' people':'')+(extra?' + '+fmt(extra)+' extras':'')+'</span><b>'+fmt(sum)+' <small>(demo)</small></b>':'';
 const bar=$('#bar-total'); if(bar) bar.textContent=p?(p.name+' · '+fmt(sum)):($('#from-price')?$('#from-price').textContent:'');
 const eq=document.getElementById('spot-eq');
 if(eq){ const n=p?people:q; eq.textContent='= '+n+(n===1?' person':' people'); }
 const chosen=document.getElementById('seat-chosen');
 if(chosen){
  if(p) chosen.innerHTML='<span class="muted">Your seating</span><b>'+h(p.name)+(holds>1?' for '+holds:'')+'</b><span>'+fmt(p.price)+' each <small>(demo)</small></span>';
  else chosen.innerHTML='<span class="muted">Your seating</span><b>Pick a seat</b>';
 }
 document.querySelectorAll('a.pass-continue').forEach(function(a){
  const code=a.getAttribute('data-code')||'';
  const params=new URLSearchParams();
  params.set('hotel', hotelSlug);
  const dateEl=$('#date');
  if(dateEl&&dateEl.value) params.set('date', dateEl.value);
  params.set('pass', code);
  params.set('qty', String(q));
  a.href='/checkout?'+params.toString();
 });
 $('#go').disabled=!p;
 if(seatCode){
  const dlg=document.getElementById('seat-dialog');
  if(dlg&&dlg.open) openSeat(seatCode, seatOpener, false);
 }
 const blocked=av[0]&&av[0].blocked;
 const any=av.some(x=>x.remaining>0);
 const st=$('#status'); st.className='status'+(blocked||!any?' out':'');
 st.textContent=blocked?blocked:!any?'Sold out this day':'Available this day';
 document.querySelectorAll('#passes input, #addons-pick input').forEach(r=>{r.onchange=render});
}
function focusBook(){
 const book=document.getElementById('book');
 if(!book) return;
 book.focus();
 if(window.matchMedia('(max-width:760px)').matches){
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  book.scrollIntoView({behavior:reduce?'auto':'smooth', block:'start'});
 }
}
function openSeat(code, from, refocus){
 const src=document.getElementById('pass-detail-'+code);
 const dlg=document.getElementById('seat-dialog');
 if(!src||!dlg||!dlg.showModal) return;
 const title=src.querySelector('h3');
 const heading=document.getElementById('seat-dialog-title');
 if(heading) heading.textContent=title?title.textContent:'';
 const body=dlg.querySelector('.sd-body');
 body.replaceChildren();
 const inner=src.querySelector('.pass-detail-body');
 if(inner) Array.prototype.forEach.call(inner.children, function(node){
  if(node.tagName==='H3') return;
  const clone=node.cloneNode(true);
  clone.querySelectorAll('[id]').forEach(function(el){ el.removeAttribute('id'); });
  body.appendChild(clone);
 });
 seatCode=code;
 if(refocus!==false) seatOpener=from||document.activeElement;
 if(!dlg.open) dlg.showModal();
 if(refocus!==false){
  const closeBtn=dlg.querySelector('.sd-close');
  if(closeBtn) closeBtn.focus();
 }
 const next='#pass-detail-'+code;
 if(location.hash!==next && history.replaceState) history.replaceState(null,'',location.pathname+location.search+next);
}
function seatFromHash(){
 const m=/^#pass-detail-([A-Za-z0-9_-]+)$/.exec(location.hash||'');
 if(!m) return;
 const det=document.getElementById('pass-detail-'+m[1]);
 if(!det) return;
 openSeat(m[1], det.querySelector('summary'), true);
}
const passBox=document.getElementById('passes');
const seatDlg=document.getElementById('seat-dialog');
if(seatDlg){
 seatDlg.addEventListener('close', function(){
  if(seatOpener&&seatOpener.focus) seatOpener.focus();
  seatOpener=null;
  seatCode='';
  if(/^#pass-detail-/.test(location.hash)&&history.replaceState) history.replaceState(null,'',location.pathname+location.search);
 });
 seatDlg.addEventListener('click', function(e){ if(e.target===seatDlg) seatDlg.close(); });
 const seatClose=seatDlg.querySelector('.sd-close');
 if(seatClose) seatClose.addEventListener('click', function(){ seatDlg.close(); });
}
if(passBox){
 passBox.addEventListener('click', function(e){
  const sum=e.target.closest('.pass-detail summary');
  if(sum && passBox.contains(sum)){
   e.preventDefault();
   const det=sum.closest('.pass-detail');
   if(det) openSeat(det.getAttribute('data-code'), sum, true);
   return;
  }
  const btn=e.target.closest('.pass-select');
  if(!btn || btn.disabled) return;
  const inDialog=!!(seatDlg && seatDlg.contains(btn));
  const code=btn.getAttribute('data-code');
  const card=document.getElementById('pass-card-'+code);
  const input=card&&card.querySelector('input[name="pass"]');
  if(!input || input.disabled) return;
  input.checked=true;
  render();
  if(inDialog && seatDlg.open) seatDlg.close();
  else focusBook();
 });
}
const seatState=document.getElementById('seat-state');
if(seatState) seatState.addEventListener('click', function(e){
 if(e.target.closest('.seat-retry')) load(false);
});
const filters=document.querySelector('.pass-filters');
if(filters){
 filters.addEventListener('click', function(e){
  const btn=e.target.closest('.pass-filter');
  if(!btn) return;
  const kind=btn.dataset.kind||'';
  filters.querySelectorAll('.pass-filter').forEach(b=>b.setAttribute('aria-pressed', b===btn?'true':'false'));
  document.querySelectorAll('#passes .pass-card').forEach(card=>{ card.hidden=!!(kind && card.dataset.kind!==kind); });
 });
}
const more=document.querySelector('.read-more');
const desc=document.getElementById('overview-desc');
if(more&&desc){
 more.addEventListener('click', function(){
  const open=more.getAttribute('aria-expanded')==='true';
  more.setAttribute('aria-expanded', open?'false':'true');
  more.textContent=open?'Read more':'Read less';
  desc.classList.toggle('is-open', !open);
 });
}
const tabNav=document.querySelector('.l-tabs');
if(tabNav){
 tabNav.addEventListener('click', function(e){
  const a=e.target.closest('a');
  if(!a) return;
  const el=document.querySelector(a.getAttribute('href'));
  if(!el) return;
  e.preventDefault();
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({behavior:reduce?'auto':'smooth', block:'start'});
  if(history.pushState) history.pushState(null,'',a.getAttribute('href'));
  tabNav.querySelectorAll('a').forEach(link=>{ if(link===a) link.setAttribute('aria-current','true'); else link.removeAttribute('aria-current'); });
 });
}
(function(){
 const gal=document.querySelector('.gallery');
 const chip=document.querySelector('.gal-chip');
 const lb=document.querySelector('.lightbox');
 if(!gal||!lb) return;
 const imgs=[...gal.querySelectorAll('img')];
 let lbIndex=0, opener=null;
 const shot=lb.querySelector('img');
 const count=lb.querySelector('.lb-count');
 function lbShow(i){
  if(!imgs.length) return;
  lbIndex=(i+imgs.length)%imgs.length;
  shot.src=imgs[lbIndex].src;
  shot.alt=imgs[lbIndex].alt;
  if(count) count.textContent=(lbIndex+1)+' / '+imgs.length;
 }
 function focusables(){
  return [...lb.querySelectorAll('button')].filter(el=>!el.disabled);
 }
 function lbOpen(i, from){
  opener=from||document.activeElement;
  lbShow(i);
  if(!lb.open && lb.showModal) lb.showModal();
  const close=lb.querySelector('.lb-close');
  if(close) close.focus();
 }
 imgs.forEach((img,i)=>img.addEventListener('click', function(){ lbOpen(i, img); }));
 const all=document.querySelector('.view-all');
 if(all) all.addEventListener('click', function(){ lbOpen(0, all); });
 lb.querySelector('.lb-prev').addEventListener('click', function(){ lbShow(lbIndex-1); });
 lb.querySelector('.lb-next').addEventListener('click', function(){ lbShow(lbIndex+1); });
 lb.querySelector('.lb-close').addEventListener('click', function(){ lb.close(); });
 lb.addEventListener('close', function(){ if(opener&&opener.focus) opener.focus(); });
 lb.addEventListener('keydown', function(e){
  if(e.key==='ArrowRight'){ e.preventDefault(); lbShow(lbIndex+1); }
  else if(e.key==='ArrowLeft'){ e.preventDefault(); lbShow(lbIndex-1); }
  else if(e.key==='Tab'){
   const nodes=focusables();
   if(!nodes.length) return;
   const first=nodes[0], last=nodes[nodes.length-1];
   if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
   else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  }
 });
 function syncChip(){
  if(!chip||!imgs.length) return;
  const w=gal.clientWidth||1;
  let i=Math.round(gal.scrollLeft/w);
  if(i<0) i=0;
  if(i>=imgs.length) i=imgs.length-1;
  chip.textContent=(i+1)+' / '+imgs.length;
 }
 gal.addEventListener('scroll', syncChip, {passive:true});
 syncChip();
})();
 async function load(quiet){
 const el=$('#date'); if(!el) return;
 const state=document.getElementById('seat-state');
 const grid=document.querySelector('#passes .pass-grid');
 if(!quiet && state) state.innerHTML='<p class="seat-loading">Checking availability…</p>';
 if(!quiet && grid) grid.classList.add('is-loading');
 try {
  const r=await fetch('/api/availability?hotel='+encodeURIComponent(hotelSlug)+'&date='+encodeURIComponent(el.value));
  if(!r.ok) throw new Error('status');
  const data=await r.json();
  av=data.passes||[]; addons=data.addons||[];
  const note=document.getElementById('cancel-note');
  if(note){ note.hidden=!el.value; note.textContent=data.cancel||''; }
  if(state) state.textContent='';
  if(grid) grid.classList.remove('is-loading');
  render();
  if(!el.value){ const st=$('#status'); if(st){ st.className='status'; st.textContent='Pick a date'; } }
 } catch(err) {
  if(grid) grid.classList.remove('is-loading');
  if(state) state.innerHTML="<p class='seat-error' role='alert'>We couldn't check availability. Try again.</p><button type='button' class='seat-retry'>Try again</button>";
 }
}
document.getElementById('date').addEventListener('change', function(){ load(false); });
document.querySelector('select[name="qty"]').addEventListener('change',render);
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
seatFromHash();
load(true);setInterval(function(){ load(true); },15000);
</script>`;
}

function galleryHtml(h, demo, short) {
  const photos = h.photos || [];
  const n = photos.length;
  const galAlt = demo ? 'Stock photo, not this hotel' : `Photo of ${short}`;
  const imgs = photos.map((p, i) => `<img class="g${i}" src="/assets/photos/${esc(p)}" alt="${esc(galAlt)}" width="1200" height="900" fetchpriority="high" decoding="async">`).join('');
  const countClass = n <= 1 ? 'g-n1' : n === 2 ? 'g-n2' : n === 3 ? 'g-n3' : n === 4 ? 'g-n4' : 'g-n5';
  const credit = demo ? '<span class="photo-credit">Stock photos · not this hotel</span>' : '';
  return `<div class="mob-g"><div class="gallery swipe ${countClass}" aria-label="Photos">${imgs}${credit}<button type="button" class="view-all">View all (${n})</button></div><span class="gal-chip">1 / ${n || 0}</span></div>
<dialog class="lightbox" aria-label="Photos"><button type="button" class="lb-close" aria-label="Close">Close</button><button type="button" class="lb-prev" aria-label="Previous photo">‹</button><img alt="${esc(galAlt)}" width="1200" height="900"><button type="button" class="lb-next" aria-label="Next photo">›</button><p class="lb-count" aria-live="polite">1 / ${n || 1}</p></dialog>`;
}

function goodToKnowBand({ policy, foodLine, includedNames }) {
  const arrive = `Show your QR code at check-in. ${instantConfirmationText()}`;
  const priced = includedNames.length ? `${includedNames.join(', ')}. ` : '';
  const price = `${priced}${foodLine || 'Food and drink are not included in the pass.'}`;
  return `<section class="gtk-band" id="before" aria-label="Before you book"><div class="wrap">
<h2 id="gtk">Good to know</h2>
<div class="gtk-cols">
<div><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><path d="M10 10h1.6v1.6H10zM12.6 12.6H14V14h-1.4z"/></svg><h3>What happens when I get there?</h3><p>${esc(arrive)}</p><p><b>Instant confirmation.</b> <a href="/contact">Help when you need it</a>.</p></div>
<div><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg><h3>What's included in the price?</h3><p>${esc(price)}</p></div>
<div><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v3M16 3.5v3M4 10h16"/><path d="M8.8 15.2l2.1 2.1 4.6-4.8"/></svg><h3>Can I cancel if my plans change?</h3><p>You have 24 hours to cancel. Free until 24 hours before your access hours start. <a href="/refunds">Cancellation and refund policy</a>.</p></div>
</div>
<p class="gtk-note">${policy.note}</p>
</div></section>`;
}

function listingHtml(opts) {
  const { h, date, minDate, maxDate, closed, passes, av, from, cancel, know, included, addonList, hours, policy, accessByPass, foodLine } = opts;
  const items = Array.isArray(included) ? included : [];
  const parkNote = includedNote(items);
  const short = shortName(h);
  const demo = isDemo(h);
  const heading = demo ? `${short} (Demo)` : short;
  const watch = supervisionNote(h);
  const names = passes.map(p => p.name).filter(Boolean);
  const meta = [h.area, names.join(', ')].filter(Boolean).join(' · ');
  const seat = pickedPass(av, opts.passCode);
  const seatHolds = seat ? (Number(seat.holds) || 1) : 1;
  const barLabel = seat ? `${esc(seat.name)} · ${money(seat.price)}` : `From ${money(from)}`;
  const place = arrivalInner(h);
  const rows = includedItems(passes, items, accessByPass);
  const incList = rows.length ? `<ul class="inc">${rows.map(text => `<li>${ITEM_ICON}<span>${esc(text)}</span></li>`).join('')}</ul>` : '';
  const parkFold = parkNote ? `<details class="fold" id="parking"><summary>Parking</summary><div class="acc-body"><p>${esc(parkNote)}</p></div></details>` : '';
  const cancelCopy = esc(know || cancel);
  return `<div class="wrap listing">
${galleryHtml(h, demo, short)}
<form action="/checkout" method="get" id="bf" class="l-layout">
<input type="hidden" name="hotel" value="${esc(h.slug)}">
<div class="l-main">
<section class="listing-head" id="overview">
<h1 class="l-title">${esc(heading)}</h1>
<p class="muted l-meta">${esc(meta)}</p>
${demo ? '<span class="demo-pill">Fictional demo listing</span>' : ''}
<p class="day-lead" id="overview-desc"><b>${esc(h.tagline)}.</b> ${esc(h.blurb)}</p>
<button type="button" class="read-more" aria-expanded="false" aria-controls="overview-desc">Read more</button>
${watch ? `<p class="guard-note">${esc(watch)}</p>` : ''}
</section>
<div class="l-tabs"><nav aria-label="Sections"><a href="#overview" aria-current="true">Overview</a><a href="#passes">Passes</a><a href="#details">Details</a></nav></div>
<section id="passes" aria-labelledby="seat-h"><div class="seat-head"><h2 class="day-kicker" id="seat-h">Choose your seating</h2><p class="seat-sub">Prices per spot, before add-ons. Pick a date to see what's left.</p></div>
<div id="seat-state" aria-live="polite"></div>
${passSection(passes, av, h, items, accessByPass, date, opts.passCode)}
</section>
${addonList || ''}
<section id="details"><h2>Details</h2>
<h3 class="sub">What's included</h3>
${incList}
<p class="food-note">${esc(foodLine || 'Food and drink are not included in the pass.')}</p>
<div class="l-acc">
<details id="hours" open><summary>Opening hours</summary><div class="acc-body">${hours}</div></details>
<details id="getting-there"><summary>Getting there</summary><div class="acc-body">${place.address || ''}${place.there || ''}</div></details>
${parkFold}
<details id="policy"><summary>Guest policy</summary><div class="acc-body">${policy.body}</div></details>
<details id="cancel-fold"><summary>Cancellation</summary><div class="acc-body"><p>You have 24 hours to cancel. Free until 24 hours before your access hours start. ${cancelCopy} <a href="/refunds">Cancellation and refund policy</a>.</p></div></details>
</div>
</section>
</div>
<aside class="book-box" id="book" tabindex="-1">
<div class="bb-price">From <b id="from-price">${money(from)}</b> <small>(demo)</small></div>
<p class="bb-label" id="date-label">Date</p>
<input type="date" class="hdc-date" data-inline="1" data-closed="${esc(closed)}" name="date" id="date" min="${minDate}" max="${maxDate}" value="${esc(date)}" required>
<div id="status" class="status"></div>
<label class="fl" for="qty">Spots<select name="qty" id="qty" class="hdc-pick">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${n === 1 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
<p class="spot-eq" id="spot-eq">${peopleLabel(seatHolds)}</p>
<p class="muted small">Party size is capped at 6.</p>
${chosenBlock(seat)}
<div class="bb-total" id="total"></div>
<p class="cancel-note" id="cancel-note"${date ? '' : ' hidden'}>${esc(cancel)}</p>
<button class="book-go" id="go" type="submit">Book your day (demo)</button>
<p class="prompt">You won't be charged. Demo payment only.</p>
</aside>
</form>
</div>
${goodToKnowBand({ policy, foodLine, includedNames: rows })}
<div class="book-bar"><b><span id="bar-total">${barLabel}</span> (demo)</b><a href="#book">Book</a></div>
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
