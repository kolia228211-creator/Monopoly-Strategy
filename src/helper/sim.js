// Монте-Карло "дограш" партії від поточного стану: усі гравці грають однією розумною стратегією
// (купують, коли вистачає грошей, будують до найкращої окупності, закладають при боргах).
// Обмінів у симуляції немає. Результат: частка перемог кожного гравця.
import { rng, die } from './rng.js';
import { rentAt, isBuyable, groupKey, prisonIndex, vacationIndex, PRISON_FEE } from './rules.js';
import { boardProbs } from './probability.js';

export function compile(s) {
  const N = s.blocks.length, P = boardProbs(s).leave;
  const B = { N, P, type: [], price: [], house: [], rent: [], group: [], members: {}, kind: [], tax: [], card: [] };
  s.blocks.forEach((b, i) => {
    B.type.push(b.type); B.price.push(b.price || 0); B.house.push(b.housePrice || 0);
    B.rent.push(b.rentPrices ? (Array.isArray(b.rentPrices) ? b.rentPrices.slice() : [0, 1, 2, 3, 4, 5].map((l) => rentAt(b, l))) : null);
    const g = isBuyable(b) ? groupKey(b) : null; B.group.push(g);
    if (g) (B.members[g] = B.members[g] || []).push(i);
    B.kind.push(b.cornerType || b.bonusType || b.type);
    B.tax.push(b.bonusType === 'tax' ? { pct: b.taxPercentage || 10 } : b.bonusType === 'premium-tax' ? { amt: b.taxAmount || 75 } : null);
  });
  B.decks = { treasure: (s.bonusCards?.treasure?.cards || []).map((c) => c.effect), surprise: (s.bonusCards?.surprise?.cards || []).map((c) => c.effect) };
  B.prison = prisonIndex(s); B.vac = vacationIndex(s);
  B.goPass = s.boardConfig?.goReward?.pass ?? 200; B.goLand = s.boardConfig?.goReward?.land ?? 300;
  B.vacSkip = s.blocks[B.vac]?.suspensionAmount ?? 1;
  const st = s.settings || {};
  B.opt = { dbl: !!st.payDoubleRentWhenOwnFullSet, vacCash: !!st.vacationCash, auction: st.auction !== false, mortgage: st.mortgage !== false, noRentPrison: !!st.noRentPaymentsWhileInPrison, even: st.evenBuild !== false };
  return B;
}

export function snapshot(s) {
  const ids = s.participants.map((p) => p.id), idx = new Map(ids.map((id, i) => [id, i]));
  const pr = s.blocks[prisonIndex(s)], vb = s.blocks[vacationIndex(s)];
  const pardon = ids.map(() => 0);
  for (const d of ['treasure', 'surprise']) { const h = s.bonusCards?.[d]?.pardonCardHolderId; if (h && idx.has(h)) pardon[idx.get(h)]++; }
  return {
    ids,
    owner: s.blocks.map((b) => (b.ownerId && idx.has(b.ownerId) ? idx.get(b.ownerId) : -1)),
    level: s.blocks.map((b) => b.level || 0),
    mort: s.blocks.map((b) => (b.isMortgaged ? 1 : 0)),
    money: s.participants.map((p) => p.money),
    pos: s.participants.map((p) => p.position || 0),
    alive: s.participants.map((p) => !p.bankruptedAt),
    jail: s.participants.map((p) => (pr?.suspendedTurnsRemaining?.[p.id] > 0 ? 0 : -1)),
    skip: s.participants.map((p) => (vb?.suspendedTurnsRemaining?.[p.id] || 0)),
    pardon,
    pot: s.vacationCash || 0,
    cur: s.cubesRolledInTurn ? (s.currentPlayerIndex + 1) % ids.length : (s.currentPlayerIndex || 0)
  };
}

function clone(x) {
  return { ids: x.ids, owner: x.owner.slice(), level: x.level.slice(), mort: x.mort.slice(), money: x.money.slice(), pos: x.pos.slice(),
    alive: x.alive.slice(), jail: x.jail.slice(), skip: x.skip.slice(), pardon: x.pardon.slice(), pot: x.pot, cur: x.cur };
}

function ownsSet(B, X, g, p) { return B.members[g].every((i) => X.owner[i] === p); }
function countType(B, X, t, p) { let n = 0; for (let i = 0; i < B.N; i++) if (B.type[i] === t && X.owner[i] === p) n++; return n; }
function inJail(X, p) { return X.jail[p] >= 0; }

