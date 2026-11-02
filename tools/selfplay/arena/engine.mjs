// Швидкий рушій self-play для richup Classic: боти з різними параметрами грають повні партії.
// На відміну від src/helper/sim.js тут є справжні аукціони між ботами, обміни (продаж ділянки,
// що завершує набір, і обмін 1↔1 з доплатою), застава/викуп, банкрутство на кредитора,
// колоди, що йдуть по колу (перемішуються один раз на старті партії), Pardon, Vacation cash.
// Політика "smart" дзеркалить формули src/helper/advisor.js (buyAdvice, auctionAdvice, tradeAdvice
// з portfolio і правилом floor, tradeIdeas, buildPlan, jailAdvice) і бере числа з params.js у тих самих
// назвах (BASE/TUNED) — тому знайдені тут параметри означають у помічнику те саме, що й у грі ботів.
import { makeState } from '../../mock-state.mjs';
import { boardProbs } from '../../../src/helper/probability.js';
import { rentAt } from '../../../src/helper/rules.js';
import { rng } from '../../../src/helper/rng.js';

const PRISON_FEE = 50;

// ---------- дошка ----------
function compileBoard() {
  const s = makeState({ players: 4 });
  const P = Array.from(boardProbs(s).leave);
  const N = s.blocks.length;
  const B = { N, P, t: new Int8Array(N), price: new Int32Array(N), house: new Int32Array(N), rent: [], g: new Int8Array(N).fill(-1),
    members: [], gname: [], kind: [], taxPct: new Int32Array(N), taxAmt: new Int32Array(N), decks: {} };
  const gid = new Map();
  s.blocks.forEach((b, i) => {
    B.t[i] = b.type === 'city' ? 1 : b.type === 'airport' ? 2 : b.type === 'company' ? 3 : 0;
    B.price[i] = b.price || 0; B.house[i] = b.housePrice || 0;
    B.rent.push(b.type === 'city' ? [0, 1, 2, 3, 4, 5].map((l) => rentAt(b, l)) : b.type === 'airport' ? [25, 50, 100, 200] : null);
    if (B.t[i]) {
      const key = b.type === 'city' ? b.countryId : '@' + b.type;
      if (!gid.has(key)) { gid.set(key, B.members.length); B.members.push([]); B.gname.push(key); }
      B.g[i] = gid.get(key); B.members[B.g[i]].push(i);
    }
    B.kind.push(b.cornerType || b.bonusType || b.type);
    if (b.bonusType === 'tax') B.taxPct[i] = b.taxPercentage || 10;
    if (b.bonusType === 'premium-tax') B.taxAmt[i] = b.taxAmount || 75;
  });
  B.cityGroups = B.members.map((m, g) => g).filter((g) => B.t[B.members[g][0]] === 1);
  for (const d of ['treasure', 'surprise']) B.decks[d] = s.bonusCards[d].cards.map((c) => c.effect);
  B.prison = 10; B.vac = 20; B.goPass = 200; B.goLand = 300;
  // середня ймовірність для аеропортів/компаній
  B.pAvg = [0, 0, 0, 0];
  for (const ty of [2, 3]) { let a = 0, c = 0; for (let i = 0; i < N; i++) if (B.t[i] === ty) { a += P[i]; c++; } B.pAvg[ty] = a / c; }
  // дохід набору за хід одного суперника: I[dbl][g][L]
  B.I = [0, 1].map((dbl) => B.members.map((m) => [0, 1, 2, 3, 4, 5].map((L) => (B.t[m[0]] === 1 ? m.reduce((a, i) => a + P[i] * B.rent[i][L] * (L === 0 && dbl ? 2 : 1), 0) : 0))));
  return B;
}
export const BOARD = compileBoard();

// ---------- "людиноподібний" бот ----------
// Переплачує на аукціонах ×1.1–1.4, купує майже все, рідко пропонує обміни, приймає обміни з невеликою
// видимою вигодою (не думає, що віддає суперникові набір), швидко виходить з тюрми, будує, коли є гроші.
export const HUMAN = { kind: 'human', overLo: 1.1, overHi: 1.4, buyKeep: 30, proposeP: 0.12, acceptLo: 10, acceptHi: 80, buildKeep: 150, needBonus: 1.3 };

