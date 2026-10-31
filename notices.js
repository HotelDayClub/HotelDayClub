const { esc, money, nice } = require('./util');
const { spotLabel, hoursView, cancelNote, displayCancelNote, swimNote } = require('./offering');
const { maskName } = require('./passwords');
const { topicLabel } = require('./contact');
const seo = require('./seo');
const { demoSite, operatorEmail } = require('./siteMode');
const mailer = require('./mailer');
const { eventWindow, passCalendarLink } = require('./calendar');
const { loadInclusions, includedText } = require('./inclusions');
const { forPass, accessText } = require('./access');
const { directionsHref } = require('./arrival');
const brand = require('./brand');
const { qrToken } = require('./qr');

const PARKING_LINE = 'Show your booking code at the entrance';
const FONT = 'Helvetica,Arial,sans-serif';
const MONO = "'Courier New',Courier,monospace";

function bookingHasParking(db, bookingId, hotelId) {
  const bought = db.prepare(`SELECT 1 AS n FROM booking_addons ba JOIN addons a ON a.id=ba.addon_id
    WHERE ba.booking_id=? AND a.code='parking'`).get(bookingId);
  if (bought) return true;
  if (!hotelId) return false;
  const mode = db.prepare(`SELECT mode FROM inclusions WHERE hotel_id=? AND code='parking'`).get(hotelId);
  return !!(mode && mode.mode === 'included');
}

function parkingCopy(info) {
  if (!info.parking) return { text: '', html: '' };
  const entrance = String(info.parkingEntrance || '').trim();
  const url = String(info.directionsUrl || '').trim();
  const text = [
    entrance ? `Parking entrance: ${entrance}` : '',
    url ? `Directions: ${url}` : '',
    PARKING_LINE,
  ].filter(Boolean).join('\n');
  const html = `<div class="park-details">
${entrance ? `<p style="margin:8px 0;font-family:${FONT};color:${brand['hdc-text']};">Parking entrance: ${htmlValue(entrance)}</p>` : ''}
${url ? `<p style="margin:0 0 8px;font-family:${FONT};"><a href="${esc(url)}" style="color:${brand['hdc-primary']};font-weight:700;">Directions</a></p>` : ''}
<p style="margin:0;font-family:${FONT};color:${brand['hdc-text']};">${esc(PARKING_LINE)}</p>
</div>`;
  return { text, html };
}

function htmlValue(value) {
  return esc(value).replace(/\n/g, '<br>');
}

function factRows(pairs) {
  return pairs.map(([label, value], index) => {
    const border = index === 0 ? '' : `border-top:1px solid ${brand['hdc-border']};`;
    return `<tr>
<td class="stack" valign="top" style="padding:9px 12px 9px 0;${border}width:38%;font-family:${FONT};font-size:15px;color:${brand['hdc-secondary']};font-weight:700;">${esc(label)}</td>
<td class="stack" valign="top" style="padding:9px 0;${border}font-family:${FONT};font-size:16px;color:${brand['hdc-text']};font-weight:600;">${htmlValue(value)}</td>
</tr>`;
  }).join('');
}

function mailButton(href, label) {
  const url = esc(href);
  const text = esc(label);
  return `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="20%" stroke="f" fillcolor="${brand['hdc-primary']}"><w:anchorlock/><center style="color:${brand['hdc-bg']};font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;">${text}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a href="${url}" style="display:inline-block;background:${brand['hdc-primary']};color:${brand['hdc-bg']};font-family:${FONT};font-size:16px;font-weight:700;line-height:48px;min-height:48px;padding:0 24px;border-radius:10px;text-decoration:none;mso-hide:all;">${text}</a><!--<![endif]-->`;
}

function mailCard(inner, bg) {
  const fill = bg || brand['hdc-tint'];
  const border = bg ? `2px solid ${brand['hdc-primary']}` : `1px solid ${brand['hdc-border']}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${fill}" style="background:${fill};border:${border};margin:0 0 16px;"><tr><td style="padding:18px 20px;">${inner}</td></tr></table>`;
}

