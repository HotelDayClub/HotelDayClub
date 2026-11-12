const { nice } = require('./util');
const { minutes } = require('./offering');

// Sydney destinations share one region. Everywhere else is its own region.
// "Nearest" is same region first, then the cheapest from-price. There are no map pins.
const SYDNEY = new Set(['sydney-cbd', 'bondi', 'manly', 'north-sydney', 'eastern-suburbs', 'parramatta']);
const PRICE_CAPS = [50, 100, 150];
const HOME_KEYS = ['where', 'dest', 'date', 'want', 'guests', 'price', 'age', 'sort'];

class SearchQuery {
  static WANTS = [
    { id: '', label: 'Any' },
    { id: 'pool', label: 'Pool' },
    { id: 'gym', label: 'Gym' },
    { id: 'spa', label: 'Spa' },
    { id: 'pool-spa', label: 'Pool + Spa' },
  ];

  static SORTS = [
    { id: '', label: 'Recommended' },
    { id: 'price-asc', label: 'Price: low to high' },
    { id: 'price-desc', label: 'Price: high to low' },
    { id: 'hours', label: 'Longest hours' },
  ];

  static first(query, key) {
    if (!query || typeof query !== 'object') return '';
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value == null ? '' : String(value).trim();
  }

  static regionId(destinationId) {
    if (SYDNEY.has(destinationId)) return 'sydney';
    return destinationId || '';
  }

  static regionByArea(destinations) {
    const map = new Map();
    for (const d of destinations || []) {
      const region = SearchQuery.regionId(d.id);
      for (const area of d.areas || []) map.set(area, region);
    }
    return map;
  }

  static findDestination(query, destinations) {
    const list = destinations || [];
    const candidates = [
      SearchQuery.first(query, 'destination'),
      SearchQuery.first(query, 'dest'),
      SearchQuery.first(query, 'where'),
    ];
    for (const value of candidates) {
      if (!value) continue;
      const lower = value.toLowerCase();
      const named = list.find(d => d.id === value || d.slug === value || String(d.name).toLowerCase() === lower);
      if (named) return named;
      const byArea = list.find(d => (d.areas || []).some(area => String(area).toLowerCase() === lower));
      if (byArea) return byArea;
    }
    return null;
  }

  // Home keeps ?destination= for the waitlist prefill. Search filters on / redirect.
  static homeRedirect(query) {
    const params = new URLSearchParams();
    let any = false;
    for (const key of HOME_KEYS) {
      const value = SearchQuery.first(query, key);
      if (!value) continue;
      params.set(key, value);
      any = true;
    }
    if (!any) return '';
    const destination = SearchQuery.first(query, 'destination');
    if (destination) params.set('destination', destination);
    return '/search?' + params.toString();
  }

  static parse(query, destinations) {
    const dateRaw = SearchQuery.first(query, 'date');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : '';
    const wantRaw = SearchQuery.first(query, 'want');
    const want = SearchQuery.WANTS.some(w => w.id && w.id === wantRaw) ? wantRaw : '';
    const guestsRaw = parseInt(SearchQuery.first(query, 'guests'), 10);
    const guests = guestsRaw >= 1 && guestsRaw <= 6 ? guestsRaw : 0;
    const priceRaw = parseInt(SearchQuery.first(query, 'price'), 10);
    const price = PRICE_CAPS.includes(priceRaw) ? priceRaw : 0;
    const ageRaw = SearchQuery.first(query, 'age');
    const age = ageRaw === 'kids' || ageRaw === '18' ? ageRaw : '';
    const sortRaw = SearchQuery.first(query, 'sort');
    const sort = SearchQuery.SORTS.some(s => s.id && s.id === sortRaw) ? sortRaw : '';
    const destination = SearchQuery.findDestination(query, destinations);
    const wantLabel = want ? (SearchQuery.WANTS.find(w => w.id === want) || {}).label || '' : '';
    const ageLabel = age === 'kids' ? 'Kids welcome' : age === '18' ? 'Adults only (18+)' : '';
    return { destination, date, dateLabel: date ? nice(date) : '', want, wantLabel, guests, price, age, ageLabel, sort };
  }

  static kidsWelcome(policy) {
    return /all ages/i.test(String(policy || ''));
  }

  static adultsOnly(policy) {
    return /18\s*\+/.test(String(policy || ''));
  }

  static ageMatch(policy, age) {
    if (age === 'kids') return SearchQuery.kidsWelcome(policy);
    if (age === '18') return SearchQuery.adultsOnly(policy);
    return true;
  }

  // A price band is offered only when it both keeps and drops at least one hotel.
  static priceChoices(prices, current) {
    const nums = (prices || []).map(Number).filter(n => Number.isFinite(n));
    const caps = PRICE_CAPS.filter(cap => nums.some(n => n < cap) && nums.some(n => n >= cap));
    if (current && PRICE_CAPS.includes(current) && !caps.includes(current)) caps.push(current);
    caps.sort((a, b) => a - b);
    return caps;
  }