// ---------- стан партії ----------
function shuffle(a, R) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// Параметри помічника (назви з params.js) → внутрішні поля політики
export function toInternal(pr) {
  return {
    kind: 'smart', horizon: pr.H, tLevel: 3, stageEarly: 0.6, stageLate: 0.25, multEarly: pr.stageEarly, multMid: 1, multLate: pr.stageLate,
    completeT: pr.complete, stepT: pr.step, blockT: pr.block, utilK: pr.air, portfolioStepT: 0.1,
    buyValue: pr.buyMin, buyMortValue: Math.max(1.15, pr.buyMin + 0.3), buyRiskValue: 1.3, buyRiskUnowned: 0.4,
    resBase: pr.resBase, resLate: pr.resLate, auctionMult: pr.aucMult, auctionKeep: pr.aucKeep,
    tradeP: pr.trade, buyerT: pr.buyShare, openMult: pr.openMult ?? 1.5, tradeOtherW: pr.deny, tradeAccept: pr.acceptMargin, floorT: pr.deny,
    floorInSwap: pr.floorInSwap ?? 1, swapBalance: 0.5 * pr.swapPay, swapCashKeep: 100, buildCashLots: Math.max(0.5, pr.buildCashLots),
    jailLeaveUnowned: pr.jailU, jailDangerLevel: pr.jailDanger ?? 2, jailFree: pr.jailFree ?? 9, jailMinCash: 100,
    bRes: pr.bRes, bResGrow: pr.bResGrow, buildMaxLevel: Math.round(pr.maxLevel), unmortCash: pr.unmortCash, unmortMult: 0.55,
    mortForBuild: pr.mortForBuild ?? 0, avoid: pr.avoid, buyAll: pr.buyAll, tradeOn: pr.tradeOn, swapOn: pr.swapOn, cashBuyOn: pr.cashBuyOn
  };
}

export function newGame(bots0, opts, seed) {
  const bots = bots0.map((b) => (b.kind === 'human' ? b : b.kind === 'smart' ? b : toInternal(b)));
  const B = BOARD, n = bots.length, R = rng(seed);
  const G = {
    B, R, n, bots, dbl: opts.dbl ? 1 : 0, vacCash: opts.vacCash !== false, auction: opts.auction !== false, mortgage: true,
    owner: new Int8Array(B.N).fill(-1), level: new Int8Array(B.N), mort: new Uint8Array(B.N),
    money: new Float64Array(n).fill(opts.cash || 1500), pos: new Int8Array(n), alive: new Uint8Array(n).fill(1),
    jail: new Int8Array(n).fill(-1), skip: new Int8Array(n), pot: 0, unowned: 0, nAlive: n, round: 0,
    deck: {}, deckIdx: { treasure: 0, surprise: 0 }, pardonHolder: { treasure: -1, surprise: -1 },
    hum: bots.map((b) => (b.kind === 'human' ? { over: b.overLo + (b.overHi - b.overLo) * R() } : null)),
    stats: { trades: 0, tradeCash: 0, swaps: 0, auctions: 0, auctionOver: 0, buys: 0, bankr: 0, pot: 0, sets: new Array(n).fill(0), firstSet: -1, firstSetG: -1, houses: new Array(n).fill(0) }
  };
  for (let i = 0; i < B.N; i++) if (B.t[i]) G.unowned++;
  G.setFirst = new Int8Array(B.members.length).fill(-1);
  for (const d of ['treasure', 'surprise']) G.deck[d] = shuffle(B.decks[d].map((_, k) => k), R);
  return G;
}

// ---------- допоміжні ----------
const unownedShare = (G) => G.unowned / 28;
function ownsSet(G, g, p) { for (const i of G.B.members[g]) if (G.owner[i] !== p) return false; return true; }
function countType(G, ty, p) { let c = 0; const B = G.B; for (let i = 0; i < B.N; i++) if (B.t[i] === ty && G.owner[i] === p) c++; return c; }
function groupHasHouses(G, g) { for (const i of G.B.members[g]) if (G.level[i] > 0) return true; return false; }

function rentOf(G, i, dice) {
  const o = G.owner[i]; if (o < 0 || G.mort[i]) return 0;
  const B = G.B, ty = B.t[i];
  if (ty === 1) { let r = B.rent[i][G.level[i]]; if (!G.level[i] && G.dbl && ownsSet(G, B.g[i], o)) r *= 2; return r; }
  if (ty === 2) return B.rent[i][Math.max(0, countType(G, 2, o) - 1)];
  if (ty === 3) return (countType(G, 3, o) >= 2 ? 10 : 4) * dice;
  return 0;
}

function stageMult(G, K) { const u = unownedShare(G); return u > K.stageEarly ? K.multEarly : u <= K.stageLate ? K.multLate : K.multMid; }
const nOpp = (G) => Math.max(1, G.nAlive - 1);
function groupT(G, g, K) { const B = G.B, m = B.members[g]; return nOpp(G) * K.horizon * B.I[G.dbl][g][K.tLevel] - K.tLevel * B.house[m[0]] * m.length; }

