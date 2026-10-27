const { esc, money, nice } = require('./util');
const { spotLabel, hoursView, cancelNote, swimNote } = require('./offering');
const { maskName } = require('./passwords');
const { topicLabel } = require('./contact');
const seo = require('./seo');
const { demoSite, operatorEmail } = require('./siteMode');
const mailer = require('./mailer');
const { eventWindow, passCalendarLink } = require('./calendar');
const { loadInclusions, includedText } = require('./inclusions');
const { forPass, accessText } = require('./access');

function htmlValue(value) {
  return esc(value).replace(/\n/g, '<br>');
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
    ['Included access', info.access],
    ['Food and drink', 'Food and drink are not included in the pass. Buy them at the bar or café, or add an optional food and drink credit when the hotel offers one.'],
    ['Extras', extras],
    ['Total', info.totalLabel],
    ['Booking code', info.code],
    ['Cancellation', info.cancel],
  ].filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
  const warning = 'This is a demo booking. No payment was taken and no real booking exists. This is not a reservation at a real hotel.';
  const heading = demo ? 'Your demo booking' : "You're booked in.";
  const intro = demo ? warning : 'This email confirms the booking you just made.';
  const linkLine = `Your QR code is on the confirmation page:\n${info.link}`;
  const calendarLine = info.calendarUrl ? `Add to Google Calendar:\n${info.calendarUrl}` : '';
  const contactLine = `Questions: ${info.contact}`;
  const guestLine = info.guest ? `Guest: ${info.guest}` : '';
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
    info.risk,
    '',
    linkLine,
    '',
    calendarLine,
    contactLine,
  ].filter(line => line !== '').join('\n');
  const rows = facts.map(([label, value]) => `<tr>
<td style="padding:10px 12px 10px 0;border-bottom:1px solid #0E1E3A;font-weight:700;vertical-align:top;color:#0A1428;">${esc(label)}</td>
<td style="padding:10px 0;border-bottom:1px solid #0E1E3A;vertical-align:top;color:#0A1428;">${htmlValue(value)}</td>
</tr>`).join('');
  const demoBox = demo
    ? `<p style="margin:0 0 20px;padding:14px 16px;background:#F6EFE6;color:#0A1428;border:2px solid #0E1E3A;font-size:18px;line-height:1.45;">${esc(warning)}</p>`
    : `<p style="margin:0 0 20px;color:#0A1428;font-size:18px;line-height:1.45;">${esc(intro)}</p>`;
  const html = `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;background:#ffffff;color:#0A1428;">
<div style="max-width:560px;margin:0 auto;padding:28px 18px;font-family:Georgia,'Iowan Old Style','Times New Roman',serif;font-size:18px;line-height:1.45;color:#0A1428;">
<p style="margin:0 0 8px;font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#0E1E3A;">Hotel Day Club</p>
<h1 style="margin:0 0 16px;font-size:32px;line-height:1.15;color:#0E1E3A;font-weight:700;">${esc(heading)}</h1>
${demoBox}
${guestLine ? `<p style="margin:0 0 12px;color:#0A1428;">${esc(guestLine)}</p>` : ''}
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:18px;line-height:1.4;">${rows}</table>
<p style="margin:20px 0;color:#0A1428;">${esc(info.risk)}</p>
<p style="margin:0 0 12px;color:#0A1428;">Your QR code is on the confirmation page:</p>
<p style="margin:0 0 20px;color:#0E1E3A;font-weight:700;overflow-wrap:anywhere;"><a href="${esc(info.link)}" style="color:#0E1E3A;font-weight:700;">${esc(info.link)}</a></p>
${info.calendarUrl ? `<p style="margin:0 0 8px;color:#0A1428;">Add to Google Calendar:</p><p style="margin:0 0 20px;color:#0E1E3A;font-weight:700;overflow-wrap:anywhere;"><a href="${esc(info.calendarUrl)}" style="color:#0E1E3A;font-weight:700;">${esc(info.calendarUrl)}</a></p>` : ''}
<p style="margin:0;color:#0A1428;">${esc(contactLine)}</p>
</div></body></html>`;
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

function bookingMessage(db, code) {
  const row = db.prepare(`SELECT b.id, b.code, b.date, b.qty, b.total, b.email, b.party, b.guest_name, b.cancel_note, b.created_at, b.hotel_id,
    p.name AS pass_name, p.holds, p.id AS pass_id
    FROM bookings b JOIN pass_types p ON p.id=b.pass_type_id WHERE b.code=?`).get(code);
  if (!row) return null;
  const email = String(row.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { invalid: true };
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(row.hotel_id);
  if (hotel) delete hotel.address;
  const adds = db.prepare('SELECT name, qty, total FROM booking_addons WHERE booking_id=? ORDER BY name').all(row.id);
  const view = hoursView(db, hotel, row.date);
  const calendarUrl = passCalendarLink({ code: row.code }, hotel, eventWindow(db, hotel, row.date));
  const bookedAt = row.created_at ? new Date(String(row.created_at).replace(' ', 'T')) : new Date();
  const note = row.cancel_note || cancelNote(db, hotel, row.date, bookedAt);
  const party = row.party || row.qty * (row.holds || 1);
  const included = hotel ? includedText(loadInclusions(db, hotel.id), party) : '';
  const access = accessText(forPass(db, row.pass_id));
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
    access,
    addons: adds.map(a => ({ name: a.name, qty: a.qty, totalLabel: money(a.total) })),
    totalLabel: money(row.total),
    cancel: note,
    risk: swimNote(hotel || {}),
    contact: operatorEmail(),
    link: seo.ORIGIN + '/booking/' + encodeURIComponent(row.code),
    calendarUrl,
    guest: maskName(row.guest_name),
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
  const message = bookingMessage(db, code);
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

module.exports = { bookingNotice, bookingMessage, contactAlert, sendBookingConfirmation, sendContactAlert };
