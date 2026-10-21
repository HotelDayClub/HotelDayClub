const crypto = require('crypto');

function fromEnv(name, label) {
  const set = process.env[name];
  if (set && String(set).trim()) return String(set).trim();
  const generated = crypto.randomBytes(9).toString('base64url');
  console.log(`${label} password was not set (${name}). Generated for this process: ${generated}`);
  return generated;
}

let admin;
let demo;
module.exports = {
  adminPassword() { return admin || (admin = fromEnv('ADMIN_PASSWORD', 'Admin')); },
  demoHotelPassword() { return demo || (demo = fromEnv('DEMO_HOTEL_PASSWORD', 'Demo hotel')); },
};
