const assert = require('assert');
const { DEMO_INTROS } = require('../seed');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-list-'));
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
function post(port, urlPath, fields, headers = {}) {
  const body = fields instanceof URLSearchParams ? fields.toString() : new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function leadAndMeta(body, slug, name, area) {
  const intro = DEMO_INTROS[slug];
  assert.ok(body.includes(`<b>${intro.tagline}.</b> ${intro.blurb}`), slug);
  const meta = body.match(/<meta name="description" content="([^"]*)">/);
  const og = body.match(/<meta property="og:description" content="([^"]*)">/);
  const tw = body.match(/<meta name="twitter:description" content="([^"]*)">/);
  const expected = `${name} is a fictional example in ${area}. Stock photos. No real booking is taken on this demo.`.replace(/&/g, '&amp;');
  assert.ok(meta && meta[1].length <= 155, slug);
  assert.strictEqual(meta[1], expected, slug);
  assert.strictEqual(og[1], expected, slug);
  assert.strictEqual(tw[1], expected, slug);
  assert.ok(!meta[1].includes(intro.blurb.slice(0, 24)), slug);
  const ld = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ld && !ld[1].includes(intro.blurb.slice(0, 24)), slug);
}

function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'list-admin', DEMO_HOTEL_PASSWORD: 'list-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}