function rent(B, X, i, dice) {
  const o = X.owner[i];
  if (o < 0 || X.mort[i]) return 0;
  if (B.opt.noRentPrison && inJail(X, o)) return 0;
  const t = B.type[i];
  if (t === 'city') { let r = B.rent[i][X.level[i]]; if (!X.level[i] && B.opt.dbl && ownsSet(B, X, B.group[i], o)) r *= 2; return r; }
  if (t === 'airport') { const n = countType(B, X, 'airport', o); return (B.rent[i] || [25, 50, 100, 200])[Math.max(0, n - 1)]; }
  if (t === 'company') return (countType(B, X, 'company', o) >= 2 ? 10 : 4) * dice;
  return 0;
}

function netWorth(B, X, p) {
  let v = X.money[p];
  for (let i = 0; i < B.N; i++) if (X.owner[i] === p) v += X.mort[i] ? B.price[i] / 2 : B.price[i] + X.level[i] * B.house[i];
  return v;
}

// Підняти гроші до >= 0: спершу продаємо будинки, потім закладаємо найменш прибуткове
function raise(B, X, p) {
  let guard = 200;
  while (X.money[p] < 0 && guard-- > 0) {
    let best = -1, bestLoss = Infinity, kind = 0;
    for (let i = 0; i < B.N; i++) {
      if (X.owner[i] !== p) continue;
      if (B.type[i] === 'city' && X.level[i] > 0) {
        const g = B.members[B.group[i]]; const max = Math.max(...g.map((j) => X.level[j]));
        if (B.opt.even && X.level[i] < max) continue;
        const loss = B.P[i] * (B.rent[i][X.level[i]] - B.rent[i][X.level[i] - 1]) / (B.house[i] / 2);
        if (loss < bestLoss) { bestLoss = loss; best = i; kind = 1; }
      } else if (!X.mort[i] && B.opt.mortgage) {
        if (B.type[i] === 'city' && B.members[B.group[i]].some((j) => X.level[j] > 0)) continue;
        const loss = (B.P[i] * (B.rent[i] ? B.rent[i][0] : 30) * 3) / (B.price[i] / 2);
        if (loss + 0.0001 < bestLoss) { bestLoss = loss; best = i; kind = 2; }
      }
    }
    if (best < 0) return false;
    if (kind === 1) { X.level[best]--; X.money[p] += B.house[best] / 2; } else { X.mort[best] = 1; X.money[p] += B.price[best] / 2; }
  }
  return X.money[p] >= 0;
}

function bankrupt(B, X, p, creditor) {
  X.alive[p] = false;
  for (let i = 0; i < B.N; i++) {
    if (X.owner[i] !== p) continue;
    if (creditor >= 0) { X.owner[i] = creditor; X.level[i] = 0; } else { X.owner[i] = -1; X.level[i] = 0; X.mort[i] = 0; }
  }
  if (creditor >= 0) X.money[creditor] += Math.max(0, X.money[p]);
  X.money[p] = 0; X.jail[p] = -1;
}

function pay(B, X, p, amount, to) {
  if (amount <= 0) return;
  X.money[p] -= amount;
  if (to >= 0) X.money[to] += amount; else if (to === -2 && B.opt.vacCash) X.pot += amount;
  if (X.money[p] < 0 && !raise(B, X, p)) bankrupt(B, X, p, to >= 0 ? to : -1);
}

function unownedShare(B, X) { let u = 0, t = 0; for (let i = 0; i < B.N; i++) if (B.group[i]) { t++; if (X.owner[i] < 0) u++; } return t ? u / t : 0; }

function valueFor(B, X, i, p) {
  const g = B.group[i]; let v = B.price[i];
  if (g && B.type[i] === 'city') {
    const m = B.members[g]; const mine = m.filter((j) => j !== i && X.owner[j] === p).length;
    if (mine === m.length - 1) v *= 1.6; else if (mine > 0) v *= 1.2;
    const opp = m.filter((j) => j !== i && X.owner[j] >= 0 && X.owner[j] !== p);
    if (opp.length === m.length - 1 && opp.every((j) => X.owner[j] === X.owner[opp[0]])) v *= 1.4;
  }
  return v;
}

function landOnBuyable(B, X, p, i, R) {
  const price = B.price[i];
  const reserve = 60 + 40 * (1 - unownedShare(B, X)) * 4;
  if (X.money[p] - price >= reserve) { X.money[p] -= price; X.owner[i] = p; return; }
  if (!B.opt.auction) return;
  let best = -1, bestMax = 0, second = 0;
  for (let q = 0; q < X.ids.length; q++) {
    if (!X.alive[q]) continue;
    const mx = Math.min(X.money[q] - 40, valueFor(B, X, i, q) * (0.85 + 0.3 * R()));
    if (mx > bestMax) { second = bestMax; bestMax = mx; best = q; } else if (mx > second) second = mx;
  }
  if (best >= 0 && bestMax >= 10) { const priceP = Math.max(10, Math.min(bestMax, second + 2)); X.money[best] -= priceP; X.owner[i] = best; }
}

