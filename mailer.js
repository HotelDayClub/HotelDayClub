const https = require('https');

// Reply-to stays this address. Another provider can replace postJson later.
const REPLY_TO = 'hello@hoteldayclub.com.au';
const HOST = 'api.resend.com';
const PATH = '/emails';

let request = https.request;

function setRequest(fn) {
  request = typeof fn === 'function' ? fn : https.request;
}

function safeReason(err) {
  const msg = String(err && err.message || 'error');
  if (/@|bearer|resend|api[_-]?key/i.test(msg) || msg.length > 160) return 'network';
  return msg;
}

function usableAddress(value) {
  const to = String(value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return '';
  return to;
}

function postJson(key, payload, idempotencyKey) {
  const body = JSON.stringify(payload);
  return new Promise(resolve => {
    let settled = false;
    const finish = (result, line) => {
      if (settled) return;
      settled = true;
      if (line) console.error(line);
      resolve(result);
    };
    const headers = {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);
    let req;
    try {
      req = request({ hostname: HOST, path: PATH, method: 'POST', headers, timeout: 8000 }, res => {
        res.resume();
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        finish(
          { ok, skipped: false },
          ok ? '' : 'mail: send failed status=' + res.statusCode,
        );
      });
    } catch (err) {
      finish({ ok: false, skipped: false }, 'mail: send failed ' + safeReason(err));
      return;
    }
    req.on('error', err => finish({ ok: false, skipped: false }, 'mail: send failed ' + safeReason(err)));
    req.setTimeout(8000, () => {
      finish({ ok: false, skipped: false }, 'mail: send failed timeout');
      req.destroy();
    });
    req.end(body);
  });
}

async function sendMail({ to, subject, html, text, idempotencyKey }) {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  if (!key) {
    console.error('mail: skipped, RESEND_API_KEY unset');
    return { ok: false, skipped: true };
  }
  const from = String(process.env.MAIL_FROM || '').trim();
  if (!from) {
    console.error('mail: skipped, MAIL_FROM unset');
    return { ok: false, skipped: true };
  }
  const recipient = usableAddress(to);
  if (!recipient) {
    console.error('mail: skipped, recipient not usable');
    return { ok: false, skipped: true };
  }
  return postJson(key, {
    from,
    to: [recipient],
    reply_to: REPLY_TO,
    subject: String(subject || '').replace(/[\r\n]+/g, ' ').slice(0, 200),
    html: String(html || ''),
    text: String(text || ''),
  }, idempotencyKey);
}

module.exports = { sendMail, setRequest, REPLY_TO };
