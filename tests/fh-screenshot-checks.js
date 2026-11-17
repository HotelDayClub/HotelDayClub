const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const imgDir = path.join(__dirname, '..', 'public', 'golden', 'img');
const shots = ['fh-dashboard.jpg', 'fh-checkin.jpg', 'fh-guestlist.jpg'];

(async () => {
  const hashes = [];
  for (const name of shots) {
    const abs = path.join(imgDir, name);
    assert.ok(fs.existsSync(abs), name + ' exists');
    const meta = await sharp(abs).metadata();
    assert.strictEqual(meta.width, 1600, name + ' width');
    assert.strictEqual(meta.height, 735, name + ' height');
    assert.ok(fs.statSync(abs).size > 30_000, name + ' byte size');
    hashes.push(crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
  }
  assert.strictEqual(new Set(hashes).size, shots.length, 'for-hotels screenshots must be distinct');

  for (const base of ['fh-dashboard', 'fh-checkin', 'fh-guestlist']) {
    const webp = path.join(imgDir, `${base}.webp`);
    assert.ok(fs.existsSync(webp), base + '.webp');
    const meta = await sharp(webp).metadata();
    assert.strictEqual(meta.width, 1600, base + '.webp width');
    assert.strictEqual(meta.height, 735, base + '.webp height');
  }

  const credits = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'CREDITS.md'), 'utf8');
  for (const base of ['fh-dashboard', 'fh-checkin', 'fh-guestlist']) {
    assert.ok(credits.includes(`${base}.jpg`), 'CREDITS lists ' + base);
  }

  console.log('fh-screenshot-checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});