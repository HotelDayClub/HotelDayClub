const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const imgDir = path.join(__dirname, '..', 'public', 'golden', 'img');
const shots = ['fh-dashboard.jpg', 'fh-checkin.jpg', 'fh-guestlist.jpg'];

const BANNER_RGB = { r: 0, g: 52, b: 76 };
const HEADER_WHITE_MIN = 250;

function colorClose(a, b, tol) {
  return Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
}

async function sampleTopStrip(abs) {
  const { data, info } = await sharp(abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let navyHits = 0;
  let whiteHits = 0;
  const rows = Math.min(28, info.height);
  const cols = Math.min(info.width, 400);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x += 4) {
      const i = (y * info.width + x) * 4;
      const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
      if (colorClose(px, BANNER_RGB, 18)) navyHits++;
      if (px.r >= HEADER_WHITE_MIN && px.g >= HEADER_WHITE_MIN && px.b >= HEADER_WHITE_MIN) whiteHits++;
    }
  }
  return { navyHits, whiteHits, rows, cols };
}

(async () => {
  const metaPath = path.join(imgDir, 'fh-capture-meta.json');
  assert.ok(fs.existsSync(metaPath), 'fh-capture-meta.json from capture script');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  const hashes = [];
  for (const name of shots) {
    const base = name.replace(/\.jpg$/, '');
    const src = meta[base] && meta[base].source;
    const ok = base === 'fh-guestlist' ? src === 'dash-main#today-table' : src === 'dash-main';
    assert.ok(ok, base + ' capture meta source ' + src);

    const abs = path.join(imgDir, name);
    assert.ok(fs.existsSync(abs), name + ' exists');
    const fileMeta = await sharp(abs).metadata();
    assert.strictEqual(fileMeta.width, 1600, name + ' width');
    const minH = base === 'fh-guestlist' || base === 'fh-checkin' ? 900 : 420;
    assert.ok(fileMeta.height >= minH && fileMeta.height <= 1200, name + ' height ' + fileMeta.height);
    assert.notStrictEqual(fileMeta.height, 735, name + ' must not be legacy 1600×735 viewport grab');

    const strip = await sampleTopStrip(abs);
    assert.ok(strip.navyHits < 4, name + ' includes demo banner navy at top');
    assert.ok(strip.whiteHits < strip.rows * (strip.cols / 4) * 0.85, name + ' includes site header white bar at top');

    hashes.push(crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
  }
  assert.strictEqual(new Set(hashes).size, shots.length, 'for-hotels screenshots must be distinct');

  for (const base of ['fh-dashboard', 'fh-checkin', 'fh-guestlist']) {
    const webp = path.join(imgDir, `${base}.webp`);
    assert.ok(fs.existsSync(webp), base + '.webp');
    const wmeta = await sharp(webp).metadata();
    assert.strictEqual(wmeta.width, 1600, base + '.webp width');
    assert.notStrictEqual(wmeta.height, 735, base + '.webp must not be legacy viewport height');
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