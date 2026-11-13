const crypto = require('crypto');

// Guest-facing booking code. The long token stays the URL and QR secret.
// This code is display only and must never unlock a booking on its own.
class ShortCode {
  static alphabet() {
    return '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  }

  static example() {
    return 'HDC-7Q4K-2M9X';
  }

  static fresh() {
    const alphabet = this.alphabet();
    let body = '';
    for (let i = 0; i < 8; i++) body += alphabet[crypto.randomInt(alphabet.length)];
    return `HDC-${body.slice(0, 4)}-${body.slice(4)}`;
  }

  static is(raw) {
    const alphabet = this.alphabet();
    return new RegExp(`^HDC-[${alphabet}]{4}-[${alphabet}]{4}$`).test(String(raw || '').trim().toUpperCase());
  }

  // Ignores case, spaces and hyphens. Returns '' when the text is not a short code.
  static canonical(raw) {
    const compact = String(raw || '').toUpperCase().replace(/[\s-]+/g, '');
    const alphabet = this.alphabet();
    let body = '';
    if (new RegExp(`^HDC[${alphabet}]{8}$`).test(compact)) body = compact.slice(3);
    else if (new RegExp(`^[${alphabet}]{8}$`).test(compact)) body = compact;
    else return '';
    return `HDC-${body.slice(0, 4)}-${body.slice(4)}`;
  }

  static take(db) {
    for (let n = 0; n < 12; n++) {
      const code = this.fresh();
      if (!db.prepare('SELECT 1 FROM bookings WHERE short_code=?').get(code)) return code;
    }
    throw new Error('Could not allocate a booking code');
  }

  static backfill(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name));
    if (!cols.has('short_code')) return;
    const rows = db.prepare("SELECT id FROM bookings WHERE short_code IS NULL OR short_code=''").all();
    const write = db.prepare("UPDATE bookings SET short_code=? WHERE id=? AND (short_code IS NULL OR short_code='')");
    db.transaction(() => {
      for (const row of rows) {
        let placed = false;
        for (let n = 0; n < 12 && !placed; n++) {
          try {
            placed = write.run(this.fresh(), row.id).changes === 1;
          } catch (err) {
            if (!/UNIQUE/i.test(String(err && err.message))) throw err;
          }
        }
        if (!placed) throw new Error('Could not allocate a booking code');
      }
    })();
  }
}

module.exports = { ShortCode };
