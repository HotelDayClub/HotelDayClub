const { ymd, addDays, esc, money, nice } = require('./util');
const { dayPlan, spotLabel } = require('./offering');

const HOTEL_SHARE = 0.75;
const RANGES = [7, 30, 90];
const WEEKDAYS = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 0, label: 'Sunday' },
];

function normalRange(raw) {
  const n = parseInt(raw, 10);
  return RANGES.includes(n) ? n : 30;
}
function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function eachDate(start, end) {
  const out = [];
  const last = parseYmd(end);
  for (let d = parseYmd(start); d <= last; d = addDays(d, 1)) out.push(ymd(d));
  return out;
}
function share(gross) {
  const payout = Math.round(Number(gross) * 75) / 100;
  const fee = Math.round((Number(gross) - payout) * 100) / 100;
  return { payout, fee };
}
function pct(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const rounded = Math.round(ratio * 1000) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return text + '%';
}
function isDemoHotel(hotel) {
  return String(hotel.login || '').startsWith('demo-') || /\(Demo\)/i.test(hotel.name || '');
}
function header(req, name) {
  if (!req || typeof req.get !== 'function') {
    const headers = (req && req.headers) || {};
    return headers[name] || headers[name.toLowerCase()] || '';
  }
  return req.get(name) || '';
}

function recordListingView(db, hotelId, day, req = {}) {
  const purpose = `${header(req, 'purpose')} ${header(req, 'sec-purpose')} ${header(req, 'sec-fetch-purpose')}`.toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview')) return false;
  const dest = String(header(req, 'sec-fetch-dest') || '').toLowerCase();
  if (dest && dest !== 'document') return false;
  const own = req.signedCookies && String(req.signedCookies.hotel) === String(hotelId);
  if (own) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false;
  db.prepare(`INSERT INTO listing_views(hotel_id, day, views, seeded) VALUES (?,?,1,0)
    ON CONFLICT(hotel_id, day, seeded) DO UPDATE SET views = views + 1`).run(hotelId, day);
  return true;
}

