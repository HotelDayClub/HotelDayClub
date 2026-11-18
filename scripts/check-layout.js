#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

// Same two files as the CI layout job (.github/workflows/checks.yml).
for (const file of ['layout-checks.js', 'layout-regression-checks.js']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'tests', file)], { stdio: 'inherit', env: process.env });
  if (result.status) process.exit(result.status);
}