function build(B, X, p, round) {
  const reserve = 120 + Math.min(300, round * 4);
  for (let guard = 0; guard < 40; guard++) {
    let best = -1, bestRoi = 0;
    for (const g in B.members) {
      const m = B.members[g];
      if (B.type[m[0]] !== 'city' || !m.every((j) => X.owner[j] === p && !X.mort[j])) continue;
      const min = Math.min(...m.map((j) => X.level[j]));
      if (min >= 5) continue;
      for (const j of m) {
        if (X.level[j] !== min) continue;
        if (X.money[p] - B.house[j] < reserve) continue;
        const roi = B.P[j] * (B.rent[j][min + 1] - B.rent[j][min] * (min === 0 && B.opt.dbl ? 2 : 1)) / B.house[j];
        if (roi > bestRoi) { bestRoi = roi; best = j; }
      }
    }
    if (best < 0) return;
    X.level[best]++; X.money[p] -= B.house[best];
  }
}

function unmortgage(B, X, p) {
  for (let i = 0; i < B.N; i++) {
    if (X.owner[i] === p && X.mort[i] && X.money[p] > 500 + B.price[i] * 0.55) { X.money[p] -= Math.ceil(B.price[i] * 0.55); X.mort[i] = 0; }
  }
}

function moveTo(B, X, p, np, collect) {
  const old = X.pos[p];
  if (collect && np !== old && (np < old || np === 0)) X.money[p] += np === 0 ? B.goLand : B.goPass;
  X.pos[p] = np;
}

function card(B, X, p, deck, R, dice) {
  const d = B.decks[deck]; if (!d || !d.length) return 'none';
  const e = d[Math.floor(R() * d.length)];
  switch (e.type) {
    case 'money-event': if (e.moneyType === 'earn') X.money[p] += e.amount; else pay(B, X, p, e.amount, -2); return 'none';
    case 'collect-from-each-player': for (let q = 0; q < X.ids.length; q++) if (q !== p && X.alive[q]) pay(B, X, q, e.amount, p); return 'none';
    case 'pay-each-player': for (let q = 0; q < X.ids.length; q++) if (q !== p && X.alive[q] && X.alive[p]) pay(B, X, p, e.amount, q); return 'none';
    case 'repairs': { let c = 0; for (let i = 0; i < B.N; i++) if (X.owner[i] === p) c += X.level[i] === 5 ? e.perHotel : X.level[i] * e.perHouse; pay(B, X, p, c, -2); return 'none'; }
    case 'go-to-prison': return 'jail';
    case 'get-pardon-card': X.pardon[p]++; return 'none';
    case 'move-to-block': moveTo(B, X, p, e.blockIndex, e.collectGo !== false); return 'moved';
    case 'move-steps': X.pos[p] = (X.pos[p] + e.steps + B.N) % B.N; return 'moved';
    case 'move-to-next-grouped': {
      const t = e.group === 'airport' ? 'airport' : 'company';
      for (let k = 1; k <= B.N; k++) { const j = (X.pos[p] + k) % B.N; if (B.type[j] === t) { moveTo(B, X, p, j, true); break; } }
      return 'moved';
    }
  }
  return 'none';
}

function land(B, X, p, R, dice, depth = 0) {
  const i = X.pos[p], k = B.kind[i];
  if (k === 'go-to-prison') return 'jail';
  if (B.group[i]) {
    const o = X.owner[i];
    if (o < 0) landOnBuyable(B, X, p, i, R);
    else if (o !== p) pay(B, X, p, rent(B, X, i, dice), o);
    return 'none';
  }
  if (B.tax[i]) { const t = B.tax[i]; pay(B, X, p, t.amt ? t.amt : Math.floor(Math.max(0, X.money[p]) * t.pct / 100), -2); return 'none'; }
  if (k === 'treasure' || k === 'surprise') {
    const r = card(B, X, p, k, R, dice);
    if (r === 'jail') return 'jail';
    if (r === 'moved' && depth < 2 && X.alive[p]) return land(B, X, p, R, dice, depth + 1);
    return 'none';
  }
  if (i === B.vac) { if (B.opt.vacCash) { X.money[p] += X.pot; X.pot = 0; } X.skip[p] = B.vacSkip; return 'vac'; }
  return 'none';
}

function toJail(B, X, p) { X.pos[p] = B.prison; X.jail[p] = 0; }

function oppHasDanger(B, X, p) {
  for (let i = 0; i < B.N; i++) if (X.owner[i] >= 0 && X.owner[i] !== p && X.level[i] >= 2) return true;
  return false;
}

