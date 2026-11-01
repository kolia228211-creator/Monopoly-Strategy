// Self-play рушій: партія richup Classic між ботами з різними параметрами стратегії.
// На відміну від src/helper/sim.js тут є справжні аукціони між ботами, ОБМІНИ між ботами,
// колоди по колу (як на richup) і окремі параметри для кожного гравця.
import { compile } from '../../src/helper/sim.js';
import { rng, die } from '../../src/helper/rng.js';
import { PRISON_FEE } from '../../src/helper/rules.js';

// ---- параметри стратегії (за замовчуванням = поточний помічник) ----
export const DEFAULT = {
  stageEarly: 1.15, stageLate: 0.8, H: 25, complete: 0.5, step: 0.15, block: 0.35, air: 0.4,
  buyMin: 0.85, resBase: 60, resLate: 160, aucMult: 1.0, aucKeep: 40,
  bRes: 120, bResGrow: 4, maxLevel: 5, unmortCash: 500, jailU: 0.25,
  trade: 1, buyShare: 0.6, swapPay: 1.0, deny: 0.6, acceptMargin: 40, buildCashLots: 1
};
// Межі пошуку [min, max] для кожного параметра
export const BOUNDS = {
  stageEarly: [0.8, 1.6], stageLate: [0.5, 1.2], H: [10, 45], complete: [0.1, 1.0], step: [0, 0.5], block: [0, 1.0], air: [0, 1.0],
  buyMin: [0, 1.5], resBase: [0, 300], resLate: [0, 500], aucMult: [0.6, 1.6], aucKeep: [0, 200],
  bRes: [0, 400], bResGrow: [0, 10], maxLevel: [3, 5], unmortCash: [150, 1200], jailU: [0, 0.8],
  trade: [0, 1], buyShare: [0.1, 1.2], swapPay: [0, 1.5], deny: [0, 1.2], acceptMargin: [-100, 300], buildCashLots: [0, 3]
};
// «Людиноподібний» гравець: купує майже все, переплачує на аукціонах, рідко торгує, легко погоджується на обміни
export function humanLike(r) {
  return { ...DEFAULT, human: true, priceBid: true, buyMin: 0, resBase: 0, resLate: 40, aucMult: 1.1 + 0.3 * r(),
    bRes: 60, bResGrow: 1, trade: 0.15, deny: 0.15, acceptMargin: 0, jailU: 0.5, buyShare: 0.3, swapPay: 0.3 };
}

export function makeBoard(state) {
  const B = compile(state);
  B.groups = Object.keys(B.members).filter((g) => B.type[B.members[g][0]] === 'city');
  B.I3 = {}; B.hp = {};
  for (const g of B.groups) { B.I3[g] = B.members[g].reduce((a, i) => a + B.P[i] * B.rent[i][3], 0); B.hp[g] = B.house[B.members[g][0]]; }
  B.Pair = B.members['@airport'] ? B.members['@airport'].reduce((a, i) => a + B.P[i], 0) / B.members['@airport'].length : 0;
  B.Pco = B.members['@company'] ? B.members['@company'].reduce((a, i) => a + B.P[i], 0) / B.members['@company'].length : 0;
  return B;
}

