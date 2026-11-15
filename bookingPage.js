const { esc, money, nice } = require('./util');
const { ShortCode } = require('./shortCode');
const { CheckoutFlow } = require('./checkout');
const { HotelClock, hotelZone } = require('./calendar');
const { swimNote, displayCancelNote, arrivalText, guardFacts, GuestCheckIn, FOOD_RULE } = require('./offering');
const { MapEmbed } = require('./mapEmbed');
const { demoSite, operatorEmail, confirmationBlurb } = require('./siteMode');
const seo = require('./seo');

const TICK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function photoHtml(b) {
  let file = '';
  try {
    const photos = JSON.parse(b.photos || '[]');
    file = Array.isArray(photos) ? (photos[0] || '') : '';
  } catch {
    file = '';
  }
  if (!file) return '';
  const alt = /\(Demo\)/.test(b.hotel) ? 'Stock photo, not this hotel' : 'Photo of ' + seo.shortName(b.hotel);
  return `<img class="tk-img" src="/assets/photos/${esc(file)}" alt="${esc(alt)}" width="72" height="72">`;
}

function consentStamp(b, hotel) {
  const raw = b.consent_at || b.terms_ack_at || b.rules_ack_at || b.risk_ack_at || '';
  const instant = HotelClock.parse(raw);
  if (!instant) return '';
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: hotelZone(hotel || {}),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(instant);
  const date = `${HotelClock.part(parts, 'day')} ${HotelClock.part(parts, 'month')} ${HotelClock.part(parts, 'year')}`;
  const time = HotelClock.clock(hotel || {}, instant);
  if (!date.trim() || !time) return '';
  return `${date}, ${time}`;
}

function ackHtml(b, hotel) {
  const when = consentStamp(b, hotel);
  if (!when) return '';
  return `<p>${esc(`Terms, Cancellation & Refund Policy, hotel rules and risk warning: accepted at checkout ${when}.`)}</p>`;
}

const NAV_ICON = '<svg class="ti" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l8 18-8-4-8 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const COPY_ICON = '<svg class="ti" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CAL_ICON = '<svg class="ti" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CHECK_ICON = '<svg class="ti" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON = '<svg class="ti" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LATE_RE = /can't be cancelled for free/;

class TicketView {
  static dayLabel(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return `${WEEK[wd]} ${Number(m[3])} ${MONTH[Number(m[2]) - 1]}`;
  }

  static addonName(a) {
    return Number(a.qty) > 1 ? `${a.name} \u00d7 ${a.qty}` : String(a.name);
  }

  static addonPrice(a, demo) {
    return demo ? `${money(a.total)} (demo)` : money(a.total);
  }

  static towelChip(lines) {
    const towel = (lines || []).find(line => /towel/i.test(line.name || ''));
    const qty = towel ? Math.max(0, Number(towel.qty) || 0) : 0;
    return qty ? `Towels: ${qty} provided` : '';
  }

  static bringChips(hotel, lines) {
    const chips = [];
    if (Number(hotel && hotel.id_required) === 1) chips.push({ text: 'Photo ID', on: false });
    chips.push({ text: 'Swimwear', on: false }, { text: 'Sunscreen and hat', on: false });
    const towel = TicketView.towelChip(lines);
    if (towel) chips.push({ text: towel, on: true });
    return chips;
  }

  static safetyLine(hotel) {
    const { childrenAllowed } = require('./offering');
    const swim = guardFacts(hotel || {}).swim;
    const extra = childrenAllowed(hotel) ? ' Supervise children at all times.' : '';
    return `Safety and your details: ${swim}${extra}`;
  }

  static isLate(note) {
    return LATE_RE.test(String(note || ''));
  }
}

