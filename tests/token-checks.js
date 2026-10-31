const assert = require('assert');
const fs = require('fs');
const path = require('path');
const brand = require('../brand');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'tokens.css'), 'utf8');
const roots = css.match(/:root\s*\{/g) || [];
assert.strictEqual(roots.length, 1, 'tokens.css should have a single :root');

const declared = [...css.matchAll(/--(hdc-[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\b/g)];
const seen = new Map();
for (const [, name, hex] of declared) {
  if (!seen.has(name)) seen.set(name, hex.toUpperCase());
}
const brandKeys = Object.keys(brand).sort();
const cssKeys = [...seen.keys()].sort();
assert.deepStrictEqual(cssKeys, brandKeys, 'token names in tokens.css and brand.js differ');
for (const name of brandKeys) {
  assert.strictEqual(brand[name], seen.get(name), name);
}

const publicCss = ['public/tokens.css', 'public/styles.css', 'public/golden/site.css', 'public/golden/home.css']
  .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
  .join('\n');
const allRoots = publicCss.match(/:root\s*\{/g) || [];
assert.strictEqual(allRoots.length, 1, ':root should live only in tokens.css');

console.log('token checks passed');