function mailDocument({ title, preheader, body }) {
  return `<!DOCTYPE html><html lang="en-AU" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><meta name="x-apple-disable-message-reformatting"><title>${esc(title)}</title><!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]--><style>:root{color-scheme:light only;supported-color-schemes:light only}@media (max-width:480px){.stack{display:block!important;width:100%!important;padding-right:0!important}.px{padding-left:16px!important;padding-right:16px!important}}</style></head>
<body style="margin:0;padding:0;background:${brand['hdc-bg']};color:${brand['hdc-text']};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${brand['hdc-bg']};opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${brand['hdc-bg']}"><tr><td align="center" style="padding:0;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td class="px" style="padding:24px 28px 12px;border-bottom:3px solid ${brand['hdc-rose']};"><p style="margin:0;font-family:${FONT};font-size:20px;font-weight:800;color:${brand['hdc-navy']};">Hotel Day <span style="color:${brand['hdc-rose-ink']};">Club</span></p></td></tr>
<tr><td class="px" style="padding:24px 28px 8px;">${body}</td></tr>
<tr><td class="px" style="padding:16px 28px 32px;border-top:1px solid ${brand['hdc-border']};"><p style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:1.5;color:${brand['hdc-secondary']};">Hotel Day Club | ${esc(operatorEmail())}</p><p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${brand['hdc-secondary']};">You get this email because a booking was made with this address. It is a service email about your booking.</p></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

function h2(text) {
  return `<h2 style="margin:0 0 10px;font-family:${FONT};font-size:19px;line-height:1.3;color:${brand['hdc-navy']};font-weight:700;">${esc(text)}</h2>`;
}

function towelBring(included) {
  const towel = String(included || '').split('\n').map(line => line.trim()).find(line => /towel/i.test(line));
  const base = 'Photo ID when the hotel asks for it, swimwear and sunscreen.';
  return towel ? `${base} Towels are included (${towel}).` : base;
}

function bookingNotice(info) {
  const demo = !!info.demo;
  const place = info.area ? `${info.area}, Australia` : 'Australia';
  const extras = Array.isArray(info.addons) && info.addons.length
    ? info.addons.map(a => `${a.name} × ${a.qty} — ${a.totalLabel}`).join('\n')
    : 'None';
  const facts = [
    ['Hotel', info.hotelName],
    ['Place', place],
    ['Date', info.dateLabel],
    ['Access hours', info.hours],
    ['Pass', info.passLabel],
    ['Guests', info.guests],
    ['Included', info.included],
    ['Included access', info.includedAccess != null ? info.includedAccess : info.access],
    ['On site to buy (not included)', info.buyAccess],
    ['Food and drink', 'Food and drink are not included in your pass.'],
    ['Extras', extras],
    ['Total', info.totalLabel],
    ['Booking code', info.code],
    ['Cancellation', displayCancelNote(info.cancel)],
  ].filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
  const warning = 'This is a demo booking. No payment was taken and no real booking exists. This is not a reservation at a real hotel.';
  const heading = demo ? 'Your demo booking' : "You're booked in.";
  const intro = demo ? warning : 'This email confirms the booking you just made.';
  const linkLine = `Your QR code is on the confirmation page:\n${info.link}`;
  const checkinLine = info.checkinUrl ? `Show this QR code at reception. It opens:\n${info.checkinUrl}` : '';
  const calendarLine = info.calendarUrl ? `Add to Google Calendar:\n${info.calendarUrl}` : '';
  const privacyLine = `Privacy policy: ${seo.ORIGIN}/privacy`;
  const contactLine = `Questions: ${info.contact}`;
  const guestLine = info.guest ? `Guest: ${info.guest}` : '';
  const park = parkingCopy(info);
  const travel = [
    info.dayEntrance ? `Day guest entrance: ${info.dayEntrance}` : '',
    info.transit ? `Train or bus: ${info.transit}` : '',
    park.text,
  ].filter(Boolean).join('\n');
  const bring = towelBring(info.included);
  const text = [
    'Hotel Day Club',
    '',
    heading,
    '',
    intro,
    '',
    guestLine,
    ...facts.map(([label, value]) => `${label}: ${value}`),
    '',
    travel,
    '',
    info.risk,
    '',
    `What to bring: ${bring}`,
    '',
    linkLine,
    '',
    checkinLine,
    '',
    calendarLine,
    privacyLine,
    contactLine,
  ].filter(line => line !== '').join('\n');
  const passLabels = new Set(['Hotel', 'Place', 'Date', 'Access hours', 'Pass', 'Guests', 'Extras', 'Total', 'Booking code']);
  const includeLabels = new Set(['Included', 'Included access', 'On site to buy (not included)', 'Food and drink']);
  const passFacts = facts.filter(([label]) => passLabels.has(label));
  if (info.guest) {
    const at = passFacts.findIndex(([label]) => label === 'Guests');
    passFacts.splice(at < 0 ? passFacts.length : at + 1, 0, ['Guest', info.guest]);
  }
  const includeFacts = facts.filter(([label]) => includeLabels.has(label));
  const cancelFact = facts.find(([label]) => label === 'Cancellation');
  const summary = [info.dateLabel, info.passLabel, info.guests ? `${info.guests} guests` : ''].filter(Boolean).join(' · ');
  const preheader = esc(`${info.dateLabel || ''} at ${info.hotelName || 'the hotel'}. Show booking code ${info.code} at reception.`);
  const demoBox = demo
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${brand['hdc-sun-soft']}" style="background:${brand['hdc-sun-soft']};border:1px solid ${brand['hdc-sun']};margin:0 0 16px;"><tr><td style="padding:18px 20px;"><p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.5;color:${brand['hdc-navy']};font-weight:600;">${esc(warning)}</p></td></tr></table>`
    : `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.5;color:${brand['hdc-text']};">${esc(intro)}</p>`;
  const qrBlock = info.qrUrl
    ? `<p style="margin:0 0 10px;text-align:center;"><img src="${esc(info.qrUrl)}" width="180" height="180" alt="Booking code: ${esc(info.code)}" style="display:block;margin:0 auto;width:180px;height:180px;border:0;"></p>`
    : '';
  const qrCard = mailCard(`<h2 style="margin:0 0 4px;font-family:${FONT};font-size:19px;color:${brand['hdc-navy']};font-weight:700;text-align:center;">Show this QR code at reception.</h2>
<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.5;color:${brand['hdc-secondary']};text-align:center;">Reception scans it or types the booking code.</p>
${qrBlock}
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${brand['hdc-secondary']};font-weight:700;text-align:center;letter-spacing:.08em;">BOOKING CODE</p>
<p style="margin:2px 0 14px;font-family:${MONO};font-size:30px;line-height:1.2;font-weight:700;color:${brand['hdc-navy']};text-align:center;letter-spacing:.06em;">${esc(info.code)}</p>
<p style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:1.5;color:${brand['hdc-text']};text-align:center;">Booking code: ${esc(info.code)}</p>
<div style="text-align:center;">${mailButton(info.link, 'View your booking')}</div>`, brand['hdc-bg']);
  const thereRows = [];
  if (info.dayEntrance) thereRows.push(['Day guest entrance', info.dayEntrance]);
  if (info.transit) thereRows.push(['Train or bus', info.transit]);
  const there = (thereRows.length || park.html)
    ? mailCard(`${h2('Getting there')}${thereRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows(thereRows)}</table>` : ''}${park.html}`)
    : '';
  const share = `We share your name, booking code, party size and add-ons with ${info.hotelName || 'the hotel'} so it can prepare for and check you in.`;
  const body = `<h1 style="margin:0 0 6px;font-family:${FONT};font-size:30px;line-height:1.2;color:${brand['hdc-navy']};font-weight:700;">${esc(heading)}</h1>
<p style="margin:0 0 16px;font-family:${FONT};font-size:18px;line-height:1.5;color:${brand['hdc-text']};font-weight:600;">${esc(summary)}</p>
${demoBox}
${qrCard}
${mailCard(`${h2('Your pass')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows(passFacts)}</table>`)}
${includeFacts.length ? mailCard(`${h2("What's included")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows(includeFacts)}</table>${info.risk ? `<p style="margin:12px 0 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${brand['hdc-text']};border-left:4px solid ${brand['hdc-primary']};padding-left:12px;">${esc(info.risk)}</p>` : ''}`) : ''}
${mailCard(`${h2('What to bring')}<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.5;color:${brand['hdc-text']};">${esc(bring)}</p>`)}
${there}
${mailCard(`${h2('Cancellation')}<p style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:1.5;color:${brand['hdc-text']};"><b>${esc(cancelFact ? cancelFact[1] : '')}</b></p><p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.5;color:${brand['hdc-text']};">To cancel, open <a href="${esc(info.link)}" style="color:${brand['hdc-primary']};font-weight:700;">your booking</a>. <a href="${esc(seo.ORIGIN + '/refunds')}" style="color:${brand['hdc-primary']};font-weight:700;">Cancellation and refunds (draft)</a></p>`)}
${info.calendarUrl ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.5;"><a href="${esc(info.calendarUrl)}" style="color:${brand['hdc-primary']};font-weight:700;">Add to Google Calendar</a></p>` : ''}
<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.5;color:${brand['hdc-secondary']};">${esc(share)}</p>
<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${brand['hdc-secondary']};"><a href="${esc(seo.ORIGIN + '/privacy')}" style="color:${brand['hdc-primary']};font-weight:700;">Privacy policy (draft)</a> · ${esc(contactLine)}</p>`;
  const html = mailDocument({ title: heading, preheader, body });
  const subject = demo
    ? `Your Hotel Day Club demo booking ${info.code}`
    : `Your Hotel Day Club booking ${info.code}`;
  return { to: info.to, subject, html, text };
}

function contactAlert(info) {
  const demo = !!info.demo;
  const topic = info.topic || 'Message';
  const code = info.bookingCode ? info.bookingCode : 'Not given';
  const warning = 'This message came from the demo site.';
  const facts = [
    ['Name', info.name],
    ['Email', info.email],
    ['Topic', topic],
    ['Booking code', code],
  ];
  const text = [
    'Hotel Day Club',
    '',
    'New contact message',
    '',
    demo ? warning : '',
    ...facts.map(([label, value]) => `${label}: ${value}`),
    '',
    info.message,
  ].filter(line => line !== '').join('\n');
  const rows = facts.map(([label, value]) => `<tr>
<td style="padding:10px 12px 10px 0;border-bottom:1px solid #0E1E3A;font-weight:700;vertical-align:top;color:#0A1428;">${esc(label)}</td>
<td style="padding:10px 0;border-bottom:1px solid #0E1E3A;vertical-align:top;color:#0A1428;overflow-wrap:anywhere;">${htmlValue(value)}</td>
</tr>`).join('');
  const html = `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>New contact message</title></head>
<body style="margin:0;background:#ffffff;color:#0A1428;">
<div style="max-width:560px;margin:0 auto;padding:28px 18px;font-family:Georgia,'Iowan Old Style','Times New Roman',serif;font-size:18px;line-height:1.45;color:#0A1428;">
<p style="margin:0 0 8px;font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#0E1E3A;">Hotel Day Club</p>
<h1 style="margin:0 0 16px;font-size:32px;line-height:1.15;color:#0E1E3A;font-weight:700;">New contact message</h1>
${demo ? `<p style="margin:0 0 20px;padding:14px 16px;background:#F6EFE6;color:#0A1428;border:2px solid #0E1E3A;">${esc(warning)}</p>` : ''}
<table role="presentation" style="width:100%;border-collapse:collapse;">${rows}</table>
<p style="margin:20px 0 0;color:#0A1428;white-space:pre-wrap;overflow-wrap:anywhere;">${esc(info.message)}</p>
</div></body></html>`;
  return {
    to: info.to,
    subject: `New contact message: ${String(topic).replace(/[\r\n]+/g, ' ').slice(0, 80)}`,
    html,
    text,
  };
}

async function claimAndSend(db, claimSql, claimArgs, triesSql, triesArgs, stateSql, stateHead, failLine, send) {
  const claimed = db.prepare(claimSql).run(...claimArgs);
  if (claimed.changes !== 1) return;
  for (let n = 1; n <= 2; n++) {
    if (n === 2) db.prepare(triesSql).run(...triesArgs);
    let result = { ok: false, skipped: false };
    try {
      result = await send();
    } catch (err) {
      result = { ok: false, skipped: false };
    }
    if (result && (result.ok || result.skipped)) {
      db.prepare(stateSql).run(result.skipped ? 'skipped' : 'sent', ...stateHead);
      return;
    }
    console.error(failLine(n));
  }
  db.prepare(stateSql).run('failed', ...stateHead);
}

async function bookingMessage(db, code) {
  const row = db.prepare(`SELECT b.id, b.code, b.date, b.qty, b.total, b.email, b.party, b.guest_name, b.cancel_note, b.created_at, b.hotel_id,
    p.name AS pass_name, p.holds, p.id AS pass_id
    FROM bookings b JOIN pass_types p ON p.id=b.pass_type_id WHERE b.code=?`).get(code);
  if (!row) return null;
  const email = String(row.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { invalid: true };
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(row.hotel_id);
  const adds = db.prepare('SELECT name, qty, total FROM booking_addons WHERE booking_id=? ORDER BY name').all(row.id);
  const view = hoursView(db, hotel, row.date);
  const bookedAt = row.created_at ? new Date(String(row.created_at).replace(' ', 'T')) : new Date();
  const note = row.cancel_note || cancelNote(db, hotel, row.date, bookedAt);
  const window = eventWindow(db, hotel, row.date);
  const parking = bookingHasParking(db, row.id, row.hotel_id);
  const dayEntrance = hotel ? String(hotel.day_entrance || '').trim() : '';
  const transit = hotel ? String(hotel.transit_note || '').trim() : '';
  const parkingEntrance = parking && hotel ? hotel.parking_entrance : '';
  const directionsUrl = parking && hotel ? directionsHref(hotel) : '';
  if (hotel) delete hotel.address;
  const calendarUrl = passCalendarLink({ code: row.code, cancel_note: note }, hotel, window);
  const checkinUrl = seo.ORIGIN + '/hotel/checkin?code=' + encodeURIComponent(row.code);
  const qrUrl = seo.ORIGIN + '/qr/' + qrToken(row.code) + '.png';
  const party = row.party || row.qty * (row.holds || 1);
  const included = hotel ? includedText(loadInclusions(db, hotel.id), party) : '';
  const areas = forPass(db, row.pass_id);
  const includedAccess = accessText(areas.filter(area => !Number(area.serves_food)));
  const buyAccess = accessText(areas.filter(area => Number(area.serves_food)));
  return bookingNotice({
    demo: demoSite(),
    to: email,
    code: row.code,
    hotelName: hotel ? hotel.name : '',
    area: hotel ? hotel.area : '',
    dateLabel: nice(row.date),
    hours: view.span || view.hoursLine,
    passLabel: `${spotLabel({ name: row.pass_name, holds: row.holds })} × ${row.qty}`,
    guests: String(party),
    included,
    includedAccess,
    buyAccess,
    addons: adds.map(a => ({ name: a.name, qty: a.qty, totalLabel: money(a.total) })),
    totalLabel: money(row.total),
    cancel: note,
    risk: swimNote(hotel || {}),
    contact: operatorEmail(),
    link: seo.ORIGIN + '/booking/' + encodeURIComponent(row.code),
    checkinUrl,
    qrUrl,
    calendarUrl,
    guest: maskName(row.guest_name),
    parking,
    parkingEntrance,
    directionsUrl,
    dayEntrance,
    transit,
  });
}

async function sendBookingConfirmation(db, code) {
  const row = db.prepare('SELECT email FROM bookings WHERE code=?').get(code);
  if (!row) return;
  const email = String(row.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    const marked = db.prepare(`UPDATE bookings SET guest_email_state='failed' WHERE code=? AND COALESCE(guest_email_state,'')=''`).run(code);
    if (marked.changes === 1) console.error('booking confirmation email failed code=' + code + ' invalid address');
    return;
  }
  const message = await bookingMessage(db, code);
  if (!message || message.invalid) return;
  await claimAndSend(
    db,
    `UPDATE bookings SET guest_email_tries = guest_email_tries + 1, guest_email_state = 'sending'
      WHERE code=? AND COALESCE(guest_email_state,'')='' AND guest_email_tries=0`,
    [code],
    `UPDATE bookings SET guest_email_tries = guest_email_tries + 1 WHERE code=? AND guest_email_state='sending'`,
    [code],
    `UPDATE bookings SET guest_email_state=? WHERE code=? AND guest_email_state='sending'`,
    [code],
    n => 'booking confirmation email failed code=' + code + ' try=' + n,
    () => mailer.sendMail({ ...message, idempotencyKey: 'booking:' + code }),
  );
}

async function sendContactAlert(db, id) {
  const row = db.prepare('SELECT id, name, email, booking_code, topic, message FROM contact_messages WHERE id=?').get(id);
  if (!row) return;
  const message = contactAlert({
    demo: demoSite(),
    to: operatorEmail(),
    name: row.name,
    email: row.email,
    topic: topicLabel(row.topic),
    bookingCode: row.booking_code,
    message: row.message,
  });
  await claimAndSend(
    db,
    `UPDATE contact_messages SET alert_tries = alert_tries + 1, alert_state = 'sending'
      WHERE id=? AND COALESCE(alert_state,'')='' AND alert_tries=0`,
    [id],
    `UPDATE contact_messages SET alert_tries = alert_tries + 1 WHERE id=? AND alert_state='sending'`,
    [id],
    `UPDATE contact_messages SET alert_state=? WHERE id=? AND alert_state='sending'`,
    [id],
    n => 'contact alert email failed id=' + id + ' try=' + n,
    () => mailer.sendMail({ ...message, idempotencyKey: 'contact:' + id }),
  );
}

function cancelNotice(info) {
  const line = 'This demo booking is cancelled. No payment was taken, so there is nothing to return to a card.';
  const text = [
    'Hotel Day Club',
    '',
    line,
    '',
    `Booking ${info.code}`,
    info.hotelName || '',
    info.dateLabel ? `Date: ${info.dateLabel}` : '',
    info.passLabel ? `Pass: ${info.passLabel}` : '',
    info.link || '',
  ].filter(Boolean).join('\n');
  const rows = [
    ['Booking code', info.code],
    ['Hotel', info.hotelName],
    ['Date', info.dateLabel],
    ['Pass', info.passLabel],
    ['Status', 'Cancelled'],
  ].filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
  const preheader = esc(`Booking ${info.code} at ${info.hotelName || 'the hotel'} is cancelled. No payment was taken.`);
  const body = `<h1 style="margin:0 0 12px;font-family:${FONT};font-size:30px;line-height:1.2;color:${brand['hdc-navy']};font-weight:700;">Demo booking cancelled</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${brand['hdc-rose-soft']}" style="background:${brand['hdc-rose-soft']};border:1px solid ${brand['hdc-rose-ink']};margin:0 0 16px;"><tr><td style="padding:18px 20px;"><p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.5;color:${brand['hdc-text']};font-weight:600;">${esc(line)}</p></td></tr></table>
${mailCard(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows(rows)}</table>`)}
<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.5;color:${brand['hdc-secondary']};">This booking code and its QR code no longer check you in.</p>
<div style="margin:0 0 16px;">${info.link ? mailButton(info.link, 'View booking') : ''}</div>
<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${brand['hdc-secondary']};"><a href="${esc(seo.ORIGIN + '/refunds')}" style="color:${brand['hdc-primary']};font-weight:700;">Cancellation and refunds (draft)</a> · Questions: ${esc(operatorEmail())}</p>`;
  return {
    to: info.to,
    subject: `Your Hotel Day Club demo booking ${info.code} is cancelled`,
    html: mailDocument({ title: 'Demo booking cancelled', preheader, body }),
    text,
  };
}

async function sendCancellation(db, code) {
  const row = db.prepare(`SELECT b.code, b.email, b.hotel_id, b.date, b.qty, p.name AS pass_name, p.holds
    FROM bookings b JOIN pass_types p ON p.id=b.pass_type_id WHERE b.code=?`).get(code);
  if (!row) return { skipped: true };
  const email = String(row.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { skipped: true };
  const hotel = db.prepare('SELECT name FROM hotels WHERE id=?').get(row.hotel_id);
  const message = cancelNotice({
    to: email,
    code: row.code,
    hotelName: hotel ? hotel.name : '',
    link: seo.ORIGIN + '/booking/' + encodeURIComponent(row.code),
    dateLabel: nice(row.date),
    passLabel: `${spotLabel({ name: row.pass_name, holds: row.holds })} × ${row.qty}`,
  });
  try {
    return await mailer.sendMail({ ...message, idempotencyKey: 'cancel:' + row.code });
  } catch (err) {
    console.error('cancel email failed code=' + code);
    return { ok: false };
  }
}

module.exports = { bookingNotice, bookingMessage, bookingHasParking, contactAlert, cancelNotice, sendBookingConfirmation, sendContactAlert, sendCancellation };
