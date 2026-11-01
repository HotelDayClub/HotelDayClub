const { esc, money, nice } = require('./util');
const { spotLabel, swimNote, displayCancelNote } = require('./offering');
const { demoSite, operatorEmail, confirmationBlurb } = require('./siteMode');
const { PASS_FOOD_LINE } = require('./inclusions');
const { accessLine } = require('./access');
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
  return `<img src="/assets/photos/${esc(file)}" alt="${esc(alt)}" width="96" height="72">`;
}

function buyLine(areas) {
  return (areas || []).filter(area => Number(area.serves_food)).map(area => accessLine(area)).filter(Boolean).join('; ');
}

function includedHtml(lines, areas) {
  const items = (lines || []).map(line => `<li class="bk-y">${esc(line.text)}</li>`).join('');
  const names = (areas || []).filter(area => !Number(area.serves_food)).map(area => String(area.name || '').trim()).filter(Boolean);
  const access = names.length ? `<li class="bk-y">Included access: ${esc(names.join(', '))}</li>` : '';
  const buy = buyLine(areas);
  const buyRow = buy ? `<p class="bk-buy">On site to buy (not included): ${esc(buy)}</p>` : '';
  return `<ul class="bk-inc">${items}${access}<li class="bk-n">${esc(PASS_FOOD_LINE)}</li></ul>${buyRow}`;
}

