// Панель помічника: Shadow DOM, не заважає грі. ПК: плаваюче вікно (можна тягати). Телефон: нижня шторка.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('uk-UA');
const pct = (v) => (v == null ? '…' : Math.round(v * 100) + '%');
const LS = 'ruhelp:ui';
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } };
const save = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* приватний режим */ } };

const CSS = `
:host { all: initial; }
.panel { --bg:#1b1730; --card:#252040; --line:#352e5c; --ink:#efecfa; --muted:#a79fc9; --accent:#8a78ff; --good:#46c98b; --bad:#ff6b6b; --warn:#ffc65c;
  position: fixed; z-index: 2147483646; font: 13px/1.4 Nunito, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 30px #0009; display: flex; flex-direction: column; overflow: hidden; }
.panel.desk { width: 330px; max-height: calc(100vh - 24px); }
.panel.mob { left: 0 !important; right: 0; bottom: 0; top: auto !important; width: auto; max-height: 46vh; border-radius: 14px 14px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
.hd { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #221d3d; cursor: grab; user-select: none; touch-action: none; }
.hd b { font-size: 13px; letter-spacing: .02em; }
.hd .now { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: 12px; }
.hd button { all: unset; cursor: pointer; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 7px; color: var(--muted); font-size: 15px; }
.hd button:hover { background: #ffffff14; color: var(--ink); }
.bd { overflow-y: auto; padding: 10px; display: grid; gap: 10px; }
.min .bd { display: none; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 11px; padding: 9px 10px; display: grid; gap: 6px; min-width: 0; }
.ttl { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); display: flex; justify-content: space-between; gap: 6px; }
.big { font-size: 16px; font-weight: 800; line-height: 1.25; }
.tone-good .big { color: var(--good); } .tone-bad .big { color: var(--bad); } .tone-neutral .big { color: var(--ink); }
ul { margin: 0; padding-left: 16px; display: grid; gap: 2px; } li { color: #d9d4ef; }
.row { display: grid; grid-template-columns: 10px 1fr auto 44px; gap: 6px; align-items: center; font-variant-numeric: tabular-nums; }
.row.dead { opacity: .4; text-decoration: line-through; }
.dot { width: 10px; height: 10px; border-radius: 50%; }
.nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .nm i { font-style: normal; color: var(--muted); font-size: 11px; }
.me .nm { font-weight: 800; }
.bar { height: 5px; background: #ffffff12; border-radius: 3px; overflow: hidden; grid-column: 2 / -1; }
.bar > span { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width .4s; }
.me .bar > span { background: var(--good); }
.wp { text-align: right; font-weight: 800; }
.mut { color: var(--muted); font-size: 12px; }
.kv { display: flex; justify-content: space-between; gap: 8px; font-variant-numeric: tabular-nums; }
.pill { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 11px; font-weight: 700; background: #ffffff14; }
.pill.good { background: #46c98b2b; color: var(--good); } .pill.bad { background: #ff6b6b2b; color: var(--bad); } .pill.warn { background: #ffc65c2b; color: var(--warn); }
.delta.up { color: var(--good); } .delta.down { color: var(--bad); }
.steps li b { font-variant-numeric: tabular-nums; }
.spin { display: inline-block; width: 9px; height: 9px; border: 2px solid var(--muted); border-top-color: transparent; border-radius: 50%; animation: r 0.8s linear infinite; }
@keyframes r { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } .bar > span { transition: none; } }
.ft { padding: 6px 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; display: flex; justify-content: space-between; gap: 8px; }
.ft button { all: unset; cursor: pointer; color: var(--accent); }
.kv .nm { display: flex; align-items: center; gap: 6px; }
.pn { font-weight: 800; color: var(--c, var(--ink)); }
.pr { font-weight: 700; color: var(--ink); box-shadow: inset 0 -2px 0 var(--c, transparent); padding: 0 1px; }
.pr.free { box-shadow: inset 0 -1px 0 #ffffff55; }
.grp { display: grid; grid-template-columns: 74px 1fr; gap: 6px; align-items: center; }
.grp .gn { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lots { display: flex; gap: 4px; flex-wrap: wrap; min-width: 0; }
.lot { font-size: 11px; line-height: 1.2; padding: 3px 6px; border-radius: 6px; background: #ffffff0d; border: 1px solid #ffffff1a; color: var(--muted); white-space: nowrap; }
.lot.own { color: #14111f; font-weight: 800; border-color: transparent; }
.lot.mine { outline: 2px solid var(--ink); outline-offset: -1px; }
.lot.mort { opacity: .45; text-decoration: line-through; }
.lot b { font-weight: 900; }
.grp.full .gn { color: var(--ink); font-weight: 800; }
.deck { display: grid; gap: 3px; }
.mix { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: #ffffff12; }
.mix i { display: block; height: 100%; }
`;

