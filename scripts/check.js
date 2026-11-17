const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter(name => name.endsWith('-checks.js')).sort();
for (const file of files) {
  const env = { ...process.env };
  delete env.TZ;
  const result = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit', env });
  if (result.status) process.exit(result.status || 1);
}
