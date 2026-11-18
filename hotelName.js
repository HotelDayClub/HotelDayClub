function displayName(hotelOrName) {
  const raw = hotelOrName && typeof hotelOrName === 'object' ? hotelOrName.name : hotelOrName;
  return String(raw || '').replace(/\s*\(Demo\)\s*$/i, '').trim();
}

module.exports = { displayName };