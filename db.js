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
  photos TEXT, amenities TEXT, hours TEXT, rating REAL, login TEXT UNIQUE, password TEXT,
  open_days TEXT, opens TEXT, closes TEXT, status TEXT DEFAULT 'active', contact_name TEXT, contact_email TEXT,
  heated INTEGER, setting TEXT, age_policy TEXT, kids_hours TEXT, towels INTEGER, food_rule TEXT,
  id_required INTEGER, lifeguard INTEGER, cutoff_hours INTEGER DEFAULT 2,
  season_start TEXT, season_end TEXT, season_opens TEXT, season_closes TEXT, room_only_from TEXT, room_only_to TEXT);
CREATE TABLE IF NOT EXISTS pass_types(id INTEGER PRIMARY KEY, hotel_id INTEGER REFERENCES hotels(id), code TEXT, name TEXT,
  description TEXT, price INTEGER, daily_cap INTEGER, sort INTEGER, holds INTEGER DEFAULT 1, photo TEXT, kind TEXT);
CREATE TABLE IF NOT EXISTS hotel_hours(hotel_id INTEGER REFERENCES hotels(id), weekday INTEGER, open INTEGER, opens TEXT, closes TEXT,
  PRIMARY KEY(hotel_id, weekday));
CREATE TABLE IF NOT EXISTS blocked_dates(hotel_id INTEGER REFERENCES hotels(id), date TEXT, reason TEXT, PRIMARY KEY(hotel_id,date));
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, code TEXT UNIQUE, hotel_id INTEGER REFERENCES hotels(id),
  pass_type_id INTEGER REFERENCES pass_types(id), date TEXT, qty INTEGER, unit_price INTEGER, total INTEGER,
  guest_name TEXT, email TEXT, phone TEXT, status TEXT DEFAULT 'confirmed', checked_in_at TEXT, created_at TEXT DEFAULT (datetime('now','localtime')),
  rules_ack_at TEXT, rules_text TEXT, party INTEGER);
CREATE TABLE IF NOT EXISTS addons(id INTEGER PRIMARY KEY, hotel_id INTEGER REFERENCES hotels(id), code TEXT, name TEXT,
  blurb TEXT, price INTEGER, daily_cap INTEGER, per TEXT, enabled INTEGER DEFAULT 0, sort INTEGER, UNIQUE(hotel_id, code));
CREATE TABLE IF NOT EXISTS booking_addons(booking_id INTEGER REFERENCES bookings(id), addon_id INTEGER REFERENCES addons(id),
  name TEXT, qty INTEGER, unit_price INTEGER, total INTEGER, PRIMARY KEY(booking_id, addon_id));
CREATE TABLE IF NOT EXISTS guest_notes(id INTEGER PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id),
  hotel_id INTEGER, kind TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS day_caps(hotel_id INTEGER, date TEXT, cap INTEGER, PRIMARY KEY(hotel_id, date));
`);
function ensureCols(table, cols) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const [name, ddl] of cols) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}
ensureCols('hotels', [
  ['open_days', 'TEXT'], ['opens', 'TEXT'], ['closes', 'TEXT'], ['status', "TEXT DEFAULT 'active'"],
  ['contact_name', 'TEXT'], ['contact_email', 'TEXT'], ['heated', 'INTEGER'], ['setting', 'TEXT'],
  ['age_policy', 'TEXT'], ['kids_hours', 'TEXT'], ['towels', 'INTEGER'], ['food_rule', 'TEXT'],
  ['id_required', 'INTEGER'], ['lifeguard', 'INTEGER'], ['cutoff_hours', 'INTEGER DEFAULT 2'],
  ['season_start', 'TEXT'], ['season_end', 'TEXT'], ['season_opens', 'TEXT'], ['season_closes', 'TEXT'],
  ['room_only_from', 'TEXT'], ['room_only_to', 'TEXT'], ['marketing_opt_in', 'INTEGER DEFAULT 0'],
]);
ensureCols('pass_types', [['holds', 'INTEGER DEFAULT 1'], ['photo', 'TEXT'], ['kind', 'TEXT']]);
ensureCols('bookings', [['rules_ack_at', 'TEXT'], ['rules_text', 'TEXT'], ['party', 'INTEGER'], ['marketing_opt_in', 'INTEGER DEFAULT 0']]);
module.exports = db;
