// One commission rate for hotel and admin figures, and for payout math.
// Hotel share is the rest. Change PLATFORM_FEE and every label follows.
const PLATFORM_FEE = 0.25;
const HOTEL_SHARE = 1 - PLATFORM_FEE;

function hotelPct() {
  return Math.round(HOTEL_SHARE * 100);
}
function feePct() {
  return Math.round(PLATFORM_FEE * 100);
}
function share(gross) {
  const payout = Math.round(Number(gross) * hotelPct()) / 100;
  const fee = Math.round((Number(gross) - payout) * 100) / 100;
  return { payout, fee };
}

module.exports = { PLATFORM_FEE, HOTEL_SHARE, hotelPct, feePct, share };