// = advisor.valueOf
export function valueOf(G, i, p, K) {
  const B = G.B; let v = B.price[i] * stageMult(G, K);
  const ty = B.t[i];
  if (ty === 1) {
    const g = B.g[i], m = B.members[g];
    let mine = 0, others = 0, clean = true, opp = -2;
    for (const j of m) {
      if (j === i) continue; others++;
      const o = G.owner[j];
      if (o === p) mine++; else if (o >= 0) clean = false;
      if (opp === -2) opp = (o >= 0 && o !== p) ? o : -1; else if (opp !== o) opp = -1;
    }
    const T = Math.max(0, groupT(G, g, K));
    if (mine === others) v += K.completeT * T;
    else if (mine > 0 && clean) v += K.stepT * T * (mine + 1) / m.length;
    if (others && opp >= 0) v += K.blockT * K.horizon * B.I[G.dbl][g][K.tLevel];
  } else if (ty === 2 || ty === 3) {
    let k = 0; for (let j = 0; j < B.N; j++) if (j !== i && B.t[j] === ty && G.owner[j] === p) k++;
    const r = (c) => (ty === 2 ? (c > 0 ? B.rent[i][c - 1] : 0) * c : (c >= 2 ? 10 : c === 1 ? 4 : 0) * 7 * c);
    v += K.utilK * nOpp(G) * K.horizon * B.pAvg[ty] * (r(k + 1) - r(k));
  }
  return v;
}

// = advisor.portfolio
function portfolio(G, p, K) {
  const B = G.B; let v = G.money[p];
  const mult = stageMult(G, K);
  for (let i = 0; i < B.N; i++) {
    if (G.owner[i] !== p) continue;
    v += G.mort[i] ? B.price[i] / 2 : B.price[i] + G.level[i] * B.house[i];
    if (B.t[i] === 2 || B.t[i] === 3) v += valueOf(G, i, p, K) - B.price[i] * mult;
  }
  for (const g of B.cityGroups) {
    let k = 0, clean = true;
    for (const j of B.members[g]) { const o = G.owner[j]; if (o === p) k++; else if (o >= 0) clean = false; }
    if (!k) continue;
    const T = Math.max(0, groupT(G, g, K)), n = B.members[g].length;
    if (k === n) v += K.completeT * T; else if (clean) v += K.portfolioStepT * T * k / n;
  }
  return v;
}

// Безпечний запас: 85-й перцентиль платежу на наступному кидку (спрощений advisor.danger, ≥ $50)
const DICE = (() => { const p = new Array(13).fill(0); for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) p[a + b] += 1 / 36; return p; })();
const _pay = new Float64Array(13);
function reserveFor(G, p, K) {
  const B = G.B, pos = G.pos[p];
  for (let d = 2; d <= 12; d++) {
    const j = (pos + d) % B.N; let x = 0;
    if (B.t[j] && G.owner[j] >= 0 && G.owner[j] !== p) x = rentOf(G, j, d);
    else if (B.taxAmt[j]) x = B.taxAmt[j];
    else if (B.taxPct[j]) x = Math.max(0, G.money[p]) * B.taxPct[j] / 100;
    _pay[d] = x;
  }
  // перцентиль
  let q = 0;
  for (let it = 0; it < 11; it++) {
    // знайти найменше x, для якого P(pay<=x) >= 0.85
    let best = Infinity;
    for (let d = 2; d <= 12; d++) {
      let acc = 0; for (let e = 2; e <= 12; e++) if (_pay[e] <= _pay[d]) acc += DICE[e];
      if (acc >= 0.85 && _pay[d] < best) best = _pay[d];
    }
    q = best; break;
  }
  return Math.max(50, q);
}
const buyReserve = (G, p, K) => Math.max(reserveFor(G, p, K), K.resBase + K.resLate * (1 - unownedShare(G)));
const buildReserve = (G, p, K) => Math.max(reserveFor(G, p, K), K.bRes + K.bResGrow * G.round);

function mortgageCapacity(G, p) {
  const B = G.B; let v = 0;
  for (let i = 0; i < B.N; i++) {
    if (G.owner[i] !== p || G.mort[i]) continue;
    if (B.t[i] === 1 && (ownsSet(G, B.g[i], p) || groupHasHouses(G, B.g[i]))) continue;
    v += B.price[i] / 2;
  }
  return v;
}

