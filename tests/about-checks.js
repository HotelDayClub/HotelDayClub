const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const polish = fs.readFileSync(path.join(__dirname, '..', 'public', 'polish.css'), 'utf8');

assert.ok(server.includes('class="about-commit"'), 'about page has commitments section');
assert.ok(server.includes('What we hold ourselves to'), 'about commitments heading');
assert.ok(server.includes('Honest labels'), 'about commitment on demo labels');
assert.match(polish, /\.about-commit/);

console.log('about-checks passed');