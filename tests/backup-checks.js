const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const repo = path.join(__dirname, '..');
const paths = require('../paths');
const backups = require('../backups');

function withEnv(extra, fn) {
  const prev = {};
  for (const key of Object.keys(extra)) {
    prev[key] = process.env[key];
    if (extra[key] == null || extra[key] === '') delete process.env[key];
    else process.env[key] = extra[key];
  }
  const finish = () => {
    for (const key of Object.keys(extra)) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.finally(finish);
    finish();
    return result;
  } catch (err) {
    finish();
    throw err;
  }
}

function ymd(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
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
function cookie(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}
function start(port, dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: repo,
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dir,
        DB_PATH: '',
        ADMIN_PASSWORD: 'backup-admin-test',
        DEMO_HOTEL_PASSWORD: 'backup-hotel-test',
        WAITLIST_WEBHOOK_URL: '',
        GA_MEASUREMENT_ID: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 30000);
    const ready = () => log.includes('Hotel Day Club demo') && (
      log.includes('backups: startup wrote') ||
      log.includes('backups: latest backup is under 24 hours') ||
      log.includes('automatic backups skipped')
    );
    child.stdout.on('data', c => {
      log += c;
      if (ready()) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => {
      if (!ready()) reject(new Error('server exited ' + code + '\n' + log));
    });
  });
}
function stop(child) {
  return new Promise(resolve => {
    if (child.exitCode != null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}
function readRows(file) {
  const db = new Database(file, { readonly: true });
  try {
    return {
      wait: db.prepare('SELECT email, first_name FROM waitlist WHERE email=?').get('persist-guest@example.com'),
      book: db.prepare('SELECT email, guest_name, phone FROM bookings WHERE email=?').get('persist-guest@example.com'),
      hotels: db.prepare('SELECT COUNT(*) n FROM hotels').get().n,
    };
  } finally {
    db.close();
  }
}

async function unit() {
  withEnv({ DATA_DIR: '', DB_PATH: '' }, () => {
    assert.ok(paths.dbPath().endsWith(path.join('data', 'daypass.db')));
    assert.strictEqual(paths.dataDir(), null);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-paths-'));
  withEnv({ DATA_DIR: dir, DB_PATH: path.join(dir, 'custom.db') }, () => {
    assert.strictEqual(paths.dbPath(), path.join(dir, 'custom.db'));
    assert.strictEqual(paths.uploadsDir(), path.join(dir, 'uploads'));
    assert.strictEqual(paths.backupsDir(), path.join(dir, 'backups'));
  });
  withEnv({ DATA_DIR: '', DB_PATH: path.join(dir, 'custom.db') }, () => {
    assert.strictEqual(paths.backupsDir(), path.join(dir, 'backups'));
  });

  assert.strictEqual(backups.nextSydney0330(new Date('2026-01-15T00:00:00Z')).toISOString(), '2026-01-15T16:30:00.000Z');
  assert.strictEqual(backups.nextSydney0330(new Date('2026-07-15T00:00:00Z')).toISOString(), '2026-07-15T17:30:00.000Z');
  assert.strictEqual(backups.nextSydney0330(new Date('2026-10-25T16:00:00Z')).toISOString(), '2026-10-25T16:30:00.000Z');
  assert.strictEqual(backups.nextSydney0330(new Date('2026-10-25T16:30:00Z')).toISOString(), '2026-10-26T16:30:00.000Z');
  const soon = backups.nextSydney0330(new Date());
  assert.ok(soon.getTime() > Date.now());
  const parts = backups.zonedParts(soon);
  assert.strictEqual(parts.hour, '03');
  assert.strictEqual(parts.minute, '30');

  const backupDir = path.join(dir, 'prune');
  fs.mkdirSync(backupDir);
  for (let i = 0; i < 16; i++) {
    const name = `hdc-2026-01-${String(i + 1).padStart(2, '0')}-0330.sqlite`;
    const file = path.join(backupDir, name);
    fs.writeFileSync(file, 'x');
    const t = new Date('2026-02-01T00:00:00Z').getTime() + i * 1000;
    fs.utimesSync(file, t / 1000, t / 1000);
  }
  const pruned = backups.pruneBackups(backupDir, 14);
  assert.strictEqual(pruned.deleted.length, 2);
  assert.strictEqual(backups.listBackups(backupDir).length, 14);
  assert.strictEqual(backups.listBackups(backupDir)[0].name, 'hdc-2026-01-16-0330.sqlite');

  const live = path.join(dir, 'live.db');
  const db = new Database(live);
  db.exec('CREATE TABLE t(email TEXT)');
  db.prepare('INSERT INTO t(email) VALUES (?)').run('unit@example.com');
  try {
    await withEnv({ DATA_DIR: dir, DB_PATH: '' }, () => backups.requestBackup(db, 'manual').then(made => {
      assert.ok(/^hdc-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite$/.test(made.name));
      const copy = new Database(made.file, { readonly: true });
      try {
        assert.strictEqual(copy.prepare('SELECT email FROM t').get().email, 'unit@example.com');
      } finally {
        copy.close();
      }
    }));
  } finally {
    db.close();
  }

  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    withEnv({ DATA_DIR: '', DB_PATH: live }, () => backups.startScheduler({}));
  } finally {
    console.log = orig;
  }
  assert.ok(logs.some(line => line.includes('automatic backups skipped')));
}

async function main() {
  await unit();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-disk-'));
  const port = 3335;
  const dbFile = path.join(dir, 'daypass.db');
  let child = await start(port, dir);
  const when = new Date();
  when.setDate(when.getDate() + 14);
  const date = ymd(when);
  const joined = await post(port, '/waitlist', {
    email: 'persist-guest@example.com',
    first_name: 'Persis',
    place: '2000',
    role: 'guest',
  });
  assert.strictEqual(joined.status, 303, joined.body);
  const booked = await post(port, '/book', {
    hotel: 'saltwater-terrace',
    date,
    qty: '1',
    pass: 'lounger',
    name: 'Persis Guest',
    email: 'persist-guest@example.com',
    phone: '0412000111',
    rules: '1',
    terms: '1',
    risk: '1',
  });
  assert.strictEqual(booked.status, 303, booked.body);
  assert.ok(booked.headers.location.includes('/booking/'));

  await stop(child);
  child = await start(port, dir);
  let rows = readRows(dbFile);
  assert.ok(rows.wait && rows.wait.first_name === 'Persis', 'waitlist missing after restart');
  assert.ok(rows.book && rows.book.guest_name === 'Persis Guest', 'booking missing after restart');
  assert.ok(rows.hotels >= 6);

  const health = await get(port, '/healthz');
  assert.strictEqual(health.status, 200);
  assert.deepStrictEqual(JSON.parse(health.body.toString()), { ok: true, db: true });
  assert.ok(String(health.headers['cache-control']).includes('no-store'));
  const robots = (await get(port, '/robots.txt')).body.toString();
  assert.ok(robots.includes('Disallow: /healthz'));
  assert.ok(robots.includes('Disallow: /admin'));
  const map = (await get(port, '/sitemap.xml')).body.toString();
  assert.ok(!map.includes('healthz'));
  assert.ok(!map.includes('/admin'));

  const locked = [
    await get(port, '/admin/backups'),
    await post(port, '/admin/backups', {}),
    await get(port, '/admin/backups/latest'),
    await get(port, '/admin/export/bookings.csv'),
    await get(port, '/admin/export/hotels.csv'),
    await get(port, '/admin/waitlist.csv'),
  ];
  for (const res of locked) {
    assert.strictEqual(res.status, 302, res.body.toString());
    assert.ok(String(res.headers.location).includes('/admin/login'));
    assert.ok(!res.body.toString().includes('persist-guest@example.com'));
  }

  const login = await post(port, '/admin/login', { user: 'jason', pass: 'backup-admin-test' });
  const jar = cookie(login);
  assert.ok(jar.includes('admin='));
  const page = await get(port, '/admin/backups', { Cookie: jar });
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.toString().includes('Back up now'));
  assert.ok(page.body.toString().includes('content="noindex'));
  const made = await post(port, '/admin/backups', {}, { Cookie: jar });
  assert.strictEqual(made.status, 302);
  assert.ok(made.headers.location.includes('/admin/backups'));
  const file = await get(port, '/admin/backups/latest', { Cookie: jar });
  assert.strictEqual(file.status, 200);
  assert.ok(file.body.toString().startsWith('SQLite format 3'));
  assert.ok(String(file.headers['cache-control']).includes('no-store'));
  assert.ok(String(file.headers['content-disposition']).includes('attachment'));
  assert.ok(String(file.headers['x-robots-tag']).includes('noindex'));

  const bookingsCsv = (await get(port, '/admin/export/bookings.csv', { Cookie: jar })).body.toString();
  assert.ok(bookingsCsv.includes('persist-guest@example.com'));
  assert.ok(bookingsCsv.includes('Persis Guest'));
  const hotelsCsv = (await get(port, '/admin/export/hotels.csv', { Cookie: jar })).body.toString();
  assert.ok(hotelsCsv.startsWith('id,slug,name,area,status,login,contact_name,contact_email,address'));
  assert.ok(!hotelsCsv.includes('backup-hotel-test'));
  assert.ok(!hotelsCsv.toLowerCase().includes('password'));
  const waitCsv = (await get(port, '/admin/waitlist.csv', { Cookie: jar })).body.toString();
  assert.ok(waitCsv.includes('persist-guest@example.com'));

  const uploads = path.join(dir, 'uploads');
  fs.writeFileSync(path.join(uploads, 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(path.join(uploads, 'note.txt'), 'secret');
  assert.strictEqual((await get(port, '/uploads/dot.png')).status, 200);
  assert.notStrictEqual((await get(port, '/uploads/note.txt')).status, 200);
  assert.notStrictEqual((await get(port, '/uploads/daypass.db')).status, 200);

  await stop(child);
  const latest = backups.listBackups(path.join(dir, 'backups'))[0];
  const snap = new Database(latest.file, { readonly: true });
  try {
    assert.ok(snap.prepare('SELECT 1 FROM bookings WHERE email=?').get('persist-guest@example.com'));
    assert.ok(snap.prepare('SELECT 1 FROM waitlist WHERE email=?').get('persist-guest@example.com'));
  } finally {
    snap.close();
  }

  const refused = spawnSync(process.execPath, ['scripts/restore-backup.js', latest.file], {
    cwd: repo,
    env: { ...process.env, DATA_DIR: dir, DB_PATH: '' },
    encoding: 'utf8',
  });
  assert.notStrictEqual(refused.status, 0);
  assert.ok((refused.stderr || '').includes('without a yes'));
  assert.ok(readRows(dbFile).book);

  const kept = spawnSync(process.execPath, ['scripts/restore-backup.js', latest.file, '--yes'], {
    cwd: repo,
    env: { ...process.env, DATA_DIR: dir, DB_PATH: '' },
    encoding: 'utf8',
  });
  assert.strictEqual(kept.status, 0, kept.stderr + kept.stdout);
  assert.ok((kept.stdout || '').includes('Copied the current database'));
  assert.ok(fs.readdirSync(dir).some(name => name.includes('before-restore')));
  assert.ok(readRows(dbFile).book);

  for (const extra of [dbFile, dbFile + '-wal', dbFile + '-shm']) {
    if (fs.existsSync(extra)) fs.unlinkSync(extra);
  }
  assert.ok(!fs.existsSync(dbFile));
  const restored = spawnSync(process.execPath, ['scripts/restore-backup.js', latest.file, '--yes'], {
    cwd: repo,
    env: { ...process.env, DATA_DIR: dir, DB_PATH: '' },
    encoding: 'utf8',
  });
  assert.strictEqual(restored.status, 0, restored.stderr + restored.stdout);
  assert.ok((restored.stdout || '').includes('before-restore') === false || fs.existsSync(dbFile));
  rows = readRows(dbFile);
  assert.ok(rows.wait && rows.book, 'restore did not bring the rows back');

  child = await start(port, dir);
  rows = readRows(dbFile);
  assert.strictEqual(rows.book.phone, '0412000111');
  assert.strictEqual(rows.wait.email, 'persist-guest@example.com');
  assert.ok(rows.hotels >= 6);
  await stop(child);
  console.log('backup checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
