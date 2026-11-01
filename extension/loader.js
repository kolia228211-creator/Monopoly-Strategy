var __FALLBACK__ = chrome.runtime.getURL('helper.js');
// Завантажувач помічника: бере НАЙСВІЖІШИЙ коміт з GitHub і підключає dist/helper.js через jsDelivr.
// Використовується і в закладці (телефон/ПК), і в розширенні Chrome (з локальною копією як запасним варіантом).
(function (fallbackUrl) {
  if (window.__RUHELP) { window.__RUHELP.ui.show(); return; }
  var R = 'kolia228211-creator/Monopoly-Strategy';
  function add(src, onerror) {
    var s = document.createElement('script'); s.src = src; s.onerror = onerror;
    (document.head || document.documentElement).appendChild(s);
  }
  function cdn(ref) {
    add('https://cdn.jsdelivr.net/gh/' + R + '@' + ref + '/dist/helper.js', function () {
      if (ref !== 'main') cdn('main');
      else if (fallbackUrl) add(fallbackUrl);
      else alert('Помічник: не вдалося завантажити. Перевір інтернет.');
    });
  }
  fetch('https://api.github.com/repos/' + R + '/commits/main', { headers: { Accept: 'application/vnd.github.sha' } })
    .then(function (r) { return r.ok ? r.text() : ''; })
    .then(function (t) { t = (t || '').trim(); cdn(/^[0-9a-f]{40}$/.test(t) ? t : 'main'); }, function () { cdn('main'); });
})(typeof __FALLBACK__ !== 'undefined' ? __FALLBACK__ : null);