function turn(B, X, p, R, round) {
  if (X.skip[p] > 0) { X.skip[p]--; return; }
  let rolls = 0;
  if (X.jail[p] >= 0) {
    if (X.pardon[p] > 0 && unownedShare(B, X) > 0.25) { X.pardon[p]--; X.jail[p] = -1; }
    else if (unownedShare(B, X) > 0.25 && !oppHasDanger(B, X, p) && X.money[p] > PRISON_FEE + 100) { X.money[p] -= PRISON_FEE; if (B.opt.vacCash) X.pot += PRISON_FEE; X.jail[p] = -1; }
    else {
      const a = die(R), b = die(R);
      if (a === b || X.jail[p] >= 2) {
        if (a !== b) pay(B, X, p, PRISON_FEE, -2);
        X.jail[p] = -1; if (!X.alive[p]) return;
        moveTo(B, X, p, (X.pos[p] + a + b) % B.N, true);
        const r = land(B, X, p, R, a + b); if (r === 'jail') toJail(B, X, p);
        return;
      }
      X.jail[p]++; return;
    }
  }
  while (X.alive[p]) {
    const a = die(R), b = die(R), dbl = a === b; rolls++;
    if (dbl && rolls === 3) { toJail(B, X, p); break; }
    moveTo(B, X, p, (X.pos[p] + a + b) % B.N, true);
    const r = land(B, X, p, R, a + b);
    if (r === 'jail') { toJail(B, X, p); break; }
    if (r === 'vac' || !dbl) break;
  }
  if (X.alive[p]) { unmortgage(B, X, p); build(B, X, p, round); }
}

/** Догравання однієї партії. Повертає індекс переможця (або -1 при нічиїй за лімітом раундів — тоді рахуємо за статками). */
export function playout(B, X0, R, maxRounds = 160) {
  const X = clone(X0), n = X.ids.length;
  let p = X.cur % n;
  for (let round = 0; round < maxRounds; round++) {
    for (let k = 0; k < n; k++) {
      if (X.alive[p]) turn(B, X, p, R, round);
      p = (p + 1) % n;
      let alive = 0, last = -1;
      for (let q = 0; q < n; q++) if (X.alive[q]) { alive++; last = q; }
      if (alive <= 1) return { winner: last, X };
    }
  }
  let best = -1, bw = -Infinity;
  for (let q = 0; q < n; q++) if (X.alive[q]) { const w = netWorth(B, X, q); if (w > bw) { bw = w; best = q; } }
  return { winner: best, X, timeout: true };
}

/** Шанси на перемогу з поточного стану. variants: { name: (X)=>void } — змінені версії стану для порівняння. */
export function winProbs(s, { n = 200, seed = 1234, maxRounds = 160, variants = null } = {}) {
  const B = compile(s), X0 = snapshot(s);
  const runs = { base: X0 };
  if (variants) for (const [k, f] of Object.entries(variants)) { const X = clone(X0); f(X, B); runs[k] = X; }
  const out = {};
  for (const [k, X] of Object.entries(runs)) {
    const wins = new Array(X0.ids.length).fill(0);
    for (let i = 0; i < n; i++) { const r = playout(B, X, rng(seed + i * 7919), maxRounds); if (r.winner >= 0) wins[r.winner]++; }
    out[k] = Object.fromEntries(X0.ids.map((id, q) => [id, wins[q] / n]));
  }
  return out;
}

/** Та сама функція, але порціями — щоб не гальмувати сторінку. Повертає Promise. */
export function winProbsAsync(s, opts = {}, isCancelled = () => false) {
  const { n = 240, seed = 1234, maxRounds = 160, variants = null, sliceMs = 12 } = opts;
  const B = compile(s), X0 = snapshot(s);
  const runs = [['base', X0]];
  if (variants) for (const [k, f] of Object.entries(variants)) { const X = clone(X0); f(X, B); runs.push([k, X]); }
  const wins = runs.map(() => new Array(X0.ids.length).fill(0));
  let i = 0;
  return new Promise((resolve) => {
    const step = () => {
      if (isCancelled()) return resolve(null);
      const t0 = performance.now();
      while (i < n && performance.now() - t0 < sliceMs) {
        runs.forEach(([, X], r) => { const res = playout(B, X, rng(seed + i * 7919), maxRounds); if (res.winner >= 0) wins[r][res.winner]++; });
        i++;
      }
      if (i < n) setTimeout(step, 0);
      else resolve(Object.fromEntries(runs.map(([k], r) => [k, Object.fromEntries(X0.ids.map((id, q) => [id, wins[r][q] / n]))])));
    };
    step();
  });
}

export const simHelpers = { clone, netWorth, rent };
