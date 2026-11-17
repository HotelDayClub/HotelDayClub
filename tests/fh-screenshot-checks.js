const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, '..', 'public', 'golden', 'img');
const shots = ['fh-dashboard.jpg', 'fh-checkin.jpg', 'fh-guestlist.jpg'];

const hashes = shots.map(name => {
  const abs = path.join(imgDir, name);
  assert.ok(fs.existsSync(abs), name + ' exists');
  const size = fs.statSync(abs).size;
  assert.ok(size > 50_000, name + ' looks like a real screenshot (' + size + ' bytes)');
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
});
assert.strictEqual(new Set(hashes).size, shots.length, 'for-hotels screenshots must be distinct');

for (const base of ['fh-dashboard', 'fh-checkin', 'fh-guestlist']) {
  assert.ok(fs.existsSync(path.join(imgDir, `${base}.webp`)), base + '.webp');
}

const credits = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'CREDITS.md'), 'utf8');
for (const base of ['fh-dashboard', 'fh-checkin', 'fh-guestlist']) {
  assert.ok(credits.includes(`${base}.jpg`), 'CREDITS lists ' + base);
}

console.log('fh-screenshot-checks passed');