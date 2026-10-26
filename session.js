const STAFF_MAX_AGE = 12 * 60 * 60 * 1000;

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

module.exports = { STAFF_MAX_AGE, staffCookieOptions, staffCookie, clearStaffCookie };
