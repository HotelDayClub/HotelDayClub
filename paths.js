const path = require('path');

function envPath(name) {
  const raw = process.env[name];
  if (raw == null) return '';
  return String(raw).trim();
}

function dataDir() {
  const raw = envPath('DATA_DIR');
  return raw ? path.resolve(raw) : null;
}

function dbPath() {
  const explicit = envPath('DB_PATH');
  if (explicit) return path.resolve(explicit);
  const dir = dataDir();
  if (dir) return path.join(dir, 'daypass.db');
  return path.join(__dirname, 'data', 'daypass.db');
}

function uploadsDir() {
  const dir = dataDir();
  if (dir) return path.join(dir, 'uploads');
  return path.join(__dirname, 'data', 'uploads');
}

function backupsDir() {
  const dir = dataDir();
  if (dir) return path.join(dir, 'backups');
  return path.join(path.dirname(dbPath()), 'backups');
}

module.exports = { dataDir, dbPath, uploadsDir, backupsDir };
