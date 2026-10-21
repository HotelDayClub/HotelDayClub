const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'daypass.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS hotels(id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, area TEXT, tagline TEXT, blurb TEXT,
  photos TEXT, amenities TEXT, hours TEXT, rating REAL, login TEXT UNIQUE, password TEXT);
CREATE TABLE IF NOT EXISTS pass_types(id INTEGER PRIMARY KEY, hotel_id INTEGER REFERENCES hotels(id), code TEXT, name TEXT,
  description TEXT, price INTEGER, daily_cap INTEGER, sort INTEGER);
CREATE TABLE IF NOT EXISTS blocked_dates(hotel_id INTEGER REFERENCES hotels(id), date TEXT, reason TEXT, PRIMARY KEY(hotel_id,date));
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, code TEXT UNIQUE, hotel_id INTEGER REFERENCES hotels(id),
  pass_type_id INTEGER REFERENCES pass_types(id), date TEXT, qty INTEGER, unit_price INTEGER, total INTEGER,
  guest_name TEXT, email TEXT, phone TEXT, status TEXT DEFAULT 'confirmed', checked_in_at TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS addons(id INTEGER PRIMARY KEY, hotel_id INTEGER REFERENCES hotels(id), code TEXT, name TEXT,
  blurb TEXT, price INTEGER, daily_cap INTEGER, per TEXT, enabled INTEGER DEFAULT 0, sort INTEGER, UNIQUE(hotel_id, code));
CREATE TABLE IF NOT EXISTS booking_addons(booking_id INTEGER REFERENCES bookings(id), addon_id INTEGER REFERENCES addons(id),
  name TEXT, qty INTEGER, unit_price INTEGER, total INTEGER, PRIMARY KEY(booking_id, addon_id));
`);
module.exports = db;
