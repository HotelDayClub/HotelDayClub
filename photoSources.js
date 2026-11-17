const fs = require('fs');
const path = require('path');

const MAP_PATH = path.join(__dirname, 'data', 'photo-sources.json');
let cache = null;

function loadMap() {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  }
  return cache;
}

function lookupFile(fileName) {
  const map = loadMap();
  const key = String(fileName || '').replace(/\.(jpe?g|webp)$/i, '').replace(/-sm$/, '');
  if (map[fileName]) return map[fileName];
  if (map[`${key}.jpg`]) return map[`${key}.jpg`];
  return map[key] || null;
}

/** Resolve a rendered img src (path only) to { provider, id } or null */
function sourceForSrc(src) {
  const raw = String(src || '').split('?')[0].split('#')[0];
  if (!raw.startsWith('/')) return null;
  let file = '';
  if (raw.startsWith('/assets/photos/')) {
    file = decodeURIComponent(raw.slice('/assets/photos/'.length));
    if (file.startsWith('seats/')) {
      const base = path.basename(file, path.extname(file));
      const map = loadMap();
      const seat = map.seats && map.seats[base];
      if (seat) return seat;
      return null;
    }
  }
  else if (raw.startsWith('/golden/img/cards/')) file = decodeURIComponent(raw.slice('/golden/img/cards/'.length));
  else if (raw.startsWith('/golden/img/')) file = decodeURIComponent(raw.slice('/golden/img/'.length));
  else if (raw.startsWith('/photos/seats/')) {
    const base = path.basename(raw, path.extname(raw));
    const map = loadMap();
    const seat = map.seats && map.seats[base];
    if (seat) return seat;
    return null;
  } else return null;
  if (/\.webp$/i.test(file)) file = file.replace(/\.webp$/i, '.jpg');
  const map = loadMap();
  const goldenKey = `golden/${file}`;
  if (map[goldenKey]) return map[goldenKey];
  return lookupFile(file);
}

function sourceKey(entry) {
  if (!entry || !entry.provider || entry.id == null) return '';
  return `${entry.provider}:${String(entry.id)}`;
}

module.exports = { loadMap, lookupFile, sourceForSrc, sourceKey, MAP_PATH };