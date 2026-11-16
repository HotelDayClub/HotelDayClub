const { esc, nice, ymd, addDays } = require('./util');
const { amenityLines, includedLines } = require('./inclusions');
const { SearchQuery } = require('./search');

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
    return 'Towels included';
  }

  static towelFor(items, people) {
    const towel = (items || []).find(i => i.code === 'towels');
    if (towel && towel.mode === 'included') return 'Towels included';
    if (towel && towel.mode === 'off') return 'Bring your own towel';
    return '';
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

  static dayHours(db, hotel, lines, iso) {
    if (db && hotel && iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const { dayHoursText } = require('./offering');
      const span = dayHoursText(db, hotel, iso);
      if (span) return span;
    }
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
function listingHtml(opts) {
  const { listingHtmlD2 } = require('./listingDir2');
  return listingHtmlD2(opts);
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
    text: 'Just the pool, gym or spa.',
  },
  {
    icon: '<path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><path d="M10 10h1.6v1.6H10zM12.6 12.6H14V14h-1.4z"/>',
    title: 'Show your QR code at the desk',
    text: 'No printing needed.',
  },
  {
    icon: '<path d="M7.2 8.2A5.2 5.2 0 1 1 6 13"/><path d="M5.2 5.4V9H9"/>',
    title: 'If the pool closes',
    text: 'Full refund or free rebooking.',
  },
  {
    icon: '<rect x="4" y="7" width="16" height="11" rx="1.5"/><path d="M4.5 7.5 12 13l7.5-5.5"/>',
    title: 'Help when you need it',
    text: 'Questions? Email us.',
    href: '/contact',
  },
];

function reassureStrip(lite) {
  const items = ASSURE.map(item => {
    const inner = `<span class="ico-wrap" aria-hidden="true"><svg class="ico" viewBox="0 0 24 24">${item.icon}</svg></span><b>${item.title}</b>${item.text ? `<span>${item.text}</span>` : ''}`;
    return item.href
      ? `<li><a class="assure-link" href="${item.href}">${inner}</a></li>`
      : `<li>${inner}</li>`;
  }).join('');
  return `<section class="assure${lite ? ' assure-lite' : ''}" aria-label="Before you book"><ul>${items}</ul></section>`;
}

class DetailsAlias {
  static replacement(hash) {
    return { '#inclusions': '#details', '#location': '#details', '#policies': '#details', '#seating': '#passes' }[hash] || '';
  }
}

module.exports = { listingHtml, reassureStrip, ListingPanel, dayStepLinks, DetailsAlias };
