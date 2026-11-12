const { esc, nice } = require('./util');
const { operatorEmail, demoSite } = require('./siteMode');
const mailer = require('./mailer');

// N is the number of active bookings on that visit date. Each booking is one
// guest to contact. Cancelled bookings are left out. Checked-in bookings count.
class PauseBooked {
  static line(value) {
    return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  }

  static active(db, hotelId, date) {
    return db.prepare(`SELECT id, code, guest_name, email, phone, qty, party, status, checked_in_at
      FROM bookings
      WHERE hotel_id=? AND date=? AND LOWER(COALESCE(status, ''))!='cancelled'
      ORDER BY guest_name, id`).all(hotelId, date);
  }

  static sentence(count) {
    const n = Number(count) || 0;
    const guests = n === 1 ? '1 guest is booked' : `${n} guests are booked`;
    return `${guests}. Hotel Day Club will contact them.`;
  }

  static statusLabel(row) {
    return row && row.checked_in_at ? 'Checked in' : 'Confirmed';
  }

  static summary(bookings) {
    return (bookings || []).map(row => [
      this.line(row.guest_name),
      this.line(row.code),
      this.statusLabel(row),
      this.line(row.email),
      this.line(row.phone),
    ].filter(Boolean).join(' · ')).join('\n');
  }

  static closingDates(db, hotelId, dates) {
    return (dates || []).map(date => ({ date, bookings: this.active(db, hotelId, date) })).filter(row => row.bookings.length);
  }

  // mode "toggle" resumes a paused date. mode "pause" only closes.
  // A date that already has guests waits for confirm. Zero guests pause immediately.
  static pause(db, hotelId, date, { mode = 'pause', confirm = false } = {}) {
    const existing = db.prepare('SELECT reason FROM blocked_dates WHERE hotel_id=? AND date=?').get(hotelId, date);
    if (mode === 'toggle' && existing && existing.reason === 'Paused') {
      db.prepare('DELETE FROM blocked_dates WHERE hotel_id=? AND date=?').run(hotelId, date);
      return { ok: true, kind: 'resume', msg: `Resumed ${nice(date)}. Guests can book it again.`, alert: false, bookings: [], date };
    }
    if (existing && existing.reason !== 'Paused') {
      return { ok: false, kind: 'closed', msg: `${nice(date)} is already closed (${existing.reason}).`, alert: false, bookings: [], date };
    }
    if (existing) {
      return { ok: true, kind: 'already', msg: `${nice(date)} is already paused.`, alert: false, bookings: [], date };
    }
    const bookings = this.active(db, hotelId, date);
    if (bookings.length && !confirm) {
      return { ok: false, kind: 'confirm', msg: this.sentence(bookings.length), alert: false, bookings, date };
    }
    db.prepare("INSERT INTO blocked_dates(hotel_id,date,reason) VALUES (?,?, 'Paused')").run(hotelId, date);
    return {
      ok: true,
      kind: 'paused',
      msg: `Paused ${nice(date)}. Guests can no longer book it.`,
      alert: bookings.length > 0,
      bookings,
      date,
    };
  }

