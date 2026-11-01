// Прогноз наступного кидка: усі 36 комбінацій кубиків, дублі (ще один кидок), START (+200 / +300),
// податки (10% від грошей ПІСЛЯ START), Vacation cash, картки Treasure/Surprise з урахуванням
// того, які картки вже вийшли («підрахунок карток»).
import { isBuyable, rentFor, inPrison, prisonIndex, vacationIndex } from './rules.js';

// ---------- колоди ----------
// Колода перемішується на старті й далі йде по колу (cards[currentIndex % L]); Pardon пропускається, поки його хтось тримає.
// Чесний підрахунок: у першому колі знаємо лише, ЯКІ картки вже вийшли; після повного кола — порядок відомий з пам'яті.
export function deckInfo(s, deck) {
  const d = s.bonusCards?.[deck];
  if (!d || !Array.isArray(d.cards) || !d.cards.length) return null;
  const L = d.cards.length, ci = d.currentIndex || 0;
  const usable = (c) => !(d.pardonCardHolderId && c.effect?.type === 'get-pardon-card');
  if (ci >= L) {
    let o = ci, c, g = 0;
    do { c = d.cards[o % L]; o++; } while (!usable(c) && g++ < L);
    return { deck, known: true, seen: L, total: L, cycle: Math.floor(ci / L) + 1, next: [{ card: c, p: 1 }] };
  }
  const rest = d.cards.slice(ci).filter(usable);
  const list = rest.length ? rest : d.cards.filter(usable);
  return { deck, known: false, seen: ci, total: L, cycle: 1, next: list.map((c) => ({ card: c, p: 1 / list.length })) };
}

export function cardKind(e) {
  switch (e?.type) {
    case 'money-event': return e.moneyType === 'earn' ? 'earn' : 'pay';
    case 'collect-from-each-player': return 'earn';
    case 'pay-each-player': case 'repairs': return 'pay';
    case 'go-to-prison': return 'jail';
    case 'get-pardon-card': return 'pardon';
    default: return 'move';
  }
}

export function cardText(s, e) {
  const name = (i) => s.blocks[i]?.name || '#' + i;
  switch (e?.type) {
    case 'money-event': return (e.moneyType === 'earn' ? '+$' : '−$') + e.amount;
    case 'collect-from-each-player': return `+$${e.amount} від кожного`;
    case 'pay-each-player': return `−$${e.amount} кожному`;
    case 'repairs': return `ремонт: $${e.perHouse}/будинок, $${e.perHotel}/готель`;
    case 'go-to-prison': return 'у тюрму';
    case 'get-pardon-card': return 'Pardon (вихід з тюрми)';
    case 'move-to-block': return `на ${name(e.blockIndex)}`;
    case 'move-to-next-grouped': return e.group === 'airport' ? 'до наступного аеропорту' : 'до наступної компанії';
    case 'move-steps': return `${e.steps > 0 ? '+' : ''}${e.steps} кроки`;
    default: return e?.type || '?';
  }
}