function buildAnalytics(db, hotel, opts = {}) {
  const range = normalRange(opts.days);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(opts.today || '') ? opts.today : ymd(new Date());
  const end = today;
  const start = ymd(addDays(parseYmd(today), -(range - 1)));
  const dates = eachDate(start, end);
  const grouped = db.prepare(`SELECT date,
      COALESCE(SUM(CASE WHEN status!='cancelled' THEN 1 ELSE 0 END),0) bookings,
      COALESCE(SUM(CASE WHEN status!='cancelled' THEN qty ELSE 0 END),0) spots,
      COALESCE(SUM(CASE WHEN status!='cancelled' THEN total ELSE 0 END),0) gross,
      COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) cancellations,
      COALESCE(SUM(CASE WHEN status='cancelled' THEN total ELSE 0 END),0) cancellation_value,
      COALESCE(SUM(CASE WHEN status='cancelled' AND COALESCE(refunded,0)=1 THEN 1 ELSE 0 END),0) refunds,
      COALESCE(SUM(CASE WHEN status='cancelled' AND COALESCE(refunded,0)=1 THEN total ELSE 0 END),0) refund_value,
      COALESCE(SUM(CASE WHEN COALESCE(seeded,0)=1 THEN 1 ELSE 0 END),0) seeded_rows
    FROM bookings WHERE hotel_id=? AND date>=? AND date<=? GROUP BY date`).all(hotel.id, start, end);
  const byDate = new Map(grouped.map(row => [row.date, row]));
  const passes = db.prepare('SELECT id, daily_cap FROM pass_types WHERE hotel_id=?').all(hotel.id);
  const defaultCap = passes.reduce((sum, row) => sum + row.daily_cap, 0);
  const capRows = new Map(db.prepare('SELECT date, cap FROM day_caps WHERE hotel_id=? AND date>=? AND date<=?').all(hotel.id, start, end).map(row => [row.date, row.cap]));
  const blocked = new Set(db.prepare('SELECT date FROM blocked_dates WHERE hotel_id=? AND date>=? AND date<=?').all(hotel.id, start, end).map(row => row.date));
  const series = dates.map(date => {
    const row = byDate.get(date) || { bookings: 0, spots: 0, gross: 0, cancellations: 0, cancellation_value: 0, refunds: 0, refund_value: 0, seeded_rows: 0 };
    const open = !blocked.has(date) && !!(dayPlan(db, hotel, date) || {}).open;
    const cap = open ? (capRows.has(date) ? capRows.get(date) : defaultCap) : null;
    const moneyShare = share(row.gross);
    return {
      date,
      label: nice(date),
      weekday: parseYmd(date).getDay(),
      bookings: row.bookings,
      spots: row.spots,
      gross: row.gross,
      payout: moneyShare.payout,
      cancellations: row.cancellations,
      cancellationValue: row.cancellation_value,
      refunds: row.refunds,
      refundValue: row.refund_value,
      seededRows: row.seeded_rows,
      open,
      cap,
      fill: open && cap > 0 ? row.spots / cap : null,
    };
  });
  const gross = series.reduce((sum, day) => sum + day.gross, 0);
  const parts = share(gross);
  const openDays = series.filter(day => day.open && day.cap > 0);
  const openSpots = openDays.reduce((sum, day) => sum + day.spots, 0);
  const openCap = openDays.reduce((sum, day) => sum + day.cap, 0);
  const byPass = db.prepare(`SELECT p.id, p.name, p.holds, p.sort,
      COUNT(b.id) bookings,
      COALESCE(SUM(b.qty),0) spots,
      COALESCE(SUM(b.total),0) gross
    FROM pass_types p
    LEFT JOIN bookings b ON b.pass_type_id=p.id AND b.hotel_id=? AND b.status!='cancelled' AND b.date>=? AND b.date<=?
    WHERE p.hotel_id=?
    GROUP BY p.id ORDER BY p.sort, p.id`).all(hotel.id, start, end, hotel.id);
  const byWeekday = WEEKDAYS.map(item => {
    const rows = series.filter(day => day.weekday === item.weekday);
    return {
      ...item,
      bookings: rows.reduce((sum, day) => sum + day.bookings, 0),
      spots: rows.reduce((sum, day) => sum + day.spots, 0),
      gross: rows.reduce((sum, day) => sum + day.gross, 0),
    };
  });
  const notes = db.prepare(`SELECT COUNT(DISTINCT b.id) n,
      COUNT(DISTINCT CASE WHEN COALESCE(n.seeded,0)=1 THEN b.id END) seeded
    FROM guest_notes n JOIN bookings b ON b.id=n.booking_id
    WHERE n.hotel_id=? AND n.kind='no_show' AND b.status!='cancelled' AND b.date>=? AND b.date<=?`).get(hotel.id, start, end);
  const views = db.prepare(`SELECT COALESCE(SUM(views),0) views,
      COALESCE(SUM(CASE WHEN seeded=1 THEN views ELSE 0 END),0) seeded
    FROM listing_views WHERE hotel_id=? AND day>=? AND day<=?`).get(hotel.id, start, end);
  const bookings = series.reduce((sum, day) => sum + day.bookings, 0);
  const seededBookings = series.reduce((sum, day) => sum + day.seededRows, 0);
  const demo = isDemoHotel(hotel);
  return {
    range,
    start,
    end,
    days: series,
    bookings,
    spots: series.reduce((sum, day) => sum + day.spots, 0),
    gross,
    payout: parts.payout,
    fee: parts.fee,
    cancellations: series.reduce((sum, day) => sum + day.cancellations, 0),
    cancellationValue: series.reduce((sum, day) => sum + day.cancellationValue, 0),
    refunds: series.reduce((sum, day) => sum + day.refunds, 0),
    refundValue: series.reduce((sum, day) => sum + day.refundValue, 0),
    noShows: notes.n,
    seededNoShows: notes.seeded,
    views: views.views,
    seededViews: views.seeded,
    conversion: views.views > 0 ? bookings / views.views : null,
    byPass,
    byWeekday,
    fill: {
      rate: openCap > 0 ? openSpots / openCap : null,
      spots: openSpots,
      cap: openCap,
      openDays: openDays.length,
    },
    seededBookings,
    demo,
    example: demo || seededBookings > 0 || views.seeded > 0 || notes.seeded > 0,
  };
}

