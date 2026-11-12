(function () {
  var hdr = document.getElementById('site-hdr');
  var hero = document.querySelector('.srch-hero');
  var drawer = document.getElementById('filter-drawer');
  var sheet = document.getElementById('search-sheet');
  var backdrop = document.querySelector('.sheet-bd');
  if (!hdr || !hero) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var phoneQuery = window.matchMedia('(max-width: 699px)');
  var drawerOpener = null;
  var sheetOpener = null;

  function phone() { return phoneQuery.matches; }
  function form() { return document.querySelector('.bigsearch'); }
  function placeForm() {
    var node = form();
    var slot = document.querySelector('.hero-slot');
    var compact = document.querySelector('.cslot');
    var sheetBody = document.querySelector('.ssheet-body');
    if (!node || !slot) return;
    var condensed = hdr.classList.contains('cond');
    var sheetOpen = sheet && !sheet.hidden;
    var target = sheetOpen ? sheetBody : (condensed && !phone() ? compact : slot);
    if (target && target !== slot && node.parentNode === slot) hero.style.minHeight = hero.offsetHeight + 'px';
    if (target && node.parentNode !== target) target.appendChild(node);
    if (target === slot) hero.style.minHeight = '';
    node.classList.toggle('is-compact', target === compact);
    var pill = document.querySelector('.cpill');
    if (pill) pill.hidden = !(condensed && phone());
  }
  function setCondensed(on) {
    hdr.classList.toggle('cond', on);
    placeForm();
  }
  if ('IntersectionObserver' in window) {
    var watch = new IntersectionObserver(function (entries) {
      var entry = entries[0];
      var past = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      setCondensed(past);
    }, { threshold: 0 });
    watch.observe(hero);
  }

  function focusables(root) {
    return [].slice.call(root.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')).filter(function (el) {
      return !el.hidden && (el.offsetParent !== null || el === document.activeElement);
    });
  }
  function trap(event, root) {
    if (event.key !== 'Tab') return;
    var items = focusables(root);
    if (!items.length) { event.preventDefault(); return; }
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    var heading = root.querySelector('h2');
    if (event.shiftKey && (active === first || active === heading || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
  function lock(on) { document.body.classList.toggle('lock', on); }
  function openDrawer() {
    if (!drawer) return;
    if (sheet && !sheet.hidden) closeSheet(true);
    drawerOpener = document.getElementById('filters-btn');
    drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
    if (drawerOpener) drawerOpener.setAttribute('aria-expanded', 'true');
    lock(true);
    var heading = document.getElementById('filters-h');
    if (heading) heading.focus();
  }
  function closeDrawer(skipFocus) {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    if (backdrop) backdrop.hidden = true;
    var btn = document.getElementById('filters-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    lock(false);
    if (!skipFocus && drawerOpener) drawerOpener.focus();
  }
  function openSheet() {
    if (!sheet) return;
    if (drawer && !drawer.hidden) closeDrawer(true);
    sheetOpener = document.querySelector('.cpill');
    sheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    if (sheetOpener) sheetOpener.setAttribute('aria-expanded', 'true');
    lock(true);
    placeForm();
    var heading = document.getElementById('ssheet-h');
    if (heading) heading.focus();
  }
  function closeSheet(skipFocus) {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    var pill = document.querySelector('.cpill');
    if (pill) pill.setAttribute('aria-expanded', 'false');
    lock(false);
    placeForm();
    if (!skipFocus && sheetOpener) sheetOpener.focus();
  }

  var countTimer = 0;
  function paintCount(n) {
    var btn = drawer && drawer.querySelector('.apply');
    var hint = document.getElementById('filter-hint');
    if (!btn) return;
    btn.textContent = 'Show ' + n + ' results';
    btn.setAttribute('data-count', String(n));
    btn.disabled = n === 0;
    btn.removeAttribute('aria-busy');
    if (hint) hint.hidden = n !== 0;
    if (n === 0) btn.setAttribute('aria-describedby', 'filter-hint');
    else btn.removeAttribute('aria-describedby');
  }
  function refreshCount() {
    if (!drawer) return;
    var btn = drawer.querySelector('.apply');
    if (!btn) return;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = false;
    btn.textContent = 'Updating results\u2026';
    clearTimeout(countTimer);
    countTimer = setTimeout(function () {
      var query = new URLSearchParams(new FormData(drawer));
      fetch('/api/search-count?' + query.toString(), { headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (data) { paintCount(Number(data.count) || 0); })
        .catch(function () {
          btn.textContent = 'Show results';
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
        });
    }, 160);
  }

  function syncMore(scope) {
    (scope || document).querySelectorAll('.day-row').forEach(function (row) {
      var btn = row.parentNode.querySelector('.day-more');
      if (!btn) return;
      var overflow = row.scrollWidth > row.clientWidth + 2;
      var atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 2;
      btn.hidden = !overflow || atEnd;
      if (!row.dataset.bound) {
        row.dataset.bound = '1';
        row.addEventListener('scroll', function () { syncMore(); });
      }
    });
  }
  function copyControl(from, to) {
    [].forEach.call(from.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'radio') {
        if (!el.checked) return;
        var match = to.querySelector('input[type="radio"][name="' + el.name + '"][value="' + el.value + '"]');
        if (match) match.checked = true;
        return;
      }
      var dest = to.elements[el.name];
      if (!dest || dest.type === 'radio') return;
      if (dest.value !== el.value) dest.value = el.value;
    });
    var guest = to.elements.guests;
    var out = to.querySelector('.step output');
    if (guest && out && guest.type === 'hidden') out.textContent = guest.value ? guest.value : 'Any';
  }
  function liveLoad(url, focusValue) {
    var count = document.querySelector('.count');
    if (count) count.setAttribute('aria-busy', 'true');
    fetch(url, { headers: { Accept: 'text/html' } })
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var nextLive = doc.querySelector('[data-live]');
        var live = document.querySelector('[data-live]');
        if (!nextLive || !live) { location.href = url; return; }
        live.innerHTML = nextLive.innerHTML;
        var nextChips = doc.querySelector('.ichips');
        var chips = document.querySelector('.ichips');
        if (nextChips && chips) chips.innerHTML = nextChips.innerHTML;
        var nextBadge = doc.querySelector('.fbtn');
        var badge = document.querySelector('.fbtn');
        if (nextBadge && badge) badge.innerHTML = nextBadge.innerHTML;
        var nextSearch = doc.querySelector('.bigsearch');
        var search = form();
        if (nextSearch && search) copyControl(nextSearch, search);
        var nextDrawer = doc.getElementById('filter-drawer');
        if (nextDrawer && drawer) copyControl(nextDrawer, drawer);
        var nextApply = nextDrawer && nextDrawer.querySelector('.apply');
        if (nextApply) paintCount(Number(nextApply.getAttribute('data-count')) || 0);
        var nextPill = doc.querySelector('.cpill-tx');
        var pill = document.querySelector('.cpill-tx');
        if (nextPill && pill) pill.textContent = nextPill.textContent;
        var nextLabel = doc.querySelector('.cpill');
        var pillBtn = document.querySelector('.cpill');
        if (nextLabel && pillBtn) pillBtn.setAttribute('aria-label', nextLabel.getAttribute('aria-label') || '');
        document.title = doc.title;
        history.pushState({}, '', url);
        syncMore(live);
        if (focusValue) {
          var again = document.querySelector('.ichip[data-value="' + focusValue + '"]');
          if (again) again.focus();
        }
      })
      .catch(function () { location.href = url; });
  }

  document.addEventListener('click', function (event) {
    var node = event.target.closest ? event.target : event.target.parentNode;
    if (!node || !node.closest) return;
    if (node.closest('.sheet-bd')) {
      event.preventDefault();
      if (drawer && !drawer.hidden) closeDrawer();
      else closeSheet();
      return;
    }
    if (node.closest('#filters-btn')) { event.preventDefault(); openDrawer(); return; }
    if (node.closest('[data-close-drawer]')) { event.preventDefault(); closeDrawer(); return; }
    if (node.closest('.cpill')) { event.preventDefault(); openSheet(); return; }
    if (node.closest('[data-close-sheet]')) { event.preventDefault(); closeSheet(); return; }
    var stepBtn = node.closest('[data-step]');
    if (stepBtn && drawer && drawer.contains(stepBtn)) {
      event.preventDefault();
      var step = stepBtn.closest('.step');
      var input = step.querySelector('input[name="guests"]');
      var out = step.querySelector('output');
      var max = Number(step.getAttribute('data-max')) || 1;
      var n = Number(input.value) || 0;
      n = Math.max(0, Math.min(max, n + Number(stepBtn.getAttribute('data-step'))));
      input.value = n ? String(n) : '';
      out.textContent = n ? String(n) : 'Any';
      refreshCount();
      return;
    }
    var more = node.closest('.day-more');
    if (more) {
      var row = more.parentNode.querySelector('.day-row');
      var pill = row && row.querySelector('.daypill');
      var width = pill ? pill.getBoundingClientRect().width + 8 : 80;
      row.scrollBy({ left: width * 3, behavior: reduce ? 'auto' : 'smooth' });
      return;
    }
    var chip = node.closest('.ichip');
    if (chip && chip.getAttribute('href')) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      liveLoad(chip.href, chip.getAttribute('data-value'));
    }
  });
  document.addEventListener('change', function (event) {
    if (drawer && event.target.closest && event.target.closest('#filter-drawer')) refreshCount();
  });
  document.addEventListener('keydown', function (event) {
    var popOpen = document.querySelector('.pk-pop:not([hidden])');
    if (event.key === 'Escape') {
      if (popOpen) return;
      if (drawer && !drawer.hidden) { event.preventDefault(); closeDrawer(); }
      else if (sheet && !sheet.hidden) { event.preventDefault(); closeSheet(); }
      return;
    }
    if (popOpen) return;
    if (drawer && !drawer.hidden) trap(event, drawer);
    else if (sheet && !sheet.hidden) trap(event, sheet);
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    var row = event.target.closest && event.target.closest('.day-row');
    if (!row) return;
    var pills = [].slice.call(row.querySelectorAll('a.daypill'));
    var index = pills.indexOf(document.activeElement);
    if (index < 0) return;
    var next = pills[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    pills.forEach(function (pill) { pill.tabIndex = -1; });
    next.tabIndex = 0;
    next.focus();
  }, true);
  document.addEventListener('submit', function (event) {
    var search = event.target.closest && event.target.closest('.bigsearch');
    if (!search) return;
    var button = search.querySelector('button[type="submit"]');
    if (button) button.setAttribute('aria-busy', 'true');
  });
  window.addEventListener('popstate', function () { location.reload(); });
  window.addEventListener('resize', function () { placeForm(); syncMore(); });
  syncMore();
})();
