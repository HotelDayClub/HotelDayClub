const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-kids-'));
const dbFile = path.join(dir, 'daypass.db');
process.env.DB_PATH = dbFile;
process.env.DATA_DIR = '';

const setup = new Database(dbFile);
setup.exec(`
CREATE TABLE hotels(
  id INTEGER PRIMARY KEY, slug TEXT, name TEXT, blurb TEXT, photos TEXT, rating REAL
);
CREATE TABLE pass_types(
  id INTEGER PRIMARY KEY, hotel_id INTEGER, name TEXT, photo TEXT, price INTEGER
);
`);
const insH = setup.prepare('INSERT INTO hotels(slug,name,blurb,photos,rating) VALUES (?,?,?,?,?)');
insH.run('palm-court', 'Palm Court Resort (Demo)', 'Lagoon pool', JSON.stringify(['tropical-resort.jpg', 'kids-float.jpg', 'resort-palms.jpg', 'kids-float.jpg']), 4.2);
insH.run('other', 'Other Hotel', 'Leave this row alone', '["spa-steps.jpg","loungers-snacks.jpg"]', 3);
insH.run('broken', 'Broken Photos', 'Bad JSON stays', 'not-json', null);
setup.prepare('INSERT INTO pass_types(hotel_id,name,photo,price) VALUES (?,?,?,?)').run(1, 'Pool chair', 'kids-float.jpg', 25);
setup.prepare('INSERT INTO pass_types(hotel_id,name,photo,price) VALUES (?,?,?,?)').run(1, 'Sun lounger', 'tropical-resort.jpg', 35);
setup.prepare('INSERT INTO pass_types(hotel_id,name,photo,price) VALUES (?,?,?,?)').run(2, 'Daybed', '', 70);
setup.close();

const appDb = require('../db');
const check = new Database(dbFile, { readonly: true });
const palm = check.prepare('SELECT name, blurb, photos, rating FROM hotels WHERE slug=?').get('palm-court');
assert.deepStrictEqual(JSON.parse(palm.photos), ['tropical-resort.jpg', 'resort-palms.jpg']);
assert.strictEqual(palm.name, 'Palm Court Resort (Demo)');
assert.strictEqual(palm.blurb, 'Lagoon pool');
assert.strictEqual(palm.rating, 4.2);
const other = check.prepare('SELECT blurb, photos, rating FROM hotels WHERE slug=?').get('other');
assert.strictEqual(other.photos, '["spa-steps.jpg","loungers-snacks.jpg"]');
assert.strictEqual(other.blurb, 'Leave this row alone');
assert.strictEqual(other.rating, 3);
const broken = check.prepare('SELECT blurb, photos FROM hotels WHERE slug=?').get('broken');
assert.strictEqual(broken.photos, 'not-json');
assert.strictEqual(broken.blurb, 'Bad JSON stays');
const chair = check.prepare('SELECT photo, price, name FROM pass_types WHERE name=?').get('Pool chair');
assert.strictEqual(chair.photo, '');
assert.strictEqual(chair.price, 25);
assert.strictEqual(chair.name, 'Pool chair');
assert.strictEqual(check.prepare('SELECT photo, price FROM pass_types WHERE name=?').get('Sun lounger').photo, 'tropical-resort.jpg');
assert.strictEqual(check.prepare('SELECT photo FROM pass_types WHERE name=?').get('Daybed').photo, '');
assert.ok(!JSON.stringify(check.prepare('SELECT photos FROM hotels').all()).includes('kids-float.jpg'));
assert.ok(!check.prepare("SELECT COUNT(*) n FROM pass_types WHERE photo='kids-float.jpg'").get().n);

const snapshot = () => JSON.stringify({
  hotels: check.prepare('SELECT * FROM hotels ORDER BY id').all(),
  passes: check.prepare('SELECT * FROM pass_types ORDER BY id').all(),
});
const once = snapshot();
appDb.dropKidsFloatPhoto(appDb);
const twice = snapshot();
assert.strictEqual(twice, once);
check.close();
appDb.close();

assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'photos', 'kids-float.jpg')));
const photos = require('../offering').PHOTOS.map(p => p[0]);
assert.ok(!photos.includes('kids-float.jpg'));
console.log('photo migration checks passed');