export function createUI(version) {
  const host = document.createElement('div');
  host.id = 'ruhelp-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><div class="panel"><div class="hd"><b>🎲 Помічник</b><span class="now"></span>
    <button data-a="min" title="Згорнути">▾</button><button data-a="close" title="Закрити">✕</button></div>
    <div class="bd"><div class="card"><div class="mut">Шукаю гру на сторінці…</div></div></div>
    <div class="ft"><span>v${esc(version)} · self-play · <span class="stats"></span></span><span><button data-a="exp" title="Зберегти журнал і профілі у файл">⤓ журнал</button> <button data-a="imp" title="Завантажити журнал/профілі з файлу">⤒</button> <span class="upd"></span></span></div>
    <input type="file" accept="application/json,.json" hidden></div>`;
  (document.body || document.documentElement).appendChild(host);
  const panel = root.querySelector('.panel'), bd = root.querySelector('.bd'), nowEl = root.querySelector('.now'), upd = root.querySelector('.upd'), statsEl = root.querySelector('.stats');
  const fileIn = root.querySelector('input[type=file]');
  const learnedLog = [];
  const hooks = { onExport: null, onImport: null };
  const st = load();
  const isMob = () => window.innerWidth < 760;
  function place() {
    panel.classList.toggle('mob', isMob()); panel.classList.toggle('desk', !isMob());
    if (!isMob()) { const x = st.x ?? 12, y = st.y ?? 150; panel.style.left = Math.max(0, Math.min(x, innerWidth - 340)) + 'px'; panel.style.top = Math.max(0, Math.min(y, innerHeight - 60)) + 'px'; }
    panel.classList.toggle('min', !!st.min);
    root.querySelector('[data-a=min]').textContent = st.min ? '▴' : '▾';
  }
  place(); window.addEventListener('resize', place);
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'min') { st.min = !st.min; save(st); place(); }
    if (a === 'close') { host.style.display = 'none'; }
    if (a === 'exp' && hooks.onExport) hooks.onExport();
    if (a === 'imp') fileIn.click();
  });
  fileIn.addEventListener('change', () => {
    const f = fileIn.files && fileIn.files[0]; if (!f) return;
    f.text().then((t) => { let ok = false; try { ok = hooks.onImport && hooks.onImport(JSON.parse(t)); } catch (e) { ok = false; } statsEl.textContent = ok ? 'імпортовано ✓' : 'не той файл'; fileIn.value = ''; });
  });
  // Перетягування (ПК)
  const hd = root.querySelector('.hd'); let drag = null;
  hd.addEventListener('pointerdown', (e) => { if (isMob() || e.target.closest('button')) return; drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop }; hd.setPointerCapture(e.pointerId); });
  hd.addEventListener('pointermove', (e) => { if (!drag) return; st.x = e.clientX - drag.dx; st.y = e.clientY - drag.dy; place(); });
  hd.addEventListener('pointerup', () => { if (drag) { drag = null; save(st); } });
  hd.addEventListener('click', (e) => { if (isMob() && !e.target.closest('button')) { st.min = !st.min; save(st); place(); } });

  let decoRe = null, decoMap = null, decoKey = '';
  function deco(text, m) {
    const t = esc(text);
    if (!m || !m.colors) return t;
    const key = JSON.stringify(m.colors);
    if (key !== decoKey) {
      decoKey = key; decoMap = new Map();
      Object.entries(m.colors.players).forEach(([n, c]) => decoMap.set(esc(n), { kind: 'p', c }));
      Object.entries(m.colors.blocks).forEach(([n, c]) => decoMap.set(esc(n), { kind: 'b', c }));
      const names = [...decoMap.keys()].filter((n) => n.length > 1).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      decoRe = names.length ? new RegExp('(?<![\\p{L}\\p{N}])(' + names.join('|') + ')(?![\\p{L}\\p{N}])', 'gu') : null;
    }
    if (!decoRe) return t;
    return t.replace(decoRe, (n) => {
      const d = decoMap.get(n); if (!d) return n;
      if (d.kind === 'p') return `<span class="pn" style="--c:${esc(d.c)}">${n}</span>`;
      return d.c ? `<span class="pr" style="--c:${esc(d.c)}">${n}</span>` : `<span class="pr free">${n}</span>`;
    });
  }
  function boardCard(m) {
    if (!m.board || !m.board.length) return '';
    const lvl = (l) => (l >= 5 ? ' <b>H</b>' : l > 0 ? ' <b>' + '•'.repeat(l) + '</b>' : '');
    return `<div class="card"><div class="ttl"><span>Власність</span><span>колір = власник</span></div>${m.board.map((g) => `<div class="grp ${g.full ? 'full' : ''}"><span class="gn">${esc(g.name)}</span><span class="lots">${g.lots.map((l) => `<span class="lot ${l.color ? 'own' : ''} ${l.mine ? 'mine' : ''} ${l.mort ? 'mort' : ''}" ${l.color ? `style="background:${esc(l.color)}"` : ''} title="${esc(l.owner || 'вільна')}">${esc(l.name)}${lvl(l.level)}</span>`).join('')}</span></div>`).join('')}</div>`;
  }
  function cardsCard(m) {
    if (!m.cards || !m.cards.length) return '';
    const col = { earn: '#46c98b', pay: '#ff6b6b', move: '#8a78ff', jail: '#ffc65c', pardon: '#9ad1ff' };
    const lab = { earn: 'гроші', pay: 'платіж', move: 'рух', jail: 'тюрма', pardon: 'Pardon' };
    return `<div class="card"><div class="ttl"><span>Колоди (підрахунок карток)</span></div>${m.cards.map((d) => `<div class="deck">
      <div class="kv"><span><b>${esc(d.title)}</b></span><span class="mut">${d.known ? `коло ${Math.floor(d.seen / d.total) + 1}: порядок відомий` : `вийшло ${d.seen}/${d.total}, лишилось ${d.left}`}</span></div>
      ${d.known ? `<div>Наступна: <b>${deco(d.nextEffect, m)}</b></div>` : `<div class="mix">${Object.entries(d.kinds).filter(([, v]) => v > 0).map(([k, v]) => `<i style="width:${(v * 100).toFixed(1)}%;background:${col[k]}" title="${lab[k]}"></i>`).join('')}</div>
      <div class="mut">${Object.entries(d.kinds).filter(([, v]) => v > 0).map(([k, v]) => `${lab[k]} ${Math.round(v * 100)}%`).join(' · ')}${d.moves.length ? `<br>рух: ${d.moves.map((x) => deco(x, m)).join(', ')}` : ''}</div>`}</div>`).join('')}</div>`;
  }
  function players(m, wins, busy) {
    const rows = m.players.map((p) => {
      const w = wins ? wins[p.id] : null;
      return `<div class="row ${p.isMe ? 'me' : ''} ${p.alive ? '' : 'dead'}"><span class="dot" style="background:${esc(p.color || '#888')}"></span>
        <span class="nm"><span class="pn" style="--c:${esc(p.color || '#ccc')}">${esc(p.name)}</span>${p.isCurrent ? ' ◀' : ''}${p.inPrison ? ' <i>тюрма</i>' : ''}${p.sets.length ? ` <i>${esc(p.sets.join(', '))}</i>` : ''}</span>
        <span class="mut">${money(p.money)} · ${money(p.net)}</span><span class="wp">${p.alive ? pct(w) : '—'}</span>
        <div class="bar"><span style="width:${Math.round((w || 0) * 100)}%"></span></div></div>`;
    }).join('');
    return `<div class="card"><div class="ttl"><span>Шанси на перемогу</span><span>${busy ? '<span class="spin"></span> рахую' : 'гроші · статки'}</span></div>${rows}</div>`;
  }
  const delta = (d) => (d == null ? '' : `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%</span>`);

  function render(m, sim) {
    const wins = sim && sim.base, busy = sim && sim.busy, my = m.meId;
    const wv = (k) => (sim && sim[k] && my ? sim[k][my] : null);
    const base = wv('base');
    nowEl.textContent = m.now ? m.now.title : (m.phase === 'lobby' ? 'Очікування старту' : '');
    let h = '';
    if (m.now) {
      const extra = [];
      if (m.now.kind === 'buy' && m.buy) {
        m.buy.reasons.forEach((r) => extra.push(`<li>${deco(r, m)}</li>`));
        const wb = wv('buy'), wa = wv('auction');
        if (wb != null && wa != null) extra.push(`<li>Шанс перемоги: купиш ${pct(wb)} ${delta(wb - base)}, віддаси на аукціон ${pct(wa)} ${delta(wa - base)}</li>`);
        if (m.buy.verdict !== 'buy') extra.push(`<li>Максимальна ставка на аукціоні: <b>${money(m.buy.maxBid)}</b></li>`);
      }
      if (m.now.kind === 'auction' && m.auction) {
        extra.push(`<li>${deco(m.auction.name, m)}: ставка ${money(m.auction.current)}, ціна ${money(m.auction.price)}</li>`);
        m.auction.est.slice(0, 4).forEach((e) => extra.push(`<li>${deco(e.name, m)}${e.isMe ? ' (ти)' : ''}: готовий до ~${money(e.max)}${e.learned ? ` <span class="pill">досвід ${e.n}</span>` : ''}</li>`));
        if (m.auction.pushTip) extra.push(`<li>${deco(m.auction.pushTip, m)}</li>`);
      }
      if (m.now.kind === 'jail' && m.jail) m.jail.reasons.forEach((r) => extra.push(`<li>${esc(r)}</li>`));
      if (m.now.kind === 'debt' && m.debt) {
        m.debt.steps.forEach((s) => extra.push(`<li>${s.kind === 'sell' ? 'Продай будинок' : 'Заклади'} ${deco(s.name, m)} +${money(s.amount)}</li>`));
        if (!m.debt.enough) extra.push(`<li>Навіть після всього не вистачає: ймовірне банкрутство</li>`);
      }
      h += `<div class="card tone-${m.now.tone}"><div class="ttl"><span>Зараз</span>${base != null ? `<span>твій шанс ${pct(base)}</span>` : ''}</div><div class="big">${deco(m.now.title, m)}</div>${extra.length ? `<ul>${extra.join('')}</ul>` : ''}</div>`;
    }
    if (m.phase === 'lobby' && m.groups) {
      h += `<div class="card"><div class="ttl"><span>Найвигідніші набори</span><span>окупність</span></div><ul>${m.groups.map((g) => `<li>${esc(g.name)}: 3 буд. дають ~${money(g.I3)} з кожного ходу суперника, окупність ~${g.payback3 ?? "—"} кіл</li>`).join('')}</ul><div class="mut">Чекаю старту гри. Поради з'являться автоматично.</div></div>`;
      if (m.firstSet) h += `<div class="card"><div class="ttl"><span>Self-play: перший набір → перемога</span></div><div class="mut">${m.firstSet.map((x) => `${esc(x.name)} ${Math.round(x.p * 100)}%`).join(' · ')}</div><div class="mut">Мільйон партій ботів: хто першим зібрав цей набір, стільки разів виграв. Без жодного набору перемог майже немає.</div></div>`;
    }
    if (m.players && m.phase !== 'lobby') h += players(m, wins, busy);
    (m.trades || []).forEach((t) => {
      const wt = wv('trade:' + t.id);
      const cls = t.verdict === 'accept' ? 'good' : t.verdict === 'reject' ? 'bad' : 'warn';
      h += `<div class="card"><div class="ttl"><span>Обмін ${deco(t.from, m)} → ${deco(t.to, m)}</span>${t.role !== 'others' ? `<span class="pill ${cls}">${esc(t.text)}</span>` : ''}</div>
        <div class="kv"><span class="mut">${deco(t.from, m)} дає</span><span>${deco(t.give, m)}</span></div><div class="kv"><span class="mut">${deco(t.to, m)} дає</span><span>${deco(t.get, m)}</span></div>
        ${t.role === 'others' ? `<div class="mut">${deco(t.text, m)}${t.danger ? ' ⚠️ сильно посилює одного з них' : ''}</div>` : `
        <ul>${wt != null ? `<li>Шанс перемоги після обміну: <b>${pct(wt)}</b> ${delta(wt - base)}</li>` : ''}
        <li>Для тебе ${t.dMe >= 0 ? '+' : ''}${money(t.dMe)}, для нього ${t.dOther >= 0 ? '+' : ''}${money(t.dOther)} (з потенціалом наборів)</li>
        ${t.verdict !== 'reject' ? `<li>Максимум, що варто доплатити: ${money(t.maxExtraPay)}</li>` : `<li>Погоджуйся, якщо дадуть ~${money(t.minAskIfReject)}</li>`}
        ${t.acceptHint ? `<li>${deco(t.acceptHint, m)}</li>` : ''}
        ${t.fairOk === false ? '<li>⚠️ Сервер може відхилити: правило чесного обміну (публічна кімната)</li>' : ''}</ul>`}</div>`;
    });
    if (m.build && (m.build.steps.length || m.build.sets.length) && m.now?.kind !== 'debt') {
      const order = m.build.steps.slice(0, 8).map((s) => `${deco(s.name, m)} ${s.to === 5 ? 'готель' : s.to}`).join(' → ');
      h += `<div class="card"><div class="ttl"><span>Будинки (вільно ${money(m.build.budget)})</span><span>запас ${money(m.build.reserve)}</span></div>
        ${m.build.sets.map((g) => `<div class="kv"><span>${esc(g.name)} до 3 буд.</span><span>−${money(g.cost)} · +${money(g.gainPerRound)}/коло · ~${g.payback ?? '—'} кіл</span></div>`).join('')}
        ${order ? `<div class="mut">Порядок зараз: ${order}</div>` : `<div class="mut">Поки бракує грошей на будинок з урахуванням запасу</div>`}
        <div class="mut">${m.build.maxLevel >= 5 ? 'Self-play: будуй до готелю (на richup він коштує як будинок); третій будинок дає найбільший стрибок оренди.' : 'Головне: 3 будинки на кожному місті. Перші будинки окупаються повільно, третій найвигідніший.'}</div>
        ${m.build.mortgageFor ? `<div class="mut">Self-play: щоб збудувати вже зараз, заклади ${m.build.first && m.build.first.picks.length ? m.build.first.picks.map((x) => esc(x.name) + ' (+' + money(x.cash) + ')').join(', ') : 'ділянки поза наборами'} (разом ~${money(m.build.mortgageFor)} на весь план)</div>` : ''}
        ${m.build.mortgagedInSets.length ? `<div class="mut">Спершу викупи заставу: ${esc(m.build.mortgagedInSets.join(', '))}</div>` : ''}</div>`;
      void order;
    }
    if (m.threats && m.threats.length) {
      h += `<div class="card tone-bad"><div class="ttl"><span>⚠️ Загрози обміну між суперниками</span></div>${m.threats.map((t, k) => {
        const w = sim && sim['threat:' + k], base0 = wins;
        const pl = (id) => m.players.find((p) => p.id === id);
        const row = (id, lbl) => (w && base0 && id ? `${deco(lbl, m)} ${pct(base0[id])}→<b>${pct(w[id])}</b>` : '');
        const impact = w && base0 ? [row(t.a, pl(t.a)?.name), row(t.b, pl(t.b)?.name), m.meId ? `ти ${pct(base0[m.meId])}→<b>${pct(w[m.meId])}</b> ${delta(w[m.meId] - base0[m.meId])}` : ''].filter(Boolean).join(' · ') : (sim && sim.busy ? '<span class="spin"></span> рахую вплив' : '');
        return `<div>${deco(t.text, m)}</div>${impact ? `<div class="mut">Якщо так станеться: ${impact}</div>` : ''}<div class="mut">${deco(t.counter, m)}</div>`;
      }).join('<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">')}</div>`;
    }
    if (m.ideas && m.ideas.length) h += `<div class="card"><div class="ttl"><span>Ідеї обмінів</span></div><ul>${m.ideas.map((i) => `<li>${i.kind === 'warn' ? '⚠️ ' : ''}${deco(i.text, m)}</li>`).join('')}</ul></div>`;
    if (m.danger) {
      const d = m.danger, sign = (v) => (v >= 0 ? '+' : '−') + money(Math.abs(v)).replace(/^[−]/, '');
      h += `<div class="card"><div class="ttl"><span>Наступний кидок</span><span>${esc(m.stage?.name || '')} гра</span></div>
      <div class="kv"><span class="mut">Чистий результат (START, картки, дублі)</span><span><b class="delta ${d.net >= 0 ? 'up' : 'down'}">${sign(d.net)}</b></span></div>
      <div class="kv"><span class="mut">Очікувана плата</span><span>${money(d.expected)}${d.pPay ? ` <span class="mut">(шанс ${Math.round(d.pPay * 100)}%)</span>` : ''}</span></div>
      <div class="kv"><span class="mut">Найгірше</span><span>${money(d.worst)}</span></div>${d.worst ? `<div class="mut">${deco(d.worstName, m)}</div>` : ''}
      <div class="kv"><span class="mut">Шанс стати на вільну ділянку</span><span>${Math.round((d.pBuy || 0) * 100)}%</span></div>
      ${d.pJail > 0.005 ? `<div class="kv"><span class="mut">Шанс потрапити в тюрму</span><span>${Math.round(d.pJail * 100)}%</span></div>` : ''}
      <div class="kv"><span class="mut">Тримай у запасі</span><span><b>${money(d.reserve)}</b></span></div></div>`;
    }
    if (m.phase !== 'lobby') h += boardCard(m) + cardsCard(m);
    if (m.rivals && m.rivals.length) {
      const fx = (v) => (v == null ? '—' : '×' + v.toFixed(2));
      h += `<div class="card"><div class="ttl"><span>Суперники (навчання)</span><span>ігор</span></div>${m.rivals.map((r) => `<div class="kv"><span class="nm"><span class="pn" style="--c:${esc(r.color || '#ccc')}">${esc(r.name)}</span>${r.isBot ? ' <i>бот</i>' : ''}</span><span class="mut">${r.games || 0}</span></div>
        <div class="mut">${r.auctionN ? `аукціон ${fx(r.auctionMed)}…${fx(r.auctionP75)} (${r.auctionN})` : 'аукціони: ще не бачив'} · ${r.buyN ? `купує ${Math.round(r.buyRate * 100)}% (${r.buyN})` : 'купівлі: —'} · ${r.tradeN ? `обміни ${r.tradeAcc}/${r.tradeN}` : 'обміни: —'}${r.houses ? ` · будинків ${r.houses}` : ''}</div>`).join('')}
        ${learnedLog.length ? `<div class="mut">Щойно: ${learnedLog.map((x) => deco(x, m)).join(' · ')}</div>` : ''}</div>`;
    }
    if (!m.meId && m.phase !== 'lobby') h += `<div class="card mut">Ти глядач: показую шанси всіх гравців.</div>`;
    bd.innerHTML = h || '<div class="card mut">Немає даних</div>';
    upd.textContent = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function status(text) { bd.innerHTML = `<div class="card"><div class="mut">${esc(text)}</div></div>`; nowEl.textContent = ''; }
  function learned(list) { list.forEach((t) => { learnedLog.unshift(t); }); learnedLog.splice(3); }
  function setStats(st) {
    if (!st) return;
    statsEl.textContent = `партій ${st.games}` + (st.followRate != null ? ` · порад дотримано ${Math.round(st.followRate * 100)}%` : '');
  }
  function download(name, data) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); a.download = name;
    (document.body || document.documentElement).appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }
  return { host, render, status, learned, setStats, download, hooks, show() { host.style.display = ''; } };
}
