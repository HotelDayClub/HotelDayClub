const crypto = require('crypto');
const { esc } = require('./util');

// Effective date for privacy and risk (Version 1.1). Customer terms use CUSTOMER_TERMS_EFFECTIVE and v1.2 at checkout.
// Refunds stay on Version 1.0. Privacy and risk pages print legalDateLabel of LEGAL_EFFECTIVE.
const LEGAL_EFFECTIVE = '2026-11-15';
const CUSTOMER_TERMS_EFFECTIVE = '2026-11-15';
const LEGAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function legalDateLabel(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  const name = LEGAL_MONTHS[month - 1];
  if (!year || !name || !day) return '';
  return `${day} ${name} ${year}`;
}

// New bookings store these values. Older rows keep the versions written when they were booked.
const LEGAL_VERSIONS = Object.freeze({
  terms: '1.2',
  refunds: '2026-11-12',
  privacy: LEGAL_EFFECTIVE,
  risk: LEGAL_EFFECTIVE,
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
    return 'Send me hot-day alerts and offers by email. I can unsubscribe at any time.';
  }

  static checkoutMarketingText() {
    return 'Send me hot-day alerts and offers by email. I can unsubscribe at any time.';
  }

  static detailsSummary() {
    return 'Read the full risk warning, hotel rules and group rules';
  }

  static refusalText() {
    return "If you break the hotel's rules, the hotel can refuse entry or ask you to leave, and no refund is payable unless the law requires it.";
  }

  static aclText() {
    return 'Nothing in this limits your rights under the Australian Consumer Law.';
  }

  static lifeguardSentence(hotel) {
    const { guardFacts } = require('./offering');
    const guard = guardFacts(hotel || {});
    if (Number(hotel && hotel.lifeguard) === 0) return 'No lifeguard is on duty at this pool.';
    return guard.risk;
  }

  static keyPointsText(hotel) {
    const { childrenAllowed } = require('./offering');
    const guard = this.lifeguardSentence(hotel);
    const supervise = childrenAllowed(hotel || {})
      ? ' Children must be actively supervised by an adult on your booking at all times.'
      : '';
    return `Risk warning: Swimming, spas, saunas and plunge pools carry risks of serious injury, illness and death, including drowning. ${guard} No diving unless the hotel's rules allow it. Don't swim or use the spa or sauna after drinking alcohol.${supervise}`;
  }

  static hazardLines(hotel) {
    const { riskLines, childrenAllowed } = require('./offering');
    const source = hotel || {};
    return riskLines(source).slice(7).filter(line => {
      if (line.startsWith('Lifeguard:')) return false;
      if (line.startsWith('Pool:') && /\bNot set\b/.test(line)) return false;
      if ((line.startsWith('Children:') || line.startsWith('Age:')) && !String(source.age_policy || '').trim() && !String(source.kids_hours || '').trim()) return false;
      if (/actively supervised/i.test(line) && !childrenAllowed(source)) return false;
      return true;
    });
  }

  static keyPointsHtml(hotel) {
    const hazards = this.hazardLines(hotel);
    const list = hazards.length ? `<ul class="co-hazards">${hazards.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : '';
    return `<div class="co-key" id="co-risk-points"><p>${esc(this.keyPointsText(hotel))}</p><p>${esc(this.refusalText())}</p>${list}</div>`;
  }

  static acceptHtml() {
    const tail = ' I\'ll show the rules and risk warning to everyone on my booking, and I or another adult on my booking will actively supervise any children at all times.';
    return `I'm 18 or over. I accept the <a href="/terms">Customer Terms</a>, the <a href="/refunds">Cancellation &amp; Refund Policy</a>, the hotel's rules and the risk warning.${tail}`;
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

  static checkoutMarketingHtml() {
    return esc(this.checkoutMarketingText());
  }

  static noticeHtml(hotelName) {
    const hotel = esc(hotelName);
    return `We collect your name, email and mobile to make and manage this booking. We share them, with your booking details, with ${hotel} so it can check you in and contact you about this booking. Some providers may store data overseas. See our <a href="/privacy">Privacy Policy</a> for how to access or correct your information or make a complaint. We record your consents with the policy version and the time.`;
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
    const rulesVersion = this.rulesVersion(rulesText);
    db.prepare(`INSERT INTO consent_log(
      booking_id, kind, policy_version, consented_at, ip,
      terms_version, refunds_version, rules_version, risk_version, privacy_version, marketing
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      bookingId,
      'acceptance',
      versions.terms,
      at,
      ip,
      versions.terms,
      versions.refunds,
      rulesVersion,
      versions.risk,
      versions.privacy,
      marketing ? 1 : 0,
    );
  }

  static adminLine(booking) {
    const row = booking || {};
    if (!row.terms_version && !row.refunds_version && !row.privacy_version && !row.risk_version) return '';
    const text = `Agreed: terms ${row.terms_version}, refunds ${row.refunds_version}, privacy ${row.privacy_version}, risk ${row.risk_version}.`;
    return `<div class="muted small">${esc(text)}</div>`;
  }
}

module.exports = { LEGAL_EFFECTIVE, CUSTOMER_TERMS_EFFECTIVE, legalDateLabel, LEGAL_VERSIONS, LegalVersions, CheckoutConsent, ConsentLog };
