const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const banned = [
  'thatched-umbrellas.jpg',
  'tropical-resort.jpg',
  'resort-palms.jpg',
  'infinity-palms.jpg',
  'daybed-canopy.jpg',
  'cabana-drapes.jpg',
  'beach-resort-pool.jpg',
];
const files = ['server.js', 'seed.js'].map(f => path.join(root, f));

for (const abs of files) {
  const text = fs.readFileSync(abs, 'utf8');
  for (const name of banned) {
    assert.ok(!text.includes(name), `${path.basename(abs)} must not reference ${name}`);
  }
}

console.log('tropical-photo-checks passed');