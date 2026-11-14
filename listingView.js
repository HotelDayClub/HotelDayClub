const { esc, money, nice, ymd, addDays } = require('./util');
const { instantConfirmationText } = require('./siteMode');
const { KINDS, supervisionNote, safePhoto, FOOD_RULE, FREE_CANCEL } = require('./offering');
const { includedNote, amenityLines, includedLines } = require('./inclusions');
const { arrivalInner } = require('./arrival');
const { MapEmbed } = require('./mapEmbed');
const { ListingImprove } = require('./listingImprove');
const { SearchQuery } = require('./search');

const SOLD_COPY = 'Sold out for this date. Pick another date or seat.';
function dateNote(row) {
  if (row && row.past) return 'That date has passed.';
  if (row && row.blocked) return 'Closed this day.';
  return SOLD_COPY;
}

class ListingPanel {
  static DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  static leftText(remaining) {
    const n = Number(remaining);
    if (!Number.isFinite(n) || n <= 0 || n > 10) return '';
    return `${n} left`;
  }

  static towelText(qty) {
    const n = Math.max(0, Number(qty) || 0);
    if (n < 1) return '';
    if (n === 1) return 'Towels: 1 per person';
    return `${n} towels`;
  }

  static towelFor(items, people) {
    const towel = includedLines(items, people).find(line => /towel/i.test(line.name || ''));
    return towel ? ListingPanel.towelText(towel.qty) : '';
  }

  static sharedLines(passes, items, accessByPass) {
    const rows = [];
    const seen = new Set();
    for (const p of passes || []) {
      const lines = amenityLines(items, Number(p.holds) || 1, (accessByPass && accessByPass[p.id]) || []);
      for (const line of lines) {
        if (/towel/i.test(line.name || '') || /towel/i.test(line.text || '')) continue;
        if (seen.has(line.text)) continue;
        seen.add(line.text);
        rows.push(line.text);
      }
    }
    return rows;
  }

  static titleLine(area, lines, weekday) {
    const place = String(area || '').trim();
    const rows = Array.isArray(lines) ? lines : [];
    const open = rows.filter(row => row && row.time && row.time !== 'Closed');
    const uniform = open.length === 7 && open.every(row => row.time === open[0].time);
    let when = '';
    if (uniform) when = `Daily ${open[0].time}`;
    else {
      const today = rows.find(row => row.day === ListingPanel.DAY[weekday]);
      when = !today || !today.time || today.time === 'Closed' ? 'Closed today' : `Today ${today.time}`;
    }
    return [when, place].filter(Boolean).join(' · ');
  }

  static hoursTable(lines, weekday) {
    const todayName = ListingPanel.DAY[weekday] || '';
    const rows = (lines || []).map(row => {
      const today = row.day === todayName;
      const label = today ? `${row.day} (today)` : row.day;
      return `<tr${today ? ' class="is-today"' : ''}><th scope="row">${esc(label)}</th><td>${esc(row.time)}</td></tr>`;
    }).join('');
    return `<table class="hours-table"><tbody>${rows}</tbody></table><p class="muted small">These are the day-pass hours for this demo listing.</p><p class="muted small">Times are the hotel's local time.</p>`;
  }

  static viewAllLabel(count) {
    const n = Number(count) || 0;
    if (n <= 4) return '';
    return `View all ${n} photos`;
  }

  static boundQty(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > SearchQuery.BOOKING_SPOTS) return 1;
    return n;
  }

  static shiftDay(iso, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
    return ymd(addDays(new Date(iso + 'T12:00:00'), days));
  }

  static stepDay(date, min, max, dir) {
    if (!min || !max) return '';
    if (dir < 0) {
      if (!date || date <= min) return '';
      const prev = ListingPanel.shiftDay(date, -1);
      if (!prev || prev < min) return '';
      return prev;
    }
    if (!date) return min;
    let next = ListingPanel.shiftDay(date, 1);
    if (next && next < min) next = min;
    if (!next || next > max || next === date) return '';
    return next;
  }

  static dayHref(slug, date, opts = {}) {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const pass = String(opts.passCode || '').slice(0, 40);
    if (pass) params.set('pass', pass);
    params.set('qty', String(ListingPanel.boundQty(opts.qty)));
    return `/h/${encodeURIComponent(slug)}?${params.toString()}#${opts.hash || 'passes'}`;
  }

  static dayHours(lines, iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Array.isArray(lines)) return '';
    const name = ListingPanel.DAY[new Date(iso + 'T12:00:00').getDay()];
    const row = lines.find(item => item.day === name);
    if (!row || !row.time || row.time === 'Closed') return '';
    return row.time;
  }
}

const CHEV_L = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
function dayStepLinks({ slug, date, minDate, maxDate, passCode, qty }) {
  const q = ListingPanel.boundQty(qty);
  const prev = ListingPanel.stepDay(date || '', minDate, maxDate, -1);
  const next = ListingPanel.stepDay(date || '', minDate, maxDate, 1);
  const opt = { passCode, qty: q };
  return {
    label: date ? nice(date) : 'Pick a date',
    prev: prev ? ListingPanel.dayHref(slug, prev, opt) : '',
    next: next ? ListingPanel.dayHref(slug, next, opt) : '',
    hours: '',
  };
}
function stepControl(id, label, href, icon) {
  const dis = href ? '' : ' aria-disabled="true" tabindex="-1"';
  const dest = href ? ` href="${esc(href)}"` : '';
  return `<a class="day-step-btn" id="${id}" aria-label="${label}"${dest}${dis}>${icon}</a>`;
}
function offerLine(offer) {
  if (!offer) return '<p class="day-offer" id="day-offer" role="status" hidden></p>';
  const link = offer.tryLabel && offer.href ? ` <a href="${esc(offer.href)}">${esc(offer.tryLabel)}</a>` : '';
  const empty = offer.empty ? ` ${esc(offer.empty)}` : '';
  return `<p class="day-offer" id="day-offer" role="status">${esc(offer.line)}${link}${empty}</p>`;
}

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

