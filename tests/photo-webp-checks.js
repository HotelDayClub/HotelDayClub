const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PhotoAssets } = require('../photoAssets');

const photosDir = path.join(__dirname, '..', 'public', 'assets', 'photos');
const jpgs = fs.readdirSync(photosDir).filter(n => /\.jpe?g$/i.test(n)).sort();

for (const jpg of jpgs) {
  const webp = jpg.replace(/\.jpe?g$/i, '.webp');
  assert.ok(fs.existsSync(path.join(photosDir, webp)), 'gallery webp for ' + jpg);
  assert.ok(PhotoAssets.hasGalleryWebp(jpg), 'PhotoAssets sees webp for ' + jpg);
  const tag = PhotoAssets.imgTag(jpg, { alt: 'test' });
  assert.match(tag, /<picture/, 'picture for ' + jpg);
  assert.match(tag, /\/assets\/photos\/[^"]+\.webp/, 'gallery webp srcset for ' + jpg);
}

console.log('photo-webp-checks passed');