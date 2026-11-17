const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tokens = fs.readFileSync(path.join(root, 'public', 'tokens.css'), 'utf8');
const base = fs.readFileSync(path.join(root, 'public', 'base.css'), 'utf8');
const polish = fs.readFileSync(path.join(root, 'public', 'polish.css'), 'utf8');

assert.match(tokens, /--section:88px/, 'desktop section token');
assert.match(tokens, /@media[^\{]*\{[^}]*--section:48px/s, 'mobile section token');
assert.match(base, /\.sec\{padding-top:calc\(var\(--section\) \/ 2\);padding-bottom:calc\(var\(--section\) \/ 2\)\}/);
assert.ok(!/\.sec\{padding-top:48px/.test(base), 'guest sec uses section token not 48px');
assert.match(polish, /hotels\.hotels-d1\{[^}]*max-width:var\(--max,1200px\)/);
assert.match(polish, /steps\.steps-d1\{[^}]*padding:var\(--section\)/);
assert.match(polish, /assure\.assure-d1\{[^}]*padding:calc\(var\(--section\) \/ 2\)/);
console.log('section-rhythm-checks passed');