function towelBring(lines) {
  const towel = (lines || []).find(line => /towel/i.test(line.name) || /towel/i.test(line.text));
  const items = ['Photo ID when the hotel asks for it', 'Swimwear and sunscreen'];
  if (towel) items.push(`Towels are included (${towel.text})`);
  return `<ul class="bk-bring">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function ackHtml(b) {
  const row = (label, on) => `<dt>${label}</dt><dd>${on ? 'Accepted' : '—'}</dd>`;
  const rows = `<dl class="bk-facts">${row('Rules', b.rules_ack_at)}${row('Terms', b.terms_ack_at)}${row('Risk warning', b.risk_ack_at)}</dl>`;
  if (b.rules_ack_at && b.terms_ack_at && b.risk_ack_at) {
    return `<p>Pool rules, customer terms and risk warning: accepted at checkout.</p>${rows}`;
  }
  return rows;
}

function gettingThere(hotel, cancelled, parkingHtml, mapHref) {
  if (cancelled || !hotel) return '';
  const day = String(hotel.day_entrance || '').trim();
  const transit = String(hotel.transit_note || '').trim();
  if (!day && !transit && !parkingHtml && !mapHref) return '';
  const rows = [
    day ? `<dt>Day guest entrance</dt><dd>${esc(day)}</dd>` : '',
    transit ? `<dt>Train or bus</dt><dd>${esc(transit)}</dd>` : '',
  ].join('');
  const demo = Number(hotel.is_demo) === 1 || /\(Demo\)/.test(hotel.name || '');
  const note = demo ? '<p class="bk-note">This is a fictional demo address.</p>' : '';
  const dirs = mapHref ? `<div class="bk-acts"><a class="btn btn-line" href="${esc(mapHref)}">Directions</a></div>` : '';
  return `<section class="bk-card" aria-labelledby="bk-go"><h2 id="bk-go">Getting there</h2>${rows ? `<dl class="bk-facts">${rows}</dl>` : ''}${parkingHtml || ''}${note}${dirs}</section>`;
}

function bookingPageBody(v) {
  const b = v.b;
  const cancelled = b.status === 'cancelled';
  const pass = `${spotLabel({ name: b.pass, holds: b.holds })} × ${b.qty}`;
  const heading = cancelled
    ? 'This demo booking is cancelled.'
    : (demoSite() ? 'Your demo booking' : "You're booked in.");
  const chip = cancelled ? 'Cancelled' : 'Confirmed';
  const dateLine = `${nice(b.date)}${v.when ? ` · ${v.when}` : ''}`;
  const emailRow = v.shownEmail ? `<dt>Email</dt><dd>${esc(v.shownEmail)}</dd>` : '';
  const addons = v.adds && v.adds.length
    ? `<section class="bk-card" aria-labelledby="bk-add"><h2 id="bk-add">Add-ons</h2><ul class="bk-adds">${v.adds.map(a => `<li><span>${esc(a.name)} × ${a.qty}</span><b>${money(a.total)}</b></li>`).join('')}</ul></section>`
    : '';
  const next = cancelled ? '' : `<section class="bk-card" aria-labelledby="bk-next"><h2 id="bk-next">What happens next</h2>
<ol class="bk-steps">
<li><span><b>Bring</b> photo ID when the hotel asks for it, swimwear and sunscreen.</span></li>
<li><span><b>Arrive</b> any time in the access hours${v.when ? ` (${esc(v.when)})` : ''}.</span></li>
<li><span><b>Show</b> the QR code or booking code at reception. Reception checks you in.</span></li>
</ol>
<div class="bk-acts"><a class="btn btn-pri" href="/booking/${encodeURIComponent(b.code)}/calendar.ics">Add to calendar</a>${v.googleCal ? `<a class="btn btn-line" href="${esc(v.googleCal)}" target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>` : ''}</div>
</section>
<section class="bk-card" aria-labelledby="bk-bring"><h2 id="bk-bring">What to bring</h2>${towelBring(v.lines)}</section>`;
  const cancelForm = v.mayCancel
    ? `<form method="post" action="/booking/${encodeURIComponent(b.code)}/cancel" class="bk-cancel-form"><button class="btn btn-rose" type="submit">Cancel this demo booking</button></form><p class="bk-muted">No payment was taken. Cancelling marks this demo booking refunded. Nothing is returned to a card.</p>`
    : '';
  const qrBlock = cancelled
    ? '<div class="bk-qr-off">This booking is cancelled, so the QR code is no longer shown and it won\'t check you in.</div>'
    : `<img class="qr" src="${v.qr}" alt="QR code for booking ${esc(b.code)}" width="220" height="220">`;
  const contact = esc(operatorEmail());
  return `<div class="wrap bk">
<div class="bk-status" role="status" aria-live="polite">
<div class="bk-mark" aria-hidden="true">${cancelled ? CROSS : TICK}</div>
<div>
<h1>${esc(heading)}</h1>
<p class="bk-sum">${esc(nice(b.date))} · ${esc(pass)} · ${v.party} guests <span class="bk-chip ${cancelled ? 'is-off' : 'is-ok'}">${chip}</span></p>
<p class="bk-blurb">${esc(confirmationBlurb())}</p>
</div>
</div>
<div class="bk-grid">
<aside class="bk-qr" aria-labelledby="bk-qr-h">
<h2 id="bk-qr-h">${cancelled ? 'Booking code' : 'Show this at reception'}</h2>
${cancelled ? '' : '<p class="bk-how">Reception scans the QR code or types the booking code.</p>'}
${qrBlock}
<p class="bk-code-lbl" id="bk-code-lbl">Booking code</p>
<p class="bk-code" aria-describedby="bk-code-lbl">${esc(b.code)}</p>
<button class="btn btn-line js-only" type="button" data-copy="${esc(b.code)}">Copy booking code</button>
<p class="bk-copied" aria-live="polite"></p>
</aside>
<div class="bk-cards">
<section class="bk-card" aria-labelledby="bk-pass"><h2 id="bk-pass">Your pass</h2>
<div class="bk-hotel">${photoHtml(b)}<div><b>${esc(b.hotel)}</b><span>${esc(b.area)}, Australia</span></div></div>
<dl class="bk-facts">
<dt>Date</dt><dd>${esc(dateLine)}</dd>
<dt>Pass</dt><dd>${esc(pass)}</dd>
<dt>Guests</dt><dd>${v.party}</dd>
<dt>Guest</dt><dd>${esc(v.shownName)}</dd>
${emailRow}
<dt>Paid</dt><dd>${money(b.total)} <span class="bk-muted">(demo, no charge)</span></dd>
<dt>Status</dt><dd>${esc(v.status)}</dd>
</dl>
</section>
${addons}
<section class="bk-card" aria-labelledby="bk-inc"><h2 id="bk-inc">What's included</h2>
${includedHtml(v.lines, v.areas)}
<p class="bk-swim">${esc(swimNote(v.hotel || {}))}</p>
</section>
${next}
${gettingThere(v.hotel, cancelled, v.parkingHtml, v.mapHref)}
<section class="bk-card bk-cancel" aria-labelledby="bk-cx"><h2 id="bk-cx">Cancellation</h2>
<p><b>${esc(displayCancelNote(v.note))}</b></p>
${cancelForm}
<p><a href="/refunds">Cancellation and refunds (draft)</a></p>
</section>
<section class="bk-card bk-legal" aria-labelledby="bk-lg"><h2 id="bk-lg">Your details and the hotel</h2>
<p>We share your name, booking code, party size and add-ons with ${esc(b.hotel)} so it can prepare for and check you in.</p>
${ackHtml(b)}
<p><a href="/privacy">Privacy policy (draft)</a> · <a href="/terms">Customer terms (draft)</a> · <a href="/risk">Risk warning (draft)</a></p>
<p>Questions: <a href="mailto:${contact}">${contact}</a></p>
</section>
<div class="bk-foot"><button class="btn btn-line js-only" type="button" data-print>Print or save as PDF</button><a class="btn btn-line" href="/">Book another day</a></div>
</div>
</div>
</div>
<script>
(function(){
  document.querySelectorAll('[data-copy]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var out = btn.parentElement.querySelector('.bk-copied');
      var text = btn.getAttribute('data-copy') || '';
      var done = function(){ if (out) out.textContent = 'Booking code copied'; };
      var fail = function(){ if (out) out.textContent = 'Select the code above to copy it'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
      else fail();
    });
  });
  document.querySelectorAll('[data-print]').forEach(function(btn){
    btn.addEventListener('click', function(){ window.print(); });
  });
})();
</script>`;
}

function bookingMissingBody(email) {
  const safe = esc(email || operatorEmail());
  return `<div class="wrap bk bk-miss"><h1>We can't find that booking</h1>
<p class="bk-blurb">Check the booking code in your confirmation email. Codes look like HDC-7Q4K2.</p>
<div class="bk-card"><p>Still stuck? Email <a href="mailto:${safe}">${safe}</a> with your name and booking date.</p></div>
<div class="bk-foot"><a class="btn btn-pri" href="/">Home</a><a class="btn btn-line" href="/faq">FAQ</a></div></div>`;
}

module.exports = { bookingPageBody, bookingMissingBody };
