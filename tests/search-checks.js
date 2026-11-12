const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { SearchQuery } = require('../search');
const { ymd, addDays, nice } = require('../util');
const { DESTINATIONS } = require('../destinations');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-search-'));
const dbPath = path.join(dir, 'daypass.db');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'search-admin', DEMO_HOTEL_PASSWORD: 'search-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function nextWeekday(want) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  let add = (want - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  return ymd(addDays(d, add));
}
function plusDays(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return ymd(addDays(d, n));
}
function titleOf(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
}
function names(html, kind) {
  const marker = `class="list ${kind}`;
  const at = html.indexOf(marker);
  assert.ok(at >= 0, 'missing list ' + kind);
  const block = html.slice(at, html.indexOf('</div>', at));
  return [...block.matchAll(/<h3>([^<]*)<\/h3>/g)].map(m => m[1]);
}
function selectOf(html, name) {
  const m = html.match(new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?<\\/select>`));
  assert.ok(m, name);
  return m[0];
}

assert.deepStrictEqual(SearchQuery.priceChoices([25, 40, 45, 55, 65, 80], 0), [50]);
assert.deepStrictEqual(SearchQuery.guestChoices([4, 4, 2, 2, 2, 2], 0), [1, 2, 3, 4]);
assert.strictEqual(SearchQuery.homeRedirect({ destination: 'melbourne' }), '');
assert.strictEqual(SearchQuery.homeRedirect({ waitlist: '1' }), '');
assert.ok(SearchQuery.homeRedirect({ date: '2026-11-14', want: 'pool' }).includes('date=2026-11-14'));
assert.strictEqual(SearchQuery.openMinutes([
  { open: 1, opens: '11:00', closes: '17:00' },
], '16:00'), 300);

const fakeDest = [
  { id: 'perth', name: 'Perth', areas: ['Perth'] },
  { id: 'bondi', name: 'Bondi', areas: ['Eastern Beaches'] },
  { id: 'melbourne', name: 'Melbourne', areas: ['Melbourne'] },
];
const nearest = SearchQuery.nearest([
  { id: 1, area: 'Eastern Beaches' },
  { id: 2, area: 'Perth' },
  { id: 3, area: 'Melbourne' },
], fakeDest[0], h => ({ 1: 10, 2: 90, 3: 5 }[h.id]), SearchQuery.regionByArea(fakeDest));
assert.deepStrictEqual(nearest.map(h => h.id), [2, 3, 1]);

(async () => {
  const port = 3361;
  const child = await start(port);
  const saturday = nextWeekday(6);
  const monday = nextWeekday(1);
  const blockedAll = plusDays(24);
  try {
    const home = await get(port, '/');
    assert.strictEqual(home.status, 200);
    assert.strictEqual((home.body.match(/<a class="ex"/g) || []).length, 6);
    assert.ok(home.body.includes('See all day passes'));
    assert.ok(home.body.includes('Example listings · not real hotels'));
    assert.ok(home.body.includes('action="/search"'));
    assert.ok(!home.body.includes('action="/#explore"'));
    const homeWhere = selectOf(home.body, 'destination');
    assert.ok(homeWhere.includes('Bondi &amp; Eastern Beaches'));
    assert.ok(homeWhere.includes('value="sydney-cbd"'));
    assert.ok(!homeWhere.includes('>Eastern Beaches<'));
    assert.ok(!homeWhere.includes('>CBD &amp; Harbour<'));
    for (const d of DESTINATIONS) assert.ok(homeWhere.includes(`value="${d.id}"`), d.id);

    const plain = await get(port, '/search');
    assert.strictEqual(plain.status, 200);
    assert.strictEqual(titleOf(plain.body), 'Day passes | Hotel Day Club');
    assert.strictEqual((plain.body.match(/<h1/g) || []).length, 1);
    assert.ok(plain.body.includes('<h1>Hotel day passes</h1>'));
    assert.ok(plain.body.includes('6 places around Australia'));
    assert.ok(!plain.body.includes('around Sydney'));
    assert.ok(!plain.body.includes('Example listings · not real hotels'));
    assert.ok(plain.body.includes('Demo site: listings are examples, no real bookings or payments.'));
    assert.ok(plain.body.includes('>Example</span>'));
    assert.ok(plain.body.includes('class="ex-note">Demo</p>'));
    assert.ok(!plain.body.includes('class="hero"'));
    assert.ok(plain.body.indexOf('class="list results"') < plain.body.indexOf('<footer'));
    assert.deepStrictEqual(names(plain.body, 'results'), [
      'The Saltwater Terrace (Demo)',
      'Skyline Rooftop Hotel (Demo)',
      'Harbourside Lido (Demo)',
      'Palm Court Resort (Demo)',
      'Manly Sands House (Demo)',
      'Bayview Spa Hotel (Demo)',
    ]);
    const sort = selectOf(plain.body, 'sort');
    assert.ok(sort.includes('Recommended'));
    assert.ok(sort.includes('Price: low to high'));
    assert.ok(sort.includes('Price: high to low'));
    assert.ok(sort.includes('Longest hours'));
    assert.ok(!sort.includes('Name'));
    assert.ok(!sort.includes('Listed order'));
    assert.ok(!sort.includes('From price'));
    assert.ok(plain.body.includes('<noscript><button type="submit">Sort</button></noscript>'));
    const price = selectOf(plain.body, 'price');
    assert.ok(price.includes('Any price'));
    assert.ok(price.includes('Under $50'));
    assert.ok(!price.includes('Under $100'));
    assert.ok(!price.includes('Under $150'));
    const guests = selectOf(plain.body, 'guests');
    assert.ok(guests.includes('value="1"') && guests.includes('value="4"'));
    assert.ok(!guests.includes('value="5"') && !guests.includes('value="6"'));
    const age = selectOf(plain.body, 'age');
    assert.ok(age.includes('Any age'));
    assert.ok(age.includes('Kids welcome'));
    assert.ok(age.includes('Adults only (18+)'));
    assert.ok(!/show map|map view|leaflet|map-toggle/i.test(plain.body));
    assert.ok(!plain.body.includes('Pay online'));
    assert.ok(!plain.body.includes('\u2014'));
    assert.ok(!/\bcommission\b/i.test(plain.body));
    assert.ok(!plain.body.includes('ABN'));
    assert.ok(!/\d+\s*%/.test(plain.body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')));
    assert.ok(!plain.body.includes('Food and drink are not included'));
    const nav = plain.body.match(/<nav class="hdr-nav"[\s\S]*?<\/nav>/)[0];
    assert.ok(nav.startsWith('<nav class="hdr-nav" aria-label="Site"><a href="/search" aria-current="page">Find a day pass</a>'));
    assert.ok(plain.body.includes('aria-label="Find a day pass" aria-current="page"'));
    assert.ok(plain.body.includes('>Menu</summary>'));
    assert.ok(plain.body.includes('id="site-menu"'));

    const hiw = await get(port, '/how-it-works');
    assert.strictEqual(hiw.status, 200);
    const hiwNav = hiw.body.match(/<nav class="hdr-nav"[\s\S]*?<\/nav>/)[0];
    assert.ok(hiwNav.startsWith('<nav class="hdr-nav" aria-label="Site"><a href="/search">Find a day pass</a>'));
    assert.ok(!hiwNav.includes('aria-current'));
    assert.ok(hiw.body.includes('>Menu</summary>'));
    assert.ok(hiw.body.includes('Join the waitlist'));

    const low = await get(port, '/search?sort=price-asc');
    assert.deepStrictEqual(names(low.body, 'results'), [
      'Palm Court Resort (Demo)',
      'Manly Sands House (Demo)',
      'The Saltwater Terrace (Demo)',
      'Skyline Rooftop Hotel (Demo)',
      'Harbourside Lido (Demo)',
      'Bayview Spa Hotel (Demo)',
    ]);
    const high = await get(port, '/search?sort=price-desc');
    assert.deepStrictEqual(names(high.body, 'results'), [
      'Bayview Spa Hotel (Demo)',
      'Harbourside Lido (Demo)',
      'Skyline Rooftop Hotel (Demo)',
      'The Saltwater Terrace (Demo)',
      'Manly Sands House (Demo)',
      'Palm Court Resort (Demo)',
    ]);
    const hours = await get(port, '/search?sort=hours');
    assert.deepStrictEqual(names(hours.body, 'results'), [
      'Harbourside Lido (Demo)',
      'Palm Court Resort (Demo)',
      'Bayview Spa Hotel (Demo)',
      'The Saltwater Terrace (Demo)',
      'Manly Sands House (Demo)',
      'Skyline Rooftop Hotel (Demo)',
    ]);
    const named = await get(port, '/search?sort=name');
    assert.deepStrictEqual(names(named.body, 'results'), names(plain.body, 'results'));

    const under = await get(port, '/search?price=50');
    assert.deepStrictEqual(names(under.body, 'results'), [
      'The Saltwater Terrace (Demo)',
      'Palm Court Resort (Demo)',
      'Manly Sands House (Demo)',
    ]);
    const kids = await get(port, '/search?age=kids');
    assert.deepStrictEqual(names(kids.body, 'results'), [
      'The Saltwater Terrace (Demo)',
      'Palm Court Resort (Demo)',
      'Manly Sands House (Demo)',
    ]);
    const adults = await get(port, '/search?age=18');
    assert.deepStrictEqual(names(adults.body, 'results'), [
      'Skyline Rooftop Hotel (Demo)',
      'Bayview Spa Hotel (Demo)',
    ]);
    const party = await get(port, '/search?guests=4');
    assert.deepStrictEqual(names(party.body, 'results'), [
      'The Saltwater Terrace (Demo)',
      'Skyline Rooftop Hotel (Demo)',
    ]);
    const gym = await get(port, '/search?want=gym');
    assert.ok(gym.body.includes('Saltwater Terrace'));
    assert.ok(!gym.body.includes('Palm Court'));
    assert.ok(!gym.body.includes('Manly Sands'));
    const spa = await get(port, '/search?want=spa');
    assert.deepStrictEqual(names(spa.body, 'results'), [
      'Harbourside Lido (Demo)',
      'Bayview Spa Hotel (Demo)',
    ]);

    const combo = `/search?destination=bondi&date=${saturday}&want=pool&guests=2&price=50&age=kids&sort=price-asc`;
    const filtered = await get(port, combo);
    assert.strictEqual(filtered.status, 200);
    assert.strictEqual(titleOf(filtered.body), `Day passes · Bondi & Eastern Beaches · ${nice(saturday)} | Hotel Day Club`);
    assert.ok(filtered.body.includes(`1 place in Bondi &amp; Eastern Beaches · Pool on ${nice(saturday)}`));
    assert.ok(filtered.body.includes('<h1>Hotel day passes in Bondi &amp; Eastern Beaches</h1>'));
    assert.deepStrictEqual(names(filtered.body, 'results'), ['The Saltwater Terrace (Demo)']);
    assert.ok(filtered.body.includes('class="list results is-single"'));
    assert.ok(filtered.body.includes('Eastern Beaches'));
    assert.ok(!filtered.body.includes('Example listings · not real hotels'));
    assert.ok(filtered.body.includes('>Clear all</a>'));
    assert.ok(filtered.body.includes('aria-label="Remove Pool"'));
    assert.ok(filtered.body.includes('aria-label="Remove 2 guests"'));
    assert.ok(filtered.body.includes('aria-label="Remove Under $50"'));
    assert.ok(filtered.body.includes('aria-label="Remove Kids welcome"'));
    assert.ok(filtered.body.includes(`aria-label="Remove ${nice(saturday)}"`));
    assert.ok(filtered.body.includes('aria-label="Remove Bondi &amp; Eastern Beaches"'));
    const removed = filtered.body.match(/href="([^"]+)" aria-label="Remove Pool"/);
    assert.ok(removed, 'remove pool chip');
    assert.ok(!removed[1].includes('want='));
    assert.ok(removed[1].includes('destination=bondi'));
    assert.ok(removed[1].includes('guests=2'));
    assert.ok(removed[1].includes('sort=price-asc'));

    const one = await get(port, '/search?want=pool');
    assert.ok(one.body.includes('aria-label="Remove Pool"'));
    assert.ok(!one.body.includes('>Clear all</a>'));
    assert.ok(!one.body.includes('Clear all filters'));

    const legacy = await get(port, '/search?where=' + encodeURIComponent('Eastern Beaches'));
    assert.strictEqual(legacy.status, 200);
    assert.deepStrictEqual(names(legacy.body, 'results'), ['The Saltwater Terrace (Demo)']);
    assert.ok(selectOf(legacy.body, 'destination').includes('value="bondi" data-icon="wave" selected'));

    const bad = await get(port, '/search?want=seat&price=20&guests=9&age=teen&sort=name&date=yesterday');
    assert.strictEqual(bad.status, 200);
    assert.deepStrictEqual(names(bad.body, 'results'), names(plain.body, 'results'));

    const none = await get(port, '/search?destination=melbourne');
    assert.ok(none.body.includes('There are no example listings in Melbourne yet'));
    assert.ok(none.body.includes('href="/?destination=melbourne#waitlist"'));
    assert.ok((none.body.match(/>Join the waitlist</g) || []).length >= 2);
    assert.ok(none.body.includes('Other example listings'));
    assert.deepStrictEqual(names(none.body, 'others'), [
      'Palm Court Resort (Demo)',
      'Manly Sands House (Demo)',
      'The Saltwater Terrace (Demo)',
    ]);

    const closed = await get(port, '/search?date=' + blockedAll);
    assert.ok(closed.body.includes('No example hotels are open on this date.'));
    assert.ok(!closed.body.includes('No passes match'));
    assert.ok(closed.body.includes('Other example listings'));
    assert.strictEqual(names(closed.body, 'others').length, 3);

    const shut = await get(port, '/search?destination=parramatta&date=' + monday);
    assert.ok(shut.body.includes('No example hotels are open on this date.'));
    assert.ok(!shut.body.includes('No passes match'));

    const miss = await get(port, '/search?price=50&age=18');
    assert.ok(miss.body.includes('No passes match. Try a higher price, another date or fewer filters.'));
    assert.ok(miss.body.includes('>Clear all filters</a>'));
    assert.ok(miss.body.includes('>Clear all</a>'));
    assert.ok(miss.body.includes('Other example listings'));

    const hop = await get(port, `/?want=pool&date=${saturday}&guests=2&price=50&age=kids&sort=hours`);
    assert.strictEqual(hop.status, 301);
    const loc = String(hop.headers.location);
    assert.ok(loc.startsWith('/search?'), loc);
    for (const bit of ['want=pool', 'date=' + saturday, 'guests=2', 'price=50', 'age=kids', 'sort=hours']) assert.ok(loc.includes(bit), loc);
    const areaHop = await get(port, '/?where=' + encodeURIComponent('Eastern Beaches'));
    assert.strictEqual(areaHop.status, 301);
    assert.ok(String(areaHop.headers.location).includes('where=Eastern'));
    const stay = await get(port, '/?destination=melbourne');
    assert.strictEqual(stay.status, 200);
    assert.ok(stay.body.includes('<option value="melbourne" data-icon="laneway" selected>Melbourne</option>'));
    const both = await get(port, '/?destination=melbourne&want=pool');
    assert.strictEqual(both.status, 301);
    assert.ok(String(both.headers.location).includes('destination=melbourne'));
    assert.ok(String(both.headers.location).includes('want=pool'));

    const headerCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'header.css'), 'utf8');
    assert.ok(headerCss.includes('max-height:64px') || headerCss.includes('max-height: 64px'));
    assert.ok(headerCss.includes('699px'));
    assert.ok(headerCss.includes('min-height: 44px') || headerCss.includes('min-height:44px'));
    assert.ok(headerCss.includes('prefers-reduced-motion'));
    const siteCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'golden', 'site.css'), 'utf8');
    assert.ok(siteCss.includes('min-height:44px'));
    assert.ok(siteCss.includes('prefers-reduced-motion'));

    console.log('search checks passed');
  } finally {
    child.kill();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
