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
  if (probe.status === 0) {
    const [w, h] = probe.stdout.trim().split('x').map(Number);
    return { w, h };
  }
  throw new Error('size for ' + file + ': ' + probe.stderr);
}

function assertLandscape32({ w, h }, label) {
  assert.ok(w > h, label + ' must be landscape');
  const ratio = w / h;
  assert.ok(ratio > 1.48 && ratio < 1.52, label + ' expected ~3:2, got ' + w + 'x' + h);
}

const hasFfprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0;
if (hasFfprobe) {
  const photosDir = path.join(root, 'public', 'assets', 'photos');
  for (const name of fs.readdirSync(photosDir)) {
    if (!name.endsWith('.jpg')) continue;
    const abs = path.join(photosDir, name);
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', abs,
    ], { encoding: 'utf8' });
    assert.strictEqual(probe.status, 0, 'ffprobe ' + name);
    const [w, h] = probe.stdout.trim().split('x').map(Number);
    const size = { w, h };
    if (name === 'restaurant-view.jpg') {
      assertLandscape32(size, name);
      continue;
    }
    assert.ok(size.w >= 1200, name + ' width');
    assertLandscape32(size, name);
  }
} else {
  console.log('photo-dimension-checks: skip JPEG masters (ffprobe not installed); WebP cards still checked');
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