export function playGame(B, params, seed, { maxRounds = 200, start = 1500, dbl = null } = {}) {
  const R = rng(seed), n = params.length, N = B.N;
  const opt = { ...B.opt }; if (dbl !== null) opt.dbl = dbl;
  const X = {
    owner: new Int8Array(N).fill(-1), level: new Int8Array(N), mort: new Uint8Array(N),
    money: new Float64Array(n).fill(start), pos: new Int16Array(n), alive: new Uint8Array(n).fill(1),
    jail: new Int8Array(n).fill(-1), skip: new Int8Array(n), pardon: new Int8Array(n), pot: 0, trades: 0, round: 0
  };
  // колоди: перемішані на старті, далі по колу
  const decks = {};
  for (const k of ['treasure', 'surprise']) { const d = B.decks[k].slice(); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } decks[k] = { cards: d, idx: 0, holder: -1 }; }

  const aliveCount = () => { let c = 0; for (let q = 0; q < n; q++) c += X.alive[q]; return c; };
  const unowned = () => { let u = 0, t = 0; for (let i = 0; i < N; i++) if (B.group[i]) { t++; if (X.owner[i] < 0) u++; } return t ? u / t : 0; };
  const ownsSet = (g, p) => B.members[g].every((i) => X.owner[i] === p);
  const countType = (t, p) => { let c = 0; for (let i = 0; i < N; i++) if (B.type[i] === t && X.owner[i] === p) c++; return c; };
  const T = (g, pr) => Math.max(0, (aliveCount() - 1) * pr.H * B.I3[g] * (opt.dbl ? 1 : 1) - 3 * B.hp[g] * B.members[g].length);

  function rent(i, dice) {
    const o = X.owner[i]; if (o < 0 || X.mort[i]) return 0;
    if (opt.noRentPrison && X.jail[o] >= 0) return 0;
    const t = B.type[i];
    if (t === 'city') { let r = B.rent[i][X.level[i]]; if (!X.level[i] && opt.dbl && ownsSet(B.group[i], o)) r *= 2; return r; }
    if (t === 'airport') return (B.rent[i] || [25, 50, 100, 200])[Math.max(0, countType('airport', o) - 1)];
    if (t === 'company') return (countType('company', o) >= 2 ? 10 : 4) * dice;
    return 0;
  }
  function value(p, i) {
    const pr = params[p], u = unowned();
    let v = B.price[i] * (u > 0.6 ? pr.stageEarly : u > 0.25 ? 1 : pr.stageLate);
    const g = B.group[i], t = B.type[i];
    if (t === 'city') {
      const m = B.members[g], others = m.filter((j) => j !== i);
      const mine = others.filter((j) => X.owner[j] === p).length;
      const Tg = T(g, pr);
      if (mine === others.length) v += pr.complete * Tg;
      else if (mine > 0 && others.every((j) => X.owner[j] < 0 || X.owner[j] === p)) v += pr.step * Tg * (mine + 1) / m.length;
      const o0 = X.owner[others[0]];
      if (o0 >= 0 && o0 !== p && others.every((j) => X.owner[j] === o0)) v += pr.block * pr.H * B.I3[g];
    } else if (t === 'airport' || t === 'company') {
      const k = countType(t, p), rr = (c) => (t === 'airport' ? [0, 25, 50, 100, 200][c] * c : (c >= 2 ? 10 : c ? 4 : 0) * 7 * c);
      v += pr.air * (aliveCount() - 1) * pr.H * (t === 'airport' ? B.Pair : B.Pco) * (rr(k + 1) - rr(k));
    }
    return v;
  }
  function netWorth(p) { let v = X.money[p]; for (let i = 0; i < N; i++) if (X.owner[i] === p) v += X.mort[i] ? B.price[i] / 2 : B.price[i] + X.level[i] * B.house[i]; return v; }

  function raise(p) {
    for (let guard = 0; guard < 100 && X.money[p] < 0; guard++) {
      let best = -1, bestLoss = Infinity, kind = 0;
      for (let i = 0; i < N; i++) {
        if (X.owner[i] !== p) continue;
        if (B.type[i] === 'city' && X.level[i] > 0) {
          const g = B.members[B.group[i]]; let mx = 0; for (const j of g) if (X.level[j] > mx) mx = X.level[j];
          if (opt.even && X.level[i] < mx) continue;
          const loss = B.P[i] * (B.rent[i][X.level[i]] - B.rent[i][X.level[i] - 1]) / (B.house[i] / 2);
          if (loss < bestLoss) { bestLoss = loss; best = i; kind = 1; }
        } else if (!X.mort[i] && opt.mortgage) {
          if (B.type[i] === 'city' && B.members[B.group[i]].some((j) => X.level[j] > 0)) continue;
          const loss = (B.P[i] * (B.rent[i] ? B.rent[i][0] : 30) * 3) / (B.price[i] / 2) + (B.type[i] === 'city' && ownsSet(B.group[i], p) ? 1 : 0);
          if (loss < bestLoss) { bestLoss = loss; best = i; kind = 2; }
        }
      }
      if (best < 0) return false;
      if (kind === 1) { X.level[best]--; X.money[p] += B.house[best] / 2; } else { X.mort[best] = 1; X.money[p] += B.price[best] / 2; }
    }
    return X.money[p] >= 0;
  }
  function bankrupt(p, cred) {
    X.alive[p] = 0;
    for (let i = 0; i < N; i++) if (X.owner[i] === p) {
      if (cred >= 0) { X.owner[i] = cred; X.level[i] = 0; } else { X.owner[i] = -1; X.level[i] = 0; X.mort[i] = 0; }
    }
    if (cred >= 0) X.money[cred] += Math.max(0, X.money[p]);
    X.money[p] = 0; X.jail[p] = -1;
    for (const k in decks) if (decks[k].holder === p) decks[k].holder = -1;
  }
  function pay(p, amt, to) {
    if (amt <= 0 || !X.alive[p]) return;
    X.money[p] -= amt;
    if (to >= 0) X.money[to] += amt; else if (to === -2 && opt.vacCash) X.pot += amt;
    if (X.money[p] < 0 && !raise(p)) bankrupt(p, to >= 0 ? to : -1);
  }

  function auction(i) {
    if (!opt.auction) return;
    let best = -1, bestMax = 0, second = 0;
    const off = Math.floor(R() * n); // випадковий порядок: при рівних ставках виграє не завжди перший
    for (let qq = 0; qq < n; qq++) {
      const q = (qq + off) % n;
      if (!X.alive[q]) continue;
      const pr = params[q];
      let v;
      if (pr.priceBid) { const others = B.group[i] && B.type[i] === 'city' ? B.members[B.group[i]].filter((j) => j !== i) : []; v = B.price[i] * pr.aucMult * (others.length && others.every((j) => X.owner[j] === q) ? 1.6 : 1); }
      else v = value(q, i) * pr.aucMult;
      const mx = Math.min(X.money[q] - pr.aucKeep, v);
      if (mx > bestMax) { second = bestMax; bestMax = mx; best = q; } else if (mx > second) second = mx;
    }
    if (best >= 0 && bestMax >= 10) { const price = Math.max(10, Math.min(bestMax, second + 2)); X.money[best] -= price; X.owner[i] = best; }
  }
  function landBuyable(p, i) {
    const pr = params[p], price = B.price[i], u = unowned();
    const reserve = pr.resBase + pr.resLate * (1 - u);
    if (X.money[p] - price >= reserve && value(p, i) >= price * pr.buyMin) { X.money[p] -= price; X.owner[i] = p; return; }
    auction(i);
  }

  function build(p) {
    const pr = params[p], reserve = pr.bRes + pr.bResGrow * X.round, cap = Math.round(pr.maxLevel);
    for (let guard = 0; guard < 40; guard++) {
      let best = -1, bestRoi = 0;
      for (const g of B.groups) {
        const m = B.members[g];
        if (!m.every((j) => X.owner[j] === p && !X.mort[j])) continue;
        let mn = 9; for (const j of m) if (X.level[j] < mn) mn = X.level[j];
        if (mn >= cap) continue;
        for (const j of m) {
          if (X.level[j] !== mn || X.money[p] - B.house[j] < reserve) continue;
          const roi = B.P[j] * (B.rent[j][mn + 1] - B.rent[j][mn] * (mn === 0 && opt.dbl ? 2 : 1)) / B.house[j];
          if (roi > bestRoi) { bestRoi = roi; best = j; }
        }
      }
      if (best < 0) return;
      X.level[best]++; X.money[p] -= B.house[best];
    }
  }
  function unmortgage(p) {
    const pr = params[p];
    for (let i = 0; i < N; i++) if (X.owner[i] === p && X.mort[i] && X.money[p] > pr.unmortCash + B.price[i] * 0.55) { X.money[p] -= Math.ceil(B.price[i] * 0.55); X.mort[i] = 0; }
  }

  // ---- обміни між ботами ----
  function noBuildings(g) { return B.members[g].every((j) => X.level[j] === 0); }
  function tryTrade(p) {
    const pr = params[p]; if (pr.trade <= 0 || R() > pr.trade) return;
    for (const g of B.groups) {
      if (!noBuildings(g)) continue;
      const m = B.members[g], miss = m.filter((j) => X.owner[j] !== p);
      if (miss.length !== 1 || miss.length === m.length) continue;
      const j = miss[0], q = X.owner[j]; if (q < 0 || !X.alive[q]) continue;
      const qr = params[q], Tme = T(g, pr);
      // 1) обмін 1↔1: у мене є ділянка, що завершує набір q
      let swapK = -1, h = null;
      for (const g2 of B.groups) {
        if (g2 === g || !noBuildings(g2)) continue;
        const m2 = B.members[g2], mineThere = m2.filter((k) => X.owner[k] === p), theirs = m2.filter((k) => X.owner[k] === q);
        if (mineThere.length === 1 && theirs.length === m2.length - 1 && !X.mort[mineThere[0]]) { swapK = mineThere[0]; h = g2; break; }
      }
      let give = [], cash;
      if (swapK >= 0) {
        give = [swapK];
        const bal = 0.5 * (Tme - T(h, pr)) * pr.swapPay; // >0: я доплачую
        cash = Math.max(-X.money[q], Math.min(bal, X.money[p] - 100));
      } else {
        cash = Math.min(B.price[j] + pr.buyShare * Tme, X.money[p] - pr.buildCashLots * B.hp[g] * m.length);
        if (cash < B.price[j]) continue;
      }
      // рішення q: вигода за його оцінкою мінус загроза від мого набору
      const gainQ = cash + give.reduce((a, k) => a + value(q, k), 0) - value(q, j) - qr.deny * Tme;
      if (gainQ >= qr.acceptMargin) {
        X.owner[j] = p; give.forEach((k) => { X.owner[k] = q; });
        X.money[p] -= cash; X.money[q] += cash; X.trades++;
        if (X.money[p] < 0 && !raise(p)) bankrupt(p, q);
        if (X.money[q] < 0 && !raise(q)) bankrupt(q, p);
        return;
      }
    }
  }

  function moveTo(p, np, collect) {
    const old = X.pos[p];
    if (collect && np !== old && (np < old || np === 0)) X.money[p] += np === 0 ? B.goLand : B.goPass;
    X.pos[p] = np;
  }
  function drawCard(k) {
    const d = decks[k]; let c, g = 0;
    do { c = d.cards[d.idx % d.cards.length]; d.idx++; } while (d.holder >= 0 && c.type === 'get-pardon-card' && g++ < 40);
    return c;
  }
  function card(p, k) {
    const e = drawCard(k);
    switch (e.type) {
      case 'money-event': if (e.moneyType === 'earn') X.money[p] += e.amount; else pay(p, e.amount, -2); return 0;
      case 'collect-from-each-player': for (let q = 0; q < n; q++) if (q !== p && X.alive[q]) pay(q, e.amount, p); return 0;
      case 'pay-each-player': for (let q = 0; q < n; q++) if (q !== p && X.alive[q] && X.alive[p]) pay(p, e.amount, q); return 0;
      case 'repairs': { let c = 0; for (let i = 0; i < N; i++) if (X.owner[i] === p) c += X.level[i] === 5 ? e.perHotel : X.level[i] * e.perHouse; pay(p, c, -2); return 0; }
      case 'go-to-prison': return 2;
      case 'get-pardon-card': decks[k].holder = p; X.pardon[p]++; return 0;
      case 'move-to-block': moveTo(p, e.blockIndex, e.collectGo !== false); return 1;
      case 'move-steps': X.pos[p] = (X.pos[p] + e.steps + N) % N; return 1;
      case 'move-to-next-grouped': { const t = e.group === 'airport' ? 'airport' : 'company'; for (let s = 1; s <= N; s++) { const j = (X.pos[p] + s) % N; if (B.type[j] === t) { moveTo(p, j, true); break; } } return 1; }
    }
    return 0;
  }
  function land(p, dice, depth = 0) {
    const i = X.pos[p], kind = B.kind[i];
    if (kind === 'go-to-prison') return 2;
    if (B.group[i]) { const o = X.owner[i]; if (o < 0) landBuyable(p, i); else if (o !== p) pay(p, rent(i, dice), o); return 0; }
    if (B.tax[i]) { const t = B.tax[i]; pay(p, t.amt ? t.amt : Math.floor(Math.max(0, X.money[p]) * t.pct / 100), -2); return 0; }
    if (kind === 'treasure' || kind === 'surprise') { const r = card(p, kind); if (r === 2) return 2; if (r === 1 && depth < 2 && X.alive[p]) return land(p, dice, depth + 1); return 0; }
    if (i === B.vac) { if (opt.vacCash) { X.money[p] += X.pot; X.pot = 0; } X.skip[p] = B.vacSkip; return 3; }
    return 0;
  }
  const toJail = (p) => { X.pos[p] = B.prison; X.jail[p] = 0; };
  function oppDanger(p) { for (let i = 0; i < N; i++) if (X.owner[i] >= 0 && X.owner[i] !== p && X.level[i] >= 2) return true; return false; }

  function turn(p) {
    if (X.skip[p] > 0) { X.skip[p]--; return; }
    tryTrade(p); if (!X.alive[p]) return;
    const pr = params[p];
    if (X.jail[p] >= 0) {
      const leave = unowned() > pr.jailU && !oppDanger(p);
      if (leave && X.pardon[p] > 0) { X.pardon[p]--; for (const k in decks) if (decks[k].holder === p) { decks[k].holder = -1; break; } X.jail[p] = -1; }
      else if (leave && X.money[p] > PRISON_FEE + 100) { X.money[p] -= PRISON_FEE; if (opt.vacCash) X.pot += PRISON_FEE; X.jail[p] = -1; }
      else {
        const a = die(R), b = die(R);
        if (a === b || X.jail[p] >= 2) {
          if (a !== b) pay(p, PRISON_FEE, -2);
          X.jail[p] = -1; if (!X.alive[p]) return;
          moveTo(p, (X.pos[p] + a + b) % N, true);
          if (land(p, a + b) === 2) toJail(p);
          if (X.alive[p]) { unmortgage(p); build(p); }
          return;
        }
        X.jail[p]++; return;
      }
    }
    for (let rolls = 1; X.alive[p]; rolls++) {
      const a = die(R), b = die(R), dbl = a === b;
      if (dbl && rolls === 3) { toJail(p); break; }
      moveTo(p, (X.pos[p] + a + b) % N, true);
      const r = land(p, a + b);
      if (r === 2) { toJail(p); break; }
      if (r === 3 || !dbl) break;
    }
    if (X.alive[p]) { unmortgage(p); build(p); }
  }

  // які набори в кого на кінець партії (для статистики «які набори виграють»)
  const setsOf = () => Array.from({ length: n }, (_, q) => B.groups.filter((g) => ownsSet(g, q)));
  // перший зібраний набір кожного гравця (і раунд)
  const firstSet = new Array(n).fill(null), firstRound = new Array(n).fill(-1);
  const trackSets = () => { for (let q = 0; q < n; q++) if (X.alive[q] && firstSet[q] === null) for (const g of B.groups) if (ownsSet(g, q)) { firstSet[q] = g; firstRound[q] = X.round; break; } };
  let cur = Math.floor(R() * n);
  for (X.round = 0; X.round < maxRounds; X.round++) {
    for (let k = 0; k < n; k++) {
      if (X.alive[cur]) { turn(cur); trackSets(); }
      cur = (cur + 1) % n;
      if (aliveCount() <= 1) { let w = -1; for (let q = 0; q < n; q++) if (X.alive[q]) w = q; return { winner: w, rounds: X.round, trades: X.trades, sets: setsOf(), firstSet, firstRound }; }
    }
  }
  let w = -1, bw = -Infinity; for (let q = 0; q < n; q++) if (X.alive[q]) { const v = netWorth(q); if (v > bw) { bw = v; w = q; } }
  return { winner: w, rounds: X.round, trades: X.trades, timeout: true, sets: setsOf(), firstSet, firstRound };
}
