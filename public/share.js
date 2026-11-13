(function () {
  var details = document.getElementById('share-box');
  if (!details) return;
  var status = document.getElementById('share-status');
  var input = details.querySelector('input');
  var summary = details.querySelector('summary');
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'share';
  btn.innerHTML = summary ? summary.innerHTML : 'Share';
  details.hidden = true;
  details.parentNode.insertBefore(btn, details);

  function cleanShareUrl(href) {
    var url;
    try { url = new URL(href); }
    catch (err) { return input ? input.value : ''; }
    var keep = new URLSearchParams();
    var keys = ['date', 'pass', 'guests', 'qty'];
    for (var i = 0; i < keys.length; i++) {
      var value = url.searchParams.get(keys[i]);
      if (value) keep.append(keys[i], value);
    }
    var q = keep.toString();
    return url.origin + url.pathname + (q ? '?' + q : '');
  }

  function setStatus(text) {
    if (!status) return;
    status.textContent = text || '';
    clearTimeout(setStatus.timer);
    if (text) setStatus.timer = setTimeout(function () { status.textContent = ''; }, 3000);
  }

  function showFallback(url) {
    details.hidden = false;
    details.open = true;
    if (!input) return;
    input.value = url;
    input.focus();
    input.select();
  }

  function copyOrFallback(url) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showFallback(url);
      return;
    }
    navigator.clipboard.writeText(url).then(function () {
      setStatus('Link copied');
    }, function () {
      showFallback(url);
    });
  }

  btn.addEventListener('click', function () {
    var url = cleanShareUrl(location.href);
    var coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    if (navigator.share && coarse) {
      navigator.share({ title: document.title, url: url }).then(function () {}, function (err) {
        if (err && err.name === 'AbortError') return;
        copyOrFallback(url);
      });
      return;
    }
    copyOrFallback(url);
  });
})();
