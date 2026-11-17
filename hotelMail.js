const { esc, money, nice, ymd } = require('./util');
const { GuestPrivacy } = require('./guestPrivacy');
const { HotelClock, hotelZone } = require('./calendar');
const { spotLabel } = require('./offering');
const { share, isDemoHotel } = require('./analytics');
const { displayName } = require('./hotelName');
const BookingGuests = require('./bookingGuests');
const mailer = require('./mailer');
const { safeEqual } = require('./passwords');
const brand = require('./brand');

const BOOKING_SQL = `SELECT b.*, p.name pass, p.holds,
  (SELECT group_concat(ba.name || ' × ' || ba.qty, ', ') FROM booking_addons ba WHERE ba.booking_id=b.id) addons
  FROM bookings b
  JOIN pass_types p ON p.id=b.pass_type_id
  WHERE b.hotel_id=? AND b.date=? AND b.status!='cancelled'
  ORDER BY b.guest_name`;

const NIGHT_BEFORE_HOUR = 18;
const STATEMENT_HOUR = 9;
const TICK_MS = 5 * 60 * 1000;

function enabled() {
  const raw = String(process.env.HOTEL_MAIL_ENABLED || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function testRecipient() {
  const raw = String(process.env.HOTEL_MAIL_TEST_TO || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : '';
}

function cronSecret() {
  return String(process.env.CRON_SECRET || '').trim();
}

function skipsHotel(hotel) {
  if (!hotel) return true;
  if (Number(hotel.is_demo) === 1) return true;
  if (isDemoHotel(hotel)) return true;
  return false;
}

function hotelRecipient(hotel) {
  const test = testRecipient();
  if (test) return test;
  const contact = String(hotel.contact_email || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return contact;
  const login = String(hotel.login || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) return login;
  return '';
}

function withNotes(db, rows) {
  if (!rows.length || rows[0].notes) return rows;
  const notes = db.prepare(`SELECT * FROM guest_notes WHERE booking_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`).all(...rows.map(r => r.id));
  const by = new Map();
  for (const n of notes) {
    if (!by.has(n.booking_id)) by.set(n.booking_id, []);
    by.get(n.booking_id).push(n);
  }
  return rows.map(r => ({ ...r, notes: by.get(r.id) || [] }));
}

function guestLine(row) {
  const seat = spotLabel({ name: row.pass, holds: row.holds });
  const extra = row.addons ? ` · ${row.addons}` : '';
  return `${row.guest_name} · ${row.code} · ${seat} × ${row.qty}${extra}`;
}

function guestLineHtml(row, hotel, now) {
  const head = BookingGuests.headlineHtml(row, hotel, now);
  const seat = esc(spotLabel({ name: row.pass, holds: row.holds }));
  const extra = row.addons ? ` · ${esc(row.addons)}` : '';
  return `<li style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:${brand['hdc-text']};"><b>${esc(head.title)}</b>${head.others ? `<br><span style="color:${brand['hdc-secondary']};font-size:14px;">${head.others}</span>` : ''} <span style="color:${brand['hdc-secondary']};">${esc(row.code)} · ${seat} × ${row.qty}${extra}</span></li>`;
}

function capChoices(db, hotel) {
  const sum = db.prepare('SELECT COALESCE(SUM(daily_cap),0) n FROM pass_types WHERE hotel_id=?').get(hotel.id).n;
  const caps = [...new Set([8, Math.max(1, Math.round(sum / 2)), Math.max(1, sum - 4)].filter(n => n > 0 && n < sum))].sort((a, b) => a - b).slice(0, 3);
  return caps.length ? caps : [Math.max(1, sum || 1)];
}

function localParts(hotel, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: hotelZone(hotel),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

function listSendHour() {
  const raw = String(process.env.HOTEL_LIST_SEND_AT || '').trim();
  if (!raw) return NIGHT_BEFORE_HOUR;
  const h = parseInt(raw, 10);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : NIGHT_BEFORE_HOUR;
}

function inSendWindow(hotel, now, hour) {
  const parts = localParts(hotel, now);
  const h = Number(parts.hour);
  const m = Number(parts.minute);
  return h === hour && m < 5;
}

function inNightBeforeWindow(hotel, now) {
  const parts = localParts(hotel, now);
  const h = Number(parts.hour);
  return h >= listSendHour() && h <= 23;
}

function monthRef(parts) {
  return `${parts.year}-${parts.month}`;
}

function previousMonth(ref) {
  const [y, m] = String(ref || '').split('-').map(Number);
  if (!y || !m) return '';
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return null;
  const [y, m] = String(month).split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = ymd(new Date(y, m, 0));
  return { start, end, label: new Date(`${start}T12:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) };
}

function statementTotals(db, hotelId, month) {
  const bounds = monthBounds(month);
  if (!bounds) return null;
  const row = db.prepare(`SELECT COUNT(b.id) bookings,
      COALESCE(SUM(COALESCE(b.party, b.qty * COALESCE(p.holds, 1))),0) guests,
      COALESCE(SUM(b.qty),0) spots,
      COALESCE(SUM(b.total),0) sales
    FROM bookings b
    JOIN pass_types p ON p.id=b.pass_type_id
    WHERE b.hotel_id=? AND b.status!='cancelled' AND b.date>=? AND b.date<=?`).get(hotelId, bounds.start, bounds.end);
  const cancellations = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE hotel_id=? AND status='cancelled' AND date>=? AND date<=?`).get(hotelId, bounds.start, bounds.end).n;
  const payout = share(row.sales).payout;
  return {
    month,
    label: bounds.label,
    bookings: row.bookings,
    guests: row.guests,
    spots: row.spots,
    cancellations,
    payout,
  };
}

function newBookingFor(db, code, opts = {}) {
  const row = db.prepare(`SELECT b.*, p.name pass, p.holds, h.name hotel_name, h.slug,
    (SELECT group_concat(ba.name || ' × ' || ba.qty, ', ') FROM booking_addons ba WHERE ba.booking_id=b.id) addons
    FROM bookings b
    JOIN pass_types p ON p.id=b.pass_type_id
    JOIN hotels h ON h.id=b.hotel_id
    WHERE b.code=? AND b.status!='cancelled'`).get(code);
  if (!row) return null;
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(row.hotel_id);
  const [b] = BookingGuests.attach([row], BookingGuests.loadMap(db, [row.id]));
  const head = BookingGuests.headlineHtml(b, hotel, new Date());
  const seat = spotLabel({ name: b.pass, holds: b.holds });
  const origin = String(opts.origin || '').replace(/\/$/, '');
  const dash = origin ? `${origin}/hotel` : '/hotel';
  const namesUnder = head.others ? head.others.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const subject = `New booking · ${nice(b.date)} · ${head.title}`;
  const text = [
    displayName(hotel),
    subject,
    `Date: ${nice(b.date)}`,
    `Guest: ${head.title}`,
    namesUnder ? `Also: ${namesUnder}` : '',
    `Pass: ${seat} × ${b.qty}`,
    b.addons ? `Add-ons: ${b.addons}` : '',
    `Code: ${b.code}`,
    `Dashboard: ${dash}`,
  ].filter(Boolean).join('\n');
  const html = `<p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:${brand['hdc-text']};"><b>${esc(head.title)}</b></p>
${head.others ? `<p style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:${brand['hdc-secondary']};">${head.others}</p>` : ''}
<p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:${brand['hdc-text']};">${esc(nice(b.date))} · ${esc(seat)} × ${b.qty}${b.addons ? `<br>${esc(b.addons)}` : ''}<br><span style="color:${brand['hdc-secondary']};">Booking ${esc(b.code)}</span></p>
<p style="margin:16px 0 0;"><a href="${esc(dash)}" style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:${brand['hdc-primary']};">Open dashboard</a></p>`;
  return { to: hotelRecipient(hotel), subject, text, html, hotel };
}

async function sendNewBooking(db, code, opts = {}) {
  if (!enabled()) return { skipped: true, reason: 'disabled' };
  const built = newBookingFor(db, code, opts);
  if (!built || !built.hotel) return { skipped: true };
  if (skipsHotel(built.hotel)) return { skipped: true, reason: 'demo' };
  const to = hotelRecipient(built.hotel);
  if (!to) return { skipped: true, reason: 'no-recipient' };
  return deliver(db, built.hotel, {
    kind: 'new_booking',
    ref: code,
    idempotencyKey: `hotel-new:${code}`,
    to,
    subject: built.subject,
    text: built.text,
    html: built.html,
  });
}

function nightBeforeFor(db, hotel, now = new Date(), opts = {}) {
  const visitDate = HotelClock.offset(hotel, 1, now);
  const rawRows = withNotes(db, db.prepare(BOOKING_SQL).all(hotel.id, visitDate));
  const rows = BookingGuests.attach(GuestPrivacy.presentAll(rawRows, hotel, now), BookingGuests.loadMap(db, rawRows.map(r => r.id)));
  const spots = rows.reduce((sum, b) => sum + b.qty, 0);
  const name = displayName(hotel);
  const visitLabel = nice(visitDate);
  const caps = capChoices(db, hotel);
  const signOps = typeof opts.signOps === 'function' ? opts.signOps : null;
  const origin = String(opts.origin || '').replace(/\/$/, '');
  const pauseToken = signOps ? signOps({ h: hotel.id, a: 'pause', d: visitDate }) : '';
  const capTokens = signOps ? caps.map(n => ({ n, token: signOps({ h: hotel.id, a: 'cap', d: visitDate, n }) })) : [];

  const lead = rows.length
    ? `${rows.length} booking${rows.length === 1 ? '' : 's'} · ${spots} spots`
    : 'No day-pass guests tomorrow.';
  const guestText = rows.length ? rows.map(guestLine).join('\n') : '';
  const guestHtml = rows.length ? `<ul style="margin:12px 0 0;padding:0 0 0 18px;">${rows.map(r => guestLineHtml(r, hotel, now)).join('')}</ul>` : `<p style="margin:12px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:${brand['hdc-secondary']};">No day-pass guests tomorrow.</p>`;

  const subject = `Guest list for ${visitLabel} at ${name}`;
  const text = [
    'Hotel Day Club',
    '',
    `Tomorrow at the pool · ${name}`,
    '',
    visitLabel,
    lead,
    '',
    guestText,
    '',
    'Log in to pause, cap or print:',
    origin ? `${origin}/hotel/login` : '/hotel/login',
  ].filter(Boolean).join('\n');

  const actionHtml = signOps && origin ? `
<p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:${brand['hdc-secondary']};">These links work for 36 hours. They do not sign you in.</p>
<p style="margin:12px 0 0;">
${pauseToken ? `<a href="${esc(origin + '/hotel/go/' + pauseToken)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;background:${brand['hdc-navy']};color:#fff;font-weight:700;text-decoration:none;border-radius:8px;">Pause tomorrow</a>` : ''}
${capTokens.map(c => `<a href="${esc(origin + '/hotel/go/' + c.token)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border:1px solid ${brand['hdc-border']};color:${brand['hdc-navy']};font-weight:600;text-decoration:none;border-radius:8px;">Cap at ${c.n}</a>`).join('')}
<a href="${esc(origin + '/hotel/print?date=' + visitDate)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border:1px solid ${brand['hdc-border']};color:${brand['hdc-navy']};font-weight:600;text-decoration:none;border-radius:8px;">Print this list</a>
</p>` : '';

  const html = `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px;background:${brand['hdc-bg']};color:${brand['hdc-text']};font-family:Helvetica,Arial,sans-serif;">
<p style="margin:0 0 8px;font-size:20px;font-weight:800;color:${brand['hdc-navy']};">Hotel Day Club</p>
<h1 style="margin:0 0 8px;font-size:19px;color:${brand['hdc-navy']};">Tomorrow at the pool</h1>
<p style="margin:0 0 4px;font-size:15px;"><b>${esc(name)}</b></p>
<p style="margin:0 0 4px;font-size:15px;color:${brand['hdc-secondary']};">${esc(visitLabel)}</p>
<p style="margin:0;font-size:15px;">${esc(lead)}</p>
${guestHtml}
${actionHtml}
</body></html>`;

  return {
    visitDate,
    visitLabel,
    name,
    rows,
    bookings: rows.length,
    spots,
    caps,
    pauseToken,
    capTokens,
    to: hotelRecipient(hotel),
    subject,
    html,
    text,
    idempotencyKey: `hotel-mail/night-before/${hotel.id}/${visitDate}`,
    kind: 'night_before',
    ref: visitDate,
  };
}

function statementFor(db, hotel, month, now = new Date()) {
  const totals = statementTotals(db, hotel.id, month);
  if (!totals) return null;
  const name = displayName(hotel);
  const bookingLabel = `${totals.bookings} booking${totals.bookings === 1 ? '' : 's'}`;
  const guestLabel = `${totals.guests} guest${totals.guests === 1 ? '' : 's'}`;
  const subject = `Your statement for ${totals.label} · ${name}`;
  const spotLabel = `${totals.spots} spot${totals.spots === 1 ? '' : 's'}`;
  const cancelLabel = `${totals.cancellations} cancellation${totals.cancellations === 1 ? '' : 's'}`;
  const text = [
    'Hotel Day Club',
    '',
    `Monthly statement · ${name}`,
    '',
    'Statement of bookings. Payments are not yet processed through Hotel Day Club.',
    totals.label,
    bookingLabel,
    guestLabel,
    spotLabel,
    cancelLabel,
    `Your payout: ${money(totals.payout)}`,
    '',
    'Open the dashboard for booking details.',
  ].join('\n');

  const html = `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px;background:${brand['hdc-bg']};color:${brand['hdc-text']};font-family:Helvetica,Arial,sans-serif;">
<p style="margin:0 0 8px;font-size:20px;font-weight:800;color:${brand['hdc-navy']};">Hotel Day Club</p>
<h1 style="margin:0 0 8px;font-size:19px;color:${brand['hdc-navy']};">Monthly statement</h1>
<p style="margin:0 0 4px;font-size:15px;"><b>${esc(name)}</b></p>
<p style="margin:0 0 8px;font-size:14px;color:${brand['hdc-secondary']};">Statement of bookings. Payments are not yet processed through Hotel Day Club.</p>
<p style="margin:0 0 12px;font-size:15px;color:${brand['hdc-secondary']};">${esc(totals.label)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.6;">
<tr><td style="padding:2px 16px 2px 0;color:${brand['hdc-secondary']};">Bookings</td><td><b>${totals.bookings}</b></td></tr>
<tr><td style="padding:2px 16px 2px 0;color:${brand['hdc-secondary']};">Guests</td><td><b>${totals.guests}</b></td></tr>
<tr><td style="padding:2px 16px 2px 0;color:${brand['hdc-secondary']};">Spots</td><td><b>${totals.spots}</b></td></tr>
<tr><td style="padding:2px 16px 2px 0;color:${brand['hdc-secondary']};">Cancellations</td><td><b>${totals.cancellations}</b></td></tr>
<tr><td style="padding:2px 16px 2px 0;color:${brand['hdc-secondary']};">Your payout</td><td><b>${esc(money(totals.payout))}</b></td></tr>
</table>
</body></html>`;

  return {
    month,
    label: totals.label,
    bookings: totals.bookings,
    guests: totals.guests,
    spots: totals.spots,
    cancellations: totals.cancellations,
    payout: totals.payout,
    name,
    to: hotelRecipient(hotel),
    subject,
    html,
    text,
    idempotencyKey: `hotel-mail/statement/${hotel.id}/${month}`,
    kind: 'statement',
    ref: month,
  };
}

function statementPreviewHtml(st) {
  if (!st) return '<p class="muted">Pick a valid month.</p>';
  const spots = st.spots != null ? st.spots : 0;
  const cancels = st.cancellations != null ? st.cancellations : 0;
  return `<article class="email-card"><p class="muted small">To ${esc(st.to || 'no address on file')} · ${esc(st.name)}</p>
<h2>Monthly statement</h2>
<p class="muted">Statement of bookings. Payments are not yet processed through Hotel Day Club.</p>
<p class="muted">${esc(st.label)}</p>
<p>${st.bookings} booking${st.bookings === 1 ? '' : 's'} · ${st.guests} guest${st.guests === 1 ? '' : 's'} · ${spots} spot${spots === 1 ? '' : 's'} · ${cancels} cancellation${cancels === 1 ? '' : 's'}</p>
<p>Your payout: <b>${esc(money(st.payout))}</b></p>
<p class="muted small">Totals are for confirmed visits in this month.</p></article>`;
}

function nightBeforePreviewHtml(mail, recipient) {
  if (!mail) return '<p class="muted">No preview.</p>';
  const inner = String(mail.html || '').replace(/^[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  return `<article class="email-card email-card-sent"><p class="muted small">To ${esc(recipient || mail.to || 'no address on file')} · ${esc(mail.name)} · same HTML as sent</p>${inner}</article>`;
}

function alreadySent(db, hotelId, kind, ref) {
  return !!db.prepare('SELECT 1 FROM hotel_mail_log WHERE hotel_id=? AND kind=? AND ref=?').get(hotelId, kind, ref);
}

function logSent(db, hotelId, kind, ref, recipient, idempotencyKey) {
  db.prepare(`INSERT INTO hotel_mail_log(hotel_id, kind, ref, recipient, idempotency_key)
    VALUES (?,?,?,?,?)`).run(hotelId, kind, ref, recipient || '', idempotencyKey || '');
}

async function deliver(db, hotel, payload) {
  if (!payload || !payload.to) {
    return { ok: false, skipped: true, reason: 'no_recipient' };
  }
  if (alreadySent(db, hotel.id, payload.kind, payload.ref)) {
    return { ok: true, skipped: true, reason: 'already_sent' };
  }
  const result = await mailer.sendMail({
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    idempotencyKey: payload.idempotencyKey,
  });
  if (result.ok) logSent(db, hotel.id, payload.kind, payload.ref, payload.to, payload.idempotencyKey);
  return result;
}

async function tick(db, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const force = !!opts.force;
  if (!enabled() && !force) return { skipped: true, sent: 0 };
  const origin = String(opts.origin || process.env.SITE_ORIGIN || 'http://localhost:' + (process.env.PORT || 3030)).replace(/\/$/, '');
  const signOps = opts.signOps;
  const hotels = db.prepare("SELECT * FROM hotels WHERE COALESCE(status,'active')='active'").all();
  let sent = 0;
  const outcomes = [];

  for (const raw of hotels) {
    const hotel = { ...raw };
    if (skipsHotel(hotel)) continue;
    const parts = localParts(hotel, now);
    const dueNight = force || inNightBeforeWindow(hotel, now);
    if (dueNight) {
      const payload = nightBeforeFor(db, hotel, now, { signOps, origin });
      if (payload.to && !alreadySent(db, hotel.id, payload.kind, payload.ref)) {
        const result = await deliver(db, hotel, payload);
        outcomes.push({ hotel: hotel.id, kind: 'night_before', ref: payload.ref, ...result });
        if (result.ok && !result.skipped) sent += 1;
      }
    }

    const statementMonth = previousMonth(monthRef(parts));
    const firstOfMonth = parts.day === '01';
    const dueStatement = force || (firstOfMonth && inSendWindow(hotel, now, STATEMENT_HOUR));
    if (dueStatement && statementMonth) {
      const payload = statementFor(db, hotel, statementMonth, now);
      if (payload && payload.to && !alreadySent(db, hotel.id, payload.kind, payload.ref)) {
        const result = await deliver(db, hotel, payload);
        outcomes.push({ hotel: hotel.id, kind: 'statement', ref: payload.ref, ...result });
        if (result.ok && !result.skipped) sent += 1;
      }
    }
  }
  return { skipped: false, sent, outcomes };
}

function verifyCronSecret(given) {
  const secret = cronSecret();
  if (!secret) return { ok: false, missing: true };
  return { ok: safeEqual(String(given), secret), missing: false };
}

function startScheduler(db, opts = {}) {
  if (!enabled()) return null;
  const run = () => tick(db, opts).catch(err => console.error('hotel-mail: tick failed ' + (err && err.message || err)));
  run();
  const timer = setInterval(run, TICK_MS);
  if (timer.unref) timer.unref();
  return timer;
}

function parseStatementMonth(raw, hotel, now = new Date()) {
  const month = String(raw || '').trim();
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  const parts = localParts(hotel || {}, now);
  return previousMonth(`${parts.year}-${parts.month}`);
}

module.exports = {
  enabled,
  testRecipient,
  cronSecret,
  verifyCronSecret,
  skipsHotel,
  hotelRecipient,
  newBookingFor,
  sendNewBooking,
  nightBeforeFor,
  statementFor,
  statementTotals,
  statementPreviewHtml,
  nightBeforePreviewHtml,
  monthBounds,
  parseStatementMonth,
  tick,
  deliver,
  startScheduler,
  TICK_MS,
  NIGHT_BEFORE_HOUR,
  STATEMENT_HOUR,
};