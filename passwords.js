const crypto = require('crypto');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const HASH_PREFIX = 'scrypt$';

function fromEnv(name, label, reveal) {
  const set = process.env[name];
  if (set && String(set).trim()) return String(set).trim();
  const generated = crypto.randomBytes(9).toString('base64url');
  if (reveal) console.log(`${label} password was not set (${name}). Generated for this process: ${generated}`);
  else console.log(`${label} password was not set (${name}). Generated for this process and not printed. Set ${name} before starting if you need to log in.`);
  return generated;
}

let admin;
let demo;
function adminPassword() { return admin || (admin = fromEnv('ADMIN_PASSWORD', 'Admin', true)); }
function demoHotelPassword() { return demo || (demo = fromEnv('DEMO_HOTEL_PASSWORD', 'Demo hotel', false)); }

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `${HASH_PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function parseHash(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return null;
  const salt = Buffer.from(parts[4], 'base64');
  const hash = Buffer.from(parts[5], 'base64');
  if (salt.length < 8 || hash.length !== SCRYPT_KEYLEN) return null;
  return { N, r, p, salt, hash };
}

function isHashedPassword(value) {
  return String(value || '').startsWith(HASH_PREFIX) && !!parseHash(value);
}

let dummyHash;
function verifyPassword(plain, stored) {
  const parsed = parseHash(stored);
  const target = parsed || (dummyHash || (dummyHash = parseHash(hashPassword('hotel-day-club-dummy'))));
  const calc = crypto.scryptSync(String(plain ?? ''), target.salt, target.hash.length, { N: target.N, r: target.r, p: target.p });
  if (!parsed || calc.length !== target.hash.length) return false;
  return crypto.timingSafeEqual(calc, target.hash);
}

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const right = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

function migrateHotelPasswords(db, demoPlain = demoHotelPassword()) {
  const rows = db.prepare('SELECT id, login, password FROM hotels').all();
  const upd = db.prepare('UPDATE hotels SET password=? WHERE id=?');
  for (const row of rows) {
    const login = String(row.login || '');
    const stored = String(row.password || '');
    if (login.startsWith('demo-')) {
      if (isHashedPassword(stored) && verifyPassword(demoPlain, stored)) continue;
      upd.run(hashPassword(demoPlain), row.id);
      continue;
    }
    if (isHashedPassword(stored) || !stored) continue;
    upd.run(hashPassword(stored), row.id);
  }
}

function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.slice(0, 1).toUpperCase()}.`;
}

function maskEmail(email) {
  const raw = String(email || '').trim();
  const at = raw.indexOf('@');
  if (at <= 0 || at === raw.length - 1) return '';
  return `${raw.slice(0, 1)}***@${raw.slice(at + 1)}`;
}

module.exports = {
  adminPassword,
  demoHotelPassword,
  hashPassword,
  isHashedPassword,
  verifyPassword,
  safeEqual,
  migrateHotelPasswords,
  maskName,
  maskEmail,
};