  // Guest counts stop at the largest pass the data can hold, and never above 6.
  static guestChoices(holds, current) {
    const nums = (holds || []).map(n => Number(n) || 0).filter(n => n > 0);
    const max = nums.length ? Math.max(...nums) : 1;
    let top = Math.min(6, max);
    if (current > top && current <= 6) top = current;
    const out = [];
    for (let n = 1; n <= top; n++) out.push(n);
    return out;
  }

  static ageChoices(policies, current) {
    const list = policies || [];
    const out = [];
    if (list.some(p => SearchQuery.kidsWelcome(p)) || current === 'kids') out.push({ id: 'kids', label: 'Kids welcome' });
    if (list.some(p => SearchQuery.adultsOnly(p)) || current === '18') out.push({ id: '18', label: 'Adults only (18+)' });
    return out;
  }

  // A chip is shown only when it both keeps and drops at least one hotel.
  static intentChips(hotels, offers, priceOf) {
    const list = hotels || [];
    const rows = list.map(h => ({
      pool: Boolean(offers(h, 'pool')),
      spa: Boolean(offers(h, 'spa')),
      gym: Boolean(offers(h, 'gym')),
      kids: SearchQuery.kidsWelcome(h.age_policy),
      adults: SearchQuery.adultsOnly(h.age_policy),
      price: priceOf(h),
    }));
    const changes = pred => {
      const n = rows.filter(pred).length;
      return rows.length > 0 && n > 0 && n < rows.length;
    };
    const chips = [];
    if (changes(r => r.pool)) chips.push({ key: 'want', value: 'pool', label: 'Pool' });
    if (changes(r => r.spa)) chips.push({ key: 'want', value: 'spa', label: 'Spa' });
    if (changes(r => r.gym)) chips.push({ key: 'want', value: 'gym', label: 'Gym' });
    if (changes(r => r.kids)) chips.push({ key: 'age', value: 'kids', label: 'Kids welcome' });
    if (changes(r => r.adults)) chips.push({ key: 'age', value: '18', label: 'Adults only (18+)' });
    for (const cap of SearchQuery.priceChoices(rows.map(r => r.price), 0)) {
      chips.push({ key: 'price', value: String(cap), label: 'Under $' + cap });
    }
    return chips;
  }

  static chipOn(params, chip) {
    return String(params[chip.key] == null ? '' : params[chip.key]) === String(chip.value);
  }

  static toggle(params, chip) {
    const next = {
      destination: params.destination,
      date: params.date,
      want: params.want,
      guests: params.guests,
      price: params.price,
      age: params.age,
      sort: params.sort,
    };
    next[chip.key] = SearchQuery.chipOn(params, chip) ? '' : chip.value;
    if (chip.key === 'price') next.price = next.price ? Number(next.price) : 0;
    return next;
  }

  static drawerCount(params) {
    return ['want', 'price', 'age', 'guests'].filter(key => params[key]).length;
  }

