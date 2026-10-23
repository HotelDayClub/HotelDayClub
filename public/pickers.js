(function () {
  var ICONS = {
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>',
    any: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    pool: '<path d="M4 15c1.4 1.2 2.8 1.2 4.2 0S11 13.8 12.4 15s2.8 1.2 4.2 0 2.8-1.2 4.2 0"/><path d="M4 18.5c1.4 1.2 2.8 1.2 4.2 0S11 17.3 12.4 18.5s2.8 1.2 4.2 0 2.8-1.2 4.2 0"/><path d="M8 12V6M12 12V8"/>',
    gym: '<path d="M6 9v6M18 9v6M4 10v4M20 10v4M6 12h12"/>',
    spa: '<path d="M12 20c4-3 6-5.5 6-8.5a6 6 0 0 0-12 0c0 3 2 5.5 6 8.5z"/>',
    both: '<path d="M3 12c1.2 1 2.4 1 3.6 0S9.2 11 10.4 12s2.4 1 3.6 0"/><path d="M14 17c2-2.4 3.2-3.6 6-2.4"/><circle cx="17" cy="8" r="2"/>',
    city: '<path d="M4 20V9l5-3v14"/><path d="M9 20V4l6 3v13"/><path d="M15 20v-8l5 2v6"/><path d="M3 20h18"/>',
    wave: '<path d="M3 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M3 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/>',
    beach: '<path d="M4 18c2.5-3 5-3 8 0s5.5 3 8 0"/><path d="M12 14V5"/><path d="M12 7c3 1 4 3 4 3"/>',
    skyline: '<path d="M3 20h18"/><path d="M6 20V8h4v12"/><path d="M10 20V4h5v16"/><path d="M15 20v-7h4v7"/>',
    palm: '<path d="M12 21V11"/><path d="M12 11C8 10 6 7 5 4c3 1 5 2 7 4 2-2 4-3 7-4-1 3-3 6-7 7z"/>',
    park: '<path d="M4 18h16"/><path d="M7 18V9l5-4 5 4v9"/><path d="M10 18v-4h4v4"/>',
    laneway: '<path d="M5 20V7l4-3v16"/><path d="M9 20V9l6-2v13"/><path d="M15 20V8l4 1v11"/>',
    river: '<path d="M4 8c3 2 5 2 8 0s5-2 8 0"/><path d="M4 13c3 2 5 2 8 0s5-2 8 0"/><path d="M4 18c3 2 5 2 8 0s5-2 8 0"/>',
    coast: '<path d="M3 16c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/><circle cx="17" cy="7" r="2.2"/>',
    lighthouse: '<path d="M10 20V9l2-4 2 4v11"/><path d="M8 20h8"/><path d="M9 12h6"/><path d="M4 9h4M16 9h4"/>',
    reef: '<path d="M4 16c2-4 4-4 6 0"/><path d="M10 16c1.5-5 4-6 7-3"/><path d="M8 20h10"/><circle cx="16" cy="8" r="1.4"/>',
    sun: '<circle cx="12" cy="12" r="3.2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4"/>'
  };
  var CHECK = '<svg class="pk-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
  var CHEV = '<svg class="pk-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  var openPop = null;

  function svg(body) {
    return '<svg class="pk-ico" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
    var p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function same(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function labelDate(d) {
    return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function shortDate(d) {
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }
  function closePop() {
    if (!openPop) return;
    openPop.el.hidden = true;
    if (openPop.btn) openPop.btn.setAttribute('aria-expanded', 'false');
    openPop = null;
  }
  function place(el, anchor) {
    var host = anchor.closest('dialog') || document.body;
    if (el.parentNode !== host) host.appendChild(el);
    if (anchor.getBoundingClientRect().height < 1) anchor.scrollIntoView({ block: 'nearest' });
    var r = anchor.getBoundingClientRect();
    var cal = el.classList.contains('pk-cal');
    var margin = 8;
    el.style.width = Math.min(Math.max(r.width, cal ? 300 : 220), window.innerWidth - margin * 2) + 'px';
    el.style.maxHeight = '';
    el.style.overflowY = '';
    el.hidden = false;
    var h = el.offsetHeight;
    var below = window.innerHeight - r.bottom - margin;
    var above = r.top - margin;
    var top = r.bottom + 6;
    if (h + 6 > below && above > below) top = r.top - h - 6;
    if (top < margin) top = margin;
    var room = window.innerHeight - top - margin;
    if (h > room) {
      el.style.maxHeight = Math.max(160, room) + 'px';
      el.style.overflowY = 'auto';
      h = el.offsetHeight;
      if (!cal && above > below) top = Math.max(margin, r.top - h - 6);
    }
    if (top + h > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - h - margin);
    var left = r.left;
    if (left + el.offsetWidth > window.innerWidth - margin) left = window.innerWidth - el.offsetWidth - margin;
    el.style.top = Math.max(margin, top) + 'px';
    el.style.left = Math.max(margin, left) + 'px';
  }
  function showPop(el, btn) {
    if (openPop && openPop.el === el) { closePop(); return; }
    closePop();
    place(el, btn);
    btn.setAttribute('aria-expanded', 'true');
    openPop = { el: el, btn: btn };
  }

  function enhanceSelect(sel) {
    if (sel.dataset.pk) return;
    sel.dataset.pk = '1';
    sel.classList.add('pk-native');
    sel.setAttribute('aria-hidden', 'true');
    sel.tabIndex = -1;
    var wrap = document.createElement('div');
    wrap.className = 'pk';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    var plain = !!sel.closest('.search');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pk-btn ' + (plain ? 'pk-plain' : 'pk-field');
    btn.setAttribute('role', 'combobox');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-autocomplete', 'none');
    if (sel.id) {
      var id = sel.id;
      sel.removeAttribute('id');
      btn.id = id;
    }
    var list = document.createElement('div');
    list.className = 'pk-pop';
    list.setAttribute('role', 'listbox');
    list.id = (btn.id || 'pk') + '-list';
    list.hidden = true;
    btn.setAttribute('aria-controls', list.id);
    var options = [].slice.call(sel.options);
    function paintBtn() {
      var opt = sel.selectedOptions[0] || options[0];
      var icon = opt && opt.dataset.icon && ICONS[opt.dataset.icon];
      btn.innerHTML = (icon ? svg(icon) : '') + '<span class="pk-txt"></span>' + CHEV;
      btn.querySelector('.pk-txt').textContent = opt ? opt.textContent : '';
    }
    options.forEach(function (opt, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pk-opt';
      b.setAttribute('role', 'option');
      b.dataset.value = opt.value;
      b.setAttribute('aria-selected', opt.selected ? 'true' : 'false');
      if (opt.selected) b.classList.add('is-on');
      var icon = opt.dataset.icon && ICONS[opt.dataset.icon];
      b.innerHTML = (icon ? svg(icon) : '') + '<span class="pk-txt"></span>' + (opt.selected ? CHECK : '');
      b.querySelector('.pk-txt').textContent = opt.textContent;
      b.addEventListener('click', function () { choose(i); });
      list.appendChild(b);
    });
    function choose(i) {
      sel.selectedIndex = i;
      [].forEach.call(list.children, function (el, n) {
        var on = n === i;
        el.setAttribute('aria-selected', on ? 'true' : 'false');
        el.classList.toggle('is-on', on);
        var tick = el.querySelector('.pk-tick');
        if (on && !tick) el.insertAdjacentHTML('beforeend', CHECK);
        if (!on && tick) tick.remove();
      });
      paintBtn();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      closePop();
      btn.focus();
    }
    function move(delta) {
      var nodes = [].slice.call(list.querySelectorAll('[role="option"]'));
      var cur = nodes.findIndex(function (n) { return n === document.activeElement; });
      if (cur < 0) cur = nodes.findIndex(function (n) { return n.getAttribute('aria-selected') === 'true'; });
      var next = nodes[Math.max(0, Math.min(nodes.length - 1, cur + delta))];
      if (next) next.focus();
    }
    btn.addEventListener('click', function () {
      var willOpen = list.hidden;
      showPop(list, btn);
      if (willOpen && !list.hidden) {
        var on = list.querySelector('[aria-selected="true"]') || list.querySelector('[role="option"]');
        if (on) on.focus();
      }
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
    list.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Home') { e.preventDefault(); move(-99); }
      else if (e.key === 'End') { e.preventDefault(); move(99); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var i = [].slice.call(list.children).indexOf(document.activeElement);
        if (i >= 0) choose(i);
      } else if (e.key === 'Escape') { e.preventDefault(); closePop(); btn.focus(); }
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        var ch = e.key.toLowerCase();
        var nodes = [].slice.call(list.querySelectorAll('[role="option"]'));
        var start = nodes.indexOf(document.activeElement) + 1;
        for (var n = 0; n < nodes.length; n++) {
          var hit = nodes[(start + n) % nodes.length];
          if ((hit.textContent || '').trim().toLowerCase().indexOf(ch) === 0) { hit.focus(); break; }
        }
      }
    });
    document.body.appendChild(list);
    paintBtn();
    wrap.appendChild(btn);
  }

  function enhanceDate(input) {
    if (input.dataset.pk) return;
    input.dataset.pk = '1';
    input.classList.add('pk-native');
    var inline = input.dataset.inline === '1';
    var required = input.required;
    var min = parseISO(input.min) || new Date();
    min = new Date(min.getFullYear(), min.getMonth(), min.getDate());
    var max = parseISO(input.max) || addDays(min, 90);
    var closed = {};
    (input.dataset.closed || '').split(',').forEach(function (s) { if (s) closed[s] = 1; });
    var view = parseISO(input.value) || new Date();
    view = new Date(view.getFullYear(), view.getMonth(), 1);
    var btn = null;
    var panel = document.createElement('div');
    panel.className = 'pk-cal' + (inline ? ' pk-inline' : ' pk-pop');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Choose a date');
    if (!inline) panel.hidden = true;
    var title = document.createElement('div');
    title.className = 'pk-cal-title';
    title.setAttribute('aria-live', 'polite');
    function setValue(date, close) {
      input.value = date ? ymd(date) : '';
      if (btn) btn.querySelector('.pk-txt').textContent = date ? shortDate(date) : 'Any day';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      paint();
      if (close) { closePop(); if (btn) btn.focus(); }
    }
    function paint() {
      var selected = parseISO(input.value);
      var year = view.getFullYear();
      var month = view.getMonth();
      title.textContent = view.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      var grid = panel.querySelector('[role="grid"]');
      grid.setAttribute('aria-label', title.textContent);
      grid.innerHTML = '';
      var first = new Date(year, month, 1);
      var lead = (first.getDay() + 6) % 7;
      var days = new Date(year, month + 1, 0).getDate();
      var cells = lead + days;
      var row;
      for (var i = 0; i < cells; i++) {
        if (i % 7 === 0) { row = document.createElement('div'); row.className = 'pk-row'; row.setAttribute('role', 'row'); grid.appendChild(row); }
        if (i < lead) {
          var empty = document.createElement('span');
          row.appendChild(empty);
          continue;
        }
        var day = i - lead + 1;
        var date = new Date(year, month, day);
        var iso = ymd(date);
        var past = date < min;
        var future = date > max;
        var shut = !!closed[iso];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pk-day';
        b.setAttribute('role', 'gridcell');
        b.textContent = String(day);
        var today = same(date, new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
        if (today) { b.classList.add('is-today'); b.setAttribute('aria-current', 'date'); }
        var why = past ? 'unavailable' : future ? 'unavailable' : shut ? 'closed' : '';
        b.setAttribute('aria-label', labelDate(date) + (why ? ', ' + why : ''));
        if (past || future || shut) b.disabled = true;
        if (selected && same(date, selected)) {
          b.classList.add('is-on');
          b.setAttribute('aria-selected', 'true');
        }
        b.addEventListener('click', function (d) { return function () { setValue(d, !inline); }; }(date));
        row.appendChild(b);
      }
      var prev = panel.querySelector('[data-dir="-1"]');
      var next = panel.querySelector('[data-dir="1"]');
      var prevMonth = new Date(year, month, 0);
      var nextMonth = new Date(year, month + 1, 1);
      prev.disabled = prevMonth < new Date(min.getFullYear(), min.getMonth(), 1);
      next.disabled = nextMonth > max;
      var clear = panel.querySelector('.pk-clear');
      if (clear) clear.classList.toggle('is-on', !input.value);
    }
    panel.innerHTML = '<div class="pk-cal-top"><button type="button" class="pk-nav" data-dir="-1" aria-label="Previous month">‹</button><div class="pk-cal-title" aria-live="polite"></div><button type="button" class="pk-nav" data-dir="1" aria-label="Next month">›</button></div><div class="pk-week" aria-hidden="true">' + WEEK.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div><div role="grid"></div><p class="pk-cal-note">Past dates are unavailable.' + (input.dataset.closed ? ' Closed days cannot be booked.' : '') + '</p>' + (required ? '' : '<button type="button" class="pk-clear">Any day</button>');
    panel.querySelector('.pk-cal-top').replaceChild(title, panel.querySelector('.pk-cal-title'));
    panel.querySelector('[data-dir="-1"]').addEventListener('click', function () { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); paint(); });
    panel.querySelector('[data-dir="1"]').addEventListener('click', function () { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); paint(); });
    var clearBtn = panel.querySelector('.pk-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () { setValue(null, !inline); });
    panel.addEventListener('keydown', function (e) {
      var days = [].slice.call(panel.querySelectorAll('.pk-day'));
      var cur = days.indexOf(document.activeElement);
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step && cur >= 0) {
        e.preventDefault();
        var n = cur + step;
        while (days[n] && days[n].disabled) n += step > 0 ? 1 : -1;
        if (days[n] && !days[n].disabled) days[n].focus();
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        view = new Date(view.getFullYear(), view.getMonth() + (e.key === 'PageUp' ? -1 : 1), 1);
        paint();
      } else if ((e.key === 'Enter' || e.key === ' ') && document.activeElement && document.activeElement.classList.contains('pk-day') && !document.activeElement.disabled) {
        e.preventDefault();
        document.activeElement.click();
      } else if (e.key === 'Escape' && !inline) { e.preventDefault(); closePop(); if (btn) btn.focus(); }
    });
    paint();
    if (inline) {
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      input.insertAdjacentElement('afterend', panel);
    } else {
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      var wrap = document.createElement('div');
      wrap.className = 'pk';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pk-btn ' + (input.closest('.search') ? 'pk-plain' : 'pk-field');
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      if (input.id) { btn.id = input.id; input.id = input.id + '-native'; }
      btn.innerHTML = '<span class="pk-txt"></span>' + CHEV;
      var current = parseISO(input.value);
      btn.querySelector('.pk-txt').textContent = current ? shortDate(current) : 'Any day';
      btn.addEventListener('click', function () {
        var willOpen = panel.hidden;
        showPop(panel, btn);
        if (willOpen && !panel.hidden) {
          var day = panel.querySelector('.pk-day.is-on:not([disabled])') || panel.querySelector('.pk-day.is-today:not([disabled])') || panel.querySelector('.pk-day:not([disabled])');
          if (day) day.focus();
        }
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
      });
      wrap.appendChild(btn);
      document.body.appendChild(panel);
    }
  }

  document.addEventListener('click', function (e) {
    if (!openPop) return;
    if (openPop.el.contains(e.target) || (openPop.btn && openPop.btn.contains(e.target))) return;
    closePop();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePop();
  });
  window.addEventListener('resize', function () { if (openPop) place(openPop.el, openPop.btn); });

  document.querySelectorAll('select.hdc-pick').forEach(enhanceSelect);
  document.querySelectorAll('input.hdc-date').forEach(enhanceDate);
})();
