#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'tests', 'layout-checks.js')], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status || 0);