function seatHref(h, code, date, qty) {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  const n = Math.max(1, Math.min(SearchQuery.BOOKING_SPOTS, Number(qty) || 1));
  params.set('qty', String(n));
  return `/h/${encodeURIComponent(h.slug)}/seat/${encodeURIComponent(code)}?${params.toString()}`;
}
function passCard(p, av, h, pick, date, qty, items) {
  const a = av.find(x => x.id === p.id);
  const dis = !a || a.remaining < 1;
  const on = !!(pick && p.code === pick.code && !dis);
  const holds = Number(p.holds) || 1;
  const id = esc(p.code);
  const desc = String(p.description || '').trim();
  const left = date ? ListingPanel.leftText(a && a.remaining) : '';
  const leftHtml = left ? `<span class="left-badge">${esc(left)}</span>` : '';
  const towel = ListingPanel.towelFor(items, holds);
  const towelHtml = towel ? `<span class="pc-towel">${esc(towel)}</span>` : '';
  return `<article class="pass-card${dis ? ' is-sold' : ''}${on ? ' is-sel' : ''}" id="pass-card-${id}" data-kind="${esc(p.kind || 'custom')}" data-code="${id}">
<input type="radio" id="pass-${id}" name="pass" value="${esc(p.code)}" data-kind="${esc(p.kind || 'custom')}" data-price="${p.price}" data-holds="${holds}" tabindex="-1"${dis ? ' disabled' : ''}${on ? ' checked' : ''}>
${photoBlock(p, h)}
<div class="pc-copy"><b>${esc(p.name)}${leftHtml}</b>${desc ? `<span class="pc-desc">${esc(desc)}</span>` : ''}<span class="pc-meta"><span class="pc-price">From ${demoPrice(p.price)}</span><span class="pc-holds">${esc(fitsText(holds))}</span></span>${towelHtml}</div>
<div class="pc-acts">
<a class="pass-view" data-code="${id}" href="${esc(seatHref(h, p.code, date, qty))}">View details</a>
${selectButton(p, on, dis)}
</div>
<p class="pass-sold" role="status"${dis ? '' : ' hidden'}>${esc(dateNote(a))}</p>
</article>`;
}

function passSection(passes, av, h, date, passCode, qty, items) {
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
  const cards = `<div class="pass-grid">${ordered.map(p => passCard(p, av, h, pick, date, qty, items)).join('')}</div>`;
  return `${filters}${cards}<p class="seat-note">${esc(FOOD_RULE)}</p>`;
}

function includedItems(passes, items, accessByPass) {
  return ListingPanel.sharedLines(passes, items, accessByPass);
}

