/*
 * RichUp Recorder — записувач гри richup.io (крок 1 проєкту "Monopoly-Strategy").
 *
 * Що робить:
 *  - перехоплює WebSocket (вхідні/вихідні повідомлення), fetch і XHR;
 *  - знімає стан фреймворку сторінки (Vue/Pinia/Vuex або React), видимі кнопки й текст;
 *  - перевіряє, чи дозволяє сайт підвантажувати скрипти з CDN (для майбутнього помічника);
 *  - зберігає все у JSON-файл, який потрібно надіслати Claude.
 *
 * Нічого не натискає й не змінює в грі. Токени/паролі в повідомленнях маскуються.
 * Запуск: як bookmarklet (Chrome Android/ПК) або вставка в консоль.
 */
(function () {
  'use strict';
  if (window.__RUREC) { try { window.__RUREC.ui.show(); } catch (e) {} return; }

  var VERSION = '0.1.0';
  var MAX_MSGS = 60000;
  var MAX_SNAPS = 120;
  var SNAP_EVERY_MS = 30000;
  var CDN_PING = 'https://cdn.jsdelivr.net/gh/kolia228211-creator/monopoly-strategy@main/tools/ping.js';

  var R = window.__RUREC = {
    version: VERSION,
    startedAt: new Date().toISOString(),
    t0: Date.now(),
    page: { url: location.href.replace(/[?#].*$/, ''), ua: navigator.userAgent, lang: navigator.language,
            screen: [screen.width, screen.height, window.devicePixelRatio] },
    sockets: [], msgs: [], http: [], snaps: [], notes: [], errors: [], cspViolations: [], probes: {},
    dropped: 0
  };

  function now() { return Date.now() - R.t0; }
  function err(where, e) { try { R.errors.push({ t: now(), where: where, msg: String(e && e.message || e) }); } catch (x) {} }

  // ---------- кодування / маскування ----------
  var SECRET_KEY = /(token|auth\w*|session\w*|password|passwd|secret|jwt|cookie|credential)/i;
  function redactStr(s) {
    if (typeof s !== 'string') return s;
    return s
      .replace(/("(?:[a-z_]*?)(?:token|auth\w*|session\w*|password|secret|jwt|cookie)(?:[a-z_]*?)"\s*:\s*)"[^"]{4,}"/gi, '$1"<redacted>"')
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/g, '$1<redacted>')
      .replace(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}/g, '<jwt-redacted>');
  }
  function redactUrl(u) {
    return String(u).replace(/([?&](?:token|auth|sid|session|key|access_token)[^=&]*=)[^&#]+/gi, '$1<r>');
  }
  function b64(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function enc(d, rec) {
    try {
      if (typeof d === 'string') { rec.s = redactStr(d); return rec; }
      if (d instanceof ArrayBuffer) { rec.b64 = b64(new Uint8Array(d)); return rec; }
      if (ArrayBuffer.isView(d)) { rec.b64 = b64(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)); return rec; }
      if (typeof Blob !== 'undefined' && d instanceof Blob) {
        rec.blobSize = d.size;
        d.arrayBuffer().then(function (ab) { rec.b64 = b64(new Uint8Array(ab)); }).catch(function (e) { err('blob', e); });
        return rec;
      }
      rec.other = String(d);
    } catch (e) { err('enc', e); }
    return rec;
  }
  function push(rec) {
    if (R.msgs.length < MAX_MSGS) R.msgs.push(rec); else R.dropped++;
    scheduleUi();
  }

  // ---------- WebSocket ----------
  function attach(ws, how) {
    try {
      if (!ws || ws.__ruId) return ws && ws.__ruId - 1;
      var id = R.sockets.length;
      ws.__ruId = id + 1;
      R.sockets.push({ id: id, how: how, url: redactUrl(ws.url), protocol: ws.protocol, binaryType: ws.binaryType,
                       readyState: ws.readyState, at: now() });
      ws.addEventListener('message', function (e) { push(enc(e.data, { t: now(), k: id, d: 'in' })); });
      ws.addEventListener('open', function () { push({ t: now(), k: id, d: 'open' }); });
      ws.addEventListener('close', function (e) { push({ t: now(), k: id, d: 'close', code: e.code, reason: e.reason }); });
      return id;
    } catch (e) { err('attach', e); }
  }
  try {
    var WSP = WebSocket.prototype, origSend = WSP.send;
    WSP.send = function (data) {
      try { var id = attach(this, 'send-hook'); push(enc(data, { t: now(), k: id, d: 'out' })); } catch (e) { err('send', e); }
      return origSend.apply(this, arguments);
    };
    var OrigWS = window.WebSocket;
    var HookWS = function (url, protocols) {
      var ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
      attach(ws, 'ctor');
      return ws;
    };
    HookWS.prototype = OrigWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { HookWS[k] = OrigWS[k]; });
    window.WebSocket = HookWS;
  } catch (e) { err('ws-hook', e); }

  // ---------- fetch / XHR ----------
  function interestingBody(ct, len) { return /json|text|msgpack/i.test(ct || '') && (len || 0) < 3e6; }
  try {
    var origFetch = window.fetch;
    if (origFetch) window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var method = (init && init.method) || (input && input.method) || 'GET';
      var rec = { t: now(), via: 'fetch', method: method, url: redactUrl(url) };
      try { if (init && typeof init.body === 'string') rec.reqBody = redactStr(init.body).slice(0, 20000); } catch (e) {}
      R.http.push(rec); scheduleUi();
      var p = origFetch.apply(this, arguments);
      p.then(function (res) {
        rec.status = res.status;
        var ct = res.headers.get('content-type') || ''; rec.ct = ct;
        if (/\.(js|css|png|jpe?g|webp|svg|woff2?|mp3|ogg|wav)(\?|$)/i.test(url)) return;
        if (interestingBody(ct, +res.headers.get('content-length') || 0)) {
          res.clone().text().then(function (t) { rec.body = redactStr(t).slice(0, 3e6); }).catch(function () {});
        }
      }).catch(function (e) { rec.error = String(e); });
      return p;
    };
  } catch (e) { err('fetch-hook', e); }
  try {
    var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__ru = { t: now(), via: 'xhr', method: m, url: redactUrl(u) }; return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) {
      var rec = this.__ru;
      if (rec) {
        try { if (typeof body === 'string') rec.reqBody = redactStr(body).slice(0, 20000); } catch (e) {}
        R.http.push(rec); scheduleUi();
        this.addEventListener('loadend', function () {
          try {
            rec.status = this.status; rec.ct = this.getResponseHeader('content-type') || '';
            if ((this.responseType === '' || this.responseType === 'text') && interestingBody(rec.ct, (this.responseText || '').length))
              rec.body = redactStr(this.responseText).slice(0, 3e6);
          } catch (e) {}
        });
      }
      return XS.apply(this, arguments);
    };
  } catch (e) { err('xhr-hook', e); }

  // ---------- безпечне клонування стану ----------
  function safeClone(root, maxDepth, budget) {
    var seen = new WeakMap(), count = { n: 0 };
    function c(v, d, path) {
      if (count.n++ > budget) return '[budget]';
      if (v === null || v === undefined) return v;
      var t = typeof v;
      if (t === 'string') return v.length > 3000 ? v.slice(0, 3000) + '…' : v;
      if (t === 'number' || t === 'boolean') return v;
      if (t === 'bigint') return String(v);
      if (t === 'function') return '[fn ' + (v.name || '') + ']';
      if (t === 'symbol') return '[symbol]';
      if (typeof Node !== 'undefined' && v instanceof Node) return '[node ' + v.nodeName + ']';
      if (v === window) return '[window]';
      if (seen.has(v)) return '[ref ' + seen.get(v) + ']';
      seen.set(v, path);
      if (d >= maxDepth) return Array.isArray(v) ? '[array ' + v.length + ']' : '[obj ' + Object.keys(v).slice(0, 12).join(',') + ']';
      if (v instanceof Map) { var mo = { __map: [] }; var i = 0; v.forEach(function (val, key) { if (i++ < 300) mo.__map.push([c(key, d + 1, path + '.k'), c(val, d + 1, path + '.' + String(key))]); }); return mo; }
      if (v instanceof Set) { var so = { __set: [] }; var j = 0; v.forEach(function (val) { if (j++ < 300) so.__set.push(c(val, d + 1, path + '[]')); }); return so; }
      if (Array.isArray(v)) { var a = []; for (var k = 0; k < Math.min(v.length, 300); k++) a.push(c(v[k], d + 1, path + '[' + k + ']')); if (v.length > 300) a.push('[+' + (v.length - 300) + ']'); return a; }
      if (ArrayBuffer.isView(v)) return '[typed ' + v.length + ']';
      var o = {};
      var keys; try { keys = Object.keys(v); } catch (e) { return '[unreadable]'; }
      for (var q = 0; q < keys.length && q < 400; q++) {
        var key = keys[q];
        if (/^(_|\$)(vnode|parent|root|el|subTree|ctx|appContext|owner|container)/.test(key)) { o[key] = '[skip]'; continue; }
        if (SECRET_KEY.test(key) && typeof v[key] === 'string') { o[key] = '<redacted>'; continue; }
        try { o[key] = c(v[key], d + 1, path + '.' + key); } catch (e) { o[key] = '[err]'; }
      }
      return o;
    }
    return c(root, 0, '$');
  }

  // ---------- пошук стану фреймворку ----------
  var GAME_KEY = /player|board|tile|block|propert|money|balance|cash|auction|trade|turn|dice|room|game|participant|owner/i;
  function vueState() {
    var out = [], apps = [];
    var els = [document.getElementById('app'), document.getElementById('__nuxt'), document.querySelector('[data-v-app]')]
      .concat(Array.prototype.slice.call(document.body ? document.body.children : []));
    els.forEach(function (el) { if (el && el.__vue_app__ && apps.indexOf(el.__vue_app__) < 0) apps.push(el.__vue_app__); });
    apps.forEach(function (app, idx) {
      var gp = app.config && app.config.globalProperties || {};
      var info = { app: idx, version: app.version, globals: Object.keys(gp) };
      try { if (gp.$pinia) info.pinia = safeClone(gp.$pinia.state.value, 9, 60000); } catch (e) { err('pinia', e); }
      try { if (gp.$store && gp.$store.state) info.vuex = safeClone(gp.$store.state, 9, 60000); } catch (e) { err('vuex', e); }
      try {
        var prov = app._context && app._context.provides;
        if (prov) {
          info.provides = {};
          Reflect.ownKeys(prov).forEach(function (k) {
            var name = typeof k === 'symbol' ? k.toString() : k;
            var val = prov[k];
            if (val && typeof val === 'object' && val._s && val.state) { info.pinia = info.pinia || safeClone(val.state.value, 9, 60000); info.provides[name] = '[pinia]'; }
            else info.provides[name] = safeClone(val, 3, 3000);
          });
        }
      } catch (e) { err('provides', e); }
      out.push(info);
    });
    return out.length ? out : null;
  }
  function reactState() {
    var roots = [];
    var cands = [document.getElementById('root'), document.getElementById('app'), document.getElementById('__next'), document.body]
      .concat(Array.prototype.slice.call(document.body ? document.body.children : []));
    cands.forEach(function (el) {
      if (!el) return;
      Object.keys(el).forEach(function (k) {
        if (k.indexOf('__reactContainer$') === 0 || k === '_reactRootContainer') {
          var r = el[k]; var fiber = r && (r._internalRoot ? r._internalRoot.current : (r.stateNode ? r : r.current || r));
          if (fiber && roots.indexOf(fiber) < 0) roots.push(fiber);
        }
      });
    });
    if (!roots.length) return null;
    var found = [], seenObjs = new WeakSet(), n = 0, t0 = performance.now();
    function consider(obj, where, name) {
      if (!obj || typeof obj !== 'object' || seenObjs.has(obj)) return;
      seenObjs.add(obj);
      var keys; try { keys = Object.keys(obj); } catch (e) { return; }
      var hits = keys.filter(function (k) { return GAME_KEY.test(k); });
      if (hits.length >= 2 && found.length < 40) found.push({ where: where, comp: name, keys: keys.slice(0, 60), value: safeClone(obj, 7, 25000) });
    }
    var stack = roots.slice();
    while (stack.length && n < 60000 && performance.now() - t0 < 2500) {
      var f = stack.pop(); n++;
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
      var name = f.type && (f.type.displayName || f.type.name) || (typeof f.type === 'string' ? f.type : '');
      try {
        consider(f.memoizedProps, 'props', name);
        var h = f.memoizedState, g = 0;
        while (h && typeof h === 'object' && g++ < 40) {
          if ('memoizedState' in h && 'next' in h) { consider(h.memoizedState, 'hook', name); if (h.queue && h.memoizedState && typeof h.memoizedState === 'object' && h.memoizedState.current) consider(h.memoizedState.current, 'ref', name); h = h.next; }
          else { consider(h, 'state', name); break; }
        }
        if (f.stateNode && f.stateNode.state) consider(f.stateNode.state, 'class', name);
      } catch (e) {}
    }
    return { fibers: n, candidates: found };
  }
  var baseGlobals = null;
  function windowGlobals() {
    try {
      if (!baseGlobals) {
        var ifr = document.createElement('iframe'); ifr.style.display = 'none'; document.documentElement.appendChild(ifr);
        baseGlobals = Object.getOwnPropertyNames(ifr.contentWindow); ifr.remove();
      }
      return Object.getOwnPropertyNames(window).filter(function (k) { return baseGlobals.indexOf(k) < 0 && k.indexOf('__RU') !== 0; })
        .slice(0, 300).map(function (k) { var v; try { v = window[k]; } catch (e) {} return k + ':' + (v === null ? 'null' : typeof v); });
    } catch (e) { err('globals', e); return []; }
  }
  function buttons() {
    var out = [];
    try {
      document.querySelectorAll('button,[role=button],a.button,.button,.btn').forEach(function (b) {
        if (ui.host && ui.host.contains(b)) return;
        var r = b.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        var t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        out.push({ t: t, dis: !!b.disabled, cls: String(b.className || '').slice(0, 80), aria: b.getAttribute('aria-label') || undefined });
      });
    } catch (e) { err('buttons', e); }
    return out.slice(0, 200);
  }

  var lastSnapSig = '';
  function snapshot(reason) {
    try {
      var s = { t: now(), reason: reason, vue: vueState(), react: null, buttons: buttons(),
                text: (document.body && document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 15000) };
      if (!s.vue) s.react = reactState();
      var sig = JSON.stringify(s.vue || s.react || '').length + ':' + s.text.length + ':' + s.buttons.length;
      if (reason === 'auto' && sig === lastSnapSig) return;
      lastSnapSig = sig;
      if (R.snaps.length >= MAX_SNAPS) R.snaps.splice(1, 1); // перший знімок лишаємо завжди
      R.snaps.push(s);
      scheduleUi();
    } catch (e) { err('snapshot', e); }
  }

  // ---------- проби середовища (для майбутнього помічника) ----------
  function probes() {
    document.addEventListener('securitypolicyviolation', function (e) {
      R.cspViolations.push({ t: now(), dir: e.violatedDirective, blocked: String(e.blockedURI).slice(0, 200) });
    });
    try { R.probes.evalAllowed = (new Function('return 2+2'))() === 4; } catch (e) { R.probes.evalAllowed = false; }
    try {
      var csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      R.probes.metaCsp = csp ? csp.getAttribute('content') : null;
    } catch (e) {}
    try {
      R.probes.scripts = Array.prototype.slice.call(document.scripts).map(function (s) { return s.src ? redactUrl(s.src) : '[inline ' + s.textContent.length + ']'; }).slice(0, 60);
      R.probes.resources = performance.getEntriesByType('resource').map(function (e) { return e.initiatorType + ' ' + redactUrl(e.name.split('?')[0]); }).slice(0, 300);
      R.probes.localStorageKeys = Object.keys(localStorage).slice(0, 100);
      R.probes.frameworkMarkers = { vue: !!document.querySelector('[data-v-app]'), nuxt: !!window.__NUXT__, next: !!window.__NEXT_DATA__, io: typeof window.io, svelte: !!document.querySelector('[class*="svelte-"]') };
    } catch (e) { err('probes', e); }
    R.probes.cdnScript = 'pending';
    try {
      var sc = document.createElement('script');
      sc.src = CDN_PING + '?t=' + Date.now();
      sc.onload = function () { R.probes.cdnScript = window.__RUPING ? 'ok' : 'loaded-no-run'; scheduleUi(); };
      sc.onerror = function () { R.probes.cdnScript = 'blocked-or-failed'; scheduleUi(); };
      (document.head || document.documentElement).appendChild(sc);
    } catch (e) { R.probes.cdnScript = 'error ' + e.message; }
    try {
      origFetchProbe(CDN_PING).then(function (r) { R.probes.cdnFetch = r.status; }).catch(function (e) { R.probes.cdnFetch = 'blocked ' + e; });
    } catch (e) {}
  }
  function origFetchProbe(u) { return (window.__RUREC_origFetch || window.fetch)(u, { cache: 'no-store' }); }

  // ---------- експорт ----------
  function exportJson() {
    R.exportedAt = new Date().toISOString();
    R.durationSec = Math.round(now() / 1000);
    R.globals = windowGlobals();
    snapshot('export');
    return JSON.stringify(R, function (k, v) { return k === 'ui' ? undefined : v; });
  }
  function fileName() { return 'richup-record-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json'; }
  function download() {
    try {
      var blob = new Blob([exportJson()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fileName();
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      toast('Файл збережено в «Завантаження»');
    } catch (e) { err('download', e); toast('Помилка збереження: ' + e.message); }
  }
  function share() {
    try {
      var file = new File([exportJson()], fileName(), { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'RichUp record' }).catch(function (e) { if (e.name !== 'AbortError') download(); });
      } else download();
    } catch (e) { err('share', e); download(); }
  }

  // ---------- UI (Shadow DOM, не заважає грі) ----------
  var ui = R.ui = { host: null, root: null, timer: null };
  function buildUi() {
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML =
      '<style>' +
      '.p{font:13px/1.3 system-ui,sans-serif;background:#1b1530ee;color:#eee;border:1px solid #6b5bd6;border-radius:10px;padding:6px 8px;display:flex;gap:6px;align-items:center;box-shadow:0 4px 16px #0008}' +
      '.dot{width:9px;height:9px;border-radius:50%;background:#e33;animation:b 1.2s infinite}@keyframes b{50%{opacity:.25}}' +
      'button{font:inherit;background:#3a2f7a;color:#fff;border:0;border-radius:7px;padding:6px 9px;min-width:34px}' +
      'button:active{background:#5a4bc0}.s{white-space:nowrap}.m{font-size:11px;opacity:.75}' +
      '.toast{position:absolute;bottom:46px;left:0;background:#000c;color:#fff;padding:6px 9px;border-radius:7px;font:12px system-ui;white-space:nowrap;display:none}' +
      '.min .hide{display:none}' +
      '</style>' +
      '<div class="toast" id="toast"></div>' +
      '<div class="p" id="p"><span class="dot"></span><span class="s"><b>REC</b> <span id="c">0</span><span class="m hide" id="m"></span></span>' +
      '<button class="hide" id="snap" title="Знімок стану">📸</button>' +
      '<button class="hide" id="save" title="Зберегти файл">💾</button>' +
      '<button class="hide" id="share" title="Поділитися файлом">📤</button>' +
      '<button id="min" title="Згорнути">–</button></div>';
    (document.body || document.documentElement).appendChild(host);
    ui.host = host; ui.root = root;
    root.getElementById('snap').onclick = function () { snapshot('manual'); toast('Знімок №' + R.snaps.length); };
    root.getElementById('save').onclick = download;
    root.getElementById('share').onclick = share;
    root.getElementById('min').onclick = function () { var p = root.getElementById('p'); p.classList.toggle('min'); this.textContent = p.classList.contains('min') ? '+' : '–'; };
    ui.show = function () { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); toast('Записувач уже працює'); };
  }
  function toast(t) {
    if (!ui.root) return;
    var el = ui.root.getElementById('toast'); el.textContent = t; el.style.display = 'block';
    clearTimeout(el._h); el._h = setTimeout(function () { el.style.display = 'none'; }, 2600);
  }
  var uiPending = false;
  function scheduleUi() {
    if (uiPending || !ui.root) return; uiPending = true;
    setTimeout(function () {
      uiPending = false;
      try {
        var ins = 0; for (var i = 0; i < R.msgs.length; i++) if (R.msgs[i].d === 'in') ins++;
        ui.root.getElementById('c').textContent = R.msgs.length;
        ui.root.getElementById('m').textContent = ' · ws:' + R.sockets.length + ' in:' + ins + ' http:' + R.http.length + ' 📸' + R.snaps.length + ' cdn:' + R.probes.cdnScript;
      } catch (e) {}
    }, 400);
  }

  // ---------- старт ----------
  window.__RUREC_origFetch = origFetch;
  buildUi();
  probes();
  snapshot('start');
  ui.timer = setInterval(function () { snapshot('auto'); }, SNAP_EVERY_MS);
  // Автоматичні знімки після помітних змін на сторінці (не частіше ніж раз на 8 с)
  try {
    var lastMut = 0;
    new MutationObserver(function () {
      var t = Date.now(); if (t - lastMut < 8000) return; lastMut = t;
      setTimeout(function () { snapshot('auto'); }, 600);
    }).observe(document.body, { childList: true, subtree: true });
  } catch (e) { err('mo', e); }
  window.addEventListener('beforeunload', function (e) { if (R.msgs.length > 50) { e.preventDefault(); e.returnValue = ''; } });
  toast('Запис почався. Грай як завжди, у кінці натисни 💾');
  scheduleUi();
})();