// ---------- гроші ----------
function canDowngrade(G, i) {
  if (!(G.level[i] > 0)) return false;
  for (const j of G.B.members[G.B.g[i]]) if (G.level[j] > G.level[i]) return false;
  return true;
}
function canMortgage(G, i, p) {
  const B = G.B;
  if (G.owner[i] !== p || G.mort[i] || !B.t[i]) return false;
  if (B.t[i] === 1 && groupHasHouses(G, B.g[i])) return false;
  return true;
}
// Підняти гроші до need (продаж будинків / застава з найменшою втратою доходу). Повертає true, якщо вдалося.
function raise(G, p, need) {
  const B = G.B, P = B.P;
  for (let guard = 0; guard < 120 && G.money[p] < need; guard++) {
    let best = -1, bestLoss = Infinity, kind = 0;
    for (let i = 0; i < B.N; i++) {
      if (G.owner[i] !== p) continue;
      if (B.t[i] === 1 && G.level[i] > 0) {
        if (!canDowngrade(G, i)) continue;
        const L = G.level[i], loss = P[i] * (B.rent[i][L] - B.rent[i][L - 1]) / (B.house[i] / 2);
        if (loss < bestLoss) { bestLoss = loss; best = i; kind = 1; }
      } else if (canMortgage(G, i, p)) {
        const loss = P[i] * ((B.t[i] === 1 ? B.rent[i][0] * (G.dbl && ownsSet(G, B.g[i], p) ? 2 : 1) : 25) * 2 + (B.t[i] === 1 && ownsSet(G, B.g[i], p) ? 400 : 0)) / (B.price[i] / 2);
        if (loss < bestLoss) { bestLoss = loss; best = i; kind = 2; }
      }
    }
    if (best < 0) return false;
    if (kind === 1) { G.level[best]--; G.money[p] += B.house[best] / 2; } else { G.mort[best] = 1; G.money[p] += B.price[best] / 2; }
  }
  return G.money[p] >= need;
}

function bankrupt(G, p, creditor) {
  const B = G.B;
  G.alive[p] = 0; G.nAlive--; G.stats.bankr++;
  for (let i = 0; i < B.N; i++) {
    if (G.owner[i] !== p) continue;
    G.level[i] = 0;
    if (creditor >= 0) G.owner[i] = creditor;
    else { G.owner[i] = -1; G.mort[i] = 0; G.unowned++; }
  }
  if (creditor >= 0) G.money[creditor] += Math.max(0, G.money[p]);
  G.money[p] = 0; G.jail[p] = -1;
  for (const d of ['treasure', 'surprise']) if (G.pardonHolder[d] === p) G.pardonHolder[d] = -1;
}

// to: індекс гравця, -1 банк, -2 банк + Vacation cash
function pay(G, p, amount, to) {
  if (amount <= 0 || !G.alive[p]) return;
  if (G.money[p] < amount) raise(G, p, amount);
  if (G.money[p] >= amount) {
    G.money[p] -= amount;
    if (to >= 0) G.money[to] += amount; else if (to === -2 && G.vacCash) G.pot += amount;
    return;
  }
  const have = Math.max(0, G.money[p]);
  if (to === -2 && G.vacCash) G.pot += have;
  G.money[p] = have;
  bankrupt(G, p, to >= 0 ? to : -1);
}

// ---------- купівля й аукціон ----------
function giveLot(G, i, p, price) { G.money[p] -= price; G.owner[i] = p; G.unowned--; }

function botMaxBid(G, i, q) {
  const b = G.bots[q], B = G.B;
  if (b.kind === 'human') {
    let need = false;
    if (B.t[i] === 1) { need = true; for (const j of B.members[B.g[i]]) if (j !== i && G.owner[j] !== q) need = false; }
    return Math.min(G.money[q] - 20, B.price[i] * G.hum[q].over * (need ? b.needBonus : 1));
  }
  if (b.avoid && b.avoid.includes(B.gname[B.g[i]])) return 0;
  return Math.min(valueOf(G, i, q, b) * b.auctionMult, G.money[q] - b.auctionKeep);
}

function auction(G, i) {
  if (!G.auction) return;
  let best = -1, bm = 0, sm = 0, ties = 0;
  for (let q = 0; q < G.n; q++) {
    if (!G.alive[q]) continue;
    const m = Math.floor(botMaxBid(G, i, q));
    if (m > bm) { sm = bm; bm = m; best = q; ties = 1; }
    else if (m === bm && m > 0) { ties++; sm = m; if (G.R() * ties < 1) best = q; }
    else if (m > sm) sm = m;
  }
  if (best < 0 || bm < 2) return;
  const price = Math.max(2, Math.min(bm, sm + 2));
  giveLot(G, i, best, price);
  G.stats.auctions++; G.stats.auctionOver += price / G.B.price[i];
}

