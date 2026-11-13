const { esc } = require('./util');
const { absolute } = require('./seo');
const { FOOD_RULE, rulesText, fmtTime } = require('./offering');

const SHARE_KEYS = ['date', 'pass', 'guests', 'qty'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AGE_LABELS = {
  'all ages': 'All ages · family friendly',
  'all-ages': 'All ages · family friendly',
  '18+': 'Adults only (18+)',
  '16+': 'Ages 16 and over',
};
const SKIP_FOOD = new Set(['welcome', 'food', 'poolside']);
const SHARE_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

class ListingImprove {
  static WHY_Q = 'Why no ratings yet?';
  static WHY_A = 'Ratings will only come from real guests after real visits. None are shown now.';
  static STEPS = [
    ['Book a date', 'Pick a pass and a day.'],
    ['Show your QR code', 'At the hotel desk when you arrive.'],
    ['Enjoy your day', 'Within the pass hours.'],
  ];
  static BRING = ['Swimwear', 'Sunscreen and a hat', 'Your QR code or booking code', 'A bag for wet things'];

  static whyText() {
    return `${ListingImprove.WHY_Q} ${ListingImprove.WHY_A}`;
  }

  static mentionsRatingScore(text) {
    return /[★☆]|\bstars?\b|\/\s*5\b|\b\d+(?:\.\d+)?\b/i.test(String(text || ''));
  }

  static cleanShareUrl(href) {
    let url;
    try { url = new URL(String(href || '')); }
    catch (err) { return ''; }
    const keep = new URLSearchParams();
    for (const key of SHARE_KEYS) {
      const value = url.searchParams.get(key);
      if (value) keep.append(key, value);
    }
    const q = keep.toString();
    return url.origin + url.pathname + (q ? `?${q}` : '');
  }

  static pageShareUrl(slug, query) {
    const base = absolute('/h/' + encodeURIComponent(slug || ''));
    const params = new URLSearchParams();
    for (const key of SHARE_KEYS) {
      const value = query && query[key] != null ? String(query[key]).trim() : '';
      if (value) params.set(key, value.slice(0, 80));
    }
    const q = params.toString();
    return q ? `${base}?${q}` : base;
  }

  static sharePlan({ canShare, coarse, errorName, clipboard }) {
    if (canShare && coarse) {
      if (!errorName) return { path: 'share', status: '', fallback: false };
      if (errorName === 'AbortError') return { path: 'share-cancel', status: '', fallback: false };
    }
    if (clipboard === 'ok') return { path: 'copy', status: 'Link copied', fallback: false };
    return { path: 'fallback', status: '', fallback: true, hint: 'Select the link and copy it.' };
  }

  static shareHtml(url) {
    const value = esc(url || '');
    return `<div class="share-area" id="share-area"><details class="share-box" id="share-box"><summary>${SHARE_ICON}Share</summary><label class="share-label">Link to this page<input type="text" readonly value="${value}" form="share-detached"></label><p class="share-hint">Select the link and copy it.</p></details><span class="share-status" id="share-status" role="status" aria-live="polite"></span></div>`;
  }

  static ageLabel(policy) {
    const raw = String(policy || '').trim();
    if (!raw) return '';
    return AGE_LABELS[raw.toLowerCase()] || AGE_LABELS[raw] || '';
  }

  static flag(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  static kidsFact(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (/^no children\b/i.test(raw)) return 'No children';
    if (/^children welcome\b/i.test(raw)) return raw.charAt(0).toUpperCase() + raw.slice(1);
    if (/\band over only\b|\badults only\b/i.test(raw)) return raw;
    return `Children welcome ${raw.charAt(0).toLowerCase()}${raw.slice(1)}`;
  }

  static heatFact(hotel) {
    const heated = ListingImprove.flag(hotel && hotel.heated);
    const setting = hotel && hotel.setting;
    const place = setting === 'indoor' ? 'indoor' : setting === 'outdoor' ? 'outdoor' : setting === 'both' ? 'indoor and outdoor' : '';
    if (heated == null || !place) return '';
    return `${heated ? 'Heated' : 'Unheated'} ${place} pool`;
  }

  static guardFact(hotel) {
    const n = ListingImprove.flag(hotel && hotel.lifeguard);
    if (n == null) return '';
    if (n === 0) return 'Lifeguard: not on duty';
    const hours = String((hotel && hotel.lifeguard_hours) || '').trim();
    if (n === 2 && hours) return `Lifeguard on duty ${hours}`;
    if (n === 1 || n === 2) return 'Lifeguard on duty';
    return '';
  }

  static facts(hotel) {
    const source = hotel || {};
    const rows = [];
    const kids = ListingImprove.kidsFact(source.kids_hours);
    if (kids) rows.push({ key: 'kids', text: kids, example: Number(source.is_demo) === 1 });
    const guard = ListingImprove.guardFact(source);
    if (guard) rows.push({ key: 'guard', text: guard });
    const heat = ListingImprove.heatFact(source);
    if (heat) rows.push({ key: 'heat', text: heat });
    if (ListingImprove.flag(source.id_required) === 1) rows.push({ key: 'id', text: 'Photo ID at check-in' });
    return rows;
  }

  static factsHtml(hotel) {
    const rows = ListingImprove.facts(hotel);
    if (!rows.length) return '';
    const items = rows.map(row => {
      const chip = row.example ? ' <span class="ex">example data</span>' : '';
      return `<li>${esc(row.text)}${chip}</li>`;
    }).join('');
    return `<ul class="facts" aria-label="Key facts">${items}</ul>`;
  }

  static whyHtml() {
    return `<p class="why-no"><b>${esc(ListingImprove.WHY_Q)}</b> ${esc(ListingImprove.WHY_A)}</p>`;
  }

  static stepsHtml() {
    const items = ListingImprove.STEPS.map(([title, text]) => `<li><b>${esc(title)}</b><span>${esc(text)}</span></li>`).join('');
    return `<section class="day-how" aria-labelledby="hiw"><h2 id="hiw">How it works</h2><ol class="steps">${items}</ol></section>`;
  }

  static notIncludedLines(items) {
    const addons = [];
    const off = [];
    for (const item of items || []) {
      if (!item || item.code === 'pool' || item.code === 'towels' || SKIP_FOOD.has(item.code)) continue;
      if (item.mode === 'addon') addons.push(`${item.name} (available as an add-on)`);
      else if (item.mode === 'off') off.push(item.name);
    }
    return [FOOD_RULE, ...addons, ...off];
  }

  static notIncludedHtml(items) {
    const lines = ListingImprove.notIncludedLines(items).map(line => `<li>${esc(line)}</li>`).join('');
    return `<h3><span class="no" aria-hidden="true">✕</span> Not included</h3><ul class="not-inc">${lines}</ul>`;
  }

  static includedEmptyCopy(hasAccess) {
    return hasAccess ? 'Pool access during pass hours' : 'Ask the hotel what is included.';
  }

  static bringItems(hotel) {
    const items = ListingImprove.BRING.slice();
    if (ListingImprove.flag(hotel && hotel.id_required) === 1) items.splice(2, 0, 'Photo ID (this hotel asks for it)');
    return items;
  }

  static towelBring(hotel) {
    return hotel && hotel.towels ? "Towels are provided, so you don't need your own." : 'Bring your own towel';
  }

  static bringHtml(hotel) {
    const items = ListingImprove.bringItems(hotel).map(line => `<li>${esc(line)}</li>`).join('');
    return `<div class="card"><h2>What to bring</h2><ul class="plain">${items}</ul><p class="muted small">${esc(ListingImprove.towelBring(hotel))}</p></div>`;
  }

  static ruleRows(hotel) {
    const source = hotel || {};
    const age = String(source.age_policy || '').trim();
    const kids = String(source.kids_hours || '').trim();
    let ages = [age, kids].filter(Boolean).join('. ');
    if (!ages) ages = 'Ask the hotel';
    const guardN = ListingImprove.flag(source.lifeguard);
    let guard = 'Ask the hotel';
    if (guardN === 0) guard = 'Lifeguard: not on duty';
    else if (guardN === 1 || guardN === 2) guard = ListingImprove.guardFact(source) || 'Ask the hotel';
    const idN = ListingImprove.flag(source.id_required);
    let id = 'Ask the hotel';
    if (idN === 1) id = 'Photo ID at check-in. The booking name must match someone in your group.';
    else if (idN === 0) id = 'Photo ID is not required';
    const dress = String(source.dress_code || '').trim() || 'Ask the hotel';
    return [
      ['Ages', ages, !!(kids && Number(source.is_demo) === 1)],
      ['Lifeguard', guard, false],
      ['ID', id, false],
      ['Food rule', FOOD_RULE, false],
      ['Glass', 'Ask the hotel', false],
      ['Dress code', dress, false],
    ];
  }

  static recordedRules(hotel, opts) {
    return rulesText(hotel || {}, opts);
  }

  static rulesHtml(hotel) {
    const rows = ListingImprove.ruleRows(hotel).map(([label, text, example]) => {
      const chip = example ? ' <span class="ex">example data</span>' : '';
      return `<div><dt>${esc(label)}</dt><dd>${esc(text)}${chip}</dd></div>`;
    }).join('');
    return `<div class="card" id="house-rules"><h2>Rules</h2><dl class="house-rules">${rows}</dl><p><a class="risk-link" href="/risk">Read the pool risk warning</a></p></div>`;
  }

  static closedLabel(iso, reason) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    const why = String(reason || '').replace(/\s+/g, ' ').trim();
    const clipped = (why || 'closed').slice(0, 60).trim();
    return `${WEEK_SHORT[wd]} ${d} ${MONTHS[m - 1]}: ${clipped}`;
  }

  static closedDates(rows, todayIso) {
    return (rows || [])
      .filter(row => row && /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') && (!todayIso || row.date >= todayIso))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
      .slice(0, 3)
      .map(row => ({ date: row.date, label: ListingImprove.closedLabel(row.date, row.reason) }));
  }

  static closedWeekdays(lines) {
    const days = (lines || []).filter(row => row && row.time === 'Closed' && WEEKDAYS.includes(row.day)).map(row => row.day);
    if (!days.length) return '';
    if (days.length === 1) return `Closed ${days[0]}`;
    return `Closed ${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
  }

  static seasonPart(mmdd) {
    const [m, d] = String(mmdd || '').split('-').map(Number);
    if (!m || !d || m < 1 || m > 12) return '';
    return `${d} ${MONTHS[m - 1]}`;
  }

  static seasonLine(hotel) {
    if (!hotel || !hotel.season_start || !hotel.season_end) return '';
    const start = ListingImprove.seasonPart(hotel.season_start);
    const end = ListingImprove.seasonPart(hotel.season_end);
    if (!start || !end) return '';
    return `Season: ${start} to ${end}`;
  }

  static roomLine(hotel) {
    if (!hotel || !hotel.room_only_from || !hotel.room_only_to) return '';
    return `Room guests only ${fmtTime(hotel.room_only_from)} to ${fmtTime(hotel.room_only_to)}`;
  }

  static seasonHtml(hotel, hourRows, blocked) {
    const demo = Number(hotel && hotel.is_demo) === 1;
    const chip = demo ? ' <span class="ex">example data</span>' : '';
    const parts = [];
    const season = ListingImprove.seasonLine(hotel);
    if (season) parts.push(`<p class="season-line"><b>${esc(season)}</b>${chip}</p>`);
    const week = ListingImprove.closedWeekdays(hourRows);
    if (week) parts.push(`<p>${esc(week)}</p>`);
    const dates = ListingImprove.closedDates(blocked);
    if (dates.length) {
      const items = dates.map(row => `<li>${esc(row.label)}${chip}</li>`).join('');
      parts.push(`<p class="muted small">Next closed dates</p><ul class="closed">${items}</ul>`);
    } else parts.push('<p>No closed dates set.</p>');
    const room = ListingImprove.roomLine(hotel);
    if (room) parts.push(`<p>${esc(room)}${chip}</p>`);
    return `<div class="card season" id="season"><h2>Season and closed dates</h2>${parts.join('')}</div>`;
  }

  static cancelHtml(note) {
    return `<div class="cancel-sum"><p class="cancel-note" id="cancel-note" aria-live="polite">${esc(note || '')}</p><a class="cancel-policy" href="/refunds">Refund policy</a></div>`;
  }
}

module.exports = { ListingImprove, SHARE_KEYS };
