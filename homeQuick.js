const { esc } = require('./util');

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ICON_CAL = '<svg class="qi" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_SUN = '<svg class="qi" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

class HomeQuick {
  static parts(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    return { y, mo, d, wd: new Date(Date.UTC(y, mo, d)).getUTCDay() };
  }

  static shift(iso, days) {
    const p = HomeQuick.parts(iso);
    if (!p) return '';
    const dt = new Date(Date.UTC(p.y, p.mo, p.d + days));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  static dayLabel(iso) {
    const p = HomeQuick.parts(iso);
    return p ? `${WEEK[p.wd]} ${p.d} ${MONTH[p.mo]}` : '';
  }

  static rangeLabel(from, to) {
    const a = HomeQuick.parts(from);
    const b = HomeQuick.parts(to);
    if (!a || !b) return '';
    return `${WEEK[a.wd]} ${a.d}\u2013${WEEK[b.wd]} ${b.d}`;
  }

  static nextSaturday(iso) {
    const p = HomeQuick.parts(iso);
    if (!p) return '';
    return HomeQuick.shift(iso, p.wd === 6 ? 7 : 6 - p.wd);
  }

  static weekend(iso, { cutoff = false } = {}) {
    const p = HomeQuick.parts(iso);
    if (!p) return null;
    const startsNext = p.wd === 0 || (p.wd === 6 && cutoff);
    if (startsNext) {
      const sat = HomeQuick.nextSaturday(HomeQuick.shift(iso, 1));
      return { label: 'Next weekend', from: sat, to: HomeQuick.shift(sat, 1) };
    }
    if (p.wd === 6) return { label: 'This weekend', from: iso, to: HomeQuick.shift(iso, 1) };
    const sat = HomeQuick.shift(iso, 6 - p.wd);
    return { label: 'This weekend', from: sat, to: HomeQuick.shift(sat, 1) };
  }

  static build(todayIso, { cutoff = false } = {}) {
    if (!HomeQuick.parts(todayIso)) return null;
    const first = cutoff
      ? { label: 'Tomorrow', date: HomeQuick.shift(todayIso, 1) }
      : { label: 'Today', date: todayIso };
    const weekend = HomeQuick.weekend(todayIso, { cutoff });
    return {
      first: {
        label: first.label,
        sub: HomeQuick.dayLabel(first.date),
        href: `/search?date=${first.date}`,
        date: first.date,
      },
      second: {
        label: weekend.label,
        sub: HomeQuick.rangeLabel(weekend.from, weekend.to),
        href: `/search?from=${weekend.from}&to=${weekend.to}`,
        from: weekend.from,
        to: weekend.to,
      },
    };
  }

  // Home hero: one quiet row of shortcuts under the search pill.
  static popular(todayIso, opts) {
    const q = HomeQuick.build(todayIso, opts);
    if (!q) return '';
    const links = [
      { label: q.first.label, href: q.first.href },
      { label: q.second.label, href: q.second.href },
      { label: 'Rooftop pools', href: '/search?mood=rooftop' },
      { label: 'Spa afternoon', href: '/search?want=spa' },
      { label: 'Family friendly', href: '/search?mood=family' },
    ];
    return `<nav class="popular" aria-label="Popular searches"><span>Popular:</span>${links.map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}</nav>`;
  }

  static html(todayIso, opts) {
    const q = HomeQuick.build(todayIso, opts);
    if (!q) return '';
    const btn = (b, icon) => `<a class="qb" href="${esc(b.href)}">${icon}<span><b>${esc(b.label)}</b><small>${esc(b.sub)}</small></span></a>`;
    return `<div class="quick" role="group" aria-label="Quick dates">${btn(q.first, ICON_CAL)}${btn(q.second, ICON_SUN)}</div>`;
  }
}

module.exports = { HomeQuick };
