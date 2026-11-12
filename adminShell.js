const seo = require('./seo');
const { demoSite } = require('./siteMode');
const { esc, money, nice } = require('./util');
const { HOTEL_SHARE, hotelPct, feePct } = require('./commission');

const FONT_LINKS = `<link rel="preload" href="/golden/fonts/f3.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/golden/fonts/f5.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/golden/fonts.css">`;

const TABS = [
  ['/admin', 'Overview'],
  ['/admin/bookings', 'Bookings'],
  ['/admin/hotels', 'Hotels'],
  ['/admin/messages', 'Messages'],
  ['/admin/backups', 'Backups'],
];

class AdminShell {
  static counts(db) {
    const hotels = db.prepare("SELECT COUNT(*) n FROM hotels WHERE status='pending'").get().n;
    const messages = db.prepare('SELECT COUNT(*) n FROM contact_messages WHERE handled=0').get().n;
    return { hotels, messages };
  }

  static flash(msg) {
    if (!msg) return '';
    return `<div class="flash" role="status">${esc(msg)}</div>`;
  }

  static heading(title, sub) {
    const chip = demoSite() ? '<span class="adm-ex">Example data</span>' : '';
    const line = sub ? `<p class="adm-sub">${esc(sub)}</p>` : '';
    return `<h1>${esc(title)}${chip}</h1>${line}`;
  }

  static tiles(tot, addonAll) {
    const paid = money(tot.gross * HOTEL_SHARE);
    const fee = money(tot.gross * (1 - HOTEL_SHARE));
    return `<div class="adm-tiles">
<div class="adm-tile"><span class="k">Bookings</span><b class="v">${tot.n}</b><small>${tot.passes} spots</small></div>
<div class="adm-tile"><span class="k">Gross sales</span><b class="v">${money(tot.gross)}</b><small>Includes ${money(addonAll)} add-ons</small></div>
<div class="adm-tile"><span class="k">Paid to hotels (${hotelPct()}%)</span><b class="v">${paid}</b></div>
<div class="adm-tile"><span class="k">Platform commission (${feePct()}%)</span><b class="v">${fee}</b><small>Hotel Day Club revenue</small></div>
</div>
<p class="adm-note">Gross includes add-ons. Commission stays at ${feePct()}% of that gross.</p>`;
  }

  static byHotel(rows, tot) {
    const body = rows.map(r => `<tr>
<td data-label="Hotel"><span><a href="/admin/bookings?hotel=${r.id}">${esc(r.name)}</a><div class="adm-muted">${esc(r.area || '')}</div></span></td>
<td class="num" data-label="Bookings">${r.n}</td>
<td class="num" data-label="Spots">${r.passes}</td>
<td class="num" data-label="Today">${r.today}</td>
<td class="num" data-label="Gross">${money(r.gross)}</td>
<td class="num" data-label="Hotel ${hotelPct()}%">${money(r.gross * HOTEL_SHARE)}</td>
<td class="num" data-label="Commission ${feePct()}%"><b>${money(r.gross * (1 - HOTEL_SHARE))}</b></td>
</tr>`).join('');
    return `<section class="adm-card"><h2>By hotel</h2><div class="adm-table adm-stack"><table>
<thead><tr><th>Hotel</th><th class="num">Bookings</th><th class="num">Spots</th><th class="num">Today</th><th class="num">Gross</th><th class="num">Hotel ${hotelPct()}%</th><th class="num">Commission ${feePct()}%</th></tr></thead>
<tbody>${body}
<tr class="tot"><td data-label="Hotel">Total</td><td class="num" data-label="Bookings">${tot.n}</td><td class="num" data-label="Spots">${tot.passes}</td><td class="num" data-label="Today">${tot.today}</td><td class="num" data-label="Gross">${money(tot.gross)}</td><td class="num" data-label="Hotel ${hotelPct()}%">${money(tot.gross * HOTEL_SHARE)}</td><td class="num" data-label="Commission ${feePct()}%">${money(tot.gross * (1 - HOTEL_SHARE))}</td></tr>
</tbody></table></div></section>`;
  }

  static attention({ hotels, messages }) {
    const items = [];
    if (hotels > 0) items.push(`<li><a href="/admin/hotels">Hotels awaiting approval</a><b class="n">${hotels}</b></li>`);
    if (messages > 0) items.push(`<li><a href="/admin/messages#messages">New messages</a><b class="n">${messages}</b></li>`);
    const body = items.length ? `<ul class="adm-att">${items.join('')}</ul>` : '<p>Nothing needs attention.</p>';
    return `<section class="adm-card"><h2>Needs attention</h2>${body}</section>`;
  }

  static bookingStatus(row) {
    if (row.status === 'cancelled') return '<span class="adm-st adm-st-x">Cancelled</span>';
    if (row.checked_in_at) return '<span class="adm-st adm-st-ok">Arrived</span>';
    return '<span class="adm-st adm-st-ok">Confirmed</span>';
  }

