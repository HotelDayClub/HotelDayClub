// The demo banner is printed on every page. Confirmation copy and guest
// email use this same switch, so they change together when the banner does.
function demoSite() {
  return true;
}

const DEFAULT_CONTACT_EMAIL = 'hello@hoteldayclub.com.au';

function operatorEmail() {
  const raw = String(process.env.CONTACT_EMAIL || DEFAULT_CONTACT_EMAIL).trim();
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(raw) ? raw : DEFAULT_CONTACT_EMAIL;
}

function confirmationBlurb() {
  const sent = 'A confirmation email is sent to the address you gave.';
  if (!demoSite()) return sent;
  return `${sent} This is a demo booking. No payment was taken and no real booking exists.`;
}

function instantConfirmationText() {
  const sent = 'The booking is confirmed as soon as you finish checkout, and a confirmation email is sent to the address you give.';
  if (!demoSite()) return sent;
  return `${sent} This demo does not take a payment and is not a reservation at a real hotel.`;
}

module.exports = {
  demoSite,
  operatorEmail,
  DEFAULT_CONTACT_EMAIL,
  confirmationBlurb,
  instantConfirmationText,
};
