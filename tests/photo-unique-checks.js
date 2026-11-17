const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function dirHashes(dir, ext) {
  const hashes = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(ext)) continue;
    const abs = path.join(dir, name);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    const prev = hashes.get(hash);
    assert.ok(!prev, `duplicate ${ext} in ${dir}: ${prev} and ${name}`);
    hashes.set(hash, name);
  }
}

dirHashes(path.join(root, 'public', 'assets', 'photos'), '.jpg');
dirHashes(path.join(root, 'public', 'assets', 'photos'), '.webp');
dirHashes(path.join(root, 'public', 'golden', 'img', 'cards'), '.webp');

console.log('photo-unique-checks passed');