function onUnowned(G, p, i) {
  const b = G.bots[p], B = G.B, price = B.price[i];
  let buy = false;
  if (G.money[p] >= price) {
    if (b.kind === 'human') buy = G.money[p] - price >= b.buyKeep;
    else if (b.avoid && b.avoid.includes(B.gname[B.g[i]])) buy = false;
    else if (b.buyAll) buy = true;
    else {
      const value = valueOf(G, i, p, b), res = buyReserve(G, p, b), after = G.money[p] - price;
      if (after >= res && value >= price * b.buyValue) buy = true;
      else if (after >= 0 && after + mortgageCapacity(G, p) >= res && value >= price * b.buyMortValue) buy = true;
      else if (after >= 0 && value >= price * b.buyRiskValue && unownedShare(G) > b.buyRiskUnowned) buy = true;
    }
  }
  if (buy) { giveLot(G, i, p, price); G.stats.buys++; } else auction(G, i);
}

// ---------- обміни ----------
// offer: { a, b, give:[lots від a], get:[lots від b], cash: a→b (може бути від'ємна) }
function applyOffer(G, o, dir) {
  for (const i of o.give) G.owner[i] = dir > 0 ? o.b : o.a;
  for (const i of o.get) G.owner[i] = dir > 0 ? o.a : o.b;
  G.money[o.a] -= dir * o.cash; G.money[o.b] += dir * o.cash;
}
function tradeScore(G, o, me, K) {
  const other = me === o.a ? o.b : o.a;
  const m0 = portfolio(G, me, K), t0 = portfolio(G, other, K);
  applyOffer(G, o, 1);
  const m1 = portfolio(G, me, K), t1 = portfolio(G, other, K);
  applyOffer(G, o, -1);
  return { dMe: m1 - m0, dOther: t1 - t0, score: (m1 - m0) - K.tradeOtherW * (t1 - t0) };
}
// чи завершує передача лоту i гравцю q його набір (з урахуванням інших лотів цього ж обміну)
function completesFor(G, i, q, extra) {
  const B = G.B; if (B.t[i] !== 1) return false;
  for (const j of B.members[B.g[i]]) if (j !== i && G.owner[j] !== q && !extra.includes(j)) return false;
  return true;
}

function accepts(G, o) {
  const rb = G.bots[o.b], B = G.B;
  if (o.cash > G.money[o.a] || -o.cash > G.money[o.b]) return false;
  if (rb.kind === 'human') {
    // бачить ціни, гроші й власні набори; майже не думає про набір суперника
    let gain = o.cash;
    for (const i of o.give) gain += B.price[i] * (completesFor(G, i, o.b, o.give) ? 2.0 : 1.0);
    for (const i of o.get) gain -= B.price[i] * (completesFor(G, i, o.a, o.get) ? 1.35 : 1.15);
    const need = rb.acceptLo + (rb.acceptHi - rb.acceptLo) * G.R();
    return gain >= need;
  }
  const { score } = tradeScore(G, o, o.b, rb);
  if (score <= rb.tradeAccept) return false;
  // правило "не віддавай ключову ділянку дешевше ціна + floorT·T"
  let floor = 0, iGetSet = false;
  for (const i of o.give) if (completesFor(G, i, o.b, o.give)) iGetSet = true;
  for (const i of o.get) if (completesFor(G, i, o.a, o.get)) floor += B.price[i] + rb.floorT * Math.max(0, groupT(G, B.g[i], rb));
  if (floor && (iGetSet && rb.floorInSwap < 0.5 ? false : -o.cash < floor)) return false;
  return true;
}

function doTrade(G, o) {
  applyOffer(G, o, 1);
  G.stats.trades++; if (o.give.length && o.get.length) G.stats.swaps++; if (o.cash) G.stats.tradeCash++;
}

