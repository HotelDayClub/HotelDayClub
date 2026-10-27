const { rateLimited } = require('./waitlist');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOPICS = [
  { value: 'booking', label: 'Booking help' },
  { value: 'change', label: 'Change or cancel' },
  { value: 'partnership', label: 'Hotel partnership' },
  { value: 'other', label: 'Something else' },
];
const TOPIC_VALUES = new Set(TOPICS.map(t => t.value));

function stripped(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function parseMessage(body) {
  const raw = body || {};
  const values = {
    name: stripped(raw.name).slice(0, 80),
    email: stripped(raw.email).slice(0, 254),
    booking_code: stripped(raw.booking_code).slice(0, 40),
    topic: stripped(raw.topic).slice(0, 40),
    message: stripped(raw.message).slice(0, 2000),
  };
  if (stripped(raw.company_website)) return { honeypot: true, values };
  if (stripped(raw.name).length > 80) return { error: 'Name is too long.', values };
  if (stripped(raw.email).length > 254) return { error: 'That email address is too long.', values };
  if (stripped(raw.booking_code).length > 40) return { error: 'That booking code is too long.', values };
  if (stripped(raw.message).length > 2000) return { error: 'Message is too long. Keep it under 2,000 characters.', values };
  if (!values.name) return { error: 'Enter your name.', values };
  if (!values.email) return { error: 'Enter an email address.', values };
  if (!EMAIL_RE.test(values.email)) return { error: 'That email address does not look right.', values };
  if (values.booking_code && !/^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/.test(values.booking_code)) {
    return { error: 'That booking code does not look right.', values };
  }
  if (!TOPIC_VALUES.has(values.topic)) return { error: 'Choose a topic.', values };
  if (!values.message) return { error: 'Write a short message.', values };
  return {
    values,
    row: {
      name: values.name,
      email: values.email.toLowerCase(),
      booking_code: values.booking_code,
      topic: values.topic,
      message: values.message,
    },
  };
}

function contactLimited(ip) {
  return rateLimited('contact:' + (ip || 'unknown'));
}

function saveMessage(db, row) {
  return db.prepare(`INSERT INTO contact_messages (name, email, booking_code, topic, message)
    VALUES (@name, @email, @booking_code, @topic, @message)`).run(row).lastInsertRowid;
}

function topicLabel(value) {
  const found = TOPICS.find(t => t.value === value);
  return found ? found.label : String(value || '');
}

function sameSitePost(req) {
  const host = String(req.get('host') || '');
  const ok = header => {
    if (!header) return true;
    let url;
    try { url = new URL(header); } catch { return false; }
    return url.host === host;
  };
  return ok(req.get('origin')) && ok(req.get('referer'));
}

module.exports = { TOPICS, parseMessage, contactLimited, saveMessage, topicLabel, sameSitePost };
