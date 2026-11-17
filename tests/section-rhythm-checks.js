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
assert.match(polish, /steps\.steps-d1\{[^}]*margin:0/);
assert.match(polish, /assure\.assure-d1\{[^}]*padding:calc\(var\(--section\) \/ 2\)/);

function ruleBlock(css, selector) {
  const idx = css.indexOf(selector + '{');
  assert.ok(idx >= 0, 'rule ' + selector);
  const body = css.slice(idx + selector.length + 1);
  const end = body.indexOf('}');
  assert.ok(end > 0, 'rule body ' + selector);
  return body.slice(0, end);
}

function assertPaddingBlock(block, label) {
  assert.match(block, /padding-block:\s*var\(--section\)/, label + ' padding-block');
  assert.ok(!/padding-top:\s*(44|64|72|88|24)px/.test(block), label + ' fixed top padding');
  assert.ok(!/margin:\s*var\(--section\)/.test(block), label + ' section margin doubling');
}

assertPaddingBlock(
  ruleBlock(polish, 'body.home main > section:not(.assure):not(.steps):not(.wl-band)'),
  'home main sections',
);
assertPaddingBlock(ruleBlock(polish, 'body.home main > section.steps.steps-d1'), 'home steps');
assertPaddingBlock(ruleBlock(polish, 'body.home main > section.wl-band'), 'home waitlist band');
assert.match(ruleBlock(polish, 'body.home section.assure.assure-d1'), /padding:calc\(var\(--section\) \/ 2\)/, 'home trust strip desktop');
assert.ok(polish.includes('body.home section.assure.assure-d1{padding-block:calc(var(--section) / 2);padding-inline:0}'), 'home trust strip mobile');
assert.ok(!/body\.home #explore\{padding-top:/.test(polish), 'explore extra top padding');

assertPaddingBlock(ruleBlock(polish, '.fh.fh-d1 > section.wrap'), 'for-hotels sections');
assert.match(ruleBlock(polish, '.fh.fh-d1 > section.fh-figs'), /padding-block:calc\(var\(--section\) \/ 2\)/, 'for-hotels figs strip');
assertPaddingBlock(ruleBlock(polish, '.fh.fh-d1 > section.fh-enquiry'), 'for-hotels enquiry');
assert.match(ruleBlock(polish, '.fh-enquiry-in'), /^(?!.*padding-(top|bottom):)/s, 'enquiry inner no extra vertical padding');

console.log('section-rhythm-checks passed');