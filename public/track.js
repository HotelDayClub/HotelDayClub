(function (root) {
  'use strict';

  var EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
  var BOOKING_RE = /\bHDC-[A-Z0-9\-]+\b/i;
  var PHONE_RE = /(?:\+?61|0)\d{8,10}/;
  var BLOCKED_KEYS = /^(e-?mail|name|full_?name|first_?name|last_?name|phone|mobile|tel|booking|booking_?(code|ref|id)|guest|code)$/i;

  function reducedTracking() {
    try {
      var nav = root.navigator || {};
      if (nav.globalPrivacyControl === true) return true;
      var dnt = nav.doNotTrack || root.doNotTrack || nav.msDoNotTrack;
      if (dnt === '1' || dnt === 'yes') return true;
    } catch (err) {}
    return false;
  }

  function isSensitiveValue(value) {
    if (value == null) return false;
    var text = String(value);
    return EMAIL_RE.test(text) || BOOKING_RE.test(text) || PHONE_RE.test(text);
  }

  function sanitizeParams(params) {
    var out = {};
    if (!params || typeof params !== 'object') return out;
    Object.keys(params).forEach(function (key) {
      if (BLOCKED_KEYS.test(key)) return;
      var val = params[key];
      if (val == null || val === '') return;
      if (typeof val === 'number') {
        if (!isFinite(val)) return;
        out[key] = val;
        return;
      }
      if (typeof val === 'boolean') {
        out[key] = val;
        return;
      }
      if (typeof val !== 'string') return;
      var text = val.length > 120 ? val.slice(0, 120) : val;
      if (isSensitiveValue(text)) return;
      out[key] = text;
    });
    return out;
  }

  function pagePath() {
    try {
      var path = (root.location && root.location.pathname) || '';
      if (/^\/booking(\/|$)/.test(path)) return '/booking';
      if (/^\/checkout(\/|$)/.test(path)) return '/checkout';
      return path;
    } catch (err) {
      return '';
    }
  }

  function track(name, params) {
    try {
      if (typeof root.gtag !== 'function') return false;
      if (reducedTracking()) return false;
      var eventName = String(name || '').trim();
      if (!/^[a-z][a-z0-9_]{1,39}$/i.test(eventName)) return false;
      var safe = sanitizeParams(params);
      if (!safe.page) safe.page = pagePath();
      root.gtag('event', eventName, safe);
      return true;
    } catch (err) {
      return false;
    }
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : undefined;
  }

  function rootSlug(doc) {
    var el = doc && doc.getElementById && doc.getElementById('d2-root');
    return (el && el.getAttribute('data-hdc-item-id')) || '';
  }

  function fireSelect(el, doc) {
    if (!el || !el.getAttribute) return;
    var form = el.closest && el.closest('#d2-form');
    var slug = el.getAttribute('data-hdc-item-id') ||
      (form && form.getAttribute('data-slug')) ||
      rootSlug(doc) ||
      '';
    var kind = el.getAttribute('data-kind') || el.getAttribute('data-hdc-seat-type') || '';
    var price = num(el.getAttribute('data-price') || el.getAttribute('data-hdc-value'));
    var pass = el.getAttribute('data-pass') || el.value || '';
    var params = { item_id: slug, seat_type: kind, currency: 'AUD' };
    if (price != null) params.value = price;
    if (pass) params.item_variant = pass;
    var passName = el.getAttribute('data-name');
    if (passName) params.item_name = passName;
    track('select_seating', params);
  }

  function fireBook(form) {
    if (!form) return;
    var slug = form.getAttribute('data-slug') || '';
    var picked = form.querySelector && form.querySelector('input[name="pass"]:checked');
    var qtyEl = form.querySelector && form.querySelector('input[name="qty"]');
    var qty = num(qtyEl && qtyEl.value) || num(form.getAttribute('data-qty')) || 1;
    var price = picked ? num(picked.getAttribute('data-price')) : undefined;
    var kind = picked ? (picked.getAttribute('data-kind') || '') : '';
    var params = { item_id: slug, seat_type: kind, currency: 'AUD' };
    if (qty) params.quantity = qty;
    if (price != null) params.value = price * (qty || 1);
    if (picked && picked.value) params.item_variant = picked.value;
    if (picked) {
      var passName = picked.getAttribute('data-name');
      if (passName) params.item_name = passName;
    }
    track('book_click', params);
    track('begin_checkout', params);
  }

  function searchParamsFrom(source) {
    function get(key) {
      if (!source) return '';
      if (typeof source.get === 'function') return source.get(key) || '';
      var field = source.elements && source.elements[key];
      if (!field) return '';
      if (field.length && field[0] && field[0].type === 'radio') {
        for (var i = 0; i < field.length; i++) if (field[i].checked) return field[i].value || '';
        return '';
      }
      return field.value || '';
    }
    var destination = get('destination');
    var date = get('date');
    var guests = get('guests');
    var want = get('want');
    var sort = get('sort');
    var mood = get('mood');
    var price = get('price');
    var age = get('age');
    var term = [destination, want, mood].filter(Boolean).join(' ') || '(all)';
    var params = { search_term: term, page: '/search' };
    if (destination) params.destination = destination;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) params.date = date;
    if (guests && /^\d+$/.test(String(guests))) params.guests = Number(guests);
    if (want) params.want = want;
    if (sort) params.sort = sort;
    if (mood) params.mood = mood;
    if (price && /^\d+$/.test(String(price))) params.price_filter = Number(price);
    if (age) params.age = age;
    return params;
  }

  function fireSearchFromUrl(href) {
    try {
      var base = (root.location && root.location.href) || 'https://www.hoteldayclub.com.au/';
      var url = new URL(href, base);
      if (url.pathname !== '/search') return false;
      return track('search', searchParamsFrom(url.searchParams));
    } catch (err) {
      return false;
    }
  }

  function fireLoadEvents(doc) {
    var nodes = doc.querySelectorAll('[data-hdc-event-load]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var name = el.getAttribute('data-hdc-event-load');
      if (name === 'view_item') {
        var params = { item_id: el.getAttribute('data-hdc-item-id') || '', currency: 'AUD' };
        var value = num(el.getAttribute('data-hdc-value'));
        if (value != null) params.value = value;
        track('view_item', params);
      } else if (name === 'search') {
        if (root.location) fireSearchFromUrl(root.location.href);
      } else if (name === 'generate_lead') {
        track('generate_lead', { lead_type: el.getAttribute('data-hdc-lead-type') || 'hotel_enquiry' });
      }
    }
  }

  function bind(doc) {
    if (!doc || !doc.addEventListener || doc.documentElement && doc.documentElement.getAttribute('data-hdc-track-bound') === '1') return;
    if (doc.documentElement) doc.documentElement.setAttribute('data-hdc-track-bound', '1');

    doc.addEventListener('click', function (event) {
      var node = event.target;
      if (!node || !node.closest) return;
      var card = node.closest('a.d2-card[data-pass]');
      if (card) fireSelect(card, doc);
      var link = node.closest('a[href]');
      if (!link) return;
      var href = link.getAttribute('href') || '';
      if (/^mailto:/i.test(href)) {
        track('click', { link_type: 'email', link_url: 'mailto', outbound: true });
        return;
      }
      if (/^tel:/i.test(href)) {
        track('click', { link_type: 'phone', link_url: 'tel', outbound: true });
        return;
      }
      if (!/^https?:/i.test(href)) return;
      try {
        var url = new URL(href, (root.location && root.location.href) || href);
        var here = root.location && root.location.hostname;
        if (here && url.hostname && url.hostname !== here) {
          track('click', { link_type: 'outbound', link_url: url.origin + url.pathname, outbound: true });
        }
      } catch (err) {}
    });

    doc.addEventListener('change', function (event) {
      var el = event.target;
      if (!el || el.name !== 'pass') return;
      if (!el.closest || !el.closest('#d2-form')) return;
      fireSelect(el, doc);
    });

    doc.addEventListener('submit', function (event) {
      if (event.defaultPrevented) return;
      var form = event.target;
      if (!form || !form.getAttribute) return;
      if (form.id === 'd2-form' || form.getAttribute('data-hdc-event') === 'book_click') {
        fireBook(form);
      }
    });

    function onReady() { fireLoadEvents(doc); }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onReady);
    else onReady();

    try {
      var hist = root.history;
      if (hist && typeof hist.pushState === 'function' && !hist.pushState._hdcTrack) {
        var original = hist.pushState;
        hist.pushState = function () {
          var result = original.apply(this, arguments);
          if (arguments[2]) fireSearchFromUrl(arguments[2]);
          return result;
        };
        hist.pushState._hdcTrack = true;
      }
    } catch (err) {}
  }

  var api = {
    track: track,
    sanitizeParams: sanitizeParams,
    reducedTracking: reducedTracking,
    searchParamsFrom: searchParamsFrom,
    bind: bind,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.hdcTrack = track;
  root.hdcAnalytics = api;
  if (root.document) {
    try { bind(root.document); } catch (err) {}
  }
})(typeof window !== 'undefined' ? window : globalThis);
