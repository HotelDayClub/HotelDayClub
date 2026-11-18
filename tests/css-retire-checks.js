const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
const baseCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'base.css'), 'utf8');

assert.ok(baseCss.includes('.privacy-note'), 'privacy-note lives in base.css');
assert.ok(!appCss.includes('.privacy-note'), 'app.css must not duplicate .privacy-note');
assert.ok(!/fonts\.googleapis\.com.*DM\+Sans/i.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8') + appCss), 'retired DM Sans request removed');

console.log('css-retire-checks passed');