  static confirmInner({ heading, note, groups, action, fields, submitLabel, backHref }) {
    const bookings = (groups || []).flatMap(group => group.bookings);
    const many = (groups || []).length > 1;
    const lists = (groups || []).map(group => {
      const items = group.bookings.map(row => `<li><b>${esc(row.guest_name)}</b> <span class="muted">${esc(row.code)} · ${esc(this.statusLabel(row))}</span></li>`).join('');
      const head = many ? `<h2 class="ph2">${esc(nice(group.date))}</h2>` : '';
      return `${head}<ul class="email-guests">${items}</ul>`;
    }).join('');
    const inputs = Object.entries(fields || {}).map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`).join('');
    const back = backHref ? `<a class="btn btn-line" href="${esc(backHref)}">Back</a>` : '';
    return `<section class="panel" id="pause-confirm"><p class="eyebrow-s">Guests already booked</p><h1 class="l-title">${esc(heading)}</h1><p><b>${esc(this.sentence(bookings.length))}</b></p><p class="muted">${esc(note)}</p>${lists}<div class="ops-bar"><form method="post" action="${esc(action)}">${inputs}<button class="btn btn-navy" type="submit">${esc(submitLabel)}</button></form>${back}</div></section>`;
  }

  static alertMessage({ to, hotelName, dateLabel, reason, bookings }) {
    const rows = bookings || [];
    const lead = this.sentence(rows.length);
    const demoLine = demoSite() ? 'This is a demo site. Bookings were not cancelled.' : '';
    const facts = [
      ['Hotel', this.line(hotelName)],
      ['Date', this.line(dateLabel)],
      ['Reason', this.line(reason) || 'Closed'],
      ['Guests', String(rows.length)],
    ];
    const list = this.summary(rows).split('\n').filter(Boolean);
    const text = [
      'Hotel Day Club',
      '',
      `${this.line(hotelName)} closed ${this.line(dateLabel)}.`,
      '',
      demoLine,
      lead,
      '',
      ...facts.map(([label, value]) => `${label}: ${value}`),
      '',
      ...list,
    ].filter(line => line !== '').join('\n');
    const factRows = facts.map(([label, value]) => `<tr><td style="padding:8px 12px 8px 0;font-weight:700;vertical-align:top;">${esc(label)}</td><td style="padding:8px 0;vertical-align:top;">${esc(value)}</td></tr>`).join('');
    const items = list.map(line => `<li style="margin:0 0 8px;">${esc(line)}</li>`).join('');
    const html = `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><title>Guests booked on a closed date</title></head><body style="margin:0;background:#ffffff;color:#0A1428;"><div style="max-width:560px;margin:0 auto;padding:28px 18px;font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.45;"><p style="margin:0 0 8px;font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;">Hotel Day Club</p><h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;">Guests booked on a closed date</h1>${demoLine ? `<p style="margin:0 0 16px;">${esc(demoLine)}</p>` : ''}<p style="margin:0 0 16px;font-weight:700;">${esc(lead)}</p><table role="presentation" style="width:100%;border-collapse:collapse;">${factRows}</table><ul style="margin:16px 0 0;padding-left:18px;">${items}</ul></div></body></html>`;
    const hotel = this.line(hotelName) || 'Hotel';
    return {
      to,
      subject: `Guests booked on a closed date: ${hotel}`.slice(0, 200),
      html,
      text,
    };
  }

  static async notify(db, hotel, date, bookings, reason) {
    const rows = bookings || [];
    if (!rows.length) return { ok: false, skipped: true, empty: true };
    const why = this.line(reason) || 'Closed';
    const id = db.prepare(`INSERT INTO closure_alerts (hotel_id, date, reason, guest_count, summary) VALUES (?,?,?,?,?)`)
      .run(hotel.id, date, why, rows.length, this.summary(rows)).lastInsertRowid;
    const message = this.alertMessage({
      to: operatorEmail(),
      hotelName: hotel.name,
      dateLabel: nice(date),
      reason: why,
      bookings: rows,
    });
    try {
      const result = await mailer.sendMail({ ...message, idempotencyKey: 'closure:' + id });
      return { ...result, id };
    } catch (err) {
      console.error('closure alert email failed id=' + id);
      return { ok: false, id };
    }
  }

  static adminSection(db) {
    const rows = db.prepare(`SELECT a.id, a.date, a.reason, a.guest_count, a.summary, h.name AS hotel
      FROM closure_alerts a JOIN hotels h ON h.id=a.hotel_id ORDER BY a.id DESC LIMIT 20`).all();
    if (!rows.length) return '';
    const items = rows.map(row => {
      const lines = esc(row.summary).replace(/\n/g, '<br>');
      return `<div class="pending-row"><div><b>${esc(row.hotel)}</b> · ${esc(nice(row.date))} · ${esc(row.reason || 'Closed')}<div class="muted small">${row.guest_count} guest${row.guest_count === 1 ? '' : 's'} booked. Hotel Day Club will contact them.</div><div class="muted small">${lines}</div></div></div>`;
    }).join('');
    return `<section class="panel" id="closures"><h2 class="ph2">Dates closed with guests</h2><p class="muted small">A hotel closed a date that already had guests. The list is who was booked. Bookings are not cancelled from here.</p>${items}</section>`;
  }
}

module.exports = { PauseBooked };
