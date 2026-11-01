// Точка входу помічника: знаходить живий стан гри richup.io (Zustand-сховище у React),
// підписується на зміни й показує поради. Нічого не надсилає на сервер і нічого не натискає.
import { analyze } from './advisor.js';
import { winProbsAsync } from './sim.js';
import { createUI } from './ui.js';

const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';

(function () {
  if (window.__RUHELP) { window.__RUHELP.ui.show(); return; }
  const H = window.__RUHELP = { version: VERSION, store: null, unsub: null, model: null, sim: null };
  const ui = H.ui = createUI(VERSION);

  function findStore() {
    const el = document.getElementById('app'); if (!el) return null;
    const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'));
    if (!fk) return null;
    let root = el[fk]; if (root && root.current) root = root.current;
    while (root && root.return) root = root.return;
    const stack = [root]; let n = 0;
    while (stack.length && n++ < 60000) {
      const f = stack.pop(); if (!f) continue;
      if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child);
      let h = f.memoizedState, g = 0;
      while (h && typeof h === 'object' && g++ < 40 && 'memoizedState' in h) {
        const v = h.memoizedState;
        if (v && typeof v.getState === 'function' && typeof v.subscribe === 'function') {
          try { const s = v.getState(); if (s && s.state && Array.isArray(s.state.participants) && Array.isArray(s.state.blocks)) return v; } catch (e) { /* далі */ }
        }
        h = h.next;
      }
    }
    return null;
  }

  // ---- перерахунок шансів (у фоні, порціями) ----
  let simToken = 0, simTimer = null, lastSig = '';
  function signature(s) {
    return [s.phase, s.blocks.map((b) => (b.ownerId || '') + (b.level || 0) + (b.isMortgaged ? 'm' : '')).join(','),
      s.participants.map((p) => Math.round(p.money / 25) + (p.bankruptedAt ? 'x' : '')).join(','),
      (s.trades || []).filter((t) => !t.status || t.status === 'pending').map((t) => t.id).join(','),
      s.auction && s.auction.state !== 'ended' ? 'a' + s.auction.blockIndex : '', s.cubesRolledInTurn ? 'r' : ''].join('|');
  }
  function variantsFor(s, m) {
    const v = {}, me = m.meId; if (!me) return v;
    const ix = (X, id) => X.ids.indexOf(id);
    if (m.buy) {
      const i = m.buy.idx, price = m.buy.price;
      v.buy = (X) => { const p = ix(X, me); X.owner[i] = p; X.money[p] -= price; };
      v.auction = (X) => { // віддаємо найбагатшому супернику за ціною
        let best = -1; X.ids.forEach((id, q) => { if (id !== me && X.alive[q] && (best < 0 || X.money[q] > X.money[best])) best = q; });
        if (best >= 0 && X.money[best] > price) { X.owner[i] = best; X.money[best] -= price; }
      };
    }
    (m.trades || []).filter((t) => t.role !== 'others').forEach((t) => {
      const raw = (s.trades || []).find((x) => x.id === t.id); if (!raw) return;
      v['trade:' + t.id] = (X) => {
        const a = ix(X, raw.initiatorId), b = ix(X, raw.recipientId); if (a < 0 || b < 0) return;
        const io = raw.initiatorOffer || {}, ro = raw.recipientOffer || {};
        X.money[a] += (ro.money || 0) - (io.money || 0); X.money[b] += (io.money || 0) - (ro.money || 0);
        (io.propertyIndices || []).forEach((i) => { X.owner[i] = b; }); (ro.propertyIndices || []).forEach((i) => { X.owner[i] = a; });
      };
    });
    return v;
  }
  function scheduleSim(s, m) {
    if (s.phase === 'lobby' || s.winnerId) return;
    const sig = signature(s) + '|b' + (m.buy ? m.buy.idx : '') + '|p' + s.participants.map((p) => p.position).join(',');
    if (sig === lastSig) return; lastSig = sig;
    clearTimeout(simTimer);
    const my = ++simToken;
    H.sim = Object.assign({}, H.sim || {}, { busy: true });
    simTimer = setTimeout(() => {
      const snap = JSON.parse(JSON.stringify({ ...s, stats: undefined, turnClock: undefined }));
      const variants = variantsFor(snap, m);
      const n = Object.keys(variants).length ? 200 : 260;
      winProbsAsync(snap, { n, variants }, () => my !== simToken).then((res) => {
        if (!res || my !== simToken) return;
        H.sim = { ...res, busy: false }; draw();
      });
      draw();
    }, 700);
  }

  // ---- оновлення панелі ----
  let drawPending = false;
  function draw() { if (H.model) ui.render(H.model, H.sim); }
  function update() {
    drawPending = false;
    try {
      const g = H.store.getState(), s = g.state;
      if (!s || !s.blocks || !s.blocks.length) { ui.status('Чекаю завантаження гри…'); return; }
      H.model = analyze(s, g.selfParticipantId);
      scheduleSim(s, H.model);
      draw();
    } catch (e) {
      console.warn('[RU помічник]', e); ui.status('Помилка аналізу: ' + e.message);
    }
  }
  function onChange() { if (!drawPending) { drawPending = true; setTimeout(update, 250); } }

  function attach() {
    const st = findStore();
    if (st && st !== H.store) {
      if (H.unsub) try { H.unsub(); } catch (e) { /* ignore */ }
      H.store = st; H.unsub = st.subscribe(onChange); lastSig = ''; H.sim = null; update();
    } else if (!st && !H.store) {
      ui.status(/\/room\//.test(location.pathname) ? 'Заходжу в гру…' : 'Відкрий кімнату гри на richup.io');
    }
  }
  attach();
  H.timer = setInterval(() => {
    // сховище може змінитися при переході в іншу кімнату — тоді шукаємо заново
    const room = (location.pathname.match(/\/room\/([^/?#]+)/) || [])[1];
    let ok = false;
    try { const s = H.store && H.store.getState().state; ok = !!(s && s.blocks && (!room || s.id === room)); } catch (e) { ok = false; }
    if (!ok) { H.store = null; attach(); }
  }, 2000);
  H.stop = () => { clearInterval(H.timer); if (H.unsub) H.unsub(); ui.host.remove(); delete window.__RUHELP; };
  console.log('[RU помічник] v' + VERSION + ' запущено');
})();
