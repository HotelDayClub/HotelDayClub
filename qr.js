const crypto = require('crypto');
const { resolveCookieSecret } = require('./session');

function qrSecret() {
  const dedicated = String(process.env.QR_SECRET || '').trim();
  if (dedicated) return dedicated;
  return resolveCookieSecret();
}

function qrKey() {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(qrSecret(), 'utf8'), Buffer.alloc(0), Buffer.from('hdc-qr-v1'), 32));
}

function qrToken(code) {
  const key = qrKey();
  const nonce = crypto.createHmac('sha256', key).update('n:' + code).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update('v1:' + code, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url');
}

function codeFromQrToken(token) {
  try {
    const raw = String(token || '');
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return '';
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length < 12 + 16 + 4) return '';
    const nonce = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const data = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', qrKey(), nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    if (!plain.startsWith('v1:')) return '';
    const code = plain.slice(3);
    if (!/^HDC-[A-Z0-9]+$/.test(code)) return '';
    return code;
  } catch {
    return '';
  }
}

module.exports = { qrToken, codeFromQrToken };