// Ідеї обміну для гравця p (= advisor.tradeIdeas): докупити останню ділянку набору / 1↔1 з доплатою
function tradePhase(G, p) {
  const b = G.bots[p], B = G.B;
  if (b.kind === 'human' && G.R() > b.proposeP) return;
  if (b.kind !== 'human' && (b.tradeOn === 0 || b.tradeP <= 0 || G.R() > b.tradeP)) return;
  const needs = [];
  for (const g of B.cityGroups) {
    const m = B.members[g]; if (groupHasHouses(G, g)) continue;
    let mine = 0, miss = -1, missN = 0;
    for (const j of m) { if (G.owner[j] === p) mine++; else { missN++; miss = j; } }
    if (mine && missN === 1 && G.owner[miss] >= 0 && G.alive[G.owner[miss]]) needs.push([g, miss, G.owner[miss]]);
  }
  if (!needs.length) return;
  const K = b.kind === 'human' ? null : b;
  // спершу 1↔1 (обом по набору)
  for (const [g, j, q] of needs) {
    for (const g2 of B.cityGroups) {
      if (g2 === g || groupHasHouses(G, g2)) continue;
      const m2 = B.members[g2]; let theirs = 0, mineThere = -1, cnt = 0;
      for (const x of m2) { if (G.owner[x] === q) theirs++; else if (G.owner[x] === p) { mineThere = x; cnt++; } }
      if (theirs !== m2.length - 1 || cnt !== 1) continue;
      let cash = 0;
      if (K) {
        if (K.swapOn === 0) continue;
        const bal = K.swapBalance * (groupT(G, g, K) - groupT(G, g2, K));
        if (bal > 20) cash = Math.max(0, Math.min(bal, G.money[p] - K.swapCashKeep));
        else if (bal < -20) cash = -Math.max(0, Math.min(-bal, G.money[q]));
      }
      const o = { a: p, b: q, give: [mineThere], get: [j], cash: Math.round(cash) };
      if (K && tradeScore(G, o, p, K).score < 0) {
        // спробувати без доплати / з меншою
        o.cash = Math.round(cash / 2);
        if (tradeScore(G, o, p, K).score < 0) continue;
      }
      if (accepts(G, o)) { doTrade(G, o); return; }
      // друга спроба: продавець хоче більше — додай половину різниці (лише якщо собі ще вигідно)
      if (K) { o.cash = Math.round(o.cash + Math.max(40, 0.15 * B.price[j])); if (o.cash <= G.money[p] - K.swapCashKeep && tradeScore(G, o, p, K).score > 0 && accepts(G, o)) { doTrade(G, o); return; } }
    }
  }
  // купівля останньої ділянки за гроші
  for (const [g, j, q] of needs) {
    const n = B.members[g].length, buildCash = B.house[j] * n * (K ? K.buildCashLots : 1);
    let cap, open;
    if (K) {
      if (K.cashBuyOn === 0) continue;
      const T = Math.max(0, groupT(G, g, K));
      cap = Math.min(B.price[j] + K.buyerT * T, G.money[p] - Math.max(100, buildCash));
      open = B.price[j] * K.openMult;
    } else {
      cap = Math.min(B.price[j] * (1.2 + 0.8 * G.R()), G.money[p] - 100); open = cap;
    }
    if (cap < open || cap < B.price[j]) continue;
    const steps = K ? [open, (open + cap) / 2, cap] : [cap];
    for (const c of steps) {
      const o = { a: p, b: q, give: [], get: [j], cash: Math.round(c) };
      if (accepts(G, o)) { doTrade(G, o); return; }
    }
  }
}

// ---------- забудова, застава ----------
function canUpgrade(G, i, p) {
  const B = G.B;
  if (B.t[i] !== 1 || G.owner[i] !== p || G.mort[i] || G.level[i] >= 5) return false;
  for (const j of B.members[B.g[i]]) { if (G.owner[j] !== p || G.mort[j]) return false; if (G.level[j] < G.level[i]) return false; }
  return true;
}

function buildPhase(G, p) {
  const b = G.bots[p], B = G.B, P = B.P;
  if (b.kind === 'human') {
    for (let guard = 0; guard < 40; guard++) {
      let best = -1;
      for (let i = 0; i < B.N; i++) if (canUpgrade(G, i, p) && G.money[p] - B.house[i] >= b.buildKeep && (best < 0 || G.level[i] < G.level[best])) best = i;
      if (best < 0) return;
      G.level[best]++; G.money[p] -= B.house[best]; G.stats.houses[p]++;
    }
    return;
  }
  // викуп застави в повних наборах — першим (інакше будувати не можна)
  for (let i = 0; i < B.N; i++) {
    if (G.owner[i] !== p || !G.mort[i]) continue;
    const cost = Math.ceil(B.price[i] * b.unmortMult);
    const inSet = B.t[i] === 1 && ownsSet(G, B.g[i], p);
    if (G.money[p] - cost >= (inSet ? buildReserve(G, p, b) : b.unmortCash)) { G.money[p] -= cost; G.mort[i] = 0; }
  }
  const res = buildReserve(G, p, b);
  const maxL = Math.round(b.buildMaxLevel);
  for (let guard = 0; guard < 40; guard++) {
    let best = -1, bestRoi = 0;
    for (let i = 0; i < B.N; i++) {
      if (!canUpgrade(G, i, p) || G.level[i] >= maxL) continue;
      const L = G.level[i], roi = P[i] * (B.rent[i][L + 1] - B.rent[i][L] * (L === 0 && G.dbl ? 2 : 1)) / B.house[i];
      if (roi > bestRoi) { bestRoi = roi; best = i; }
    }
    if (best < 0) return;
    if (G.money[p] - B.house[best] < res) {
      // закласти ділянки поза наборами, щоб збудувати (якщо дозволено)
      if (b.mortForBuild >= 0.5 && mortgageForBuild(G, p, B.house[best] + res)) { /* далі будуємо */ } else return;
    }
    G.level[best]++; G.money[p] -= B.house[best]; G.stats.houses[p]++;
  }
}
function mortgageForBuild(G, p, need) {
  const B = G.B;
  while (G.money[p] < need) {
    let best = -1, bl = Infinity;
    for (let i = 0; i < B.N; i++) {
      if (!canMortgage(G, i, p)) continue;
      if (B.t[i] === 1 && ownsSet(G, B.g[i], p)) continue;
      const loss = B.P[i] * (B.t[i] === 1 ? B.rent[i][0] : 30) / B.price[i];
      if (loss < bl) { bl = loss; best = i; }
    }
    if (best < 0) return false;
    G.mort[best] = 1; G.money[p] += B.price[best] / 2;
  }
  return true;
}

