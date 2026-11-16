// Demo Explore copy is upgraded once (versioned in app_meta). Hotel edits survive restarts.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Sqlite = require('better-sqlite3');
const { FOOD_RULE } = require('../offering');
const { saveExplore, DEMO_SEED, DEMO_EXPLORE_KEY, DEMO_EXPLORE_VERSION } = require('../hotelExplore');
const { DEMO_SEED_V1 } = require('../exploreSeedV1');

const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-explore-mig-'));
const dbPath = path.join(dir, 'daypass.db');
const port = 3377;
const SLUG = 'saltwater-terrace';

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function start() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 25000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => { if (code) reject(new Error('server exited ' + code + '\n' + log)); });
  });
}

async function restart(fn) {
  const child = await start();
  try { return await fn(); } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.once('exit', r));
  }
}

function cards(db, hotelId) {
  return db.prepare('SELECT * FROM hotel_explore_areas WHERE hotel_id=? ORDER BY sort_order, id').all(hotelId);
}

function exploreBlock(html) {
  return html.slice(html.indexOf('id="explore"'), html.indexOf('id="details"'));
}

(async () => {
  // 1. Fresh database: the current seed goes in and the migration is marked done.
  await restart(async () => {});
  let db = new Sqlite(dbPath);
  const hotelId = db.prepare('SELECT id FROM hotels WHERE slug=?').get(SLUG).id;
  assert.deepStrictEqual(cards(db, hotelId).map(c => c.name), DEMO_SEED[SLUG].areas.map(a => a.name), 'fresh seed');
  assert.strictEqual(db.prepare('SELECT value FROM app_meta WHERE key=?').get(DEMO_EXPLORE_KEY).value, DEMO_EXPLORE_VERSION);

  // 2. Make it look like a live database from before this change (PR #98 seed, no meta row),
  //    with two hotel edits on top of the old seed.
  const v1 = DEMO_SEED_V1[SLUG];
  db.transaction(() => {
    db.prepare('DELETE FROM app_meta WHERE key=?').run(DEMO_EXPLORE_KEY);
    db.prepare('DELETE FROM hotel_explore_areas WHERE hotel_id=?').run(hotelId);
    db.prepare('UPDATE hotels SET about_intro=? WHERE id=?').run(v1.intro, hotelId);
    const ins = db.prepare('INSERT INTO hotel_explore_areas(hotel_id, sort_order, name, line, details, hours, photo, kind) VALUES (?,?,?,?,?,?,?,?)');
    v1.areas.forEach((a, i) => ins.run(hotelId, i, a.name, a.line, a.details, a.hours, a.photo, a.kind));
    db.prepare("UPDATE hotel_explore_areas SET line='Our own bar line.' WHERE hotel_id=? AND name='Pool bar'").run(hotelId);
    db.prepare("UPDATE hotel_explore_areas SET hours='11am\u20133pm' WHERE hotel_id=? AND name='The Terrace'").run(hotelId);
  })();
  db.close();

  // 3. One start runs the upgrade.
  await restart(async () => {
    const page = await get('/h/' + SLUG);
    const ex = exploreBlock(page.body);
    assert.ok(ex.includes('Restaurant'), 'restaurant card reaches an existing database');
    assert.ok(!ex.includes(FOOD_RULE), 'old food-rule copy replaced in Explore');
    assert.ok(ex.includes('Our own bar line.'), 'edited line shown');
  });
  db = new Sqlite(dbPath);
  let rows = cards(db, hotelId);
  const by = name => rows.find(r => r.name === name);
  const seed = name => DEMO_SEED[SLUG].areas.find(a => a.name === name);
  assert.strictEqual(rows.length, 4, 'four cards after upgrade');
  assert.ok(by('Restaurant') && by('Restaurant').kind === 'restaurant', 'restaurant card added');
  assert.strictEqual(by('The Pool').line, seed('The Pool').line, 'untouched line upgraded');
  assert.strictEqual(by('The Pool').hours, '', 'untouched hours upgraded to derived hours');
  assert.strictEqual(by('Pool bar').line, 'Our own bar line.', 'hotel-edited line kept');
  assert.strictEqual(by('Pool bar').details, seed('Pool bar').details, 'untouched details upgraded');
  assert.strictEqual(by('The Terrace').hours, '11am\u20133pm', 'hotel-edited hours kept');
  assert.strictEqual(by('The Terrace').line, seed('The Terrace').line, 'untouched terrace line upgraded');
  assert.strictEqual(db.prepare('SELECT about_intro FROM hotels WHERE id=?').get(hotelId).about_intro, DEMO_SEED[SLUG].intro, 'old intro upgraded');
  assert.strictEqual(db.prepare('SELECT value FROM app_meta WHERE key=?').get(DEMO_EXPLORE_KEY).value, DEMO_EXPLORE_VERSION, 'migration recorded');

  // 4. The hotel edits a card and removes the restaurant through the Explore editor, then the server restarts.
  const keep = rows.filter(r => r.name !== 'Restaurant');
  const res = saveExplore(db, hotelId, {
    about_intro: '',
    card_id: keep.map(r => String(r.id)),
    card_name: keep.map(r => r.name),
    card_line: keep.map(r => (r.name === 'The Pool' ? 'Edited by the hotel.' : r.line)),
    card_details: keep.map(r => r.details),
    card_hours: keep.map(r => r.hours),
    card_photo: keep.map(r => r.photo),
    card_kind: keep.map(r => r.kind),
  });
  assert.ok(!res.err, 'save ok ' + JSON.stringify(res));
  db.close();

  for (let i = 0; i < 2; i++) {
    await restart(async () => {
      const page = await get('/h/' + SLUG);
      assert.ok(exploreBlock(page.body).includes('Edited by the hotel.'), 'edit shown after restart ' + i);
    });
  }
  db = new Sqlite(dbPath);
  rows = cards(db, hotelId);
  assert.strictEqual(rows.length, 3, 'removed card stays removed after restarts');
  assert.ok(!rows.some(r => r.name === 'Restaurant'), 'restaurant not re-added');
  assert.strictEqual(rows.find(r => r.name === 'The Pool').line, 'Edited by the hotel.', 'edit kept after restarts');
  assert.strictEqual(rows.find(r => r.name === 'Pool bar').line, 'Our own bar line.', 'earlier edit kept after restarts');
  db.close();
  console.log('explore migration checks passed');
})().catch(err => { console.error(err); process.exit(1); });
