var __FALLBACK__ = chrome.runtime.getURL('helper.js');
// Завантажувач помічника: бере НАЙСВІЖІШИЙ коміт з GitHub і підключає dist/helper.js.
// Джерела по черзі: jsDelivr@коміт → GitHub raw@коміт → jsDelivr@main → GitHub raw@main → вбудована копія (розширення).
// Код завантажується через fetch і вставляється в сторінку (richup.io не має CSP), тож кеш CDN не заважає.
(function (fallbackUrl) {
  if (window.__RUHELP) { window.__RUHELP.ui.show(); return; }
  var R = 'kolia228211-creator/Monopoly-Strategy', F = '/dist/helper.js';
  var log = function (m) { try { console.log('[RU завантажувач] ' + m); } catch (e) { /* */ } };
  function inject(code, src) {
    var s = document.createElement('script');
    s.textContent = code + '\n//# sourceURL=' + src;
    (document.head || document.documentElement).appendChild(s); s.remove();
  }
  function get(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      if (t.indexOf('RichUp') < 0) throw new Error('не той файл');
      return t;
    });
  }
  function tryList(list) {
    if (!list.length) {
      if (fallbackUrl) { log('мережа недоступна, вмикаю вбудовану копію'); var s = document.createElement('script'); s.src = fallbackUrl; (document.head || document.documentElement).appendChild(s); }
      else alert('Помічник: не вдалося завантажити. Перевір інтернет і спробуй ще раз.');
      return;
    }
    var u = list.shift();
    get(u).then(function (t) { inject(t, u); log('завантажено ' + u); },
      function (e) { log('не вдалося ' + u + ' (' + e.message + ')'); tryList(list); });
  }
  function sources(ref) {
    var l = [];
    if (ref) l.push('https://cdn.jsdelivr.net/gh/' + R + '@' + ref + F, 'https://raw.githubusercontent.com/' + R + '/' + ref + F);
    l.push('https://cdn.jsdelivr.net/gh/' + R + '@main' + F, 'https://raw.githubusercontent.com/' + R + '/main' + F);
    return l;
  }
  fetch('https://api.github.com/repos/' + R + '/commits/main', { headers: { Accept: 'application/vnd.github.sha' } })
    .then(function (r) { return r.ok ? r.text() : ''; })
    .then(function (t) { t = (t || '').trim(); tryList(sources(/^[0-9a-f]{40}$/.test(t) ? t : null)); },
      function () { tryList(sources(null)); });
})(typeof __FALLBACK__ !== 'undefined' ? __FALLBACK__ : null);
