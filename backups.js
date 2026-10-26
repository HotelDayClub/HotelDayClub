const fs = require('fs');
const path = require('path');
const { dataDir, backupsDir } = require('./paths');

const TIME_ZONE = 'Australia/Sydney';
const KEEP = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_RE = /^hdc-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.sqlite$/;

function zonedParts(date, timeZone = TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

function zonedToUtc(year, month, day, hour, minute, timeZone = TIME_ZONE) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const target = utc;
  for (let i = 0; i < 4; i++) {
    const got = zonedParts(new Date(utc), timeZone);
    const gotUtc = Date.UTC(+got.year, +got.month - 1, +got.day, +got.hour, +got.minute, +got.second);
    const diff = gotUtc - target;
    if (diff === 0) return utc;
    utc -= diff;
  }
  return utc;
}

function nextSydney0330(now = new Date()) {
  const parts = zonedParts(now);
  let year = +parts.year;
  let month = +parts.month;
  let day = +parts.day;
  const minutes = +parts.hour * 60 + +parts.minute;
  if (minutes >= 3 * 60 + 30) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  let when = zonedToUtc(year, month, day, 3, 30);
  if (when <= now.getTime()) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    when = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 3, 30);
  }
  return new Date(when);
}

function formatSydney(date) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date) + ' (Sydney)';
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' bytes';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function listBackups(dir = backupsDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => NAME_RE.test(name))
    .map(name => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      return { name, file, bytes: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

function latestBackup(dir = backupsDir()) {
  return listBackups(dir)[0] || null;
}

function backupIsStale(dir = backupsDir(), now = Date.now()) {
  const latest = latestBackup(dir);
  if (!latest) return true;
  return now - latest.mtimeMs > DAY_MS;
}

function uniqueName(dir, date) {
  const parts = zonedParts(date);
  const stem = `hdc-${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`;
  let name = `${stem}.sqlite`;
  let n = 2;
  while (fs.existsSync(path.join(dir, name)) || fs.existsSync(path.join(dir, `.${name}.partial`))) {
    name = `${stem}-${n}.sqlite`;
    n += 1;
  }
  return name;
}

function pruneBackups(dir = backupsDir(), keep = KEEP) {
  const files = listBackups(dir);
  const dropped = [];
  for (const file of files.slice(keep)) {
    fs.unlinkSync(file.file);
    dropped.push(file.name);
  }
  if (fs.existsSync(dir)) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.partial')) continue;
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(file);
        dropped.push(name);
      }
    }
  }
  return { kept: Math.min(files.length, keep), deleted: dropped };
}

let chain = Promise.resolve();

function requestBackup(db, reason) {
  const run = chain.then(() => writeBackup(db, reason));
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function writeBackup(db, reason) {
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, new Date());
  const finalPath = path.join(dir, name);
  const partial = path.join(dir, `.${name}.partial`);
  try {
    await db.backup(partial);
    fs.renameSync(partial, finalPath);
  } catch (err) {
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
    console.error(`backups: ${reason} failed: ${err.message}`);
    throw err;
  }
  const bytes = fs.statSync(finalPath).size;
  const pruned = pruneBackups(dir);
  const where = dataDir() ? 'DATA_DIR/backups' : 'the backups folder next to the database';
  console.log(`backups: ${reason} wrote ${name} (${bytes} bytes) in ${where}. Kept ${pruned.kept}, deleted ${pruned.deleted.length}.`);
  return { name, file: finalPath, bytes, deleted: pruned.deleted, kept: pruned.kept };
}

function startScheduler(db) {
  if (!dataDir()) {
    console.log('backups: automatic backups skipped (DATA_DIR is not set). Admin can still back up by hand.');
    return;
  }
  fs.mkdirSync(backupsDir(), { recursive: true });
  if (backupIsStale()) {
    requestBackup(db, 'startup').catch(err => console.error(`backups: startup failed: ${err.message}`));
  } else {
    console.log('backups: latest backup is under 24 hours old.');
  }
  scheduleNext(db);
}

function scheduleNext(db) {
  const when = nextSydney0330(new Date());
  const wait = Math.max(1000, when.getTime() - Date.now());
  console.log(`backups: next automatic backup at ${formatSydney(when)}.`);
  const timer = setTimeout(() => {
    requestBackup(db, 'nightly')
      .catch(err => console.error(`backups: nightly failed: ${err.message}`))
      .then(() => scheduleNext(db));
  }, wait);
  if (timer.unref) timer.unref();
}

module.exports = {
  KEEP,
  TIME_ZONE,
  zonedParts,
  nextSydney0330,
  formatSydney,
  formatBytes,
  listBackups,
  latestBackup,
  backupIsStale,
  pruneBackups,
  requestBackup,
  startScheduler,
};
