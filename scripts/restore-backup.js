#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');
const { dbPath } = require('../paths');

const HEADER = 'SQLite format 3';

function usage() {
  console.error(`Usage: node scripts/restore-backup.js <backup-file> [--yes]

Stop the Hotel Day Club server first. A running server keeps the old file open and will not use the restored copy.

This copies the current database to a sibling file ending in .before-restore-<timestamp>, then replaces it with the backup.
The backup must be a SQLite file made by Admin → Back up now or the nightly job (better-sqlite3 online backup), not a copy taken while the database was being written.

You will be asked to type YES. --yes skips that prompt.
The database path comes from DB_PATH, or DATA_DIR/daypass.db, or data/daypass.db.`);
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function isSqlite(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    return n >= 15 && buf.subarray(0, 15).toString() === HEADER;
  } finally {
    fs.closeSync(fd);
  }
}

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

async function copyDatabase(src, dest) {
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}

async function main() {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const yes = args.includes('--yes');
  const fileArg = args.find(arg => arg !== '--yes');
  if (!fileArg || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(fileArg ? 0 : 1);
  }
  const source = path.resolve(fileArg);
  const dest = dbPath();
  if (!fs.existsSync(source)) {
    console.error('Backup file not found: ' + source);
    process.exit(1);
  }
  if (path.resolve(source) === path.resolve(dest)) {
    console.error('That file is the live database. Choose a backup file.');
    process.exit(1);
  }
  if (!isSqlite(source)) {
    console.error('That file is not a SQLite database.');
    process.exit(1);
  }

  console.log('Live database: ' + dest);
  console.log('Restore from:  ' + source);
  console.log('Stop the server before continuing. A running process will keep writing the old file.');

  if (fs.existsSync(dest)) {
    const live = new Database(dest, { timeout: 500 });
    try {
      live.pragma('busy_timeout = 500');
      live.exec('BEGIN IMMEDIATE');
      live.exec('ROLLBACK');
    } catch (err) {
      console.error('The database is in use (' + err.message + '). Stop the server, then run this again.');
      process.exit(1);
    } finally {
      live.close();
    }
  }

  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error('Refusing to replace the database without a yes. Re-run with --yes after you have stopped the server.');
      process.exit(1);
    }
    const answer = await ask('Type YES to replace the live database: ');
    if (answer !== 'YES') {
      console.error('Restore cancelled.');
      process.exit(1);
    }
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let aside = '';
  if (fs.existsSync(dest)) {
    aside = `${dest}.before-restore-${stamp()}`;
    await copyDatabase(dest, aside);
    console.log('Copied the current database to ' + aside);
  }
  for (const extra of [dest, dest + '-wal', dest + '-shm']) {
    if (fs.existsSync(extra)) fs.unlinkSync(extra);
  }
  await copyDatabase(source, dest);
  console.log('Restored ' + path.basename(source) + ' to ' + dest);
  console.log('Start the server again. An existing database is not re-seeded.');
}

main().catch(err => {
  console.error('Restore failed: ' + err.message);
  process.exit(1);
});