// ---------- рух і клітинки ----------
function moveTo(G, p, np, collect) {
  const old = G.pos[p];
  if (collect && np !== old && (np < old || np === 0)) G.money[p] += np === 0 ? G.B.goLand : G.B.goPass;
  G.pos[p] = np;
}

function drawCard(G, deck) {
  const order = G.deck[deck], L = order.length, B = G.B;
  for (let k = 0; k < L; k++) {
    const e = B.decks[deck][order[G.deckIdx[deck] % L]]; G.deckIdx[deck]++;
    if (e.type === 'get-pardon-card' && G.pardonHolder[deck] >= 0) continue;
    return e;
  }
  return null;
}

function card(G, p, deck) {
  const e = drawCard(G, deck); if (!e) return 0;
  const B = G.B;
  switch (e.type) {
    case 'money-event': if (e.moneyType === 'earn') G.money[p] += e.amount; else pay(G, p, e.amount, -2); return 0;
    case 'collect-from-each-player': for (let q = 0; q < G.n; q++) if (q !== p && G.alive[q]) pay(G, q, e.amount, p); return 0;
    case 'pay-each-player': for (let q = 0; q < G.n; q++) if (q !== p && G.alive[q] && G.alive[p]) pay(G, p, e.amount, q); return 0;
    case 'repairs': { let c = 0; for (let i = 0; i < B.N; i++) if (G.owner[i] === p) c += G.level[i] === 5 ? e.perHotel : G.level[i] * e.perHouse; pay(G, p, c, -2); return 0; }
    case 'go-to-prison': return 1;
    case 'get-pardon-card': G.pardonHolder[deck] = p; return 0;
    case 'move-to-block': moveTo(G, p, e.blockIndex, e.collectGo !== false); return 2;
    case 'move-steps': G.pos[p] = (G.pos[p] + e.steps + B.N) % B.N; return 2;
    case 'move-to-next-grouped': {
      const ty = e.group === 'airport' ? 2 : 3;
      for (let k = 1; k <= B.N; k++) { const j = (G.pos[p] + k) % B.N; if (B.t[j] === ty) { moveTo(G, p, j, true); break; } }
      return 2;
    }
  }
  return 0;
}

// 0 — нічого, 1 — у тюрму, 3 — відпустка
function land(G, p, dice, depth) {
  const B = G.B, i = G.pos[p], k = B.kind[i];
  if (k === 'go-to-prison') return 1;
  if (B.t[i]) {
    const o = G.owner[i];
    if (o < 0) onUnowned(G, p, i);
    else if (o !== p) pay(G, p, rentOf(G, i, dice), o);
    return 0;
  }
  if (B.taxAmt[i]) { pay(G, p, B.taxAmt[i], -2); return 0; }
  if (B.taxPct[i]) { pay(G, p, Math.floor(Math.max(0, G.money[p]) * B.taxPct[i] / 100), -2); return 0; }
  if (k === 'treasure' || k === 'surprise') {
    const r = card(G, p, k);
    if (r === 1) return 1;
    if (r === 2 && depth < 2 && G.alive[p]) return land(G, p, dice, depth + 1);
    return 0;
  }
  if (i === B.vac) { if (G.vacCash) { G.money[p] += G.pot; G.stats.pot += G.pot; G.pot = 0; } G.skip[p] = 1; return 3; }
  return 0;
}