// ---------- кидок ----------
export function nextRoll(s, pid, { doubles = true, keepLeaves = false } = {}) {
  const me = s.participants.find((p) => p.id === pid);
  if (!me) return null;
  const N = s.blocks.length, goPass = s.boardConfig?.goReward?.pass ?? 200, goLand = s.boardConfig?.goReward?.land ?? 300;
  const alive = s.participants.filter((p) => !p.bankruptedAt).length;
  const decks = { treasure: deckInfo(s, 'treasure'), surprise: deckInfo(s, 'surprise') };
  const vac = vacationIndex(s), vacCash = !!s.settings?.vacationCash;
  const myHouses = s.blocks.reduce((a, b) => (b.ownerId === pid && b.type === 'city' ? a + ((b.level || 0) >= 5 ? 0 : b.level || 0) : a), 0);
  const myHotels = s.blocks.filter((b) => b.ownerId === pid && (b.level || 0) >= 5).length;

  const goFrom = (from, to) => (to === 0 ? goLand : to < from ? goPass : 0);

  // результат потрапляння на клітинку j (гроші вже з урахуванням START до цього моменту)
  // повертає масив гілок { p, cash, label, jail, pos, buy, pay }
  function resolve(j, money, dice, depth) {
    const b = s.blocks[j];
    if (b.cornerType === 'go-to-prison') return [{ p: 1, cash: 0, pay: 0, label: 'у тюрму', jail: true, pos: prisonIndex(s) }];
    if (isBuyable(b)) {
      if (b.ownerId && b.ownerId !== pid) { const r = rentFor(s, j, dice); return [{ p: 1, cash: -r, pay: r, label: b.name, pos: j }]; }
      return [{ p: 1, cash: 0, pay: 0, label: b.name, pos: j, buy: !b.ownerId }];
    }
    if (b.bonusType === 'tax') { const t = Math.floor(Math.max(0, money) * (b.taxPercentage || 10) / 100); return [{ p: 1, cash: -t, pay: t, label: b.name, pos: j }]; }
    if (b.bonusType === 'premium-tax') { const t = b.taxAmount || 75; return [{ p: 1, cash: -t, pay: t, label: b.name, pos: j }]; }
    if (j === vac) { const pot = vacCash ? (s.vacationCash || 0) : 0; return [{ p: 1, cash: pot, pay: 0, label: 'Vacation' + (pot ? ` (+$${pot})` : ''), pos: j }]; }
    if ((b.bonusType === 'treasure' || b.bonusType === 'surprise') && decks[b.bonusType] && depth < 2) {
      const out = [];
      for (const { card, p } of decks[b.bonusType].next) {
        const e = card.effect, lbl = `${b.bonusType === 'treasure' ? 'Treasure' : 'Surprise'}: ${cardText(s, e)}`;
        switch (e.type) {
          case 'money-event': { const v = e.amount * (e.moneyType === 'earn' ? 1 : -1); out.push({ p, cash: v, pay: Math.max(0, -v), label: lbl, pos: j }); break; }
          case 'collect-from-each-player': out.push({ p, cash: e.amount * (alive - 1), pay: 0, label: lbl, pos: j }); break;
          case 'pay-each-player': out.push({ p, cash: -e.amount * (alive - 1), pay: e.amount * (alive - 1), label: lbl, pos: j }); break;
          case 'repairs': { const c = myHouses * e.perHouse + myHotels * e.perHotel; out.push({ p, cash: -c, pay: c, label: lbl, pos: j }); break; }
          case 'go-to-prison': out.push({ p, cash: 0, pay: 0, label: lbl, jail: true, pos: prisonIndex(s) }); break;
          case 'get-pardon-card': out.push({ p, cash: 0, pay: 0, label: lbl, pos: j }); break;
          default: {
            let t = j, collect = true;
            if (e.type === 'move-to-block') { t = e.blockIndex; collect = e.collectGo !== false; }
            else if (e.type === 'move-steps') { t = (j + e.steps + N) % N; collect = false; }
            else if (e.type === 'move-to-next-grouped') { const ty = e.group === 'airport' ? 'airport' : 'company'; for (let k = 1; k <= N; k++) { const q = (j + k) % N; if (s.blocks[q].type === ty) { t = q; break; } } }
            const g = collect ? goFrom(j, t) : 0;
            for (const r of resolve(t, money + g, dice, depth + 1)) out.push({ ...r, p: p * r.p, cash: g + r.cash, label: lbl + (r.label && r.label !== s.blocks[t].name ? ' → ' + r.label : '') });
          }
        }
      }
      return out;
    }
    return [{ p: 1, cash: 0, pay: 0, label: b.name, pos: j }];
  }

  const leaves = [];
  const jailed = inPrison(s, pid);
  function roll(pos, money, rollNo, pAcc, cashAcc, payAcc, labels) {
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      const p = pAcc / 36, dbl = a === b, sum = a + b;
      if (jailed && rollNo === 1 && !dbl) { leaves.push({ p, cash: cashAcc, pay: payAcc, label: 'лишаєшся в тюрмі', stay: true }); continue; }
      if (dbl && rollNo === 3) { leaves.push({ p, cash: cashAcc, pay: payAcc, label: labels.concat('3 дублі → тюрма').join(' · '), jail: true }); continue; }
      const np = (pos + sum) % N, g = goFrom(pos, np);
      for (const r of resolve(np, money + g, sum, 0)) {
        const cash = cashAcc + g + r.cash, pay = payAcc + r.pay, lab = labels.concat((g ? (g === goLand ? 'START +' + g : '+' + g + ' START') + ' → ' : '') + r.label);
        if (doubles && dbl && !r.jail && !(jailed && rollNo === 1) && rollNo === 1) roll(r.pos, money + cash - cashAcc, rollNo + 1, p * r.p, cash, pay, lab);
        else leaves.push({ p: p * r.p, cash, pay, label: lab.join(' · '), jail: r.jail, buy: r.buy });
      }
    }
  }
  roll(me.position, me.money, 1, 1, 0, 0, []);

  const E = (f) => leaves.reduce((a, l) => a + l.p * f(l), 0);
  const byPay = leaves.slice().sort((x, y) => x.pay - y.pay);
  let acc = 0, q85 = 0;
  for (const l of byPay) { acc += l.p; if (acc >= 0.85) { q85 = l.pay; break; } }
  const worst = byPay[byPay.length - 1] || { pay: 0, label: '' };
  const best = leaves.reduce((m, l) => (l.cash > m.cash ? l : m), { cash: -Infinity, label: '' });
  const pTotal = E(() => 1);
  return {
    net: Math.round(E((l) => l.cash)), expected: Math.round(E((l) => l.pay)), q85: Math.round(q85),
    worst: Math.round(worst.pay), worstName: worst.label, best: Math.round(best.cash), bestName: best.label,
    pBuy: E((l) => (l.buy ? 1 : 0)), pJail: E((l) => (l.jail ? 1 : 0)), pPay: E((l) => (l.pay > 0 ? 1 : 0)),
    reserve: Math.max(50, Math.round(q85)), check: pTotal, decks, leaves: keepLeaves ? leaves : undefined
  };
}