  static summary(params) {
    const where = params.destination ? params.destination.name : 'Anywhere';
    const when = params.dateLabel || 'Any date';
    const guests = params.guests ? String(params.guests) : 'Any';
    let face = 'Search';
    if (params.destination || params.date || params.guests) {
      let day = 'Any day';
      if (params.date) {
        const parsed = new Date(params.date + 'T00:00:00');
        day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsed.getDay()] + ' ' + parsed.getDate();
      }
      face = where + ' · ' + day;
      if (params.guests) face += ' · ' + params.guests;
    }
    return { where, when, guests, label: where + ' · ' + when + ' · ' + guests, face };
  }

  static partyCap(passes) {
    const holds = (passes || []).map(p => Number(p.holds) || 1);
    return holds.length ? Math.max(...holds) : 1;
  }

  static fromPrice(passes) {
    const prices = (passes || []).map(p => Number(p.price)).filter(n => Number.isFinite(n));
    return prices.length ? Math.min(...prices) : 0;
  }

  static openMinutes(rows, roomFrom) {
    let best = 0;
    const room = minutes(roomFrom);
    for (const row of rows || []) {
      if (!row.open) continue;
      const start = minutes(row.opens);
      let end = minutes(row.closes);
      if (start == null || end == null || end <= start) continue;
      if (room != null && room > start && room < end) end = room;
      if (end > start) best = Math.max(best, end - start);
    }
    return best;
  }

  static spanMinutes(plan) {
    if (!plan || !plan.open) return 0;
    const start = minutes(plan.opens);
    const end = minutes(plan.effective || plan.closes);
    if (start == null || end == null || end <= start) return 0;
    return end - start;
  }

  static href(params, omit) {
    const q = new URLSearchParams();
    const add = (key, value) => {
      if (key === omit || value == null || value === '' || value === 0) return;
      q.set(key, String(value));
    };
    add('destination', params.destination && params.destination.id);
    add('date', params.date);
    add('want', params.want);
    add('guests', params.guests);
    add('price', params.price);
    add('age', params.age);
    add('sort', params.sort);
    const text = q.toString();
    return text ? '/search?' + text : '/search';
  }

  static chips(params) {
    const items = [];
    if (params.destination) items.push({ key: 'destination', label: params.destination.name });
    if (params.date) items.push({ key: 'date', label: params.dateLabel });
    if (params.want) items.push({ key: 'want', label: params.wantLabel });
    if (params.guests) items.push({ key: 'guests', label: params.guests === 1 ? '1 guest' : params.guests + ' guests' });
    if (params.price) items.push({ key: 'price', label: 'Under $' + params.price });
    if (params.age) items.push({ key: 'age', label: params.ageLabel });
    return items.map(item => ({
      key: item.key,
      label: item.label,
      href: SearchQuery.href(params, item.key),
      remove: 'Remove ' + item.label,
    }));
  }

  static documentTitle(params) {
    const parts = ['Day passes'];
    if (params.destination) parts.push(params.destination.name);
    if (params.date) parts.push(params.dateLabel);
    return parts.join(' · ') + ' | Hotel Day Club';
  }

  static heading(params) {
    return params.destination ? 'Hotel day passes in ' + params.destination.name : 'Hotel day passes';
  }

  static countLine(n, params) {
    const place = params.destination ? 'in ' + params.destination.name : 'around Australia';
    const noun = n === 1 ? 'place' : 'places';
    let line = n + ' ' + noun + ' ' + place;
    if (params.wantLabel) line += ' · ' + params.wantLabel;
    if (params.date) line += ' on ' + params.dateLabel;
    return line;
  }

  static nearest(hotels, destination, fromPrice, regionByArea) {
    const want = destination ? SearchQuery.regionId(destination.id) : '';
    return hotels.map((h, i) => ({
      h,
      i,
      price: fromPrice(h),
      region: regionByArea.get(h.area) || '',
    })).sort((a, b) => {
      const ar = want && a.region === want ? 0 : 1;
      const br = want && b.region === want ? 0 : 1;
      if (ar !== br) return ar - br;
      if (a.price !== b.price) return a.price - b.price;
      return a.i - b.i;
    }).slice(0, 3).map(row => row.h);
  }

  static run({ hotels, passesById, closedById, minutesById, remainingById, offers, destinations, query }) {
    const params = SearchQuery.parse(query, destinations);
    const list = hotels || [];
    const passesOf = h => (passesById && passesById.get(h.id)) || [];
    const priceOf = h => SearchQuery.fromPrice(passesOf(h));
    const capOf = h => SearchQuery.partyCap(passesOf(h));
    const regions = SearchQuery.regionByArea(destinations);
    const prices = list.map(priceOf);
    const holds = list.map(capOf);
    const policies = list.map(h => h.age_policy);
    let pool = params.destination ? list.filter(h => params.destination.areas.includes(h.area)) : list.slice();
    const catalogInDestination = params.destination
      ? list.filter(h => params.destination.areas.includes(h.area)).length
      : list.length;
    if (params.want) pool = pool.filter(h => offers(h, params.want));
    if (params.guests) pool = pool.filter(h => capOf(h) >= params.guests);
    if (params.price) pool = pool.filter(h => priceOf(h) < params.price);
    if (params.age) pool = pool.filter(h => SearchQuery.ageMatch(h.age_policy, params.age));
    const beforeDate = pool.slice();
    if (params.date) pool = pool.filter(h => !(closedById && closedById.get(h.id)));
    const order = new Map(list.map((h, i) => [h.id, i]));
    const sort = params.sort;
    pool.sort((a, b) => {
      if (remainingById) {
        const as = (remainingById.get(a.id) || 0) === 0 ? 1 : 0;
        const bs = (remainingById.get(b.id) || 0) === 0 ? 1 : 0;
        if (as !== bs) return as - bs;
      }
      if (sort === 'price-asc' || sort === 'price-desc') {
        const diff = priceOf(a) - priceOf(b);
        if (diff) return sort === 'price-asc' ? diff : -diff;
      } else if (sort === 'hours') {
        const diff = (minutesById.get(b.id) || 0) - (minutesById.get(a.id) || 0);
        if (diff) return diff;
      }
      return (order.get(a.id) || 0) - (order.get(b.id) || 0);
    });
    const filtered = Boolean(params.destination || params.date || params.want || params.guests || params.price || params.age);
    let empty = '';
    if (!pool.length && (filtered || !list.length)) {
      if (params.destination && catalogInDestination === 0) empty = 'destination';
      else if (params.date && beforeDate.length > 0 && beforeDate.every(h => closedById && closedById.get(h.id))) empty = 'closed';
      else empty = 'nomatch';
    }
    const chips = SearchQuery.chips(params);
    return {
      params,
      list: pool,
      empty,
      others: pool.length ? [] : SearchQuery.nearest(list, params.destination, priceOf, regions),
      chips,
      showClear: chips.length >= 2,
      priceChoices: SearchQuery.priceChoices(prices, params.price),
      guestChoices: SearchQuery.guestChoices(holds, params.guests),
      ageChoices: SearchQuery.ageChoices(policies, params.age),
      intentChips: SearchQuery.intentChips(list, offers, priceOf),
      drawerCount: SearchQuery.drawerCount(params),
      heading: SearchQuery.heading(params),
      title: SearchQuery.documentTitle(params),
      count: SearchQuery.countLine(pool.length, params),
    };
  }
}

module.exports = { SearchQuery };