function toJail(G, p) { G.pos[p] = G.B.prison; G.jail[p] = 0; }

function oppDanger(G, p, lvl) { for (let i = 0; i < G.B.N; i++) if (G.owner[i] >= 0 && G.owner[i] !== p && G.level[i] >= lvl) return true; return false; }

function usePardon(G, p) { for (const d of ['treasure', 'surprise']) if (G.pardonHolder[d] === p) { G.pardonHolder[d] = -1; return true; } return false; }
const hasPardon = (G, p) => G.pardonHolder.treasure === p || G.pardonHolder.surprise === p;

function jailDecision(G, p) {
  const b = G.bots[p];
  if (b.kind === 'human') {
    if (hasPardon(G, p)) return 'pardon';
    return G.money[p] > 150 && (unownedShare(G) > 0.1 || G.R() < 0.5) ? 'pay' : 'roll';
  }
  const leave = unownedShare(G) > b.jailLeaveUnowned && (!oppDanger(G, p, b.jailDangerLevel) || unownedShare(G) > b.jailFree);
  if (!leave) return 'roll';
  if (hasPardon(G, p)) return 'pardon';
  return G.money[p] > PRISON_FEE + b.jailMinCash ? 'pay' : 'roll';
}

function die(R) { return 1 + Math.floor(R() * 6); }

function turn(G, p) {
  if (G.skip[p] > 0) { G.skip[p]--; return; }
  const R = G.R;
  if (G.jail[p] >= 0) {
    const d = jailDecision(G, p);
    if (d === 'pardon') { usePardon(G, p); G.jail[p] = -1; }
    else if (d === 'pay') { pay(G, p, PRISON_FEE, -2); G.jail[p] = -1; if (!G.alive[p]) return; }
    else {
      const a = die(R), c = die(R);
      if (a === c || G.jail[p] >= 2) {
        if (a !== c) { pay(G, p, PRISON_FEE, -2); if (!G.alive[p]) return; }
        G.jail[p] = -1;
        moveTo(G, p, (G.pos[p] + a + c) % G.B.N, true);
        if (land(G, p, a + c, 0) === 1) toJail(G, p);
        endTurn(G, p);
        return;
      }
      G.jail[p]++; endTurn(G, p); return;
    }
  }
  let rolls = 0;
  while (G.alive[p]) {
    const a = die(R), c = die(R), dbl = a === c; rolls++;
    if (dbl && rolls === 3) { toJail(G, p); break; }
    moveTo(G, p, (G.pos[p] + a + c) % G.B.N, true);
    const r = land(G, p, a + c, 0);
    if (r === 1) { toJail(G, p); break; }
    if (r === 3 || !dbl) break;
  }
  endTurn(G, p);
}

function endTurn(G, p) {
  if (!G.alive[p]) return;
  tradePhase(G, p);
  buildPhase(G, p);
}

export function netWorth(G, p) {
  const B = G.B; let v = G.money[p];
  for (let i = 0; i < B.N; i++) if (G.owner[i] === p) v += G.mort[i] ? B.price[i] / 2 : B.price[i] + G.level[i] * B.house[i];
  return v;
}

/** Зіграти партію. bots — масив політик (params-об'єкти з kind:'smart' або HUMAN). Повертає { winner, rounds, timeout, stats } */
export function playGame(bots, opts, seed) {
  const G = newGame(bots, opts, seed), n = G.n, maxRounds = opts.maxRounds || 250;
  let p = 0;
  for (G.round = 0; G.round < maxRounds; G.round++) {
    for (let k = 0; k < n; k++) {
      if (G.alive[p]) turn(G, p);
      p = (p + 1) % n;
      if (G.nAlive <= 1) {
        let w = -1; for (let q = 0; q < n; q++) if (G.alive[q]) w = q;
        return { winner: w, rounds: G.round + 1, timeout: false, G };
      }
    }
    for (const g of G.B.cityGroups) {
      if (G.setFirst[g] >= 0) continue;
      const o = G.owner[G.B.members[g][0]];
      if (o >= 0 && ownsSet(G, g, o)) { G.setFirst[g] = o; if (G.stats.firstSet < 0) { G.stats.firstSet = o; G.stats.firstSetG = g; G.stats.firstSetRound = G.round; } }
    }
  }
  let best = -1, bw = -Infinity;
  for (let q = 0; q < n; q++) if (G.alive[q]) { const w = netWorth(G, q); if (w > bw) { bw = w; best = q; } }
  return { winner: best, rounds: maxRounds, timeout: true, G };
}

export const _internal = { valueOf, portfolio, reserveFor, rentOf, ownsSet, groupT };