  static recent(rows) {
    const head = `<div class="adm-card-h"><h2>Recent bookings</h2><a href="/admin/bookings">All bookings</a></div>`;
    if (!rows.length) return `<section class="adm-card">${head}<p>No bookings yet.</p></section>`;
    const body = rows.map(b => `<tr>
<td data-label="Ref"><a href="/booking/${esc(b.code)}">${esc(b.code)}</a></td>
<td data-label="Guest"><span><b>${esc(b.guest_name)}</b><div class="adm-muted">${esc(b.email)}</div></span></td>
<td data-label="Hotel">${esc(b.hotel)}</td>
<td data-label="Date">${esc(nice(b.date))}</td>
<td data-label="Status">${AdminShell.bookingStatus(b)}</td>
<td class="num" data-label="Gross sales">${money(b.total)}</td>
</tr>`).join('');
    return `<section class="adm-card">${head}<div class="adm-table adm-stack"><table>
<thead><tr><th>Ref</th><th>Guest</th><th>Hotel</th><th>Date</th><th>Status</th><th class="num">Gross sales</th></tr></thead>
<tbody>${body}</tbody></table></div></section>`;
  }

  static bookingsHref({ q = '', hotel = 0, status = '', page = 1 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (hotel) params.set('hotel', String(hotel));
    if (status) params.set('status', status);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    return query ? `/admin/bookings?${query}` : '/admin/bookings';
  }

  static filters({ q, hotel, status, hotels }) {
    const hotelOpts = [`<option value="">All hotels</option>`].concat(hotels.map(h => {
      const on = Number(h.id) === Number(hotel) ? ' selected' : '';
      return `<option value="${h.id}"${on}>${esc(h.name)}</option>`;
    }));
    const states = [['', 'Any status'], ['confirmed', 'Confirmed'], ['arrived', 'Arrived'], ['cancelled', 'Cancelled']];
    const statusOpts = states.map(([value, label]) => `<option value="${value}"${value === status ? ' selected' : ''}>${label}</option>`).join('');
    return `<form class="adm-filters" method="get" action="/admin/bookings">
<label class="f">Search<input name="q" value="${esc(q)}" placeholder="Code, name or email"></label>
<label class="f">Hotel<select name="hotel">${hotelOpts.join('')}</select></label>
<label class="f">Status<select name="status">${statusOpts}</select></label>
<button class="btn adm-btn-p">Filter</button>
<a class="btn" href="/admin/bookings">Clear</a>
</form>`;
  }

  static pager({ q, hotel, status, page, total, count }) {
    const pages = Math.max(1, Math.ceil(total / 10));
    const text = total === 0
      ? 'No bookings match.'
      : `Showing ${(page - 1) * 10 + 1}\u2013${(page - 1) * 10 + count} of ${total}`;
    const prev = page <= 1
      ? '<span class="btn adm-btn" aria-disabled="true">Previous</span>'
      : `<a class="btn adm-btn" href="${esc(AdminShell.bookingsHref({ q, hotel, status, page: page - 1 }))}">Previous</a>`;
    const next = page >= pages
      ? '<span class="btn adm-btn" aria-disabled="true">Next</span>'
      : `<a class="btn adm-btn" href="${esc(AdminShell.bookingsHref({ q, hotel, status, page: page + 1 }))}">Next</a>`;
    return `<div class="adm-pager"><p class="adm-range">${text}</p><div class="adm-pager-nav">${prev}${next}</div></div>`;
  }

  static page(here, inner, opts = {}) {
    const title = opts.title || 'Admin';
    const hotelCount = Number(opts.hotels) || 0;
    const messageCount = Number(opts.messages) || 0;
    const countFor = href => {
      if (href === '/admin/hotels' && hotelCount > 0) return ` <span class="adm-count">${hotelCount}</span>`;
      if (href === '/admin/messages' && messageCount > 0) return ` <span class="adm-count">${messageCount}</span>`;
      return '';
    };
    const tabs = TABS.map(([href, label]) => {
      const current = href === here ? ' aria-current="page"' : '';
      return `<a href="${href}"${current}>${label}${countFor(href)}</a>`;
    }).join('');
    const drawer = TABS.map(([href, label]) => {
      const current = href === here ? ' class="is-current"' : '';
      return `<a href="${href}"${current}>${label}${countFor(href)}</a>`;
    }).join('');
    const meta = seo.headMeta({
      documentTitle: seo.fullTitle(title),
      description: '',
      robots: seo.robotsContent(false),
      canonicalUrl: '',
      image: '',
    });
    const css = `${FONT_LINKS}<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/golden/site.css">`;
    const banner = demoSite() ? '<div class="demo-banner">Demo site: listings are examples, no real bookings or payments.</div>' : '';
    return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${meta}${css}</head><body class="adm">
${banner}
<header class="adm-top"><div class="adm-top-in">
<a class="adm-logo" href="/admin"><img src="/assets/hdc-lockup-light.svg" alt="Hotel Day Club" width="187" height="32"></a><span class="adm-tag">Admin</span>
<nav class="adm-tabs" aria-label="Admin sections">${tabs}</nav>
<a class="adm-signout" href="/admin/logout">Sign out</a>
<a class="adm-menu" href="#adm-menu" aria-controls="adm-menu">Menu</a>
</div></header>
<div class="adm-drawer" id="adm-menu" role="dialog" aria-label="Admin menu"><nav>
<a class="adm-close" href="#">Close</a>
${drawer}
<hr>
<a href="/admin/logout">Sign out</a>
</nav></div>
<main class="adm-main">${inner}</main>
</body></html>`;
  }
}

module.exports = { AdminShell };
