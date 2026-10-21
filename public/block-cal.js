(function () {
  const dlg = document.getElementById('block-cal');
  const openBtn = document.getElementById('open-block-cal');
  if (!dlg || !openBtn) return;

  const today = dlg.dataset.today;
  const initial = JSON.parse(dlg.dataset.blocked || '[]');
  const reasons = Object.fromEntries(initial.map(b => [b.date, b.reason || '']));
  const grid = document.getElementById('block-cal-grid');
  const title = document.getElementById('block-cal-title');
  const hint = document.getElementById('block-cal-hint');
  const countEl = document.getElementById('block-cal-count');
  const datesInput = document.getElementById('block-cal-dates');
  const form = document.getElementById('block-cal-form');
  const prevBtn = dlg.querySelector('[data-dir="-1"]');
  const nextBtn = dlg.querySelector('[data-dir="1"]');
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const pad = n => String(n).padStart(2, '0');
  const attr = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const monthStart = s => { const d = parse(s); return new Date(d.getFullYear(), d.getMonth(), 1); };
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const nice = s => parse(s).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  const minMonth = monthStart(today);
  const maxMonth = addMonths(minMonth, 18);
  const maxDate = ymd(new Date(maxMonth.getFullYear(), maxMonth.getMonth() + 1, 0));
  const selectable = s => s >= today && s <= maxDate;

  let blocked = new Set();
  let anchor = null;
  let view = minMonth;

  function applyRange(from, to, on) {
    let d = from < to ? from : to;
    const end = from < to ? to : from;
    while (d <= end) {
      if (selectable(d)) { if (on) blocked.add(d); else blocked.delete(d); }
      if (d === end || d > maxDate) break;
      d = addDays(d, 1);
    }
  }

  function reset() {
    blocked = new Set(initial.map(b => b.date).filter(selectable));
    anchor = null;
    view = new Date(minMonth.getTime());
    render();
  }

  function render() {
    title.textContent = view.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
    prevBtn.disabled = view.getTime() <= minMonth.getTime();
    nextBtn.disabled = view.getTime() >= maxMonth.getTime();
    const offset = (view.getDay() + 6) % 7;
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - offset);
    const cells = DOW.map(d => `<span class="dow">${d}</span>`);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const s = ymd(d);
      const on = blocked.has(s);
      const cls = ['day'];
      if (d.getMonth() !== view.getMonth()) cls.push('out');
      if (on) cls.push('on');
      if (s === today) cls.push('today');
      if (anchor && anchor.date === s) cls.push('anchor');
      if (!selectable(s)) cls.push('past');
      const why = on && reasons[s] ? `, ${reasons[s]}` : '';
      const label = `${nice(s)}, ${on ? 'blocked' : 'open'}${why}`;
      cells.push(selectable(s)
        ? `<button type="button" class="${cls.join(' ')}" data-date="${s}" aria-pressed="${on}" aria-label="${attr(label)}">${d.getDate()}</button>`
        : `<button type="button" class="${cls.join(' ')}" disabled aria-label="${attr(label)}">${d.getDate()}</button>`);
    }
    grid.innerHTML = cells.join('');
    const n = [...blocked].filter(selectable).length;
    countEl.textContent = n === 0 ? 'No dates blocked' : n === 1 ? '1 date blocked' : `${n} dates blocked`;
    hint.textContent = anchor
      ? `${anchor.on ? 'Blocking' : 'Unblocking'} from ${nice(anchor.date)}. Tap the last day of the range.`
      : 'Tap a date to block or unblock it. Tap a second date to select every day in between.';
  }

  function onDay(date, extend) {
    if (!selectable(date)) return;
    if (anchor && (extend || anchor.date !== date)) {
      applyRange(anchor.date, date, anchor.on);
      anchor = null;
    } else if (anchor && anchor.date === date) {
      if (blocked.has(date)) blocked.delete(date); else blocked.add(date);
      anchor = null;
    } else {
      const on = !blocked.has(date);
      if (on) blocked.add(date); else blocked.delete(date);
      anchor = { date, on };
    }
    render();
  }

  grid.addEventListener('click', e => {
    const btn = e.target.closest('[data-date]');
    if (!btn) return;
    onDay(btn.dataset.date, e.shiftKey);
  });
  prevBtn.addEventListener('click', () => { view = addMonths(view, -1); if (view < minMonth) view = minMonth; render(); });
  nextBtn.addEventListener('click', () => { view = addMonths(view, 1); if (view > maxMonth) view = maxMonth; render(); });
  openBtn.addEventListener('click', () => { reset(); dlg.showModal(); });
  document.getElementById('block-cal-cancel').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { anchor = null; });
  form.addEventListener('submit', () => {
    datesInput.value = [...blocked].filter(selectable).sort().join(',');
  });
})();