(async () => {
  const port = 3217;
  const child = await start(port);
  try {
    const home = await get(port, '/');
    assert.ok(home.body.includes('class="hdc-date"'));
    assert.ok(home.body.includes('class="hdc-pick"'));
    assert.ok(home.body.includes('name="want"'));
    assert.ok(home.body.includes('>What</label>'));
    assert.ok(!home.body.includes('Any seat'));
    assert.ok(home.body.includes('id="wl-dest"'));
    const pool = await get(port, '/?want=pool');
    assert.ok(pool.body.includes('Saltwater Terrace'));
    assert.ok(!home.body.includes(DEMO_INTROS['bayview-spa'].blurb));
    assert.ok(!pool.body.includes(DEMO_INTROS['saltwater-terrace'].blurb));
    const spa = await get(port, '/?want=spa');
    assert.ok(spa.body.includes('Bayview Spa'));
    assert.ok(spa.body.includes('Harbourside Lido'));
    assert.ok(!spa.body.includes('Saltwater Terrace'));
    assert.ok(!spa.body.includes(DEMO_INTROS['harbourside-lido'].blurb));
    const gym = await get(port, '/?want=gym');
    assert.ok(gym.body.includes('Skyline Rooftop'));
    assert.ok(!gym.body.includes('Palm Court'));
    const both = await get(port, '/?want=pool-spa');
    assert.ok(both.body.includes('Bayview Spa'));
    assert.ok(!both.body.includes('Manly Sands'));

    const salt = await get(port, '/h/saltwater-terrace');
    assert.strictEqual(salt.status, 200);
    leadAndMeta(salt.body, 'saltwater-terrace', 'The Saltwater Terrace', 'Eastern Beaches');
    assert.ok(salt.body.includes('<h1 class="l-title">The Saltwater Terrace (Demo)</h1>'));
    assert.ok(salt.body.includes('id="passes"'));
    assert.ok(!salt.body.includes('id="included"'));
    assert.ok(!salt.body.includes('class="inc-grid"'));
    assert.ok(salt.body.includes('class="pass-select"'));
    assert.ok(!salt.body.includes('class="pass-filter"'));
    assert.ok(salt.body.includes('aria-pressed="true"'));
    assert.ok(salt.body.includes('aria-label="Select Daybed"') || salt.body.includes('aria-label="Select Cabana"'));
    assert.ok(salt.body.includes('aria-expanded="false"'));
    assert.ok(salt.body.includes('<details class="pass-detail" id="pass-detail-lounger" data-code="lounger" role="region" aria-labelledby="pass-title-lounger">'));
    assert.ok(!/id="pass-detail-lounger"[^>]*\shidden/.test(salt.body));
    assert.ok(salt.body.includes('type="button"'));
    assert.ok(salt.body.includes('Included access'));
    assert.ok(salt.body.includes('On site to buy (not included)'));
    assert.ok(salt.body.includes('<h3 class="sub">What\'s included</h3>'));
    const incList = salt.body.slice(salt.body.indexOf('<ul class="inc">'), salt.body.indexOf('</ul>', salt.body.indexOf('<ul class="inc">')));
    assert.ok(incList.includes('Towels'));
    assert.ok(!/food|drink|café|cafe|\bbar\b/i.test(incList));
    assert.ok(salt.body.includes('From $'));
    assert.ok(!salt.body.includes('1 guest'));
    assert.ok(salt.body.includes('2 guests'));
    assert.ok(salt.body.includes('4 guests'));
    assert.ok(salt.body.includes('1 × Towels'));
    assert.ok(salt.body.includes('2 × Towels'));
    assert.ok(salt.body.includes('4 × Towels'));
    assert.ok(!salt.body.includes('Pool access'));
    const amenityLists = [...salt.body.matchAll(/<ul class="pass-inc-list">([\s\S]*?)<\/ul>/g)].map(m => m[1]);
    assert.ok(amenityLists.length >= 3);
    for (const list of amenityLists) {
      assert.ok(list.includes('× Towels'));
      assert.ok(list.includes('Complimentary Wi-Fi'));
      assert.ok(list.includes('Showers and change rooms'));
      assert.ok(list.includes('Lockers'));
      assert.ok(list.includes('Toiletries'));
      assert.ok(list.includes('Luggage storage'));
      assert.ok(!/\d+ × (?!Towels)/.test(list));
    }
    assert.ok(salt.body.includes('<details class="pass-detail" id="pass-detail-lounger" data-code="lounger" role="region" aria-labelledby="pass-title-lounger">'));
    assert.ok(!/id="pass-detail-lounger"[^>]*\shidden/.test(salt.body));
    assert.ok(salt.body.includes('>Opening hours</summary>'));
    assert.ok(salt.body.includes('>Guest policy</summary>'));
    assert.ok(salt.body.includes('>Cancellation</summary>'));
    assert.ok(!salt.body.includes('<summary>Parking</summary>'));
    assert.ok(!salt.body.includes('Train and bus'));
    assert.ok(salt.body.includes('id="addons-list"'));
    assert.ok(salt.body.includes('id="addons-pick"'));
    assert.ok(salt.body.includes('name="addon"'));
    assert.ok(salt.body.includes('value="gym"'));
    assert.ok(salt.body.includes('value="food"'));
    assert.ok(salt.body.includes('value="parking"'));
    assert.ok(salt.body.includes('type="checkbox"'));
    assert.ok(salt.body.includes('Fitness centre access'));
    assert.ok(salt.body.includes('Prepaid food and drink credit (optional)'));
    assert.ok(!salt.body.includes('extra-static'));
    assert.ok(salt.body.includes('Parking'));
    assert.ok(salt.body.includes('$18'));
    assert.ok(!salt.body.includes('Train and bus'));
    assert.ok(!salt.body.includes('Bondi Junction'));
    assert.ok(!salt.body.includes('Day guests check in'));
    assert.ok(!salt.body.includes('30 a day'));
    assert.ok(!/\b\d+ a day\b/.test(salt.body));
    assert.ok(salt.body.includes('id="hours"'));
    const saltHoursBlock = salt.body.slice(salt.body.indexOf('id="hours"'), salt.body.indexOf('id="getting-there"'));
    assert.ok(saltHoursBlock.includes('<span>Monday</span><b>10am–4pm</b>'));
    assert.ok(saltHoursBlock.includes('<span>Sunday</span><b>10am–4pm</b>'));
    const saltMeta = salt.body.slice(salt.body.indexOf('class="muted l-meta"'), salt.body.indexOf('day-lead'));
    assert.ok(saltMeta.includes('Eastern Beaches'));
    assert.ok(!saltMeta.includes('New ·'));
    assert.ok(!saltMeta.includes('10am'));
    assert.ok(salt.body.includes('id="policy"'));
    assert.ok(salt.body.includes('Guest policy'));
    assert.ok(salt.body.includes('id="getting-there"'));
    assert.ok(salt.body.includes('Getting there'));
    assert.ok(salt.body.includes('18 Demo Terrace'));
    const saltPass = salt.body.indexOf('id="passes"');
    const saltExtras = salt.body.indexOf('id="addons-list"');
    const saltHours = salt.body.indexOf('id="hours"');
    const saltThere = salt.body.indexOf('id="getting-there"');
    const saltPolicy = salt.body.indexOf('id="policy"');
    const saltCancel = salt.body.indexOf('id="cancel-fold"');
    const saltKnow = salt.body.indexOf('id="before"');
    const saltBook = salt.body.indexOf('aria-label="Before you book"');
    assert.ok(saltPass < saltExtras && saltExtras < saltHours && saltHours < saltThere && saltThere < saltPolicy && saltPolicy < saltCancel);
    assert.ok(saltCancel < saltKnow && saltCancel < saltBook);
    const saltHead = salt.body.slice(salt.body.indexOf('listing-head'), salt.body.indexOf('day-kicker'));
    assert.ok(!saltHead.includes('18 Demo Terrace'));
    assert.ok(!saltHead.includes('View map'));
    assert.ok(!salt.body.includes('Get directions'));
    assert.ok(!salt.body.includes('Apple Maps'));
    assert.ok(salt.body.includes('Pick a date to see your free-cancellation deadline.'));
    assert.ok(!salt.body.includes("can't be cancelled for free"));
    assert.ok(salt.body.includes('>Lifeguard</dt><dd>Not on duty</dd>'));
    assert.ok(salt.body.includes('>Pool</dt><dd>Outdoor</dd>'));
    assert.ok(salt.body.includes('>Heated</dt><dd>Yes</dd>'));
    assert.ok(salt.body.includes('Example information for a fictional hotel.'));
    assert.ok(salt.body.includes('class="map-peek"'));
    assert.ok(salt.body.includes('View map'));
    assert.ok(salt.body.includes('data-lat="-33.8915"'));
    assert.ok(!salt.body.includes('<iframe'));
    assert.ok(!salt.body.includes('export/embed.html'));
    assert.ok(!salt.body.includes('<script src="/vendor/leaflet/leaflet.js">'));
    assert.ok(salt.body.includes('class="hdc-date"'));
    assert.ok(salt.body.includes('data-inline="1"'));
    assert.ok(!salt.body.includes('Most popular'));
    assert.ok(salt.body.includes('Buy them at the pool bar, or add the optional food and drink credit.'));
    assert.ok(salt.body.includes('24 hours before your access hours start'));
    assert.ok(!salt.body.includes('before the day starts'));
    assert.ok(salt.body.includes('<h1 class="l-title">The Saltwater Terrace (Demo)</h1>'));
    assert.ok(salt.body.includes('The Saltwater Terrace (Demo) day pass'));
    assert.ok(salt.body.includes('Instant confirmation'));
    assert.ok(salt.body.includes('a confirmation email is sent to the address you give'));
    assert.ok(salt.body.includes('This demo does not take a payment and is not a reservation at a real hotel.'));
    assert.ok(salt.body.includes('class="gtk-band"'));
    assert.ok(salt.body.includes('24 hours to cancel'));
    assert.ok(salt.body.includes('Show your QR code at check-in.'));
    assert.ok(salt.body.includes('Help when you need it'));
    assert.ok(salt.body.includes('href="/contact"'));
    assert.ok(salt.body.includes('Book your day'));
    const poolBar = salt.body.match(/<li class="access-item">(?:(?!<\/li>)[\s\S])*?<b>Pool bar<\/b>[\s\S]*?<\/li>/);
    assert.ok(poolBar, 'pool bar access');
    assert.ok(poolBar[0].includes('Food and drink available to purchase'));
    assert.ok(poolBar[0].includes('From 11am'));
    assert.ok(!/included/i.test(poolBar[0]));
    assert.ok(salt.body.includes('<b>Infinity pool</b>'));
    assert.ok(salt.body.includes('/assets/photos/infinity-ocean.jpg'));
    assert.ok(salt.body.includes('<option value="1" selected>1</option>'));
    assert.ok(salt.body.includes('select[name="qty"]'));
    assert.ok(!salt.body.includes("$('#qty').value"));
    assert.ok(!salt.body.includes('spots left'));
    assert.ok(!salt.body.includes('Wed ·'));
    assert.ok(!/>\s*Seat\s*</.test(salt.body));
    assert.ok(!salt.body.includes('quietest'));
    assert.ok(salt.body.includes('href="#overview"'));
    assert.ok(salt.body.includes('href="#passes"'));
    assert.ok(salt.body.includes('href="#details"'));
    assert.ok(salt.body.includes('id="overview"'));
    assert.ok(salt.body.includes('id="details"'));
    assert.ok(salt.body.includes('class="lightbox"'));
    assert.ok(salt.body.includes('aria-label="Previous photo"'));
    assert.ok(salt.body.includes('aria-label="Next photo"'));
    assert.ok(salt.body.includes('aria-label="Close"'));
    assert.ok(salt.body.includes('View all ('));
    assert.ok(!/>\s*Reviews\s*</.test(salt.body));
    assert.ok(!/star rating|\b5 star\b|★|aggregateRating|class="stars"|class="rate"/i.test(salt.body));
    assert.ok(!/\bbed\s*#?\s*\d+\b/i.test(salt.body));
    assert.ok(!salt.body.includes('ResortPass'));
    assert.ok(salt.body.includes('Choose your seating'));
    assert.ok(salt.body.includes('>View details</summary>'));
    assert.ok(salt.body.includes('for="qty">Spots<select'));
    assert.ok(!salt.body.includes('for="qty">Guests'));
    assert.ok(salt.body.includes('id="spot-eq">= 1 person</p>'));
    assert.ok(salt.body.includes('class="pass-card is-sel" id="pass-card-lounger"'));
    assert.ok(/id="pass-lounger"[^>]*\schecked/.test(salt.body));
    assert.ok(salt.body.includes('class="pass-continue"'));
    assert.ok(salt.body.includes('href="/checkout?hotel=saltwater-terrace&amp;pass=lounger&amp;qty=1"') || salt.body.includes('href="/checkout?hotel=saltwater-terrace&pass=lounger&qty=1"'));
    assert.ok(salt.body.includes('>Continue to booking</a>'));
    assert.ok(salt.body.includes('Food and drink are not included in the pass.'));
    assert.ok(salt.body.includes('Sold out for this date — pick another date or seat'));
    assert.ok(!salt.body.includes('Sold out for this date - pick another date'));
    assert.ok(salt.body.includes('seatFromHash'));
    assert.ok(salt.body.includes('showModal'));
    assert.ok(salt.body.includes("location.hash"));
    assert.ok(salt.body.includes('Checking availability…'));
    assert.ok(salt.body.includes("We couldn't check availability. Try again."));
    assert.ok(!salt.body.includes('seat_detail_open'));
    assert.ok(!salt.body.includes('seat_select'));
    assert.ok(!salt.body.includes('seat_continue'));
    assert.ok(salt.body.includes('Book your day (demo)'));

    const pre = await get(port, '/h/saltwater-terrace?pass=daybed');
    assert.strictEqual(pre.status, 200);
    assert.ok(pre.body.includes('class="pass-card is-sel" id="pass-card-daybed"'));
    assert.ok(/id="pass-daybed"[^>]*\schecked/.test(pre.body));
    assert.ok(pre.body.includes('class="pass-card" id="pass-card-lounger"'));
    assert.ok(pre.body.includes('id="spot-eq">= 2 people</p>'));

    const Sqlite = require('better-sqlite3');
    const capDb = new Sqlite(dbPath);
    const saltHotel = capDb.prepare("SELECT id FROM hotels WHERE slug='saltwater-terrace'").get();
    const cabRow = capDb.prepare("SELECT id, daily_cap FROM pass_types WHERE hotel_id=? AND code='cabana'").get(saltHotel.id);
    capDb.prepare('UPDATE pass_types SET daily_cap=0 WHERE id=?').run(cabRow.id);
    capDb.close();
    try {
      const sold = await get(port, '/h/saltwater-terrace');
      const start = sold.body.indexOf('id="pass-card-cabana"');
      const from = sold.body.lastIndexOf('<article', start);
      const next = sold.body.indexOf('<article', start + 1);
      const end = next === -1 ? sold.body.indexOf('class="seat-note"', start) : next;
      const cab = sold.body.slice(from, end);
      assert.ok(cab.includes('class="pass-card is-sold"'));
      assert.ok(/id="pass-cabana"[^>]*\sdisabled/.test(cab));
      assert.ok(/class="pass-select"[^>]*\sdisabled/.test(cab));
      assert.ok(cab.includes('role="status">Sold out for this date — pick another date or seat'));
      assert.ok(!cab.includes('pass-sold" role="status" hidden'));
    } finally {
      const restore = new Sqlite(dbPath);
      restore.prepare('UPDATE pass_types SET daily_cap=? WHERE id=?').run(cabRow.daily_cap, cabRow.id);
      restore.close();
    }

    const bay = await get(port, '/h/bayview-spa');
    leadAndMeta(bay.body, 'bayview-spa', 'Bayview Spa Hotel', 'Eastern Suburbs');
    assert.ok(bay.body.includes('>Age</dt><dd>18+</dd>'));
    assert.ok(bay.body.includes('>Children</dt><dd>No children</dd>'));
    assert.ok(!bay.body.includes('18+ on weekdays'));
    assert.ok(!bay.body.includes('Adults only (18+).'));
    assert.ok(bay.body.includes('Spa treatment credit'));
    assert.ok(bay.body.includes('$30'));
    assert.ok(!bay.body.includes('Spa treatment discount'));
    assert.ok(bay.body.includes('>Pool</dt><dd>Indoor bathhouse and outdoor pool</dd>'));
    assert.ok(!bay.body.includes('>Pool</dt><dd>Indoor and outdoor</dd>'));
    assert.ok(bay.body.includes('>Heated</dt><dd>Yes</dd>'));
    assert.ok(bay.body.includes('heated outdoor pool'));
    assert.ok(bay.body.includes('Included access'));
    assert.ok(bay.body.includes('<b>Bathhouse</b>'));
    assert.ok(bay.body.includes('<b>Plunge pools</b>'));
    assert.ok(bay.body.includes('<b>Heated outdoor pool</b>'));
    assert.ok(bay.body.includes('<b>Sauna and steam room</b>'));
    assert.ok(!bay.body.includes('<b>Café</b>'));
    assert.ok(!bay.body.includes('<b>Bar</b>'));

    const manly = await get(port, '/h/manly-sands');
    leadAndMeta(manly.body, 'manly-sands', 'Manly Sands House', 'Northern Beaches');
    assert.ok(manly.body.includes('steps from the beach'));
    assert.ok(!manly.body.includes('water line'));
    assert.ok(manly.body.includes('>Age</dt><dd>All ages</dd>'));
    assert.ok(manly.body.includes('>Children</dt><dd>Children welcome until 2pm</dd>'));
    assert.ok(!manly.body.includes('>Children</dt><dd>Until 2pm</dd>'));
    assert.ok(!/adults only after 2pm/i.test(manly.body));
    const kiosk = manly.body.match(/<li class="access-item">(?:(?!<\/li>)[\s\S])*?<b>Kiosk<\/b>[\s\S]*?<\/li>/);
    assert.ok(kiosk, 'kiosk access');
    assert.ok(kiosk[0].includes('Food and drink available to purchase'));
    assert.ok(!/included/i.test(kiosk[0]));
    assert.ok(manly.body.includes('<b>Magnesium pool</b>'));

    const palm = await get(port, '/h/palm-court');
    leadAndMeta(palm.body, 'palm-court', 'Palm Court Resort', 'Parramatta');
    assert.ok(palm.body.includes('>Lifeguard</dt><dd>On duty. Lifeguards don&#39;t replace adult supervision: an adult on the booking must actively supervise each child at all times.</dd>'));
    assert.ok(palm.body.includes('class="guard-note">Lifeguards don&#39;t replace adult supervision: an adult on the booking must actively supervise each child at all times.</p>'));
    assert.ok(!palm.body.includes('during day-pass hours'));
    assert.ok(palm.body.includes('>Heated</dt><dd>No</dd>'));
    assert.ok(!palm.body.includes('kids-float.jpg'));
    assert.ok(palm.body.includes('tropical-resort.jpg'));
    assert.ok(palm.body.includes('resort-palms.jpg'));
    assert.ok(palm.body.includes('thatched-umbrellas.jpg'));
    assert.strictEqual((palm.body.match(/class="g\d+"/g) || []).length, 3);
    assert.ok(palm.body.includes('<summary>Parking</summary>'));
    assert.ok(palm.body.includes('On-site parking is included'));
    assert.ok(!palm.body.includes('Parking is not offered'));
    assert.ok(palm.body.includes('Food and drink are not included in the pass. Buy them at the café, or add the optional food and drink credit.'));
    assert.ok(palm.body.includes('Packed lunches are welcome.'));
    assert.ok(!palm.body.includes('The optional food and drink credit stays an extra.'));
    assert.ok(palm.body.includes('<h3 class="sub">What\'s included</h3>'));
    const palmInc = palm.body.slice(palm.body.indexOf('<ul class="inc">'), palm.body.indexOf('</ul>', palm.body.indexOf('<ul class="inc">')));
    assert.ok(!/food|drink|café|cafe|\bbar\b/i.test(palmInc));
    assert.ok(palm.body.includes('Included access'));
    assert.ok(palm.body.includes('On site to buy (not included)'));
    assert.ok(palm.body.includes('<b>Lagoon pool</b>'));
    const cafe = palm.body.match(/<li class="access-item">(?:(?!<\/li>)[\s\S])*?<b>Café<\/b>[\s\S]*?<\/li>/);
    assert.ok(cafe, 'café access');
    assert.ok(cafe[0].includes('Food and drink available to purchase'));
    assert.ok(!/included/i.test(cafe[0]));
    assert.ok(palm.body.includes('Prepaid food and drink credit (optional)'));
    assert.ok(palm.body.includes('$22'));
    assert.ok(!palm.body.includes('part of the visit'));
    assert.ok(!palm.body.includes('Poolside food and drink'));
    assert.ok(palm.body.includes('id="getting-there"'));
    assert.ok(palm.body.includes('7 Demo Avenue'));

    const harbour = await get(port, '/h/harbourside-lido');
    leadAndMeta(harbour.body, 'harbourside-lido', 'Harbourside Lido', 'CBD & Harbour');
    assert.ok(harbour.body.includes('>Pool</dt><dd>Indoor</dd>'));
    assert.ok(harbour.body.includes('>Heated</dt><dd>Yes</dd>'));
    assert.ok(harbour.body.includes('heated indoor pool'));

    const sky = await get(port, '/h/skyline-rooftop');
    leadAndMeta(sky.body, 'skyline-rooftop', 'Skyline Rooftop Hotel', 'North Sydney');
    const skyHours = sky.body.slice(sky.body.indexOf('id="hours"'), sky.body.indexOf('id="getting-there"'));
    assert.ok(skyHours.includes('<span>Monday</span><b>11am–4pm</b>'));
    assert.ok(skyHours.includes('<span>Thursday</span><b>11am–4pm</b>'));
    assert.ok(skyHours.includes('<span>Friday</span><b>Closed</b>'));
    const skyMeta = sky.body.slice(sky.body.indexOf('class="muted l-meta"'), sky.body.indexOf('day-lead'));
    assert.ok(skyMeta.includes('North Sydney'));
    assert.ok(!skyMeta.includes('New ·'));
    assert.ok(!skyMeta.includes('Mon–Thu'));
    assert.ok(sky.body.includes('<b>Heated rooftop pool</b>'));
    assert.ok(!sky.body.includes('quietest'));
    assert.ok(!sky.body.includes('<b>Gym</b>'));
    const skyBar = sky.body.match(/<li class="access-item">(?:(?!<\/li>)[\s\S])*?<b>Bar<\/b>[\s\S]*?<\/li>/);
    assert.ok(skyBar, 'bar access');
    assert.ok(skyBar[0].includes('Food and drink available to purchase'));
    assert.ok(skyBar[0].includes('From noon'));
    assert.ok(!/included/i.test(skyBar[0]));
    assert.ok(!sky.body.includes('Wed ·'));
    assert.ok(sky.body.includes('Parking'));
    assert.ok(sky.body.includes('$40'));
    assert.ok(!sky.body.includes('16 a day'));
    assert.ok(!/\b\d+ a day\b/.test(sky.body));

    const join = await get(port, '/hotel/join');
    assert.strictEqual(join.status, 302);

    const login = await post(port, '/hotel/login', { user: 'demo-saltwater', pass: 'list-hotel' });
    assert.strictEqual(login.status, 302);
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const settings = await get(port, '/hotel/settings');
    // cookie not sent
    assert.ok(settings.status === 302 || settings.status === 200);
    const authed = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/hotel/settings', headers: { Cookie: cookie } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
    assert.strictEqual(authed.status, 200);
    assert.ok(authed.body.includes('Getting there'));
    assert.ok(authed.body.includes('name="address"'));
    assert.ok(authed.body.includes("What's included"));
    assert.ok(authed.body.includes('Included access'));
    assert.ok(authed.body.includes('name="area_name"'));
    assert.ok(authed.body.includes('Infinity pool'));
    assert.ok(authed.body.includes('Pool bar'));
    assert.ok(authed.body.includes('Food and drink is not included'));
    assert.ok(authed.body.includes('Access included'));
    assert.ok(authed.body.includes('Available to buy'));
    assert.ok(authed.body.includes('name="state"'));
    assert.ok(authed.body.includes('name="timezone"'));
    assert.ok(authed.body.includes('Most popular label'));
    assert.ok(authed.body.includes('name="cap_parking"'));
    assert.ok(authed.body.includes('Food and drink are never included'));
    for (const name of ['inc_food', 'inc_welcome', 'inc_poolside']) {
      const block = authed.body.match(new RegExp(`<select name="${name}"[\\s\\S]*?</select>`));
      assert.ok(block, name);
      assert.ok(!block[0].includes('value="included"'), name);
      assert.ok(block[0].includes('Optional extra'), name);
      assert.ok(block[0].includes('Available to purchase'), name);
    }

    const Database = require('better-sqlite3');
    const live = new Database(dbPath);
    const hotel = live.prepare("SELECT id FROM hotels WHERE slug='saltwater-terrace'").get();
    let when = '';
    for (let i = 1; i < 21 && !when; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!live.prepare('SELECT 1 FROM blocked_dates WHERE hotel_id=? AND date=?').get(hotel.id, iso)) when = iso;
    }
    live.close();
    const checkout = await get(port, `/checkout?hotel=saltwater-terrace&date=${encodeURIComponent(when)}&pass=lounger&qty=1`);
    assert.strictEqual(checkout.status, 200);
    assert.ok(checkout.body.includes('Add extras'));
    assert.ok(checkout.body.includes('(optional)'));
    assert.ok(checkout.body.includes('id="co-addons"'));
    assert.ok(!checkout.body.includes('Make it a day'));
    assert.ok(!/<details class="extras"/.test(checkout.body));
    assert.ok(!checkout.body.includes('Spots left'));
    assert.ok(checkout.body.includes('>Pass</dt>'));
    assert.ok(checkout.body.includes('>Guests</dt>'));
    assert.ok(checkout.body.includes('Before you book'));
    assert.ok(checkout.body.includes('Your details'));
    assert.strictEqual(checkout.body.split("What's included").length - 1, 1);
    const formPart = checkout.body.split('id="co-form"')[1].split('co-dock')[0];
    assert.ok(!formPart.includes("What's included"));
    assert.ok(!formPart.includes('Included access'));
    assert.ok(formPart.includes('Pool rules'));
    assert.ok(formPart.includes('<h3>Risk warning</h3>'));
    assert.ok(!/booking agent/i.test(checkout.body));
    assert.ok(!/commission/i.test(checkout.body));
    assert.ok(checkout.body.includes('name="book_token"'));
    assert.ok(checkout.body.includes('Confirming'));
    assert.ok(checkout.body.includes("What's included"));
    const token = (checkout.body.match(/name="book_token" value="([a-f0-9]+)"/) || [])[1];
    assert.ok(token);
    const kept = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', book_token: token,
      name: 'Alex Citizen', email: 'not-an-email', phone: '0412', rules: '1',
    });
    assert.strictEqual(kept.status, 409);
    assert.ok(kept.body.includes('value="Alex Citizen"'));
    assert.ok(kept.body.includes('Enter a valid email.'));
    assert.ok(kept.body.includes('Enter a mobile number.'));
    assert.ok(kept.body.includes('Tick the customer terms to continue.'));
    const again = (kept.body.match(/name="book_token" value="([a-f0-9]+)"/) || [])[1];
    assert.strictEqual(again, token);
    const onceBody = {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', book_token: again,
      name: 'Alex Citizen', email: 'once@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    };
    const once = await post(port, '/book', onceBody);
    const twice = await post(port, '/book', onceBody);
    assert.strictEqual(once.status, 303, once.body.slice(0, 300));
    assert.strictEqual(twice.status, 303, twice.body.slice(0, 300));
    assert.strictEqual(twice.headers.location, once.headers.location);
    assert.ok(checkout.body.includes('1 × Towels'));
    assert.ok(checkout.body.includes('Pool access'));
    assert.ok(checkout.body.includes('Complimentary Wi-Fi'));
    assert.ok(!checkout.body.includes('× Pool access'));
    assert.ok(!checkout.body.includes('× Complimentary Wi-Fi'));
    assert.ok(checkout.body.includes('Food and drink are not included'));
    assert.ok(!checkout.body.includes('Poolside food and drink'));
    assert.ok(checkout.body.includes('Parking'));
    assert.ok(!checkout.body.includes('30 a day'));
    assert.ok(!/\b\d+ a day\b/.test(checkout.body));
    const fields = new URLSearchParams({
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '2', price: '1',
      name: 'Alex Citizen', email: 'alex-extra@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    });
    fields.append('addon', 'gym');
    fields.append('addon', 'parking');
    const priced = await post(port, '/book', fields);
    assert.strictEqual(priced.status, 303, priced.body.slice(0, 400));
    const pricedDb = new Database(dbPath);
    const saved = pricedDb.prepare('SELECT id, total, code FROM bookings WHERE email=?').get('alex-extra@example.com');
    assert.strictEqual(saved.total, 158);
    const lines = pricedDb.prepare('SELECT name, qty, unit_price, total FROM booking_addons WHERE booking_id=? ORDER BY name').all(saved.id);
    assert.deepStrictEqual(lines, [
      { name: 'Fitness centre access', qty: 2, unit_price: 25, total: 50 },
      { name: 'Parking', qty: 1, unit_price: 18, total: 18 },
    ]);
    const hotelRow = pricedDb.prepare("SELECT * FROM hotels WHERE slug='saltwater-terrace'").get();
    const { eventWindow, formatUtc } = require('../calendar');
    const win = eventWindow(pricedDb, hotelRow, when);
    pricedDb.close();
    assert.ok(win && win.start < win.end);
    const confirm = await get(port, priced.headers.location);
    assert.ok(confirm.body.includes("What's included"));
    assert.ok(confirm.body.includes('2 × Towels'));
    assert.ok(confirm.body.includes('Pool access'));
    assert.ok(confirm.body.includes('Complimentary Wi-Fi'));
    assert.ok(!confirm.body.includes('× Pool access'));
    assert.ok(!confirm.body.includes('× Complimentary Wi-Fi'));
    assert.ok(!confirm.body.includes('× Showers'));
    assert.ok(!confirm.body.includes('× Lockers'));
    assert.ok(!confirm.body.includes('× Toiletries'));
    assert.ok(!confirm.body.includes('× Luggage'));
    assert.ok(confirm.body.includes('Food and drink are not included in your pass.'));
    assert.ok(confirm.body.includes('On site to buy (not included)'));
    assert.ok(!confirm.body.includes('Poolside food and drink'));
    assert.ok(confirm.body.includes('Cancellation'));
    assert.ok(confirm.body.includes('Included access'));
    assert.ok(confirm.body.includes('Infinity pool'));
    assert.ok(confirm.body.includes('Food and drink available to purchase'));
    assert.ok(confirm.body.includes('Fitness centre access'));
    assert.ok(confirm.body.includes('Parking'));
    assert.ok(confirm.body.includes('$158'));
    assert.ok(confirm.body.includes('Add to Google Calendar'));
    assert.ok(confirm.body.includes('https://calendar.google.com/calendar/render?'));
    assert.ok(confirm.body.includes('action=TEMPLATE'));
    assert.ok(confirm.body.includes(formatUtc(win.start)));
    assert.ok(confirm.body.includes(formatUtc(win.end)));
    assert.ok(confirm.body.includes(saved.code));
    const ics = await get(port, priced.headers.location + '/calendar.ics');
    assert.ok(String(ics.headers['content-type']).includes('text/calendar'));
    assert.ok(ics.body.includes('DTSTART:' + formatUtc(win.start)));
    assert.ok(ics.body.includes('DTEND:' + formatUtc(win.end)));
    assert.ok(!ics.body.includes('VALUE=DATE'));
    assert.ok(ics.body.includes('Booking ' + saved.code));
    assert.ok(ics.body.includes('18 Demo Terrace'));
    const unknown = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', addon: 'not-a-real-extra',
      name: 'Alex Citizen', email: 'alex-bad@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    });
    assert.strictEqual(unknown.status, 409, unknown.body.slice(0, 300));
    assert.ok(/not available/i.test(unknown.body));
    const live2 = new Database(dbPath);
    live2.prepare("UPDATE addons SET daily_cap=0 WHERE hotel_id=? AND code='parking'").run(hotel.id);
    live2.close();
    const book = await post(port, '/book', {
      hotel: 'saltwater-terrace', date: when, pass: 'lounger', qty: '1', addon: 'parking',
      name: 'Alex Citizen', email: 'alex@example.com', phone: '0412345678', rules: '1', terms: '1', risk: '1',
    });
    assert.strictEqual(book.status, 409, book.body.slice(0, 300));
    assert.ok(/sold out/i.test(book.body), book.body.slice(0, 300));
  } finally {
    child.kill('SIGTERM');
  }
  console.log('listing checks passed');
})().catch(err => { console.error(err); process.exit(1); });
