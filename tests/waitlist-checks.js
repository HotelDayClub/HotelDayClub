const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-wait-'));
const dbPath = path.join(dir, 'daypass.db');
const failDb = path.join(dir, 'fail.db');

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}
function post(port, urlPath, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function start(port, dbFile, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: dbFile,
        DATA_DIR: '',
        ADMIN_PASSWORD: 'wait-admin-test',
        DEMO_HOTEL_PASSWORD: 'wait-hotel-test',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 20000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function rows(file = dbPath) {
  const db = new Database(file, { readonly: true });
  const all = db.prepare('SELECT email, first_name, place, role, hotel_name, destination FROM waitlist ORDER BY id').all();
  db.close();
  return all;
}
function cookie(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

(async () => {
  const hooks = [];
  const hook = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      hooks.push(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      res.statusCode = 200;
      res.end('ok');
    });
  });
  await new Promise(resolve => hook.listen(3202, '127.0.0.1', resolve));

  const port = 3201;
  const child = await start(port, dbPath, {
    WAITLIST_WEBHOOK_URL: 'http://127.0.0.1:3202/hook',
    WAITLIST_WEBHOOK_TOKEN: 'test-token',
  });
  try {
    const home = await get(port, '/');
    assert.strictEqual(home.status, 200);
    assert.ok(home.body.includes('Join the waitlist'));
    const homeCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'golden', 'home.css'), 'utf8');
    assert.ok(homeCss.includes('.wl input:not([type="radio"]):not([type="checkbox"])'), 'text fields must not size radios');
    assert.ok(homeCss.includes('.wl-choice:has(input:checked)'), 'selected role needs a visible state');
    assert.ok(!/\.wl input,\.wl select\{/.test(homeCss), 'broad .wl input rule would stretch radios');
    const appCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
    assert.ok(appCss.includes('.wl input:not([type="radio"]):not([type="checkbox"])'));
    assert.ok(appCss.includes('.hours-row input[type=checkbox]{accent-color:var(--navy);width:18px;height:18px}'));
    assert.ok(appCss.includes('.pp input{accent-color:var(--navy)}'));
    assert.ok(home.body.includes('Find a hotel'));
    assert.ok(home.body.includes('Pick a pass and a day'));
    assert.ok(home.body.includes('name="want"'));
    assert.ok(home.body.includes('Pool + Spa'));
    assert.ok(!home.body.includes('Any seat'));
    assert.ok(!home.body.includes('>Seat<'));
    assert.ok(home.body.includes('Show up, switch off'));
    assert.ok(home.body.includes('Example listings'));
    assert.ok(home.body.includes('Swim &amp; gym'));
    assert.ok(home.body.includes('Gym session'));
    assert.ok(home.body.includes('fetchpriority="high"'));
    assert.ok(home.body.includes('media=[0,1,2,3]'));
    assert.ok(home.body.includes('/golden/img/hero-swim'));
    assert.ok(home.body.includes('/golden/img/hero-lunch'));
    assert.ok(home.body.includes('width="1920" height="1080"'));
    assert.ok(home.body.includes('href="/golden/img/hero-lunch.webp"'));
    assert.ok(home.body.includes('Photo: Yulius Santoso / Pexels'));
    assert.ok(home.body.includes('Photo: Relaxing Journeys / Pexels'));
    assert.ok(!home.body.includes('Bronte') && !home.body.includes('Palm Cove') && !home.body.includes('Icebergs'));
    assert.ok(!home.body.includes('hero.mp4'));
    assert.ok(!home.body.includes('hero-poster'));
    assert.ok(!home.body.includes('<video'));
    assert.ok(home.body.includes('saveData') && home.body.includes('visibilitychange') && home.body.includes("classList.toggle('motion'"));
    assert.ok(home.body.includes('class="shimmer"'));
    for (const name of ['kb0', 'kb1', 'kb2', 'kb3', 'kbshine']) assert.ok(homeCss.includes('@keyframes ' + name), name);
    assert.ok(homeCss.includes('scale(1.06)'));
    assert.ok(homeCss.includes('animation-play-state:paused'));
    assert.ok(homeCss.includes('prefers-reduced-motion:reduce'));
    assert.ok(homeCss.includes('.media.motion .layer,.media.motion .shimmer{animation:none}'));
    assert.ok(!homeCss.includes('feTurbulence') && !homeCss.includes('filter:'));
    for (const photo of ['infinity-ocean.jpg', 'rooftop-city.jpg', 'glass-roof-pool.jpg', 'tropical-resort.jpg', 'daybed-canopy.jpg', 'cabana-drapes.jpg']) {
      const webp = photo.replace(/\.jpg$/, '.webp');
      assert.ok(home.body.includes('/golden/img/cards/' + webp), photo);
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'photos', photo)), photo);
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'golden', 'img', 'cards', webp)), webp);
    }
    assert.ok(home.body.includes('loading="lazy"'), 'below-the-fold images should be lazy');
    assert.ok(!/fetchpriority="high"[^>]*loading="lazy"/.test(home.body), 'the hero image should not be lazy');
    assert.ok(home.body.includes('href="/faq"'));
    assert.ok(home.body.includes('For hotels'));
    assert.ok(home.body.includes('List a hotel pool'));
    assert.ok(home.body.includes('href="/for-hotels"'));
    assert.ok(!home.body.includes('href="/hotel/join"'));
    const hotels = await get(port, '/for-hotels');
    assert.strictEqual(hotels.status, 200);
    assert.ok(hotels.body.includes('A quiet pool'));
    assert.ok(hotels.body.includes('gym'));
    assert.ok(hotels.body.includes('Australia'));
    assert.ok(hotels.body.includes('A short pilot'));
    assert.ok(hotels.body.includes('Talk to us'));
    assert.ok(hotels.body.includes('mailto:hello@hoteldayclub.com.au?subject=Hotel%20Day%20Club%20-%20partnership%20enquiry'));
    assert.ok(!/commission|75%|25%|partner hotel/i.test(hotels.body));
    assert.ok(!hotels.body.includes('<form'));
    const join = await get(port, '/hotel/join');
    assert.strictEqual(join.status, 302);
    assert.strictEqual(join.headers.location, '/for-hotels');
    const posted = await post(port, '/hotel/join', { login: 'sneaky-hotel', password: 'secret', contact_email: 'a@b.co' });
    assert.strictEqual(posted.status, 303);
    assert.strictEqual(posted.headers.location, '/for-hotels');
    const hiw = await get(port, '/how-it-works');
    assert.ok(hiw.body.includes('href="/for-hotels"'));
    assert.ok(!hiw.body.includes('href="/hotel/join"'));
    assert.ok(home.body.includes('Explore by destination'));
    assert.ok(home.body.includes('<h2>Destinations</h2>'));
    assert.ok(/href="\/destinations\/sydney"[\s\S]*?Sydney CBD[\s\S]*?1 example listing/.test(home.body));
    assert.ok(/href="\/destinations\/bondi"[\s\S]*?Bondi &amp; Eastern Beaches[\s\S]*?1 example listing/.test(home.body));
    assert.ok(/href="\/destinations\/melbourne"[\s\S]*?Melbourne[\s\S]*?Coming soon[\s\S]*?No listings yet/.test(home.body));
    assert.ok(home.body.includes('Gold Coast') && home.body.includes('Brisbane') && home.body.includes('Byron Bay'));
    assert.ok(home.body.includes('Cairns &amp; Port Douglas') && home.body.includes('Perth'));
    assert.ok(!home.body.includes('0 example'));
    assert.ok(!/testimonial|as seen in|fully insured|we hold insurance|member count|star rating/i.test(home.body));
    assert.ok(!home.body.includes("gtag('event','generate_lead')"));
    assert.ok(home.body.includes('All of Australia'));
    assert.ok(!home.body.includes('across Sydney') && !home.body.includes('around Sydney'));

    const city = await get(port, '/?dest=sydney-cbd');
    assert.ok(city.body.includes('Harbourside Lido'));
    assert.ok(city.body.includes('1 example listing · Sydney CBD'));
    assert.ok(!city.body.includes('Manly Sands'));
    assert.ok(!city.body.includes('Saltwater Terrace'));

    const beach = await get(port, '/?dest=bondi');
    assert.ok(beach.body.includes('Saltwater Terrace'));
    assert.ok(!beach.body.includes('Harbourside Lido'));
    assert.ok(!beach.body.includes('Bayview Spa'));

    const none = await get(port, '/?dest=melbourne');
    assert.ok(none.body.includes('No example listings in Melbourne yet'));
    assert.ok(!none.body.includes('Saltwater Terrace'));
    assert.ok(none.body.includes('href="/?destination=melbourne#waitlist"'));

    const prefill = await get(port, '/?destination=melbourne');
    assert.ok(prefill.body.includes('<option value="melbourne" data-icon="laneway" selected>Melbourne</option>'));

    const missing = await post(port, '/waitlist', { role: 'guest' }, { 'X-Forwarded-For': '203.0.113.1' });
    assert.strictEqual(missing.status, 400);
    assert.ok(missing.body.includes('Enter an email address.'));

    const bad = await post(port, '/waitlist', { email: 'not-an-email', role: 'guest' }, { 'X-Forwarded-For': '203.0.113.2' });
    assert.strictEqual(bad.status, 400);
    assert.ok(bad.body.includes('does not look right'));

    const noRole = await post(port, '/waitlist', { email: 'role@example.com' }, { 'X-Forwarded-For': '203.0.113.3' });
    assert.strictEqual(noRole.status, 400);
    assert.ok(noRole.body.includes('guest or a hotel'));

    const badDest = await post(port, '/waitlist', { email: 'dest@example.com', role: 'guest', destination: 'atlantis' }, { 'X-Forwarded-For': '203.0.113.4' });
    assert.strictEqual(badDest.status, 400);
    assert.strictEqual(rows().length, 0);

    const guest = await post(port, '/waitlist', {
      email: 'Guest.One@Example.com',
      first_name: 'Ada',
      place: '2000',
      role: 'guest',
      hotel_name: 'Should Not Stick',
      destination: 'melbourne',
    }, { 'X-Forwarded-For': '203.0.113.5' });
    assert.strictEqual(guest.status, 303);
    assert.strictEqual(guest.headers.location, '/?waitlist=1#waitlist');
    assert.ok(!guest.headers.location.includes('@'));
    assert.deepStrictEqual(rows()[0], {
      email: 'guest.one@example.com',
      first_name: 'Ada',
      place: '2000',
      role: 'guest',
      hotel_name: '',
      destination: 'Melbourne',
    });
    assert.strictEqual(hooks.length, 1);
    assert.strictEqual(hooks[0].email, 'guest.one@example.com');
    assert.strictEqual(hooks[0].destination, 'Melbourne');
    assert.strictEqual(hooks[0].hotel_name, '');
    assert.strictEqual(hooks[0].token, 'test-token');
    assert.strictEqual(hooks[0].source, 'hoteldayclub-waitlist');

    const again = await post(port, '/waitlist', {
      email: 'guest.one@example.com',
      first_name: 'Ada Updated',
      place: 'Bondi',
      role: 'guest',
      destination: 'perth',
    }, { 'X-Forwarded-For': '203.0.113.6' });
    assert.strictEqual(again.status, 303);
    assert.strictEqual(rows().length, 1);
    assert.strictEqual(rows()[0].first_name, 'Ada Updated');
    assert.strictEqual(rows()[0].destination, 'Perth');

    const hotel = await post(port, '/waitlist', {
      email: 'Hotel@Example.com',
      role: 'hotel',
      hotel_name: 'Quiet Pool House',
      destination: 'gold-coast',
    }, { 'X-Forwarded-For': '203.0.113.7' });
    assert.strictEqual(hotel.status, 303);
    const hotelRow = rows().find(r => r.email === 'hotel@example.com');
    assert.strictEqual(hotelRow.role, 'hotel');
    assert.strictEqual(hotelRow.hotel_name, 'Quiet Pool House');
    assert.strictEqual(hotelRow.destination, 'Gold Coast');

    const bot = await post(port, '/waitlist', {
      email: 'bot@example.com',
      role: 'guest',
      company_website: 'http://spam.example',
    }, { 'X-Forwarded-For': '203.0.113.8' });
    assert.strictEqual(bot.status, 303);
    assert.ok(!rows().some(r => r.email === 'bot@example.com'));

    const success = await get(port, '/?waitlist=1');
    assert.ok(success.body.includes("gtag('event','generate_lead')"));
    assert.ok(success.body.includes("You're on the list"));
    assert.ok(!success.body.includes('guest.one@example.com'));
    assert.ok(!success.body.includes('hotel@example.com'));
    const againHome = await get(port, '/');
    assert.ok(!againHome.body.includes('guest.one@example.com'));
    assert.ok(!againHome.body.includes("gtag('event','generate_lead')"));

    const locked = await get(port, '/admin/waitlist.csv');
    assert.strictEqual(locked.status, 302);
    assert.ok(locked.headers.location.includes('/admin/login'));

    const login = await post(port, '/admin/login', { user: 'jason', pass: 'wait-admin-test' });
    assert.strictEqual(login.status, 302);
    const jar = cookie(login);
    const csv = await get(port, '/admin/waitlist.csv', { Cookie: jar });
    assert.strictEqual(csv.status, 200);
    assert.ok(csv.headers['content-type'].includes('text/csv'));
    assert.ok(csv.body.includes('guest.one@example.com'));
    assert.ok(csv.body.includes('Melbourne') || csv.body.includes('Perth'));
    assert.ok(csv.body.includes('Quiet Pool House'));
    assert.ok(!csv.body.includes('test-token'));
    const admin = await get(port, '/admin', { Cookie: jar });
    assert.ok(admin.body.includes('guest.one@example.com'));
    assert.ok(!admin.body.includes('googletagmanager.com'));

    const idDb = new Database(dbPath, { readonly: true });
    const victim = idDb.prepare("SELECT id FROM waitlist WHERE email='hotel@example.com'").get();
    idDb.close();
    const removed = await post(port, '/admin/waitlist/delete', { id: String(victim.id) }, { Cookie: jar });
    assert.strictEqual(removed.status, 302);
    assert.ok(!rows().some(r => r.email === 'hotel@example.com'));

    for (let i = 1; i <= 8; i++) {
      const ok = await post(port, '/waitlist', { email: `rate${i}@example.com`, role: 'guest' }, { 'X-Forwarded-For': '203.0.113.50' });
      assert.strictEqual(ok.status, 303, 'signup ' + i);
    }
    const limited = await post(port, '/waitlist', { email: 'rate9@example.com', role: 'guest' }, { 'X-Forwarded-For': '203.0.113.50' });
    assert.strictEqual(limited.status, 429);
    assert.ok(limited.body.includes('Please wait a few minutes'));
    assert.ok(!rows().some(r => r.email === 'rate9@example.com'));
  } finally {
    child.kill('SIGTERM');
    hook.close();
  }

  const failPort = 3203;
  const fail = await start(failPort, failDb, { WAITLIST_WEBHOOK_URL: 'http://127.0.0.1:1/nope' });
  try {
    const saved = await post(failPort, '/waitlist', { email: 'offline@example.com', role: 'guest', destination: 'brisbane' }, { 'X-Forwarded-For': '203.0.113.90' });
    assert.strictEqual(saved.status, 303, saved.body.slice(0, 200));
    const stored = rows(failDb);
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].email, 'offline@example.com');
    assert.strictEqual(stored[0].destination, 'Brisbane');
  } finally {
    fail.kill('SIGTERM');
  }
  console.log('waitlist checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
