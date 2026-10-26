const crypto = require('crypto');

const STAFF_MAX_AGE = 12 * 60 * 60 * 1000;
const DEFAULT_COOKIE_SECRET = 'hdc-demo-secret';

function resolveCookieSecret() {
  const set = String(process.env.COOKIE_SECRET || '').trim();
  const builtin = !set || set === DEFAULT_COOKIE_SECRET;
  if (process.env.NODE_ENV === 'production' && builtin) {
    console.error('COOKIE_SECRET is missing or still the built-in demo value. Refusing that secret in production. Using a random in-memory secret instead. Sessions reset on restart. Set COOKIE_SECRET so logins survive a restart.');
    return crypto.randomBytes(32).toString('base64url');
  }
  return set || DEFAULT_COOKIE_SECRET;
}

function staffCookieOptions() {
  return {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STAFF_MAX_AGE,
  };
}

function staffCookie(res, name, value) {
  res.cookie(name, value, staffCookieOptions());
}

function clearStaffCookie(res, name) {
  const opts = staffCookieOptions();
  res.clearCookie(name, { httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite });
}

module.exports = { STAFF_MAX_AGE, DEFAULT_COOKIE_SECRET, resolveCookieSecret, staffCookieOptions, staffCookie, clearStaffCookie };
