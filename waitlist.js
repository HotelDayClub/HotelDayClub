const http = require('http');
const https = require('https');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const buckets = new Map();

function clean(value, max) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function parseSignup(body, destinations) {
  const values = {
    email: clean(body.email, 254),
    first_name: clean(body.first_name, 60),
    place: clean(body.place, 80),
    role: clean(body.role, 20),
    hotel_name: clean(body.hotel_name, 120),
    destination: clean(body.destination, 40),
  };
  if (clean(body.company_website, 200)) return { honeypot: true, values };
  if (!values.email) return { error: 'Enter an email address.', values };
  if (!EMAIL_RE.test(values.email)) return { error: 'That email address does not look right.', values };
  if (values.role !== 'guest' && values.role !== 'hotel') return { error: 'Tell us whether you are a guest or a hotel.', values };
  const dest = destinations.find(d => d.id === values.destination);
  if (values.destination && !dest) return { error: 'Choose a destination from the list, or leave it blank.', values };
  return {
    values,
    row: {
      email: values.email.toLowerCase(),
      first_name: values.first_name,
      place: values.place,
      role: values.role,
      hotel_name: values.role === 'hotel' ? values.hotel_name : '',
      destination: dest ? dest.name : '',
    },
  };
}

function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const max = 8;
  let bucket = buckets.get(ip);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, n: 0 };
    buckets.set(ip, bucket);
  }
  bucket.n += 1;
  if (buckets.size > 4000) {
    for (const [key, value] of buckets) if (now - value.start > windowMs) buckets.delete(key);
  }
  return bucket.n > max;
}

function saveSignup(db, row) {
  db.prepare(`INSERT INTO waitlist (email, first_name, place, role, hotel_name, destination)
    VALUES (@email, @first_name, @place, @role, @hotel_name, @destination)
    ON CONFLICT(email) DO UPDATE SET
      first_name = excluded.first_name,
      place = excluded.place,
      role = excluded.role,
      hotel_name = excluded.hotel_name,
      destination = excluded.destination,
      updated_at = datetime('now')`).run(row);
}

function loggedRow(row) {
  return {
    email: row.email,
    first_name: row.first_name,
    place: row.place,
    role: row.role,
    hotel_name: row.hotel_name,
    destination: row.destination,
  };
}

function notifyWebhook(row) {
  const logged = loggedRow(row);
  const url = String(process.env.WAITLIST_WEBHOOK_URL || '').trim();
  if (!url) {
    console.log('waitlist: stored locally; WAITLIST_WEBHOOK_URL is not set ' + JSON.stringify(logged));
    return Promise.resolve('unconfigured');
  }
  let target;
  try { target = new URL(url); } catch {
    console.error('waitlist: WAITLIST_WEBHOOK_URL is not a valid URL ' + JSON.stringify(logged));
    return Promise.resolve('bad-url');
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    console.error('waitlist: webhook protocol not allowed ' + JSON.stringify(logged));
    return Promise.resolve('bad-url');
  }
  const payload = JSON.stringify({
    ...logged,
    token: process.env.WAITLIST_WEBHOOK_TOKEN || '',
    source: 'hoteldayclub-waitlist',
  });
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    const req = lib.request(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 5000,
    }, res => {
      res.resume();
      if (res.statusCode < 400) {
        console.log('waitlist: webhook accepted ' + res.statusCode);
        resolve('ok');
      } else {
        console.error('waitlist: webhook status ' + res.statusCode + ' ' + JSON.stringify(logged));
        resolve('status');
      }
    });
    req.on('timeout', () => {
      req.destroy();
      console.error('waitlist: webhook timeout ' + JSON.stringify(logged));
      resolve('timeout');
    });
    req.on('error', err => {
      console.error('waitlist: webhook error ' + err.message + ' ' + JSON.stringify(logged));
      resolve('error');
    });
    req.end(payload);
  });
}

function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function waitlistCsv(rows) {
  const headers = ['email', 'first_name', 'place', 'role', 'hotel_name', 'destination', 'created_at', 'updated_at'];
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map(key => csvCell(row[key])).join(','));
  return lines.join('\r\n') + '\r\n';
}

module.exports = { parseSignup, saveSignup, notifyWebhook, rateLimited, waitlistCsv };
