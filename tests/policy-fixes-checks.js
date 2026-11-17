const assert = require('assert');
const fs = require('fs');
const path = require('path');

const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'policy-fixes-needed.md'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '..', 'legal', 'privacy-policy.md'), 'utf8');

assert.ok(
  doc.includes('### 1. Payment provider (fixed in code, 17 Nov 2026)'),
  'policy-fixes item 1 marked fixed',
);
assert.ok(
  doc.includes('The privacy policy now matches the demo checkout'),
  'policy-fixes item 1 notes privacy alignment',
);
assert.ok(!privacy.includes('Stripe'), 'privacy policy does not mention Stripe');
assert.ok(privacy.includes('we do not take payment on this site yet'), 'privacy states demo payments');

console.log('policy-fixes-checks passed');