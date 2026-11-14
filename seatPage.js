const { esc, money } = require('./util');
const { safePhoto, FOOD_RULE } = require('./offering');
const { seatPhoto, amenityLines } = require('./inclusions');
const { ListingPanel } = require('./listingView');
const { SearchQuery } = require('./search');
const { accessDetail } = require('./access');
const { demoSite } = require('./siteMode');

const BOOKING_INSIDE = "This booking is inside 24 hours of the start, so it can't be cancelled for free.";
const DATE_INSIDE = "This date starts within 24 hours, so a booking can't be cancelled for free.";
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SOLD = 'Sold out on this date. Try another date. This seat is still shown so you can compare.';

class SeatPage {
  static dayLabel(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
    return `${WEEK[dt.getDay()]} ${d} ${MONTH[m - 1]}`;
  }

  static cancelCopy(note) {
    const text = String(note || '');
    if (text === BOOKING_INSIDE) return DATE_INSIDE;
    return text;
  }

  static qty(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > SearchQuery.BOOKING_SPOTS) return 1;
    return n;
  }

  static photoSrc(pass) {
    const file = safePhoto(String((pass && pass.photo) || ''));
    if (file) return `/assets/photos/${file}`;
    return seatPhoto((pass && pass.kind) || 'custom');
  }

  static seatWord(pass) {
    return String((pass && pass.name) || 'seat').trim().toLowerCase() || 'seat';
  }

  static isDemo(hotel) {
    return Number(hotel && hotel.is_demo) === 1;
  }

  static altText(pass, hotel) {
    const seat = SeatPage.seatWord(pass);
    if (SeatPage.isDemo(hotel)) return `Example photo of a ${seat} (demo)`;
    const place = String((hotel && hotel.name) || '').replace(/\s*\(Demo\)\s*$/i, '').trim() || 'the hotel';
    return `Photo of the ${seat} at ${place}`;
  }

  static listingHref(slug, date, qty) {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    params.set('qty', String(SeatPage.qty(qty)));
    return `/h/${encodeURIComponent(slug)}?${params.toString()}#seating`;
  }

  static state({ date, row, qty, hotelName }) {
    const q = SeatPage.qty(qty);
    if (!date || !row) {
      return { kind: 'pick', canBook: false, text: 'Pick a date', button: 'Continue to booking', qty: q };
    }
    const when = SeatPage.dayLabel(date);
    if (row.blocked) {
      const text = /same-day|closed for today/i.test(row.blocked)
        ? `${row.blocked}.`
        : `${hotelName} is closed on ${when} (${row.blocked}).`;
      return { kind: 'closed', canBook: false, text, button: 'Closed on this date', when, qty: q, left: 0 };
    }
    const left = Math.max(0, Number(row.remaining) || 0);
    if (left < 1) {
      return { kind: 'sold', canBook: false, text: SOLD, button: 'Sold out on this date', when, qty: q, left };
    }
    if (left < q) {
      return {
        kind: 'short',
        canBook: false,
        text: `${left} left on ${when}`,
        button: `Only ${left} left on this date`,
        when,
        qty: q,
        left,
      };
    }
    return {
      kind: 'open',
      canBook: true,
      text: `${left} left on ${when}`,
      button: 'Continue to booking',
      when,
      qty: q,
      left,
    };
  }

  static availHtml(state) {
    if (state.kind === 'sold') {
      return '<b>Sold out on this date.</b> Try another date. This seat is still shown so you can compare.';
    }
    return esc(state.text);
  }

  static totalLabel(state, amount) {
    if (state.canBook) return `${money(amount)} (demo)`;
    if (state.kind === 'sold') return 'Sold out';
    if (state.kind === 'closed') return 'Closed';
    if (state.kind === 'short') return `Only ${state.left} left`;
    return 'Pick a date';
  }

  static barWhen(state) {
    if (state.kind === 'pick') return 'Pick a date';
    if (state.kind === 'sold') return 'Sold out on this date';
    if (state.kind === 'closed') return 'Closed on this date';
    const spots = state.qty === 1 ? '1 spot' : `${state.qty} spots`;
    return `${state.when} · ${spots}`;
  }

  static barLink(state) {
    if (state.kind === 'sold' || state.kind === 'closed') return { label: 'Change date', alt: true };
    if (state.kind === 'short') return { label: 'Change spots', alt: true };
    return { label: 'Continue to booking', alt: false };
  }

  static description(pass, hotel) {
    const seat = String(pass.name || 'Seat').trim();
    const place = String(hotel.name || '').replace(/\s*\(Demo\)\s*$/i, '').trim();
    const area = String(hotel.area || '').trim();
    if (SeatPage.isDemo(hotel)) {
      return `${seat} at ${place}, a fictional example in ${area}. Example photo. No real booking is taken on this demo.`;
    }
    const about = String(pass.description || '').trim();
    return [`${seat} at ${place} in ${area}, Australia.`, about].filter(Boolean).join(' ');
  }

  static html(opts) {
    const { hotel, pass, date, qty, row, items, areas, cancel, minDate, maxDate, closed } = opts;
    const demo = SeatPage.isDemo(hotel);
    const holds = Math.max(1, Number(pass.holds) || 1);
    const price = Number(pass.price) || 0;
    const q = SeatPage.qty(qty);
    const status = SeatPage.state({ date, row, qty: q, hotelName: hotel.name });
    const back = SeatPage.listingHref(hotel.slug, date, q);
    const photo = SeatPage.photoSrc(pass);
    const alt = SeatPage.altText(pass, hotel);
    const caption = demo ? '<span class="seat-cap">Example photo (demo)</span>' : '';
    const amenity = amenityLines(items, holds, areas);
    const towel = amenity.find(line => /towel/i.test(line.name || ''));
    const lines = amenity.filter(line => !/towel/i.test(line.name || ''));
    const included = lines.length
      ? `<ul class="pass-inc-list seat-inc">${lines.map(line => `<li>${esc(line.text)}</li>`).join('')}</ul>`
      : '';
    const towelHtml = towel ? `<p class="seat-towels">${esc(ListingPanel.towelText(towel.qty))}</p>` : '';
    const access = accessDetail(areas, { demo, compact: true });
    const guest = holds === 1 ? 'guest' : 'guests';
    const amount = price * q;
    const line = `${money(price)} × ${q}`;
    const sum = SeatPage.totalLabel(status, amount);
    const demoNote = demo || demoSite() ? ' <span class="muted">(demo)</span>' : '';
    const chip = `From ${money(price)} per spot${demo ? ' (demo)' : ''}`;
    const desc = String(pass.description || '').trim();
    const bar = SeatPage.barLink(status);
    const checkAction = `/h/${encodeURIComponent(hotel.slug)}/seat/${encodeURIComponent(pass.code)}`;
    const goDisabled = status.canBook ? '' : ' disabled';
    return `<div class="wrap seat-page">
<a class="seat-back" href="${esc(back)}"><span aria-hidden="true">←</span> Back to ${esc(hotel.name)}</a>
<div class="seat-grid">
<div class="seat-main">
<div class="seat-photo"><img src="${esc(photo)}" alt="${esc(alt)}" width="1280" height="720">${caption}</div>
<h1>${esc(pass.name)}</h1>
<p class="seat-where">${esc(hotel.name)}${hotel.area ? ` · ${esc(hotel.area)}` : ''}</p>
<div class="seat-facts"><span>Fits ${holds}</span><span>${esc(chip)}</span></div>
${desc ? `<p class="seat-desc">${esc(desc)}</p>` : ''}
<h2>What's included</h2>
${towelHtml}
${included}
${access}
${opts.amenitiesHtml || ''}
<p class="seat-food">${esc(FOOD_RULE)}</p>
<h2>Cancellation</h2>
<p class="seat-cancel" id="seat-cancel"><span id="seat-cancel-text">${esc(SeatPage.cancelCopy(cancel))}</span> <a href="/refunds">Cancellation and refund policy</a></p>
</div>
<form class="seat-book" id="book" method="get" action="/checkout" aria-labelledby="seat-book-title" data-price="${price}" data-holds="${holds}" data-slug="${esc(hotel.slug)}" data-code="${esc(pass.code)}" data-hotel="${esc(hotel.name)}">
<h2 id="seat-book-title">Book this seat</h2>
<input type="hidden" name="hotel" value="${esc(hotel.slug)}">
<input type="hidden" name="pass" value="${esc(pass.code)}">
<p class="seat-rate"><b>${money(price)}</b> per spot${demoNote}</p>
<label for="seat-date">Date
<input type="date" class="hdc-date" id="seat-date" name="date" min="${esc(minDate)}" max="${esc(maxDate)}" data-closed="${esc(closed || '')}" value="${esc(date || '')}" required>
</label>
<p class="seat-avl${status.kind === 'sold' || status.kind === 'closed' ? ' is-bad' : ''}" id="avl" aria-live="polite">${SeatPage.availHtml(status)}</p>
<label for="seat-qty">Spots
<select class="hdc-pick" id="seat-qty" name="qty">${SearchQuery.bookingSpots().map(n => `<option value="${n}"${n === q ? ' selected' : ''}>${n}</option>`).join('')}</select>
</label>
<p class="seat-eq">1 spot = ${holds} ${guest}</p>
<p class="seat-cap-note">Party size is capped at 6.</p>
<div class="seat-total"><span id="seat-line">${esc(line)}</span><b id="seat-sum">${esc(sum)}</b></div>
<button class="seat-go" id="seat-go" type="submit"${goDisabled}>${esc(status.button)}</button>
<button class="seat-check" type="submit" formaction="${esc(checkAction)}">Check</button>
<p class="seat-demo-note">You won't be charged. Demo payment only.</p>
<a class="seat-all" href="${esc(back)}">View all seating at ${esc(hotel.name)} →</a>
</form>
</div>
</div>
<div class="seat-bar" id="seat-bar">
<span class="seat-bar-copy"><b id="seat-bar-price">${money(price)}</b>${demo ? ' <span class="muted">(demo)</span>' : ''}<span class="seat-bar-when" id="seat-bar-when">${esc(SeatPage.barWhen(status))}</span></span>
<a id="seat-bar-go" href="#book"${bar.alt ? ' class="is-alt"' : ''}>${esc(bar.label)}</a>
</div>
${SeatPage.script()}`;
  }

  static script() {
    return `<script>
(function(){
var form=document.getElementById('book');
if(!form) return;
var price=+form.getAttribute('data-price')||0;
var slug=form.getAttribute('data-slug')||'';
var code=form.getAttribute('data-code')||'';
var hotelName=form.getAttribute('data-hotel')||'';
var dateInput=form.querySelector('input[name="date"]');
var qtyInput=form.querySelector('select[name="qty"]');
var avl=document.getElementById('avl');
var go=document.getElementById('seat-go');
var line=document.getElementById('seat-line');
var sum=document.getElementById('seat-sum');
var barWhen=document.getElementById('seat-bar-when');
var barGo=document.getElementById('seat-bar-go');
var cancelText=document.getElementById('seat-cancel-text');
var WEEK=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MONTH=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function money(n){return '$'+Number(n).toLocaleString('en-AU')}
function dayLabel(iso){
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(iso||'')) return '';
  var p=iso.split('-').map(Number);
  var dt=new Date(p[0],p[1]-1,p[2]);
  return WEEK[dt.getDay()]+' '+p[2]+' '+MONTH[p[1]-1];
}
function spots(){
  var n=qtyInput?parseInt(qtyInput.value,10):1;
  return n>=1&&n<=6?n:1;
}
function paint(state){
  if(!avl||!go) return;
  avl.className='seat-avl'+(state.kind==='sold'||state.kind==='closed'?' is-bad':'');
  avl.textContent='';
  if(state.kind==='sold'){
    var b=document.createElement('b');
    b.textContent='Sold out on this date.';
    avl.appendChild(b);
    avl.appendChild(document.createTextNode(' Try another date. This seat is still shown so you can compare.'));
  } else avl.textContent=state.text;
  go.disabled=!state.canBook;
  go.textContent=state.button;
  var q=state.qty;
  if(line) line.textContent=money(price)+' × '+q;
  if(sum){
    if(state.canBook) sum.textContent=money(price*q)+' (demo)';
    else if(state.kind==='sold') sum.textContent='Sold out';
    else if(state.kind==='closed') sum.textContent='Closed';
    else if(state.kind==='short') sum.textContent='Only '+state.left+' left';
    else sum.textContent='Pick a date';
  }
  if(barWhen){
    if(state.kind==='pick') barWhen.textContent='Pick a date';
    else if(state.kind==='sold') barWhen.textContent='Sold out on this date';
    else if(state.kind==='closed') barWhen.textContent='Closed on this date';
    else barWhen.textContent=state.when+' · '+(q===1?'1 spot':q+' spots');
  }
  if(barGo){
    var alt=state.kind==='sold'||state.kind==='closed'||state.kind==='short';
    barGo.textContent=state.kind==='sold'||state.kind==='closed'?'Change date':(state.kind==='short'?'Change spots':'Continue to booking');
    barGo.classList.toggle('is-alt', alt);
  }
}
function seatCancel(note){
  var old="This booking is inside 24 hours of the start, so it can't be cancelled for free.";
  if(note===old) return "This date starts within 24 hours, so a booking can't be cancelled for free.";
  return note||'';
}
function fromRow(date, row, cancel){
  var q=spots();
  var lineNote=seatCancel(cancel);
  if(!date||!row){
    paint({kind:'pick', canBook:false, text:'Pick a date', button:'Continue to booking', qty:q});
    if(cancelText) cancelText.textContent=lineNote||'Pick a date to see your free-cancellation deadline.';
    return;
  }
  var when=dayLabel(date);
  if(row.blocked){
    var closed=/same-day|closed for today/i.test(row.blocked)?row.blocked+'.':hotelName+' is closed on '+when+' ('+row.blocked+').';
    paint({kind:'closed', canBook:false, text:closed, button:'Closed on this date', when:when, qty:q, left:0});
  } else {
    var left=Math.max(0, +row.remaining||0);
    if(left<1) paint({kind:'sold', canBook:false, text:'', button:'Sold out on this date', when:when, qty:q, left:0});
    else if(left<q) paint({kind:'short', canBook:false, text:left+' left on '+when, button:'Only '+left+' left on this date', when:when, qty:q, left:left});
    else paint({kind:'open', canBook:true, text:left+' left on '+when, button:'Continue to booking', when:when, qty:q, left:left});
  }
  if(cancelText) cancelText.textContent=lineNote;
}
function apply(data){
  var date=dateInput?dateInput.value:'';
  var row=(data.passes||[]).find(function(p){return p.code===code});
  fromRow(date, row||null, data.cancel||'');
}
async function load(){
  var date=dateInput?dateInput.value:'';
  if(!date){
    fromRow('', null, 'Pick a date to see your free-cancellation deadline.');
    return;
  }
  try{
    var r=await fetch('/api/availability?hotel='+encodeURIComponent(slug)+'&date='+encodeURIComponent(date));
    if(!r.ok) throw new Error('status');
    apply(await r.json());
  }catch(err){
    if(avl) avl.textContent="We couldn't check availability. Try again.";
    if(go){ go.disabled=true; go.textContent='Continue to booking'; }
  }
}
if(dateInput) dateInput.addEventListener('change', load);
if(qtyInput) qtyInput.addEventListener('change', function(){
  if(dateInput && dateInput.value) load();
  else if(line) line.textContent=money(price)+' × '+spots();
});
})();
</script>`;
  }
}

module.exports = { SeatPage };
