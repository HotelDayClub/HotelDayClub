/** Spots-left copy for listings (1–5 only). Uses the same availability rows as the booking form. */

function spotsCount(av, date) {
  if (!date || !Array.isArray(av) || av.length === 0) return null;
  const first = av[0];
  if (first && (first.blocked || first.past)) return 0;
  if (av.day_left != null && Number.isFinite(Number(av.day_left))) return Math.max(0, Math.floor(Number(av.day_left)));
  return av.reduce((sum, p) => {
    if (p.blocked || p.past) return sum;
    return sum + Math.max(0, Math.floor(Number(p.remaining) || 0));
  }, 0);
}

function spotsLabel(count) {
  if (count == null) return '';
  const n = Math.floor(Number(count));
  if (n < 1 || n > 5) return '';
  return `${n} spot${n === 1 ? '' : 's'} left`;
}

function passSpotsLabel(av, date, passCode) {
  if (!date || !passCode || !Array.isArray(av)) return '';
  const row = av.find(p => p.code === passCode);
  if (!row || row.blocked || row.past) return '';
  return spotsLabel(row.remaining);
}

module.exports = { spotsCount, spotsLabel, passSpotsLabel };