function listingScript(slug, leaflet) {
  return `<script>
const $=s=>document.querySelector(s);
const hotelSlug=${JSON.stringify(String(slug || ''))};
let av=[],addons=[],currentOffer=null;
function seatFromHash(){
 const m=/^#pass-detail-([A-Za-z0-9_-]+)$/.exec(location.hash||'');
 if(!m) return;
 location.replace('/h/'+encodeURIComponent(hotelSlug)+'/seat/'+encodeURIComponent(m[1])+(location.search||''));
}
seatFromHash();
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
 card.querySelectorAll('.pass-select').forEach(function(btn){
  btn.setAttribute('aria-pressed', on?'true':'false');
  const t=btn.querySelector('.t'); if(t) t.textContent=on?'✓ Selected':'Select';
  const name=btn.getAttribute('data-name')||'';
  btn.setAttribute('aria-label', on?name+' selected':'Select '+name);
 });
}
function syncLeft(card, p){
 const dated=!!($('#date')&&$('#date').value);
 const n=p?Number(p.remaining):0;
 const text=dated&&n>0&&n<=10?n+' left':'';
 let badge=card.querySelector('.left-badge');
 const name=card.querySelector('.pc-copy b');
 if(!text){ if(badge) badge.remove(); return; }
 if(!badge&&name){
  badge=document.createElement('span');
  badge.className='left-badge';
  name.appendChild(badge);
 }
 if(badge) badge.textContent=text;
}
function render(){
 const q=guests();
 const dayBlocked=av[0]&&av[0].blocked;
 const dayPast=av[0]&&av[0].past;
 const note=dayPast?'That date has passed.':dayBlocked?'Closed this day.':'Sold out for this date. Pick another date or seat.';
 document.querySelectorAll('#passes .pass-card').forEach(card=>{
  const input=card.querySelector('input');
  const p=av.find(x=>x.code===input.value);
  const dis=!p||p.remaining<q;
  input.disabled=dis;
  card.classList.toggle('is-sold',dis);
  card.querySelectorAll('.pass-sold').forEach(function(n){ n.hidden=!dis; n.textContent=note; });
  card.querySelectorAll('.pass-select').forEach(function(btn){ btn.disabled=dis; });
  card.querySelectorAll('a.pass-view').forEach(function(a){ a.hidden=false; });
  syncLeft(card, p);
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
  box.innerHTML=addons.map(a=>{const dis=a.remaining<need(a,q,holds);const on=!dis&&prev.indexOf(a.code)>=0;const price=!dis&&a.price>0?'<span class="extra-price">'+fmt(a.price)+' <small>(demo)</small></span>':'';const why=dayPast||dayBlocked?'Closed this day':'Sold out for this date';const extraNote=dis?'<span class="extra-note">'+why+'</span>':'';return '<label class="extra'+(dis?' is-off':'')+'"><input type="checkbox" name="addon" value="'+h(a.code)+'" data-price="'+(+a.price||0)+'" data-per="'+h(a.per||'guest')+'" '+(dis?'disabled':'')+(on?' checked':'')+'><span class="extra-name">'+h(a.name)+'</span>'+price+extraNote+'</label>'}).join('');
  if(wrap) wrap.hidden=!addons.length;
 }
 let extra=0;document.querySelectorAll('#addons-pick input:checked').forEach(i=>{const price=+i.dataset.price||0;const qty=i.dataset.per==='booking'?1:q*(holds||1);extra+=price*qty});
 const people=p?q*holds:q;
 const sum=p?p.price*q+extra:0;
 paintTotal(p,q,people,extra,sum);
 paintBar(p,sum);
 paintSum(p,q);
 const eq=document.getElementById('spot-eq');
 if(eq){ const n=p?people:q; eq.textContent='= '+n+(n===1?' person':' people'); }
 const chosen=document.getElementById('seat-chosen');
 if(chosen){
  if(p) chosen.innerHTML='<span class="muted">Your seating</span><b>'+h(p.name)+(holds>1?' for '+holds:'')+'</b><span>'+fmt(p.price)+' each <small>(demo)</small></span>';
  else chosen.innerHTML='<span class="muted">Your seating</span><b>Pick a seat</b>';
 }
 document.querySelectorAll('a.pass-view').forEach(function(a){
  const code=a.getAttribute('data-code')||'';
  const params=new URLSearchParams();
  const dateEl=$('#date');
  if(dateEl&&dateEl.value) params.set('date', dateEl.value);
  params.set('qty', String(q));
  a.href='/h/'+encodeURIComponent(hotelSlug)+'/seat/'+encodeURIComponent(code)+'?'+params.toString();
 });
 const alert=document.getElementById('date-alert');
 const held=!!(alert && $('#date') && alert.getAttribute('data-date')===$('#date').value);
 $('#go').disabled=held||!p||!!currentOffer;
 if(held){ const go=$('#go'); if(go) go.setAttribute('aria-disabled','true'); }
 else { const go=$('#go'); if(go) go.removeAttribute('aria-disabled'); }
 const blocked=dayBlocked;
 const any=av.some(x=>x.remaining>0);
 const st=$('#status');
 if(!held && st){
  st.className='status'+(blocked||!any?' out':'');
  st.textContent=blocked?blocked:!any?'Sold out this day':'Available this day';
 }
 document.querySelectorAll('#passes input, #addons-pick input').forEach(r=>{r.onchange=render});
}
function focusBook(){
 const alert=document.getElementById('date-alert');
 const book=document.getElementById('book');
 if(sheetMobile()){
  if(openBookSheet()){
   if(alert) alert.focus();
   return;
  }
 }
 const target=alert||book;
 if(!target) return;
 target.focus();
}
const passBox=document.getElementById('passes');
if(passBox){
 passBox.addEventListener('click', function(e){
  const btn=e.target.closest('.pass-select');
  if(!btn || btn.disabled) return;
  const code=btn.getAttribute('data-code');
  const card=document.getElementById('pass-card-'+code);
  const input=card&&card.querySelector('input[name="pass"]');
  if(!input || input.disabled) return;
  input.checked=true;
  render();
  focusBook();
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
function leadFullHeight(){
 desc.classList.add('is-open');
 var full=desc.offsetHeight;
 desc.classList.remove('is-open');
 return full;
}
function leadUnderBar(){
 var bar=document.querySelector('.book-bar');
 if(!bar) return false;
 var box=getComputedStyle(bar);
 if(box.display==='none' || box.visibility==='hidden') return false;
 var barTop=bar.getBoundingClientRect().top;
 var intro=desc.getBoundingClientRect();
 if(barTop<=0 || intro.top>=barTop) return false;
 var control=more.getBoundingClientRect();
 return control.bottom>barTop-8 || intro.bottom>barTop-8;
}
function syncLead(){
 if(!more||!desc) return;
 var open=more.getAttribute('aria-expanded')==='true';
 if(open){
  more.hidden=false;
  desc.style.removeProperty('--lead-lines');
  return;
 }
 desc.style.setProperty('--lead-lines','5');
 var full=leadFullHeight();
 var cut=full>desc.offsetHeight+1;
 more.hidden=!cut;
 if(!cut){
  desc.style.removeProperty('--lead-lines');
  return;
 }
 var lines=5;
 while(lines>1 && leadUnderBar()){
  lines-=1;
  desc.style.setProperty('--lead-lines', String(lines));
 }
}
if(more&&desc){
 more.addEventListener('click', function(){
  const open=more.getAttribute('aria-expanded')==='true';
  more.setAttribute('aria-expanded', open?'false':'true');
  more.textContent=open?'Read more':'Read less';
  desc.classList.toggle('is-open', !open);
  syncLead();
 });
}
function placeListingChrome(){
 var hdr=document.querySelector('.hdr');
 var tabs=document.querySelector('.l-tabs');
 if(!hdr) return;
 var h=Math.ceil(hdr.getBoundingClientRect().height);
 var tabsH=tabs?Math.ceil(tabs.getBoundingClientRect().height):0;
 var root=document.documentElement;
 root.style.setProperty('--listing-sticky', h+'px');
 root.style.setProperty('--listing-scroll', (h+tabsH+12)+'px');
 root.style.setProperty('--listing-book', (h+12)+'px');
}
placeListingChrome();
syncLead();
window.addEventListener('resize', function(){ placeListingChrome(); syncLead(); });
if(document.fonts&&document.fonts.ready) document.fonts.ready.then(function(){ placeListingChrome(); syncLead(); });
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
 if('IntersectionObserver' in window){
  const links=[].slice.call(tabNav.querySelectorAll('a[href^="#"]'));
  const sections=links.map(function(link){ return document.querySelector(link.getAttribute('href')); }).filter(Boolean);
  const ratios=new Map();
  const spy=new IntersectionObserver(function(entries){
   entries.forEach(function(entry){ ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0); });
   let best=null, score=-1;
   sections.forEach(function(section){
    const now=ratios.get(section)||0;
    if(now>score){ score=now; best=section; }
   });
   if(score<=0){
    const line=Math.max(120, window.innerHeight*0.25);
    let dist=Infinity;
    sections.forEach(function(section){
     const gap=Math.abs(section.getBoundingClientRect().top-line);
     if(gap<dist){ dist=gap; best=section; }
    });
   }
   links.forEach(function(link){
    if(best && link.getAttribute('href')==='#'+best.id) link.setAttribute('aria-current','true');
    else link.removeAttribute('aria-current');
   });
  }, { root:null, rootMargin:'-12% 0px -45% 0px', threshold:[0, 0.1, 0.25, 0.5, 0.75, 1] });
  sections.forEach(function(section){ spy.observe(section); });
 }
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
  const passNow=document.querySelector('#passes input:checked');
  const r=await fetch('/api/availability?hotel='+encodeURIComponent(hotelSlug)+'&date='+encodeURIComponent(el.value)+'&qty='+encodeURIComponent(String(guests()))+'&pass='+encodeURIComponent(passNow?passNow.value:''));
  if(!r.ok) throw new Error('status');
  const data=await r.json();
  av=data.passes||[]; addons=data.addons||[];
  const note=document.getElementById('cancel-note');
  const barCancel=document.getElementById('bar-cancel');
  if(note) note.textContent=data.cancel||'';
  if(barCancel) barCancel.textContent=data.cancel||'';
  if(state) state.textContent='';
  if(grid) grid.classList.remove('is-loading');
  applyStep(data.step);
  applyOffer(data.offer);
  render();
  if(!el.value){ const st=$('#status'); if(st){ st.className='status'; st.textContent='Pick a date'; } }
 } catch(err) {
  if(grid) grid.classList.remove('is-loading');
  if(state) state.innerHTML="<p class='seat-error' role='alert'>We couldn't check availability. Try again.</p><button type='button' class='seat-retry'>Try again</button>";
 }
}
document.getElementById('date').addEventListener('change', function(){ load(false); });
document.querySelector('select[name="qty"]').addEventListener('change', function(){ render(); load(true); });
${leaflet === false ? '' : `const peek=document.querySelector('.map-peek');
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
`}
function setPrice(el, value){
 if(!el) return;
 const next=String(value||'');
 const prev=el.getAttribute('data-price')||'';
 if(el.textContent!==next) el.textContent=next;
 el.setAttribute('data-price', next);
 if(!prev||prev===next) return;
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
 el.classList.remove('is-tick');
 void el.offsetWidth;
 el.classList.add('is-tick');
}
function paintTotal(p, q, people, extra, sum){
 const total=document.getElementById('total');
 if(!total) return;
 if(!p||currentOffer){ total.textContent=''; return; }
 let num=total.querySelector('.price-num');
 const math=fmt(p.price)+' × '+q+(people>q?' · '+people+' people':'')+(extra?' + '+fmt(extra)+' extras':'');
 if(!num){
  total.innerHTML='<span class="tot-math"></span><b><span class="price-num"></span> <small>(demo)</small></b>';
  num=total.querySelector('.price-num');
 }
 const mathEl=total.querySelector('.tot-math');
 if(mathEl) mathEl.textContent=math;
 setPrice(num, fmt(sum));
}
function paintBar(p, sum){
 const text=document.getElementById('bar-text');
 const price=document.getElementById('bar-price');
 if(!text||!price) return;
 if(currentOffer){
  text.textContent=currentOffer.bar||currentOffer.word||'';
  price.hidden=true;
  price.textContent='';
  return;
 }
 price.hidden=false;
 text.textContent=p?(p.name+' · '):'From ';
 const fromEl=document.getElementById('from-price');
 setPrice(price, p?fmt(sum):(fromEl?fromEl.textContent:price.textContent));
}
function paintSum(p, q){
 const line=document.getElementById('bb-sum');
 if(!line) return;
 const label=document.getElementById('day-step-label');
 const when=label&&label.textContent&&label.textContent!=='Pick a date'?label.textContent:'';
 const bits=[];
 if(when) bits.push(when);
 if(p) bits.push(p.name);
 bits.push(String(q)+(q===1?' spot':' spots'));
 line.textContent=bits.join(' · ');
}
function paintFrom(offer){
 const bb=document.getElementById('bb-price');
 if(!bb) return;
 const from=bb.getAttribute('data-from')||'';
 bb.replaceChildren();
 const small=document.createElement('small');
 small.textContent='(demo)';
 if(offer){
  const b=document.createElement('b');
  b.textContent=offer.word||'';
  bb.append(b, document.createTextNode(' '), small);
  return;
 }
 bb.append(document.createTextNode('From '));
 const b=document.createElement('b');
 b.id='from-price';
 b.textContent=from;
 bb.append(b, document.createTextNode(' '), small);
}
function setStepLink(el, href){
 if(!el) return;
 if(href){
  el.setAttribute('href', href);
  el.removeAttribute('aria-disabled');
  el.removeAttribute('tabindex');
 } else {
  el.removeAttribute('href');
  el.setAttribute('aria-disabled','true');
  el.setAttribute('tabindex','-1');
 }
}
function applyStep(step){
 if(!step) return;
 const label=document.getElementById('day-step-label');
 const hours=document.getElementById('day-step-hours');
 if(label&&step.label) label.textContent=step.label;
 if(hours){
  hours.textContent=step.hours||'';
  hours.hidden=!step.hours;
 }
 setStepLink(document.getElementById('day-prev'), step.prev||'');
 setStepLink(document.getElementById('day-next'), step.next||'');
}
function applyOffer(offer){
 currentOffer=offer||null;
 const line=document.getElementById('day-offer');
 if(line){
  line.replaceChildren();
  if(!currentOffer) line.hidden=true;
  else {
   line.hidden=false;
   line.append(document.createTextNode(currentOffer.line||''));
   if(currentOffer.tryLabel&&currentOffer.href){
    line.append(document.createTextNode(' '));
    const a=document.createElement('a');
    a.href=currentOffer.href;
    a.textContent=currentOffer.tryLabel;
    line.append(a);
   }
   if(currentOffer.empty) line.append(document.createTextNode((currentOffer.tryLabel?' ':'')+currentOffer.empty));
  }
 }
 const see=document.getElementById('day-see');
 if(see){
  if(currentOffer&&currentOffer.href&&currentOffer.see){
   see.hidden=false;
   see.href=currentOffer.href;
   see.textContent=currentOffer.see;
  } else see.hidden=true;
 }
 const go=document.getElementById('go');
 if(go){
  if(!go.dataset.label) go.dataset.label='Book your day (demo)';
  go.textContent=currentOffer?currentOffer.button:go.dataset.label;
 }
 paintFrom(currentOffer);
 const open=document.getElementById('book-open');
 if(open){
  if(currentOffer&&currentOffer.href){
   open.href=currentOffer.href;
   open.textContent='Next day';
   open.classList.add('is-next');
   open.removeAttribute('aria-haspopup');
   open.removeAttribute('aria-controls');
  } else {
   open.href='#book';
   open.textContent='Book';
   open.classList.remove('is-next');
   open.setAttribute('aria-haspopup','dialog');
   open.setAttribute('aria-controls','book-sheet');
  }
 }
}
function sheetMobile(){
 return window.matchMedia('(max-width:760px)').matches;
}
function openBookSheet(){
 const bookSheet=document.getElementById('book-sheet');
 const opener=document.getElementById('book-open');
 if(!bookSheet||!bookSheet.showModal||!sheetMobile()) return false;
 if(opener&&opener.getAttribute('href')&&opener.getAttribute('href').indexOf('#book')<0) return false;
 if(!bookSheet.open) bookSheet.showModal();
 document.documentElement.classList.add('book-lock');
 const close=bookSheet.querySelector('.book-sheet-close');
 if(close) close.focus();
 return true;
}
function sheetFocusable(bookSheet){
 return [...bookSheet.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(function(el){
  if(el.disabled||el.hidden) return false;
  if(el.getAttribute('aria-hidden')==='true') return false;
  if(el.tabIndex<0) return false;
  if(el.closest('[hidden]')) return false;
  const box=el.getBoundingClientRect();
  return box.width>0||box.height>0;
 });
}
function bindBookSheet(){
 const bookSheet=document.getElementById('book-sheet');
 const opener=document.getElementById('book-open');
 if(!bookSheet) return;
 if(opener) opener.addEventListener('click', function(e){
  if(openBookSheet()) e.preventDefault();
 });
 const closeBtn=bookSheet.querySelector('.book-sheet-close');
 if(closeBtn) closeBtn.addEventListener('click', function(){ bookSheet.close(); });
 function releaseBookSheet(){
  document.documentElement.classList.remove('book-lock');
  const back=document.getElementById('book-open');
  setTimeout(function(){ if(back&&back.focus) back.focus(); }, 0);
 }
 bookSheet.addEventListener('close', releaseBookSheet);
 bookSheet.addEventListener('cancel', function(e){
  if(e.target!==bookSheet) return;
  releaseBookSheet();
 });
 bookSheet.addEventListener('keydown', function(e){
  if(e.key!=='Tab'||!bookSheet.open) return;
  const nodes=sheetFocusable(bookSheet);
  if(!nodes.length) return;
  const first=nodes[0], last=nodes[nodes.length-1];
  if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
 });
 const wide=window.matchMedia('(min-width:761px)');
 if(wide.addEventListener) wide.addEventListener('change', function(){
  if(wide.matches&&bookSheet.open) bookSheet.close();
 });
}
function bindBookBar(){
 const bar=document.querySelector('.book-bar');
 const gal=document.querySelector('.gallery');
 if(!bar) return;
 const mobile=window.matchMedia('(max-width:760px)');
 function place(show){
  if(!mobile.matches){ bar.classList.remove('is-in'); return; }
  bar.classList.toggle('is-in', !!show);
 }
 if(!gal||!('IntersectionObserver' in window)){ place(true); return; }
 new IntersectionObserver(function(entries){
  const e=entries[0];
  place(!e.isIntersecting&&e.boundingClientRect.top<0);
 }).observe(gal);
}
function bindCompact(){
 const slot=document.querySelector('.book-sentinel');
 const box=document.querySelector('.book-box');
 if(!slot||!box||!('IntersectionObserver' in window)) return;
 const wide=window.matchMedia('(min-width:761px)');
 new IntersectionObserver(function(entries){
  const e=entries[0];
  const stuck=wide.matches&&!e.isIntersecting&&e.boundingClientRect.top<0;
  box.classList.toggle('is-stuck', stuck);
 }, {rootMargin:'-72px 0px 0px 0px', threshold:[0]}).observe(slot);
}
const dayStepEl=document.querySelector('.day-step');
if(dayStepEl) dayStepEl.addEventListener('click', function(e){
 const a=e.target.closest('a');
 if(a&&a.getAttribute('aria-disabled')==='true') e.preventDefault();
});
bindBookSheet();
bindBookBar();
bindCompact();
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
  const viewAll = ListingPanel.viewAllLabel(n);
  const viewBtn = viewAll ? `<button type="button" class="view-all">${esc(viewAll)}</button>` : '';
  return `<div class="mob-g"><div class="gallery swipe ${countClass}" aria-label="Photos">${imgs}${credit}${viewBtn}</div><span class="gal-chip">1 / ${n || 0}</span></div>
<dialog class="lightbox" aria-label="Photos"><button type="button" class="lb-close" aria-label="Close">Close</button><button type="button" class="lb-prev" aria-label="Previous photo">‹</button><img alt="${esc(galAlt)}" width="1200" height="900"><button type="button" class="lb-next" aria-label="Next photo">›</button><p class="lb-count" aria-live="polite">1 / ${n || 1}</p></dialog>`;
}

function goodToKnowBand({ policy }) {
  const arrive = `Show your QR code at check-in. ${instantConfirmationText()}`;
  return `<section class="gtk-band" id="before" aria-label="Before you book"><div class="wrap">
<h2 id="gtk">Good to know</h2>
<div class="gtk-cols">
<div><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><path d="M10 10h1.6v1.6H10zM12.6 12.6H14V14h-1.4z"/></svg><h3>What happens when I get there?</h3><p>${esc(arrive)}</p><p><b>Instant confirmation.</b> <a href="/contact">Help when you need it</a>.</p></div>
<div><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v3M16 3.5v3M4 10h16"/><path d="M8.8 15.2l2.1 2.1 4.6-4.8"/></svg><h3>Can I cancel if my plans change?</h3><p>${esc(FREE_CANCEL)} <a href="/refunds">Cancellation and refund policy</a>.</p></div>
</div>
<p class="gtk-more"><a href="#passes">What's included → see Passes</a></p>
<p class="gtk-note">${policy.note}</p>
</div></section>`;
}

const ALERT_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6M12 16.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
function holdAttrs(hold) {
  if (!hold) return '';
  const next = (hold.links || []).map(link => link.date).join(',');
  return ` data-hold="${esc(hold.date)}" data-next="${esc(next)}" aria-invalid="true" aria-describedby="date-alert"`;
}
function dateAlert(hold) {
  if (!hold) return '';
  const links = (hold.links || []).map(link => `<a class="date-alt" href="${esc(link.href)}">${esc(link.label)}</a>`).join('');
  const alts = links
    ? `<div class="date-alts">${links}</div>`
    : `<p class="date-none">${esc(hold.empty)} <a href="${esc(hold.listingHref)}">Back to ${esc(hold.hotelName)}</a></p>`;
  const when = hold.when ? `<b>${esc(hold.when)}</b>` : '';
  return `<div class="date-alert" role="alert" tabindex="-1" id="date-alert" data-date="${esc(hold.date)}">${ALERT_ICON}<div><span>${esc(hold.before)}${when}${esc(hold.after)}</span>${alts}</div></div>`;
}
function listingQty(raw) {
  return ListingPanel.boundQty(raw);
}
function cancelFoldText(know) {
  const text = String(know || '');
  if (/^Free cancellation until .+\(hotel time\)\.$/.test(text)) return text;
  if (text.includes("can't be cancelled for free")) return text;
  return FREE_CANCEL;
}
function listingHtml(opts) {
  const { h, date, minDate, maxDate, closed, passes, av, from, cancel, know, included, addonList, hours, policy, accessByPass, foodLine } = opts;
  const qty = listingQty(opts.qty);
  const items = Array.isArray(included) ? included : [];
  const parkNote = includedNote(items);
  const short = shortName(h);
  const demo = isDemo(h);
  const heading = demo ? `${short} (Demo)` : short;
  const watch = supervisionNote(h);
  const names = passes.map(p => p.name).filter(Boolean);
  const hourRows = Array.isArray(opts.hourRows) ? opts.hourRows : null;
  const meta = hourRows
    ? ListingPanel.titleLine(h.area, hourRows, opts.todayWd)
    : [h.area, names.join(', ')].filter(Boolean).join(' · ');
  const hoursHtml = hourRows ? ListingPanel.hoursTable(hourRows, opts.todayWd) : (hours || '');
  const seat = pickedPass(av, opts.passCode);
  const seatHolds = seat ? (Number(seat.holds) || 1) : 1;
  const offer = opts.offer || null;
  const step = dayStepLinks({ slug: h.slug, date, minDate, maxDate, passCode: opts.passCode, qty });
  step.hours = ListingPanel.dayHours(hourRows, date);
  const dayStep = `<div class="day-step" role="group" aria-label="Day">${stepControl('day-prev', 'Previous day', step.prev, CHEV_L)}<div class="day-step-date"><b id="day-step-label">${esc(step.label)}</b><span class="day-step-hours" id="day-step-hours"${step.hours ? '' : ' hidden'}>${esc(step.hours)}</span></div>${stepControl('day-next', 'Next day', step.next, CHEV_R)}</div>`;
  const sumBits = [];
  if (date) sumBits.push(nice(date));
  if (seat) sumBits.push(seat.name);
  sumBits.push(`${qty} ${qty === 1 ? 'spot' : 'spots'}`);
  const seeLink = offer && offer.href && offer.see
    ? `<a class="day-see" id="day-see" href="${esc(offer.href)}">${esc(offer.see)}</a>`
    : '<a class="day-see" id="day-see" href="#passes" hidden></a>';
  const fromHtml = offer
    ? `<b>${esc(offer.word)}</b> <small>(demo)</small>`
    : `From <b id="from-price">${money(from)}</b> <small>(demo)</small>`;
  const barText = offer
    ? `<span id="bar-text">${esc(offer.bar || offer.word)}</span><span class="price-num" id="bar-price" hidden></span>`
    : `<span id="bar-text">${seat ? `${esc(seat.name)} · ` : 'From '}</span><span class="price-num" id="bar-price">${seat ? money(seat.price) : money(from)}</span>`;
  const barAction = offer && offer.href
    ? `<a class="book-open is-next" id="book-open" href="${esc(offer.href)}">Next day</a>`
    : '<a class="book-open" id="book-open" href="#book" aria-haspopup="dialog" aria-controls="book-sheet">Book</a>';
  const goDis = opts.hold || offer ? ' disabled aria-disabled="true"' : '';
  const goText = offer ? esc(offer.button) : 'Book your day (demo)';
  const place = arrivalInner(h);
  const rows = includedItems(passes, items, accessByPass);
  const incList = rows.length ? `<ul class="inc">${rows.map(text => `<li>${ITEM_ICON}<span>${esc(text)}</span></li>`).join('')}</ul>` : '';
  const towelNote = passes.some(p => ListingPanel.towelFor(items, Number(p.holds) || 1))
    ? '<p class="towel-note">Towels are listed on each pass.</p>'
    : '';
  const parkFold = parkNote ? `<details class="fold" id="parking"><summary>Parking</summary><div class="acc-body"><p>${esc(parkNote)}</p></div></details>` : '';
  const shareUrl = ListingImprove.pageShareUrl(h.slug, {
    date: date || '',
    pass: opts.passCode || '',
    qty: opts.shareQty || '',
    guests: opts.shareGuests || '',
  });
  const age = ListingImprove.ageLabel(h.age_policy);
  const badges = `${demo ? '<span class="demo-pill">Fictional demo listing</span>' : ''}${age ? `<span class="age-pill">${esc(age)}</span>` : ''}`;
  const emptyIncluded = rows.length ? '' : `<p class="inc-empty">${esc(ListingImprove.includedEmptyCopy(false))}</p>`;
  return `<div class="wrap listing">
${galleryHtml(h, demo, short)}
<form action="/checkout" method="get" id="bf" class="l-layout">
<input type="hidden" name="hotel" value="${esc(h.slug)}">
<div class="l-main">
<section class="listing-head" id="overview">
<div class="title-row"><h1 class="l-title">${esc(heading)}</h1>${ListingImprove.shareHtml(shareUrl)}</div>
<p class="muted l-meta">${esc(meta)}</p>
${badges ? `<div class="badges">${badges}</div>` : ''}
${ListingImprove.factsHtml(h)}
${ListingImprove.whyHtml()}
<p class="day-lead" id="overview-desc"><b>${esc(h.tagline)}.</b> ${esc(h.blurb)}</p>
<button type="button" class="read-more" aria-expanded="false" aria-controls="overview-desc">Read more</button>
${watch ? `<p class="guard-note">${esc(watch)}</p>` : ''}
</section>
<div class="l-tabs"><nav aria-label="Sections"><a href="#overview" aria-current="true">Overview</a><a href="#passes">Passes</a><a href="#inclusions">Inclusions</a><a href="#location">Location</a><a href="#policies">Policies</a></nav></div>
<section id="seating" aria-labelledby="seat-h"><div class="seat-head"><h2 class="day-kicker" id="seat-h">Choose your seating</h2><p class="seat-sub">Prices per spot, before add-ons. Pick a date to see what's left.</p></div>
<div id="seat-state" aria-live="polite"></div>
<div id="passes">
${dayStep}
${offerLine(offer)}
${passSection(passes, av, h, date, opts.passCode, qty, items)}
</div>
</section>
${opts.amenitiesHtml || ''}
${ListingImprove.stepsHtml()}
${addonList || ''}
<section id="inclusions"><h2>Inclusions</h2>
<div class="incl">
<div>
<h3 class="sub">What's included</h3>
${incList || emptyIncluded}
${towelNote}
</div>
<div>
${ListingImprove.notIncludedHtml(items)}
</div>
</div>
<div class="two">
${ListingImprove.bringHtml(h)}
${ListingImprove.rulesHtml(h)}
</div>
<div class="hours-season">
<div class="l-acc">
<details id="hours" open><summary>Opening hours</summary><div class="acc-body">${hoursHtml}</div></details>
</div>
</div>
</section>
<section id="location"><h2>Location</h2>
<div class="l-acc">
<details id="getting-there"><summary>Getting there</summary><div class="acc-body">${place.address || ''}${place.there || ''}</div></details>
${parkFold}
</div>
</section>
<section id="policies"><h2>Policies</h2>
<div class="l-acc">
<details id="policy"><summary>Guest policy</summary><div class="acc-body">${policy.body}</div></details>
<details id="cancel-fold"><summary>Cancellation</summary><div class="acc-body"><p>${esc(cancelFoldText(know))} <a href="/refunds">Cancellation and refund policy</a>.</p></div></details>
</div>
</section>
</div>
<div class="book-slot"><div class="book-sentinel" aria-hidden="true"></div><div class="book-col">
<dialog class="book-sheet" id="book-sheet" aria-labelledby="book-sheet-title">
<div class="book-sheet-top"><h2 id="book-sheet-title">Book a pass</h2><button type="button" class="book-sheet-close">Close</button></div>
<aside class="book-box${opts.hold ? ' is-hold' : ''}" id="book" tabindex="-1">
<div class="bb-price" id="bb-price" data-from="${esc(money(from))}">${fromHtml}</div>
<p class="bb-sum" id="bb-sum">${esc(sumBits.join(' · '))}</p>
${dateAlert(opts.hold)}
<p class="bb-label" id="date-label">Date</p>
${opts.hold ? `<div class="date-hold" aria-hidden="true">${esc(opts.hold.longLabel)}</div>` : ''}
<input type="date" class="hdc-date" data-inline="1" data-closed="${esc(closed)}" name="date" id="date" min="${minDate}" max="${maxDate}" value="${esc(date)}" required${holdAttrs(opts.hold)}>
${opts.hold ? '<p class="date-leg"><span><i class="sw open"></i>Open</span><span><i class="sw shut"></i>Closed</span><span><i class="sw today"></i>Today</span></p>' : ''}
<div id="status" class="status${opts.hold ? ' out' : ''}">${opts.hold ? esc(opts.hold.status) : ''}</div>
<label class="fl" for="qty">Spots<select name="qty" id="qty" class="hdc-pick">${SearchQuery.bookingSpots().map(n => `<option value="${n}"${n === qty ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
<p class="spot-eq" id="spot-eq">${peopleLabel(seatHolds)}</p>
<p class="muted small cap-note">Party size is capped at 6.</p>
${chosenBlock(seat)}
<div class="bb-total" id="total" aria-live="polite" aria-atomic="true"></div>
<button class="book-go" id="go" type="submit" data-label="Book your day (demo)"${goDis}>${goText}</button>
${ListingImprove.cancelHtml(cancel)}
${seeLink}
<p class="prompt">You won't be charged. Demo payment only.</p>
</aside>
</dialog>
</div></div>
</form>
</div>
${goodToKnowBand({ policy })}
<div class="book-bar" role="region" aria-label="Book"><div class="book-bar-row"><b id="bar-total" aria-live="polite" aria-atomic="true">${barText} <small>(demo)</small></b>${barAction}</div><p class="book-bar-cancel" id="bar-cancel">${esc(cancel)}</p></div>
${listingScript(h.slug, !MapEmbed.key())}
${DetailsAlias.script()}
<script src="/share.js"></script>`;
}

const ASSURE = [
  {
    icon: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v3M16 3.5v3M4 10h16"/><path d="M8.8 15.2l2.1 2.1 4.6-4.8"/>',
    title: 'Free cancellation',
    text: 'Up to 24 hours before your access hours start.',
  },
  {
    icon: '<circle cx="12" cy="12" r="3.2"/><path d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.5 6.5l1.6 1.6M15.9 15.9l1.6 1.6M17.5 6.5l-1.6 1.6M8.1 15.9l-1.6 1.6"/>',
    title: 'No room needed',
    text: '',
  },
  {
    icon: '<path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><path d="M10 10h1.6v1.6H10zM12.6 12.6H14V14h-1.4z"/>',
    title: 'Show your QR code at the desk',
    text: '',
  },
  {
    icon: '<path d="M7.2 8.2A5.2 5.2 0 1 1 6 13"/><path d="M5.2 5.4V9H9"/>',
    title: 'If the pool closes',
    text: 'You choose a full refund or a free rebooking.',
  },
  {
    icon: '<path d="M4 7.5h16v10H4z"/><path d="M4 8l8 6 8-6"/>',
    title: 'Help when you need it',
    text: 'Questions? Email us.',
    href: '/contact',
  },
];

function reassureStrip(lite) {
  const items = ASSURE.map(item => {
    const inner = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><b>${item.title}</b>${item.text ? `<span>${item.text}</span>` : ''}`;
    return item.href
      ? `<li><a class="assure-link" href="${item.href}">${inner}</a></li>`
      : `<li>${inner}</li>`;
  }).join('');
  return `<section class="assure${lite ? ' assure-lite' : ''}" aria-label="Before you book"><ul>${items}</ul></section>`;
}

class DetailsAlias {
  static replacement(hash) {
    return hash === '#details' ? '#inclusions' : '';
  }

  static script() {
    return `<script>(function(){function go(){if(location.hash!=='#details')return;var el=document.getElementById('inclusions');if(!el)return;var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;el.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});history.replaceState(null,'',location.pathname+location.search+'#inclusions');}addEventListener('hashchange',go);go();})();</script>`;
  }
}

module.exports = { listingHtml, reassureStrip, ListingPanel, dayStepLinks, DetailsAlias };
