function parseBookingCode(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('code') || '';
    const queryMatch = fromQuery.toUpperCase().match(/HDC-[A-Z0-9]+/);
    if (queryMatch) return queryMatch[0];
  } catch (err) { /* plain text, not a URL */ }
  const match = text.toUpperCase().match(/HDC-[A-Z0-9]+/);
  return match ? match[0] : '';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseBookingCode };
if (typeof window !== 'undefined') window.parseBookingCode = parseBookingCode;
