const fs = require('fs');
const path = require('path');
const { esc } = require('./util');
const { StaticAssets } = require('./staticAssets');

const CARDS_DIR = path.join(__dirname, 'public', 'golden', 'img', 'cards');

class PhotoAssets {
  static cardBase(photo) {
    const file = String(photo || '').trim();
    if (!file) return '';
    return file.replace(/\.jpe?g$/i, '');
  }

  static hasCardWebp(photo) {
    const base = PhotoAssets.cardBase(photo);
    if (!base) return false;
    return fs.existsSync(path.join(CARDS_DIR, `${base}.webp`));
  }

  static cardWebpUrl(photo) {
    if (!PhotoAssets.hasCardWebp(photo)) return '';
    const base = PhotoAssets.cardBase(photo);
    return StaticAssets.assetUrl(`/golden/img/cards/${base}.webp`);
  }

  static jpgUrl(photo) {
    const file = String(photo || '').trim();
    if (!file) return '';
    return StaticAssets.assetUrl(`/assets/photos/${file}`);
  }

  static imgTag(photo, opts = {}) {
    const {
      alt = '',
      width = 800,
      height = 600,
      sizes = '100vw',
      loading = 'lazy',
      className = '',
      fetchpriority = '',
    } = opts;
    const file = String(photo || '').trim();
    if (!file) return '';
    const webp = PhotoAssets.cardWebpUrl(file);
    const jpg = PhotoAssets.jpgUrl(file);
    const cls = className ? ` class="${esc(className)}"` : '';
    const fp = fetchpriority ? ` fetchpriority="${esc(fetchpriority)}"` : '';
    const load = loading ? ` loading="${esc(loading)}"` : '';
    if (webp) {
      const srcset = `${esc(webp)} 800w`;
      return `<picture${cls}><source type="image/webp" srcset="${srcset}" sizes="${esc(sizes)}"><img src="${esc(jpg)}" alt="${esc(alt)}" width="${width}" height="${height}"${load} decoding="async"${fp}></picture>`;
    }
    return `<img src="${esc(jpg)}" alt="${esc(alt)}" width="${width}" height="${height}"${load} decoding="async"${fp}${cls}>`;
  }
}

module.exports = { PhotoAssets };