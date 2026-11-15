const { esc } = require('./util');

const PROCESS_START_MS = Date.now();

class StaticAssets {
  static buildId() {
    if (!StaticAssets._id) {
      const commit = String(process.env.RENDER_GIT_COMMIT || '').trim();
      StaticAssets._id = commit ? commit.slice(0, 12) : PROCESS_START_MS.toString(36);
    }
    return StaticAssets._id;
  }

  static assetUrl(path) {
    const raw = String(path || '').trim();
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return raw;
    const base = raw.split('?')[0].split('#')[0];
    if (!/\.(?:css|js|webp|jpe?g|png|gif|svg|woff2?)$/i.test(base)) return raw;
    const join = raw.includes('?') ? '&' : '?';
    return `${raw}${join}v=${StaticAssets.buildId()}`;
  }

  static stylesheet(path) {
    return `<link rel="stylesheet" href="${esc(StaticAssets.assetUrl(path))}">`;
  }

  static script(path) {
    return `<script src="${esc(StaticAssets.assetUrl(path))}"></script>`;
  }

  static fontLinks() {
    return `<link rel="preload" href="/golden/fonts/f3.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/golden/fonts/f5.woff2" as="font" type="font/woff2" crossorigin>${StaticAssets.stylesheet('/golden/fonts.css')}`;
  }
}

module.exports = { StaticAssets };