function tick(date, range) {
  const d = parseYmd(date);
  if (range <= 7) return `${esc(d.toLocaleDateString('en-AU', { weekday: 'short' }))}<br>${d.getDate()}`;
  return esc(String(d.getDate()));
}
function peakDay(days) {
  return days.reduce((best, day) => (day.gross > best.gross ? day : best), days[0]);
}
function bars(days, { range, heightFor, barClass, caption, foot }) {
  return `<div class="vchart-wrap"${range > 7 ? ' tabindex="0"' : ''}><div class="vchart${range > 7 ? ' scroll' : ' fit'}" role="img" aria-label="${esc(caption)}">${days.map(day => {
    const height = Math.max(0, Math.min(100, heightFor(day)));
    const on = height > 0;
    return `<div class="vcol"><div class="vtrack${day.open ? '' : ' closed'}"><div class="vbar${on ? ' on' : ''} ${barClass(day)}" style="height:${height}%"></div></div><span class="vlab">${foot(day)}</span></div>`;
  }).join('')}</div></div>`;
}
function hbars(rows, value, labelFor, metaFor) {
  const max = Math.max(1, ...rows.map(value));
  return `<ul class="hbars">${rows.map(row => {
    const width = Math.round(value(row) / max * 100);
    return `<li><div class="hrow"><span class="hname">${esc(labelFor(row))}</span><span class="hmeta">${metaFor(row)}</span><span class="htrack"><span class="hbar" style="width:${width}%"></span></span></div></li>`;
  }).join('')}</ul>`;
}
function exampleNote(report) {
  if (report.demo) return 'Example data. This is a demo listing, not a live hotel. Sample bookings and sample page views are included so there is something to look at. They are not real sales. A booking made in the demo is counted as well, and it is still not a real charge.';
  return 'Example data. These figures include sample rows loaded for the demo. They are not live results.';
}
function renderAnalytics(report) {
  const peak = report.days.length ? peakDay(report.days) : null;
  const revenueCaption = !peak || peak.gross === 0
    ? `Gross revenue by day from ${nice(report.start)} to ${nice(report.end)}. No revenue in this period.`
    : `Gross revenue by day from ${nice(report.start)} to ${nice(report.end)}. The highest day is ${peak.label} at ${money(peak.gross)}. Total gross is ${money(report.gross)}.`;
  const fillCaption = report.fill.rate == null
    ? 'No open days in this period, so there is no fill rate.'
    : `Fill rate by day. ${report.fill.spots} of ${report.fill.cap} spots were booked on ${report.fill.openDays} open day${report.fill.openDays === 1 ? '' : 's'}, ${pct(report.fill.rate)} of the cap. Closed days are hatched.`;
  const revenueChart = bars(report.days, {
    range: report.range,
    heightFor: day => {
      const max = peak ? peak.gross : 0;
      return max > 0 ? (day.gross / max) * 100 : 0;
    },
    barClass: () => '',
    caption: revenueCaption,
    foot: day => tick(day.date, report.range),
  });
  const fillChart = bars(report.days, {
    range: report.range,
    heightFor: day => (day.fill == null ? 0 : day.fill * 100),
    barClass: day => (day.fill > 1 ? 'over' : ''),
    caption: fillCaption,
    foot: day => tick(day.date, report.range),
  });
  const rangeNav = RANGES.map(n => `<a href="/hotel/analytics?range=${n}"${n === report.range ? ' aria-current="page"' : ''}>Last ${n} days</a>`).join('');
  const passBody = report.byPass.length
    ? hbars(report.byPass, row => row.bookings, row => spotLabel(row), row => `${row.bookings} booking${row.bookings === 1 ? '' : 's'} · ${money(row.gross)}`)
    : '<p class="an-note">No seating types yet.</p>';
  const dailyRows = report.days.map(day => `<tr><td>${esc(day.label)}</td><td>${day.bookings}</td><td>${money(day.gross)}</td><td>${money(day.payout)}</td><td>${day.open ? day.spots : '—'}</td><td>${day.open ? day.cap : 'Closed'}</td><td>${day.fill == null ? '—' : pct(day.fill)}</td></tr>`).join('');
  const badge = report.example ? '<p class="example-badge">Example data</p>' : '';
  const note = report.example ? `<p class="example-note">${exampleNote(report)}</p>` : '';
  const conversionSmall = report.views > 0
    ? `${report.bookings} confirmed booking${report.bookings === 1 ? '' : 's'} and ${report.views.toLocaleString('en-AU')} page view${report.views === 1 ? '' : 's'}`
    : 'No page views in this period';
  return `<div class="an">
<div class="an-top"><div><p class="eyebrow-s">Analytics</p><h1 class="l-title">How this listing is doing</h1>
<p class="an-lead">Last ${report.range} days, ${esc(nice(report.start))} to ${esc(nice(report.end))}. Figures use the day of the visit.</p></div>${badge}</div>
${note}
<nav class="range-pick" aria-label="Date range">${rangeNav}</nav>
<div class="stats three">
<div class="stat"><span>Bookings</span><b>${report.bookings.toLocaleString('en-AU')}</b><small>${report.spots.toLocaleString('en-AU')} spots. Cancelled visits are not included.</small></div>
<div class="stat"><span>Gross revenue</span><b>${money(report.gross)}</b><small>Seating and add-ons on confirmed visits.</small></div>
<div class="stat payout"><span>Your payout</span><b>${money(report.payout)}</b><small>What you receive.</small></div>
</div>
<section class="panel"><h2 class="ph2">Revenue over time</h2>
<p class="an-note">Each bar is gross revenue for that day. Your payout is what you receive for the same days. A hatched bar is a day the pool is closed. Amounts for every day are in the table below.</p>
${revenueChart}
${report.range > 7 ? '<p class="an-note">Scroll sideways to see each day. Amounts are in the table below.</p>' : ''}</section>
<section class="panel"><h2 class="ph2">Fill rate</h2>
<p class="an-lead an-fill">${report.fill.rate == null ? 'No open days in this period.' : `<b>${pct(report.fill.rate)}</b> full · ${report.fill.spots.toLocaleString('en-AU')} of ${report.fill.cap.toLocaleString('en-AU')} spots on ${report.fill.openDays} open day${report.fill.openDays === 1 ? '' : 's'}`}</p>
<p class="an-note">Fill rate compares spots booked with that day's cap. The cap is the total of your seating limits, or a lower number if you capped that day. A full bar is 100%. Closed days are hatched and left out of the percentage.</p>
${fillChart}</section>
<section class="panel"><h2 class="ph2">Each day</h2>
<div class="an-table-scroll"><table class="tbl"><caption class="sr-only">Daily bookings, gross revenue, payout, spots, cap and fill rate</caption><thead><tr><th scope="col">Date</th><th scope="col">Bookings</th><th scope="col">Gross</th><th scope="col">Your payout</th><th scope="col">Spots</th><th scope="col">Cap</th><th scope="col">Fill</th></tr></thead><tbody>${dailyRows}</tbody></table></div></section>
<div class="an-grid">
<section class="panel"><h2 class="ph2">By pass type</h2>
<p class="an-note">Confirmed bookings for each seating type. The amount is the booking total, including add-ons.</p>
${passBody}</section>
<section class="panel"><h2 class="ph2">By day of week</h2>
<p class="an-note">Confirmed bookings by the weekday of the visit, not the day the guest booked.</p>
${hbars(report.byWeekday, row => row.bookings, row => row.label, row => `${row.bookings} booking${row.bookings === 1 ? '' : 's'} · ${money(row.gross)}`)}</section>
</div>
<section class="panel"><h2 class="ph2">Cancellations, refunds and no-shows</h2>
<div class="stats three">
<div class="stat"><span>Cancellations</span><b>${report.cancellations.toLocaleString('en-AU')}</b><small>${money(report.cancellationValue)} in cancelled bookings. Not included in revenue or fill.</small></div>
<div class="stat"><span>Refunds</span><b>${report.refunds.toLocaleString('en-AU')}</b><small>${money(report.refundValue)} returned. Already included in the cancellation count. A late cancellation may not be refunded.</small></div>
<div class="stat"><span>No-shows</span><b>${report.noShows.toLocaleString('en-AU')}</b><small>Marked from the guest list. The booking stays confirmed, so it still counts as revenue.</small></div>
</div></section>
<section class="panel"><h2 class="ph2">Listing views</h2>
<div class="stats">
<div class="stat"><span>Listing views</span><b>${report.views.toLocaleString('en-AU')}</b><small>Opens of your public page in this period.</small></div>
<div class="stat payout"><span>View to booking</span><b>${pct(report.conversion)}</b><small>${conversionSmall}</small></div>
</div>
<p class="an-note">A listing view is counted on the server when someone opens your public page. Only a daily total is stored. Names, email addresses, phone numbers and IP addresses are not. Refreshing the page counts again. This is not a count of unique people.</p>
<p class="an-note">View to booking is confirmed bookings in this period divided by listing views in the same period. A guest may look on one day and book another, so this is a simple ratio, not a path for each person.</p>
</section>
</div>`;
}

module.exports = {
  HOTEL_SHARE, RANGES, normalRange, share, pct, isDemoHotel,
  recordListingView, buildAnalytics, renderAnalytics,
};
