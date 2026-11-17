const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HDC_NOW = '2026-11-12T10:00:00.000Z';
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-cap-')), 'cap.db');
process.env.DB_PATH = dbPath;
process.env.DATA_DIR = '';
const db = require('../db');
const { seed, ensureSchedules, seedPerformance } = require('../seed');
const { HotelClock } = require('../calendar');
const { addDays, ymd } = require('../util');

const now = new Date(process.env.HDC_NOW);
seed(db);
ensureSchedules(db);
seedPerformance(db, now);
seedPerformance(db, now);

const hotels = db.prepare("SELECT * FROM hotels WHERE login LIKE 'demo-%'").all();
const soldStmt = db.prepare("SELECT COALESCE(SUM(qty),0) n FROM bookings WHERE pass_type_id=? AND date=? AND status!='cancelled'");
const passStmt = db.prepare('SELECT * FROM pass_types WHERE hotel_id=? ORDER BY sort, id');
const dayCapStmt = db.prepare('SELECT cap FROM day_caps WHERE hotel_id=? AND date=?');

for (const hotel of hotels) {
  const today = HotelClock.today(hotel, now);
  const passes = passStmt.all(hotel.id);
  const sumCap = passes.reduce((s, p) => s + (Number(p.daily_cap) || 0), 0);
  for (let offset = 0; offset < 14; offset++) {
    const date = ymd(addDays(new Date(`${today}T12:00:00`), offset));
    let daySold = 0;
    for (const pass of passes) {
      const sold = soldStmt.get(pass.id, date).n;
      daySold += sold;
      const pct = pass.daily_cap ? Math.round((sold * 100) / pass.daily_cap) : 0;
      assert.ok(sold <= pass.daily_cap, `${hotel.slug} ${pass.name} on ${date}: sold ${sold} > cap ${pass.daily_cap} (${pct}%)`);
    }
    const capRow = dayCapStmt.get(hotel.id, date);
    const dayCap = capRow ? Number(capRow.cap) : sumCap;
    if (dayCap > 0) {
      const pct = Math.round((daySold * 100) / dayCap);
      assert.ok(daySold <= dayCap, `${hotel.slug} day ${date}: sold ${daySold} > cap ${dayCap} (${pct}%)`);
    }
  }
}

console.log('capacity-checks passed');