const crypto = require('crypto');
const { esc } = require('./util');

// Effective date of the legal pages served from legal/*.md (Version 1.0).
// One shared config. New bookings store these values. Older rows keep the
// versions written when they were booked.
const LEGAL_VERSIONS = Object.freeze({
  terms: '2026-11-12',
  refunds: '2026-11-12',
  privacy: '2026-11-12',
  risk: '2026-11-12',
});

class LegalVersions {
  static current() {
    return {
      terms: LEGAL_VERSIONS.terms,
      refunds: LEGAL_VERSIONS.refunds,
      privacy: LEGAL_VERSIONS.privacy,
      risk: LEGAL_VERSIONS.risk,
    };
  }
}

class CheckoutConsent {
  static shareText(hotelName) {
    return `I agree to Hotel Day Club sharing my name, email, mobile and booking details with ${hotelName} for this booking.`;
  }

  static marketingText() {
    return 'Send me hot-day alerts and offers by email/SMS. I can unsubscribe at any time.';
  }

  static riskHtml() {
    return '<b>Risk warning.</b> I have read the risk warning above. I understand that swimming and using spa facilities involve risks of injury and death, and that unless the listing says otherwise, no lifeguard is on duty. I\'ll decide for myself whether I (and anyone in my care) am fit to take part, and I\'ll swim within my ability and not swim or use the spa or sauna after drinking alcohol.';
  }

  static rulesHtml() {
    return '<b>Hotel rules.</b> I have read and will follow the hotel\'s rules (shown at checkout), including the age, ID, alcohol, glassware and conduct rules. I understand the hotel may refuse entry or ask me to leave if I break them, and that no refund is then payable unless the law requires it.';
  }

  static groupHtml() {
    return '<b>Group and children.</b> I am 18 or over. I have shown this risk warning and the rules to everyone on my booking. If children are on the booking, I am, or a named adult on this booking is, responsible for actively supervising each child at all times.';
  }

  static termsHtml() {
    return '<b>Terms.</b> I accept the Hotel Day Club <a href="/terms">Customer Terms</a> and the <a href="/refunds">Cancellation and Refund Policy</a>, and I have read the <a href="/privacy">Privacy collection notice</a>. A separate checkout box records my consent to Hotel Day Club sharing my details with the hotel for this booking. Nothing in these limits my rights under the Australian Consumer Law.';
  }

  static shareHtml(hotelName) {
    return `<b>${esc(this.shareText(hotelName))}</b>`;
  }

  static marketingHtml() {
    return esc(this.marketingText());
  }

  static noticeHtml(hotelName) {
    const hotel = esc(hotelName);
    return `We collect your name, email and mobile to make and manage this booking. We share them, with your booking details, with ${hotel} so it can check you in and contact you about this booking. Some providers may store data overseas. See our <a href="/privacy">Privacy Policy</a> for how to access or correct your information or make a complaint. We record your consents with the policy version, the time and your IP address.`;
  }

  static guestNoticeHtml(mailHtml) {
    return `<b>Guests.</b> By joining the waitlist you consent to Hotel Day Club emailing you when day passes are available near you. This is not consent to hot-day alerts or other offers unless you separately opt in. Messages will identify Hotel Day Club and include a way to unsubscribe. Contact: ${mailHtml}. See our <a href="/privacy">Privacy Policy</a>.`;
  }

  static hotelNoticeHtml(mailHtml) {
    return `<b>Hotels and partners.</b> By sending an enquiry you consent to Hotel Day Club contacting you about a possible partnership. You can ask us to stop at any time. Messages will identify Hotel Day Club. Contact: ${mailHtml}. See our <a href="/privacy">Privacy Policy</a>.`;
  }

  static box({ name, html, required, checked, invalid }) {
    const attrs = [
      'type="checkbox"',
      `name="${name}"`,
      'value="1"',
      required ? 'required' : '',
      checked ? 'checked' : '',
      invalid ? `aria-invalid="true" aria-describedby="err-${name}"` : '',
    ].filter(Boolean).join(' ');
    return `<label class="tick"><input ${attrs}> <span>${html}</span></label>`;
  }
}

class ConsentLog {
  static utcNow(now = new Date()) {
    return now.toISOString();
  }

  static clientIp(req) {
    const raw = String((req && req.ip) || 'unknown').replace(/[\u0000-\u001F\u007F]/g, '').trim();
    return (raw || 'unknown').slice(0, 80);
  }

  static rulesVersion(text) {
    return 'rules-' + crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 12);
  }

  static ticked(body, key) {
    return body[key] === '1' || body[key] === 'on';
  }

  static write(db, bookingId, { at, ip, marketing, rulesText }) {
    const versions = LegalVersions.current();
    const rows = [
      ['rules', this.rulesVersion(rulesText)],
      ['risk', versions.risk],
      ['group', versions.risk],
      ['terms', versions.terms],
      ['refunds', versions.refunds],
      ['privacy', versions.privacy],
      ['share', versions.privacy],
    ];
    if (marketing) rows.push(['marketing', versions.privacy]);
    const ins = db.prepare('INSERT INTO consent_log(booking_id, kind, policy_version, consented_at, ip) VALUES (?,?,?,?,?)');
    for (const [kind, version] of rows) ins.run(bookingId, kind, version, at, ip);
  }

  static adminLine(booking) {
    const row = booking || {};
    if (!row.terms_version && !row.refunds_version && !row.privacy_version && !row.risk_version) return '';
    const text = `Agreed: terms ${row.terms_version}, refunds ${row.refunds_version}, privacy ${row.privacy_version}, risk ${row.risk_version}.`;
    return `<div class="muted small">${esc(text)}</div>`;
  }
}

module.exports = { LEGAL_VERSIONS, LegalVersions, CheckoutConsent, ConsentLog };
