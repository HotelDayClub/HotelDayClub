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
    sheetOpener = document.querySelector('.search-sum') || document.querySelector('.cpill');
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

  function pillStep(row) {
    var pill = row.querySelector('.daypill');
    if (!pill) return 0;
    var gap = parseFloat(getComputedStyle(row).columnGap || getComputedStyle(row).gap) || 0;
    return pill.getBoundingClientRect().width + gap;
  }
  function visiblePills(row) {
    var step = pillStep(row);
    if (!step) return 1;
    return Math.max(1, Math.round(row.clientWidth / step));
  }
  function showSelected(row) {
    var step = pillStep(row);
    if (!step) return;
    var pills = [].slice.call(row.querySelectorAll('.daypill'));
    var count = visiblePills(row);
    var selected = -1;
    pills.forEach(function (pill, index) {
      if (pill.classList.contains('on') || pill.getAttribute('aria-pressed') === 'true') selected = index;
    });
    if (selected < 0) return;
    var current = Math.round(row.scrollLeft / step);
    if (selected >= current && selected < current + count) return;
    var start = Math.min(Math.max(0, selected - count + 1), Math.max(0, pills.length - count));
    row.scrollLeft = start * step;
  }
  function syncMore(scope) {
    (scope || document).querySelectorAll('.day-row').forEach(function (row) {
      var btn = row.parentNode.querySelector('.day-more');
      if (!row.dataset.aligned) {
        showSelected(row);
        row.dataset.aligned = '1';
      }
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
    var count = document.getElementById('search-count') || document.querySelector('.count');
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
        var nextSum = doc.querySelector('.search-sum');
        var sumBtn = document.querySelector('.search-sum');
        if (nextSum && sumBtn) {
          sumBtn.innerHTML = nextSum.innerHTML;
          sumBtn.setAttribute('aria-label', nextSum.getAttribute('aria-label') || '');
        }
        var nextLabel = doc.querySelector('.cpill');
        var pillBtn = document.querySelector('.cpill');
        if (nextLabel && pillBtn) {
          pillBtn.innerHTML = nextLabel.innerHTML;
          pillBtn.setAttribute('aria-label', nextLabel.getAttribute('aria-label') || '');
        }
        var nextHead = doc.getElementById('search-count');
        var head = document.getElementById('search-count');
        if (nextHead && head) head.textContent = nextHead.textContent;
        document.title = doc.title;
        history.pushState({}, '', url);
        syncMore(live);
        bindCardHover(live);
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
    if (node.closest('.search-sum') || node.closest('.cpill')) { event.preventDefault(); openSheet(); return; }
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
      var step = row ? pillStep(row) : 0;
      if (!row || !step) return;
      var count = visiblePills(row);
      var next = Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + step * count);
      row.scrollTo({ left: next, behavior: reduce ? 'auto' : 'smooth' });
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
  window.addEventListener('resize', function () {
    placeForm();
    document.querySelectorAll('.day-row').forEach(function (row) { delete row.dataset.aligned; });
    syncMore();
  });
  syncMore();

  var mapDataEl = document.getElementById('search-map-data');
  var mapWrap = document.getElementById('search-map-wrap');
  var live = document.querySelector('[data-live]');
  var btnList = document.getElementById('search-view-list');
  var btnMap = document.getElementById('search-view-map');
  var wideQuery = window.matchMedia('(min-width: 1024px)');
  var mapInst = null;
  var markersBySlug = {};
  var pinRows = [];
  var activeSlug = '';
  var mobileView = 'list';
  function isWide() { return wideQuery.matches; }
  function loadLeaflet(done) {
    if (window.L) { done(); return; }
    var s = document.createElement('script');
    s.src = '/vendor/leaflet/leaflet.js';
    s.onload = done;
    document.head.appendChild(s);
  }
  function mapPinIcon(label, on) {
    var cls = 'srch-map-pin' + (on ? ' is-on' : '');
    if (label) {
      return window.L.divIcon({
        className: cls,
        html: '<span class="srch-map-pin-price">' + label + '</span>',
        iconAnchor: [0, 16],
        popupAnchor: [0, -18],
      });
    }
    return window.L.divIcon({
      className: cls,
      html: '<span class="srch-map-pin-dot" aria-hidden="true"></span>',
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -34],
    });
  }
  function setPinHighlight(slug) {
    activeSlug = slug || '';
    if (live) {
      [].forEach.call(live.querySelectorAll('.ex[data-slug]'), function (card) {
        card.classList.toggle('is-pin-on', card.getAttribute('data-slug') === activeSlug);
      });
    }
    Object.keys(markersBySlug).forEach(function (key) {
      var row = markersBySlug[key];
      var label = row.pin.priceLabel || '';
      row.marker.setIcon(mapPinIcon(label, key === activeSlug));
    });
  }
  function bindCardHover(scope) {
    if (!scope || !isWide()) return;
    [].forEach.call(scope.querySelectorAll('.ex[data-slug]'), function (card) {
      if (card.dataset.pinBound) return;
      card.dataset.pinBound = '1';
      card.addEventListener('mouseenter', function () { setPinHighlight(card.getAttribute('data-slug')); });
      card.addEventListener('mouseleave', function () { setPinHighlight(''); });
    });
  }
  function ensureMap() {
    if (!mapDataEl) return;
    loadLeaflet(function () {
      var pins = JSON.parse(mapDataEl.textContent || '[]');
      var el = document.getElementById('search-map');
      if (!el || !pins.length) return;
      if (!mapInst) {
        mapInst = window.L.map(el, { scrollWheelZoom: true });
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(mapInst);
        var bounds = [];
        markersBySlug = {};
        pinRows = pins;
        pins.forEach(function (p) {
          var label = p.priceLabel || '';
          var m = window.L.marker([p.lat, p.lng], {
            icon: mapPinIcon(label, false),
            alt: p.name,
            title: p.name,
          }).addTo(mapInst);
          var link = document.createElement('a');
          link.href = p.href;
          link.innerHTML = '<b></b><br><span></span>';
          link.querySelector('b').textContent = p.name;
          link.querySelector('span').textContent = p.area;
          m.bindPopup(link);
          if (p.slug) {
            markersBySlug[p.slug] = { marker: m, pin: p };
            m.on('mouseover', function () { if (isWide()) setPinHighlight(p.slug); });
            m.on('mouseout', function () { if (isWide()) setPinHighlight(''); });
          }
          bounds.push([p.lat, p.lng]);
        });
        if (bounds.length === 1) mapInst.setView(bounds[0], 12);
        else if (bounds.length) mapInst.fitBounds(bounds, { padding: [28, 28] });
      }
      bindCardHover(live);
      if (mapInst) mapInst.invalidateSize();
    });
  }
  function setSearchView(mode) {
    if (!mapWrap || !live) return;
    if (isWide()) {
      mapWrap.hidden = false;
      live.hidden = false;
      if (btnList) { btnList.classList.toggle('is-on', true); btnList.setAttribute('aria-pressed', 'true'); }
      if (btnMap) { btnMap.classList.toggle('is-on', false); btnMap.setAttribute('aria-pressed', 'false'); }
      ensureMap();
      return;
    }
    mobileView = mode;
    var mapOn = mode === 'map';
    mapWrap.hidden = !mapOn;
    live.hidden = mapOn;
    if (btnList) { btnList.classList.toggle('is-on', !mapOn); btnList.setAttribute('aria-pressed', mapOn ? 'false' : 'true'); }
    if (btnMap) { btnMap.classList.toggle('is-on', mapOn); btnMap.setAttribute('aria-pressed', mapOn ? 'true' : 'false'); }
    if (!mapOn) return;
    ensureMap();
  }
  function layoutSearchMap() {
    if (!mapWrap || !live) return;
    if (isWide()) setSearchView('list');
    else setSearchView(mobileView);
  }
  if (mapDataEl && btnMap && btnList) {
    btnList.addEventListener('click', function () { setSearchView('list'); });
    btnMap.addEventListener('click', function () { setSearchView('map'); });
    layoutSearchMap();
    if (typeof wideQuery.addEventListener === 'function') wideQuery.addEventListener('change', layoutSearchMap);
    else wideQuery.addListener(layoutSearchMap);
  }
  bindCardHover(live);
})();
