const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function imageSize(file) {
  if (file.endsWith('.webp')) {
    const buf = fs.readFileSync(file);
    const vp8 = buf.indexOf(Buffer.from('VP8 '));
    assert.ok(vp8 > 0, 'VP8 chunk in ' + file);
    const w = buf.readUInt16LE(vp8 + 14) & 0x3fff;
    const h = buf.readUInt16LE(vp8 + 16) & 0x3fff;
    return { w, h };
  }
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0:s=x',
    file,
  ], { encoding: 'utf8' });
  assert.strictEqual(probe.status, 0, 'ffprobe ' + file + ': ' + probe.stderr);
  const [w, h] = probe.stdout.trim().split('x').map(Number);
  return { w, h };
}

function assertLandscape32({ w, h }, label) {
  assert.ok(w > h, label + ' must be landscape');
  const ratio = w / h;
  assert.ok(ratio > 1.48 && ratio < 1.52, label + ' expected ~3:2, got ' + w + 'x' + h);
}

const photosDir = path.join(root, 'public', 'assets', 'photos');
for (const name of fs.readdirSync(photosDir)) {
  if (!name.endsWith('.jpg')) continue;
  const abs = path.join(photosDir, name);
  const size = imageSize(abs);
  if (name === 'restaurant-view.jpg') {
    assert.ok(size.h > size.w, 'restaurant-view stays portrait');
    assert.strictEqual(size.w, 1000);
    assert.strictEqual(size.h, 1500);
    continue;
  }
  assert.strictEqual(size.w, 1600, name + ' width');
  assert.strictEqual(size.h, 1067, name + ' height');
  assertLandscape32(size, name);
}

const cardsDir = path.join(root, 'public', 'golden', 'img', 'cards');
for (const name of fs.readdirSync(cardsDir)) {
  if (!name.endsWith('.webp')) continue;
  const size = imageSize(path.join(cardsDir, name));
  assert.strictEqual(size.w, 800, name);
  assert.strictEqual(size.h, 533, name);
  assertLandscape32(size, name);
}

console.log('photo-dimension-checks passed');