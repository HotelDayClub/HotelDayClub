const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-contact-'));
const dbPath = path.join(dir, 'daypass.db');
const repo = path.join(__dirname, '..');

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
function start(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: repo,
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: dbPath,
        DATA_DIR: '',
        ADMIN_PASSWORD: 'contact-admin-test',
        DEMO_HOTEL_PASSWORD: 'contact-hotel-test',
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
function messages() {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, name, email, booking_code, topic, message, handled FROM contact_messages ORDER BY id').all();
  db.close();
  return rows;
}
function cookie(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}
function prepareOldDatabase(file) {
  const setup = new Database(file);
  setup.exec(`CREATE TABLE hotels(id INTEGER PRIMARY KEY, name TEXT, photos TEXT);
    INSERT INTO hotels(name, photos) VALUES ('Kept Hotel', '["pool.jpg"]');
    CREATE TABLE pass_types(id INTEGER PRIMARY KEY, photo TEXT);`);
  setup.close();
}
function bootOldDatabase(file) {
  const script = [
    "const db = require('./db');",
    "const t = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='contact_messages'\").get();",
    "if (!t) process.exit(2);",
    "const cols = new Set(db.prepare('PRAGMA table_info(contact_messages)').all().map(c => c.name));",
    "for (const name of ['id','created_at','name','email','booking_code','topic','message','handled']) {",
    "  if (!cols.has(name)) { console.error('missing ' + name); process.exit(3); }",
    "}",
    "const h = db.prepare('SELECT name, photos FROM hotels').get();",
    "if (!h || h.name !== 'Kept Hotel' || h.photos !== '[\"pool.jpg\"]') { console.error(JSON.stringify(h)); process.exit(4); }",
    "if (db.prepare('SELECT COUNT(*) n FROM contact_messages').get().n !== 0) process.exit(5);",
  ].join('\n');
  return spawnSync(process.execPath, ['-e', script], {
    cwd: repo,
    env: { ...process.env, DB_PATH: file, DATA_DIR: '' },
    encoding: 'utf8',
  });
}

const valid = {
  name: 'Ada Guest',
  email: 'Ada.Guest@Example.com',
  booking_code: 'HDC-4401',
  topic: 'change',
  message: 'Please move my day to the Friday after this one.',
};

(async () => {
  const migFile = path.join(dir, 'old.db');
  prepareOldDatabase(migFile);
  const first = bootOldDatabase(migFile);
  assert.strictEqual(first.status, 0, first.stdout + first.stderr);
  const second = bootOldDatabase(migFile);
  assert.strictEqual(second.status, 0, second.stdout + second.stderr);

  const port = 3361;
  const child = await start(port);
  try {
    const page = await get(port, '/contact');
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('How can we help?'));
    assert.ok(page.body.includes('Contact us · Hotel Day Club'));
    assert.ok(page.body.includes('Send a message to Hotel Day Club about a booking'));
    assert.ok(page.body.includes('content="index, follow"'));
    assert.ok(page.body.includes('rel="canonical" href="https://www.hoteldayclub.com.au/contact"'));
    assert.ok(page.body.includes('name="name"'));
    assert.ok(page.body.includes('name="email"'));
    assert.ok(page.body.includes('name="booking_code"'));
    assert.ok(page.body.includes('Booking help'));
    assert.ok(page.body.includes('Change or cancel'));
    assert.ok(page.body.includes('Hotel partnership'));
    assert.ok(page.body.includes('Something else'));
    assert.ok(page.body.includes('name="company_website"'));
    assert.ok(page.body.includes('mailto:hello@hoteldayclub.com.au'));
    assert.ok(page.body.includes('only to reply to you'));
    assert.ok(page.body.includes('href="/privacy"'));
    assert.ok(page.body.includes('class="contact-note hotel-notice"'));
    assert.ok(page.body.includes('By sending an enquiry you consent to Hotel Day Club contacting you about a possible partnership.'));
    const contactCss = await get(port, '/golden/site.css');
    assert.ok(contactCss.body.includes('.contact-note.hotel-notice{display:none}'));
    assert.ok(contactCss.body.includes('option[value="partnership"]:checked'));
    assert.ok(page.body.includes('Send me hot-day alerts and offers by email. I can unsubscribe at any time.'));
    assert.ok(!page.body.includes('email/SMS'));
    assert.ok(!/name="marketing"[^>]*checked/.test(page.body));
    assert.ok(page.body.includes('in Australia'));
    assert.ok(!/response time|support hours|live chat|7-day support|within \d+/i.test(page.body));
    assert.strictEqual((page.body.match(/<h1/g) || []).length, 1);

    const home = await get(port, '/');
    assert.ok(home.body.includes('Help when you need it'));
    assert.ok(home.body.includes('<p class="ftr-help"><b>Help when you need it</b> <a href="/contact">Questions? Email us.</a></p>'));
    assert.ok(home.body.includes('href="/contact">Contact</a>'));
    const hiw = await get(port, '/how-it-works');
    assert.ok(hiw.body.includes('Changes and cancellations'));
    assert.ok(hiw.body.includes('href="/contact"'));
    const faq = await get(port, '/faq');
    assert.ok(faq.body.includes('Cancel in your booking link or email'));
    assert.ok(faq.body.includes('hello@hoteldayclub.com.au'));
    assert.ok(!faq.body.includes('contact form'));
    assert.ok(faq.body.includes('How do I contact you?'));
    const map = await get(port, '/sitemap.xml');
    assert.ok(map.body.includes('https://www.hoteldayclub.com.au/contact'));

    const missing = await post(port, '/contact', { email: 'ada@example.com', topic: 'booking', message: 'Hello there' }, { 'X-Forwarded-For': '203.0.113.41' });
    assert.strictEqual(missing.status, 400);
    assert.ok(missing.body.includes('Enter your name.'));
    assert.strictEqual(messages().length, 0);

    const badMail = await post(port, '/contact', { ...valid, email: 'not-an-email' }, { 'X-Forwarded-For': '203.0.113.42' });
    assert.strictEqual(badMail.status, 400);
    assert.ok(badMail.body.includes('does not look right'));
    assert.ok(badMail.body.includes('value="Ada Guest"'));

    const badCode = await post(port, '/contact', { ...valid, booking_code: '<script>' }, { 'X-Forwarded-For': '203.0.113.43' });
    assert.strictEqual(badCode.status, 400);
    assert.ok(badCode.body.includes('booking code does not look right'));

    const badTopic = await post(port, '/contact', { ...valid, topic: 'spam' }, { 'X-Forwarded-For': '203.0.113.44' });
    assert.strictEqual(badTopic.status, 400);
    assert.ok(badTopic.body.includes('Choose a topic.'));

    const tooLong = await post(port, '/contact', { ...valid, message: 'x'.repeat(2001) }, { 'X-Forwarded-For': '203.0.113.45' });
    assert.strictEqual(tooLong.status, 400);
    assert.ok(tooLong.body.includes('too long'));
    assert.strictEqual(messages().length, 0);

    const evil = await post(port, '/contact', valid, { 'X-Forwarded-For': '203.0.113.46', Origin: 'https://evil.example' });
    assert.strictEqual(evil.status, 403);
    assert.ok(evil.body.includes('could not be sent'));
    assert.strictEqual(messages().length, 0);

    const bot = await post(port, '/contact', { ...valid, company_website: 'http://spam.example' }, { 'X-Forwarded-For': '203.0.113.47' });
    assert.strictEqual(bot.status, 303);
    assert.strictEqual(bot.headers.location, '/contact?sent=1');
    assert.strictEqual(messages().length, 0);

    const nasty = {
      ...valid,
      name: '<script>alert(1)</script>',
      email: 'nasty@example.com',
      message: 'Hello <img src=x onerror=alert(1)>',
      topic: 'booking',
    };
    const saved = await post(port, '/contact', nasty, { 'X-Forwarded-For': '203.0.113.48' });
    assert.strictEqual(saved.status, 303);
    assert.strictEqual(saved.headers.location, '/contact?sent=1');
    assert.ok(!saved.headers.location.includes('nasty'));
    const thanks = await get(port, '/contact?sent=1');
    assert.strictEqual(thanks.status, 200);
    assert.ok(thanks.body.includes('Thanks, we have your message'));
    assert.ok(thanks.body.includes("We'll reply by email to the address you gave us."));
    const sentCard = thanks.body.indexOf('contact-card');
    const sentFlash = thanks.body.indexOf('<div class="flash">Message sent</div>');
    const sentCopy = thanks.body.indexOf('You can also write to');
    assert.ok(sentCard !== -1 && sentCard < sentFlash && sentFlash < sentCopy);
    assert.ok(!thanks.body.includes('nasty@example.com'));
    assert.ok(!thanks.body.includes('<script>alert(1)</script>'));
    assert.ok(!/response time|support hours|live chat|within \d+|business hours/i.test(thanks.body));
    assert.ok(thanks.body.includes('rel="canonical" href="https://www.hoteldayclub.com.au/contact"'));

    const later = await post(port, '/contact', { ...valid, name: 'Bea Later', email: 'bea@example.com', topic: 'other', message: 'Second note' }, { 'X-Forwarded-For': '203.0.113.49' });
    assert.strictEqual(later.status, 303);
    const rows = messages();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].email, 'nasty@example.com');
    assert.strictEqual(rows[0].name, '<script>alert(1)</script>');
    assert.strictEqual(rows[0].message, 'Hello <img src=x onerror=alert(1)>');
    assert.strictEqual(rows[0].topic, 'booking');
    assert.strictEqual(rows[0].handled, 0);
    assert.strictEqual(rows[1].name, 'Bea Later');
    assert.strictEqual(rows[1].booking_code, 'HDC-4401');

    const locked = await get(port, '/admin');
    assert.strictEqual(locked.status, 302);
    assert.ok(locked.headers.location.includes('/admin/login'));
    const login = await post(port, '/admin/login', { user: 'jason', pass: 'contact-admin-test' }, { 'X-Forwarded-For': '203.0.113.50' });
    assert.strictEqual(login.status, 302);
    const jar = cookie(login);
    const admin = await get(port, '/admin/messages', { Cookie: jar });
    assert.strictEqual(admin.status, 200);
    assert.ok(admin.body.includes('Contact messages'));
    assert.ok(admin.body.includes('2 new'));
    assert.ok(admin.body.includes('does not send these by email'));
    assert.ok(admin.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!admin.body.includes('<script>alert(1)</script>'));
    assert.ok(admin.body.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(admin.body.indexOf('Bea Later') < admin.body.indexOf('&lt;script&gt;'));
    assert.ok(admin.body.includes('Booking help'));
    assert.ok(admin.body.includes('Something else'));
    assert.ok(admin.body.includes('content="noindex'));

    const unmarked = await post(port, '/admin/messages/handled', { id: String(rows[1].id) });
    assert.strictEqual(unmarked.status, 302);
    assert.ok(unmarked.headers.location.includes('/admin/login'));
    assert.strictEqual(messages().find(r => r.id === rows[1].id).handled, 0);

    const marked = await post(port, '/admin/messages/handled', { id: String(rows[1].id) }, { Cookie: jar, 'X-Forwarded-For': '203.0.113.50' });
    assert.strictEqual(marked.status, 302);
    assert.ok(marked.headers.location.includes('#messages'));
    assert.strictEqual(messages().find(r => r.id === rows[1].id).handled, 1);
    assert.strictEqual(messages().find(r => r.id === rows[0].id).handled, 0);
    const after = await get(port, marked.headers.location, { Cookie: jar });
    assert.ok(after.body.includes('Marked that message as handled.'));
    assert.ok(after.body.includes('1 new'));
    const beaAt = after.body.indexOf('Bea Later');
    const scriptAt = after.body.indexOf('&lt;script&gt;');
    const between = after.body.slice(beaAt, scriptAt);
    assert.ok(between.includes('Handled'));
    assert.ok(!between.includes('Mark as handled'));

    // For hotels pitch page: enquiry form reuses the contact backend.
    const pitch = await get(port, '/for-hotels');
    assert.strictEqual(pitch.status, 200);
    assert.ok(pitch.body.includes('<form class="fh-form" method="post" action="/contact">'));
    assert.ok(pitch.body.includes('<input type="hidden" name="form" value="hotel">'));
    for (const n of ['name', 'hotel', 'email', 'message', 'company_website']) assert.ok(pitch.body.includes(`name="${n}"`), 'hotel form field ' + n);
    assert.ok(pitch.body.includes('Message <span class="opt">(optional)</span>'));
    assert.ok(/<textarea name="message"(?![^>]*required)/.test(pitch.body), 'message is optional');
    assert.ok(pitch.body.includes('<a class="hdr-login" href="/hotel/login">Hotel login</a>'));
    assert.ok(pitch.body.includes('Sample data from the demo dashboard. The hotel and figures are fictional.'));
    assert.ok(pitch.body.includes('/golden/img/fh-dashboard.webp'));
    const figs = (pitch.body.match(/<section class="fh-figs"[\s\S]*?<\/section>/) || [''])[0];
    assert.strictEqual((figs.match(/<li>/g) || []).length, 4, 'four facts in the figure strip');
    assert.strictEqual((pitch.body.match(/class="fh-card"/g) || []).length, 3, 'three benefit cards');
    const pitchText = pitch.body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
    assert.ok(!/\d\s*%|commission|stripe|payout|sydney site|\u2014/i.test(pitchText), 'no %, commission, payout or em-dash on For hotels');
    assert.ok(!/spots? left|of \d+ booked/i.test(pitchText), 'no invented availability figures');
    const hotelValid = { form: 'hotel', name: 'Hana Host', hotel: 'Harbour View Hotel', email: 'hana@hotel.example', message: '' };
    const noHotel = await post(port, '/contact', { ...hotelValid, hotel: '' }, { 'X-Forwarded-For': '203.0.113.61' });
    assert.strictEqual(noHotel.status, 400);
    assert.ok(noHotel.body.includes('Enter the hotel name.'));
    assert.ok(noHotel.body.includes('<div class="fh fh-d1">'), 'hotel form errors re-render For hotels');
    assert.ok(noHotel.body.includes('value="hana@hotel.example"'));
    const badHotelMail = await post(port, '/contact', { ...hotelValid, email: 'nope' }, { 'X-Forwarded-For': '203.0.113.62' });
    assert.strictEqual(badHotelMail.status, 400);
    assert.ok(badHotelMail.body.includes('<div class="fh fh-d1">'));
    const hotelBot = await post(port, '/contact', { ...hotelValid, company_website: 'http://spam.example' }, { 'X-Forwarded-For': '203.0.113.63' });
    assert.strictEqual(hotelBot.status, 303);
    assert.strictEqual(hotelBot.headers.location, '/for-hotels?sent=1#enquiry');
    assert.strictEqual(messages().length, 2, 'invalid or bot hotel enquiries are not saved');
    const hotelSaved = await post(port, '/contact', hotelValid, { 'X-Forwarded-For': '203.0.113.64' });
    assert.strictEqual(hotelSaved.status, 303);
    assert.strictEqual(hotelSaved.headers.location, '/for-hotels?sent=1#enquiry');
    const hotelRow = messages()[2];
    assert.strictEqual(hotelRow.topic, 'partnership');
    assert.strictEqual(hotelRow.name, 'Hana Host');
    assert.strictEqual(hotelRow.email, 'hana@hotel.example');
    assert.strictEqual(hotelRow.message, 'Hotel: Harbour View Hotel. Enquiry from the For hotels page.');
    const hotelThanks = await get(port, '/for-hotels?sent=1');
    assert.ok(hotelThanks.body.includes('Thanks, we have your note.'));
    assert.ok(!hotelThanks.body.includes('<form class="fh-form"'));
    const hotelNote = await post(port, '/contact', { ...hotelValid, message: 'Two pools, keen to try.' }, { 'X-Forwarded-For': '203.0.113.65' });
    assert.strictEqual(hotelNote.status, 303);
    assert.strictEqual(messages()[3].message, 'Hotel: Harbour View Hotel. Two pools, keen to try.');

    const limitIp = '203.0.113.90';
    for (let i = 0; i < 8; i++) {
      const attempt = await post(port, '/contact', { topic: 'booking' }, { 'X-Forwarded-For': limitIp });
      assert.strictEqual(attempt.status, 400, 'try ' + i);
    }
    const beforeLimit = messages().length;
    const limited = await post(port, '/contact', valid, { 'X-Forwarded-For': limitIp });
    assert.strictEqual(limited.status, 429);
    assert.ok(limited.body.includes('Please wait a few minutes, then try the form again.'));
    assert.strictEqual(messages().length, beforeLimit);
    const stillWaitlist = await post(port, '/waitlist', { email: 'still.ok@example.com', role: 'guest' }, { 'X-Forwarded-For': limitIp });
    assert.strictEqual(stillWaitlist.status, 303);
  } finally {
    child.kill('SIGTERM');
  }
  console.log('contact checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