function hotelRow(b, v) {
  const dirs = MapEmbed.directionsUrl(v.hotel || {}) || v.mapHref || '';
  const link = dirs && !(v.b.status === 'cancelled')
    ? `<a class="tk-dir" href="${esc(dirs)}" target="_blank" rel="noopener">${NAV_ICON}Directions</a>`
    : '';
  const area = `${b.area}, Australia`;
  return `<div class="tk-hot">${photoHtml(b)}<div><b>${esc(b.hotel)}</b><span>${esc(area)}</span></div>${link}</div>`;
}

function bookingPageBody(v) {
  const b = v.b;
  const hotel = v.hotel || {};
  const cancelled = b.status === 'cancelled';
  const demo = demoSite() || Number(hotel.is_demo) === 1;
  const heading = cancelled
    ? 'This demo booking is cancelled.'
    : (demoSite() ? 'Your demo booking' : "You're booked in.");
  const chip = cancelled ? 'Cancelled' : (b.checked_in_at && v.status ? v.status : 'Confirmed');
  const passText = `${b.pass}${Number(b.qty) > 1 ? ` \u00d7 ${b.qty}` : ''}`;
  const facts = [
    ['Date', TicketView.dayLabel(b.date)],
    ['Access', v.when || ''],
    ['Pass', passText],
    ['Guests', String(v.party)],
  ].filter(row => row[1]);
  const arrival = arrivalText(b.expected_arrival, 'estimate');
  const adds = (v.adds || []).length
    ? `<ul class="tk-adds" aria-label="Add-ons"><li class="h">Add-ons</li>${v.adds.map(a => `<li><span>${esc(TicketView.addonName(a))}</span><b>${esc(TicketView.addonPrice(a, demo))}</b></li>`).join('')}</ul>`
    : '';
  const shownCode = v.shownCode || b.short_code || b.code;
  const stub = cancelled
    ? `<div class="tk-off">This booking is cancelled, so the QR code is no longer shown and it won't check you in.</div><p class="tk-ref">Booking ref<b id="tk-code">${esc(shownCode)}</b></p>`
    : `${demo ? '<span class="ex">Example QR (demo)</span>' : ''}<div class="tk-qrbox"><img class="qr" src="${v.qr}" alt="QR code for booking ${esc(b.code)}" width="160" height="160"></div>
<p class="tk-ref">Booking ref<b id="tk-code">${esc(shownCode)}</b></p>
<button class="tk-copy js-only" type="button" data-copy="${esc(shownCode)}" aria-describedby="tk-code">${COPY_ICON}Copy booking ref</button>
<span class="tk-copied" role="status"></span>`;
  const ticket = `<article class="tk-ticket" aria-label="Booking ticket">
<div class="tk-top">
${hotelRow(b, v)}
<dl class="tk-facts">${facts.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl>
${arrival ? `<p class="tk-arr">Expected arrival: ${esc(arrival)}</p>` : ''}
${adds}
</div>
<div class="tk-perf" aria-hidden="true"><i></i><i></i></div>
<div class="tk-stub">${stub}</div>
</article>`;
  const action = cancelled ? '' : `<a class="tk-btn" href="/booking/${encodeURIComponent(b.code)}/calendar.ics">${CAL_ICON}Add to calendar</a>`;
  const bring = cancelled ? '' : `<section class="tk-bring" aria-labelledby="tk-bring-h"><h2 id="tk-bring-h">What to bring</h2><ul class="tk-chips">${TicketView.bringChips(hotel, v.lines).map(c => `<li class="tk-chip${c.on ? ' inc' : ''}">${CHECK_ICON}${esc(c.text)}</li>`).join('')}</ul><p class="tk-food">${esc(FOOD_RULE)}</p></section>`;
  const food = cancelled ? `<p class="tk-food">${esc(FOOD_RULE)}</p>` : '';
  const note = cancelled ? 'This demo booking is cancelled.' : displayCancelNote(v.note);
  const late = !cancelled && TicketView.isLate(note);
  const manage = cancelled
    ? ''
    : `<details class="tk-manage" id="manage"><summary>Manage or cancel${CHEVRON}</summary>${v.mayCancel
      ? `<form method="post" action="/booking/${encodeURIComponent(b.code)}/cancel"><button class="tk-btn tk-cancel" type="submit">Cancel this demo booking</button></form>`
      : '<p>This booking can no longer be cancelled here.</p>'}<p><a href="/refunds">Cancellation and refunds</a></p></details>`;
  const contact = esc(operatorEmail());
  const parking = !cancelled && v.parkingHtml ? `<details class="tk-dd"><summary><span>Parking</span>${CHEVRON}</summary>${v.parkingHtml}</details>` : '';
  const when = consentStamp(b, hotel);
  const consent = when ? `<p>${esc(`Terms, Cancellation & Refund Policy, hotel rules and risk warning: accepted at checkout ${when}.`)}</p>` : '';
  const rows = `<details class="tk-dd"><summary><span>At reception</span>${CHEVRON}</summary><p>${esc(GuestCheckIn.line())}</p></details>
<details class="tk-dd"><summary><span>${esc(TicketView.safetyLine(hotel))}</span>${CHEVRON}</summary>
<p>${esc(swimNote(hotel))}</p>
<p>We share your name, email, mobile and booking details with ${esc(b.hotel)} so it can check you in and contact you about this booking.</p>
${consent}
<p class="tk-links"><a href="/privacy">Privacy policy</a> · <a href="/terms">Customer terms</a> · <a href="/risk">Risk warning</a></p>
<p>Questions: <a href="mailto:${contact}">${contact}</a></p>
</details>${parking}`;
  return `<div class="tk">
<div class="tk-st" role="status" aria-live="polite"><div class="tk-mk" aria-hidden="true">${cancelled ? CROSS : TICK}</div><h1>${esc(heading)}</h1><span class="tk-ok${cancelled ? ' is-off' : ''}">${chip}</span></div>
${ticket}
<div class="tk-row2">${action ? `<div class="tk-act">${action}</div>` : ''}${bring}</div>
${food}
<section class="tk-more">
<p class="tk-cx${late ? ' late' : ''}">${esc(note)}</p>
${manage}
<p class="tk-dm">Demo: nothing is charged or refunded.</p>
${cancelled ? '' : `<p class="tk-dm">${esc(confirmationBlurb())}</p>`}
${rows}
</section>
<p class="tk-foot"><a href="/">Book another day</a></p>
</div>
<script>
${CheckoutFlow.clearFunction()}
clearCheckoutMemory();
(function(){
  document.querySelectorAll('[data-copy]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var out = btn.parentElement.querySelector('.tk-copied');
      var text = btn.getAttribute('data-copy') || '';
      var done = function(){
        if (!out) return;
        out.textContent = 'Copied';
        clearTimeout(out._hide);
        out._hide = setTimeout(function(){ out.textContent = ''; }, 3000);
      };
      var fail = function(){ if (out) out.textContent = 'Select the code above to copy it'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
      else fail();
    });
  });
  var manage = document.getElementById('manage');
  function openManage(){ if (manage && location.hash === '#manage') manage.open = true; }
  window.addEventListener('hashchange', openManage);
  openManage();
})();
</script>`;
}

function bookingMissingBody(email) {
  const safe = esc(email || operatorEmail());
  return `<div class="wrap bk bk-miss"><h1>We can't find that booking</h1>
<p class="bk-blurb">Check the booking code in your confirmation email. Codes look like ${esc(ShortCode.example())}.</p>
<div class="bk-card"><p>Still stuck? Email <a href="mailto:${safe}">${safe}</a> with your name and booking date.</p></div>
<div class="bk-foot"><a class="btn btn-pri" href="/">Home</a><a class="btn btn-line" href="/faq">FAQ</a></div></div>`;
}

module.exports = { bookingPageBody, bookingMissingBody, TicketView };
