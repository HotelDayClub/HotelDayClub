const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'listing-dir2.css'), 'utf8');
assert.ok(/\.g-track img\{[\s\S]*object-fit:\s*cover/.test(css), 'gallery track must use cover');
assert.ok(/\.g-lb-track img[\s\S]*object-fit:\s*contain/.test(css), 'lightbox keeps contain');

const hits = [];
function scan(dir) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) scan(abs);
    else if (name.endsWith('.css')) {
      const text = fs.readFileSync(abs, 'utf8');
      const base = path.basename(abs);
      if (!/object-fit:\s*contain/.test(text)) continue;
      if (base === 'booking-ticket.css' || base === 'app.css') continue;
      if (base === 'listing-dir2.css' && /\.g-lb-track img[\s\S]*contain/.test(text)) continue;
      hits.push(path.relative(root, abs));
    }
  }
}
scan(path.join(root, 'public'));
assert.deepStrictEqual(hits, [], 'object-fit contain only in lightbox/ticket QR');

console.log('photo-cover-checks passed');