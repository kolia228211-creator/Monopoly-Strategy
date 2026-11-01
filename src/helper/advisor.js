// "Мозок" помічника: оцінка ділянок, купівля, аукціон, обміни, будівництво, борги, тюрма.
// Формули узгоджені з математичним звітом (sim/): T_g, buyerMaxPay, sellerAsk, обмін 1↔1.
import {
  rentAt, rentFor, isBuyable, groupKey, groupIndices, setOwner, inPrison, alivePlayers, currentPlayer,
  canUpgrade, canDowngrade, canMortgage, assetValue, liquidationValue, groupName, PRISON_FEE, tradeFairnessOk, prisonIndex
} from './rules.js';
import { boardProbs, DICE } from './probability.js';
import { nextRoll, deckInfo, cardKind, cardText } from './roll.js';
import { paramsFor, TUNED } from './params.js';

export const HORIZON = 25;   // за замовчуванням; фактичне значення — params.H (self-play)
const PR = (s) => paramsFor(s);

export function stage(s) {
  let u = 0, t = 0;
  s.blocks.forEach((b) => { if (isBuyable(b)) { t++; if (!b.ownerId) u++; } });
  const share = t ? u / t : 0;
  const pr = PR(s);
  return { unownedShare: share, mult: share > 0.6 ? pr.stageEarly : share > 0.25 ? 1 : pr.stageLate, name: share > 0.6 ? 'рання' : share > 0.25 ? 'середина' : 'пізня' };
}

const nOpp = (s) => Math.max(1, (s.phase === 'lobby' ? Math.max(alivePlayers(s).length, s.settings?.maxPlayers || 4) : alivePlayers(s).length) - 1);

// Дохід набору за один хід ОДНОГО суперника при рівні L на всіх містах
export function groupIncome(s, key, L, P = boardProbs(s).leave) {
  const dbl = !!s.settings?.payDoubleRentWhenOwnFullSet;
  return groupIndices(s, key).reduce((a, i) => a + P[i] * rentAt(s.blocks[i], L) * (L === 0 && dbl ? 2 : 1), 0);
}
export function groupT(s, key, P) {
  const idx = groupIndices(s, key), hp = s.blocks[idx[0]]?.housePrice || 0;
  return nOpp(s) * PR(s).H * groupIncome(s, key, 3, P) - 3 * hp * idx.length;
}

// Цінність ділянки i для гравця pid (у $)
export function valueOf(s, i, pid, P = boardProbs(s).leave) {
  const b = s.blocks[i]; if (!isBuyable(b)) return 0;
  const st = stage(s); let v = b.price * st.mult; const why = [];
  if (b.type === 'city') {
    const g = groupIndices(s, b.countryId), others = g.filter((j) => j !== i);
    const mine = others.filter((j) => s.blocks[j].ownerId === pid).length;
    const T = Math.max(0, groupT(s, b.countryId, P));
    const pr = PR(s);
    if (mine === others.length) { v += pr.complete * T; why.push('завершує твій набір ' + groupName(b.countryId)); }
    else if (mine > 0 && others.every((j) => !s.blocks[j].ownerId || s.blocks[j].ownerId === pid)) { v += pr.step * T * (mine + 1) / g.length; why.push('крок до набору ' + groupName(b.countryId)); }
    const opp = others.map((j) => s.blocks[j].ownerId);
    if (opp.length && opp.every((o) => o && o !== pid && o === opp[0])) {
      v += pr.block * pr.H * groupIncome(s, b.countryId, 3, P); why.push('блокує набір суперника');
    }
  } else if (b.type === 'airport' || b.type === 'company') {
    const k = s.blocks.filter((x, j) => j !== i && x.type === b.type && x.ownerId === pid).length;
    const pAvg = s.blocks.reduce((a, x, j) => a + (x.type === b.type ? P[j] : 0), 0) / Math.max(1, s.blocks.filter((x) => x.type === b.type).length);
    const r = (n) => b.type === 'airport' ? ((Array.isArray(b.rentPrices) ? b.rentPrices : [25, 50, 100, 200])[n - 1] || 0) * n : (n >= 2 ? 10 : n === 1 ? 4 : 0) * 7 * n;
    v += PR(s).air * nOpp(s) * PR(s).H * pAvg * (r(k + 1) - r(k));
    if (k > 0) why.push(`${k + 1}-й ${b.type === 'airport' ? 'аеропорт' : 'компанія'}`);
  }
  return { value: Math.round(v), why };
}

// Прогноз наступного кидка (START, податки, картки з підрахунком, дублі) => безпечний запас
export function danger(s, pid) {
  const r = nextRoll(s, pid);
  return r || { net: 0, expected: 0, q85: 0, worst: 0, worstName: '', reserve: 50, pBuy: 0, pJail: 0 };
}

// Шанс, що наступна витягнута картка відправить гравця на клітинку i
export function cardPullTo(s, i) {
  const out = [];
  for (const deck of ['treasure', 'surprise']) {
    const d = deckInfo(s, deck); if (!d) continue;
    let p = 0;
    for (const { card, p: q } of d.next) {
      const e = card.effect;
      if (e?.type === 'move-to-block' && e.blockIndex === i) p += q;
      if (e?.type === 'move-to-next-grouped' && s.blocks[i] && s.blocks[i].type === (e.group === 'airport' ? 'airport' : 'company')) p += q / Math.max(1, s.blocks.filter((b) => b.type === s.blocks[i].type).length);
    }
    if (p > 0) out.push({ deck, p, known: d.known });
  }
  return out;
}

function mortgageCapacity(s, pid, exceptIdx = -1) {
  // гроші з застави ділянок, які НЕ входять у твої повні набори
  let v = 0;
  s.blocks.forEach((b, i) => {
    if (i === exceptIdx || !canMortgage(s, i, pid)) return;
    if (b.type === 'city' && setOwner(s, b.countryId) === pid) return;
    v += b.price / 2;
  });
  return v;
}

export function buyAdvice(s, pid, i, P, profileOf = null) {
  const me = s.participants.find((p) => p.id === pid), b = s.blocks[i];
  const { value, why } = valueOf(s, i, pid, P), dz = danger(s, pid);
  const pr = PR(s), after = me.money - b.price, cap = mortgageCapacity(s, pid);
  const reserve = Math.max(dz.reserve, Math.round(pr.resBase + pr.resLate * (1 - stage(s).unownedShare)));
  dz.reserve = reserve;
  const maxBid = Math.max(0, Math.round(Math.min(value * pr.aucMult, me.money - Math.min(reserve, pr.aucKeep + 40))));
  let verdict, text;
  if (me.money < b.price) {
    // Купити неможливо: у richup лишається тільки «Завершити хід» (ділянка піде на аукціон)
    const bid = Math.max(0, Math.min(maxBid, me.money - 10));
    verdict = 'cant';
    text = `Не вистачає $${b.price - Math.max(0, me.money)}: заверши хід` + (bid >= 10 ? `, на аукціоні став до $${bid}` : '');
    const reasons = [...why, `цінність для тебе ≈ $${value} (ціна $${b.price}), у тебе $${me.money}`];
    if (cap > 0 && me.money + cap >= b.price && value >= b.price * 1.3) reasons.push(`ділянка цінна: наступного разу варто мати запас або закласти щось непотрібне заздалегідь`);
    return { idx: i, name: b.name, price: b.price, value, verdict, text, maxBid: bid, reasons, affordable: false };
  }
  if (after >= dz.reserve && value >= b.price * pr.buyMin) { verdict = 'buy'; text = `КУПУЙ за $${b.price}`; }
  else if (after >= 0 && after + cap >= dz.reserve && value >= b.price * Math.max(1.15, pr.buyMin + 0.3)) { verdict = 'buy'; text = `КУПУЙ (за потреби заклади непотрібне)`; }
  else if (after >= 0 && value >= b.price * 1.3 && stage(s).unownedShare > 0.4) { verdict = 'buy'; text = `КУПУЙ, ризиковано: запас буде $${after}`; }
  else { verdict = 'auction'; text = `Аукціон: став до $${maxBid}`; }
  const reasons = [...why];
  reasons.push(`цінність для тебе ≈ $${value} (ціна $${b.price}, ${stage(s).name} гра)`);
  reasons.push(`після покупки: $${after}, безпечний запас $${dz.reserve}`);
  for (const c of cardPullTo(s, i)) reasons.push(`${c.known ? 'наступна' : 'шанс ' + Math.round(c.p * 100) + '%, що наступна'} картка ${c.deck === 'treasure' ? 'Treasure' : 'Surprise'} відправить гравця сюди`);
  if (profileOf) {
    const meds = alivePlayers(s).filter((p) => p.id !== pid).map(profileOf).filter((x) => x && x.auctionN >= 3 && x.auctionMed);
    if (meds.length) {
      const top = Math.max(...meds.map((x) => x.auctionMed));
      if (top < 0.85 && verdict === 'buy') reasons.push(`суперники на аукціонах зазвичай дають до ×${top.toFixed(2)} ціни: аукціон може бути дешевшим, але ризикуєш віддати`);
      if (top > 1.15 && verdict === 'auction') reasons.push(`суперники зазвичай переплачують на аукціонах (×${top.toFixed(2)}): не бійся віддати, хай платять більше`);
    }
  }
  return { idx: i, name: b.name, price: b.price, value, verdict, text, maxBid, reasons, affordable: true };
}

export function auctionAdvice(s, pid, P, profileOf = null) {
  const a = s.auction; if (!a || a.state === 'ended') return null;
  const i = a.blockIndex, b = s.blocks[i];
  const me = s.participants.find((p) => p.id === pid);
  const est = alivePlayers(s).map((p) => {
    const { value } = valueOf(s, i, p.id, P);
    const prm = PR(s);
    let max = p.id === pid ? Math.min(value * prm.aucMult, p.money - prm.aucKeep) : Math.min(value, p.money - 40), learned = null;
    const pr = p.id !== pid && profileOf ? profileOf(p) : null;
    if (pr && pr.auctionN >= 2 && pr.auctionP75) {
      const need = b.type === 'city' && groupIndices(s, b.countryId).filter((j) => j !== i).every((j) => s.blocks[j].ownerId === p.id);
      learned = Math.round(b.price * pr.auctionP75 * (need ? 1.3 : 1));
      const w = pr.auctionN >= 6 ? 0.75 : 0.5;
      max = Math.min(p.money, Math.round(w * learned + (1 - w) * max));
    }
    return { id: p.id, name: p.name, max: Math.max(0, Math.round(max)), isMe: p.id === pid, learned, n: pr ? pr.auctionN : 0 };
  }).sort((x, y) => y.max - x.max);
  const mine = est.find((e) => e.isMe);
  const myMax = mine ? mine.max : 0;
  const leaderIsMe = a.currentBidderId === pid;
  const cur = a.currentBid || 0;
  let verdict, text;
  if (!me) { verdict = 'watch'; text = 'Ти не береш участі'; }
  else if (leaderIsMe) { verdict = 'hold'; text = `Ти лідер ($${cur}). Чекай`; }
  else if (cur + 2 <= myMax) { verdict = 'bid'; text = `Став! Твій максимум $${myMax}`; }
  else { verdict = 'pass'; text = `Пас: дорожче $${myMax} не вигідно`; }
  // Якщо суперникові ділянка потрібніша — підняти йому ціну, не ризикуючи виграти
  const top = est.find((e) => !e.isMe);
  const pushTip = me && top && top.max > myMax && cur + 12 < Math.min(top.max, myMax + 40)
    ? `${top.name} цінує її до ~$${top.max}: можна піднімати ціну до ~$${Math.min(myMax + 30, top.max - 10)}, але це ризик купити самому` : null;
  return { idx: i, name: b.name, price: b.price, current: cur, myMax, verdict, text, est, pushTip };
}

// Застосувати обмін до копії стану
export function applyTrade(s, t) {
  const c = JSON.parse(JSON.stringify({ ...s, stats: undefined, turnClock: undefined }));
  const pa = c.participants.find((p) => p.id === t.initiatorId), pb = c.participants.find((p) => p.id === t.recipientId);
  if (!pa || !pb) return c;
  const io = t.initiatorOffer || {}, ro = t.recipientOffer || {};
  pa.money += (ro.money || 0) - (io.money || 0); pb.money += (io.money || 0) - (ro.money || 0);
  (io.propertyIndices || []).forEach((i) => { if (c.blocks[i]) c.blocks[i].ownerId = pb.id; });
  (ro.propertyIndices || []).forEach((i) => { if (c.blocks[i]) c.blocks[i].ownerId = pa.id; });
  for (const d of ['treasure', 'surprise']) {
    const bc = c.bonusCards?.[d]; if (!bc) continue;
    if ((io.pardonCards || []).includes(d) && bc.pardonCardHolderId === pa.id) bc.pardonCardHolderId = pb.id;
    else if ((ro.pardonCards || []).includes(d) && bc.pardonCardHolderId === pb.id) bc.pardonCardHolderId = pa.id;
  }
  return c;
}

// "Портфель": гроші + ділянки + потенціал повних наборів
export function portfolio(s, pid, P) {
  const p = s.participants.find((x) => x.id === pid); if (!p) return 0;
  let v = p.money;
  const seen = new Set();
  s.blocks.forEach((b, i) => {
    if (b.ownerId !== pid) return;
    v += b.isMortgaged ? b.price / 2 : b.price + (b.level || 0) * (b.housePrice || 0);
    if (b.type === 'city' && !seen.has(b.countryId)) {
      seen.add(b.countryId);
      const g = groupIndices(s, b.countryId), k = g.filter((j) => s.blocks[j].ownerId === pid).length;
      const T = Math.max(0, groupT(s, b.countryId, P));
      if (k === g.length) v += 0.5 * T;
      else if (g.every((j) => !s.blocks[j].ownerId || s.blocks[j].ownerId === pid)) v += 0.1 * T * k / g.length;
    }
    if (b.type === 'airport' || b.type === 'company') v += valueOf(s, i, pid, P).value - b.price * stage(s).mult;
  });
  return v;
}

export function describeOffer(s, o) {
  const parts = [];
  (o.propertyIndices || []).forEach((i) => parts.push(s.blocks[i]?.name || '#' + i));
  if (o.money) parts.push('$' + o.money);
  (o.pardonCards || []).forEach(() => parts.push('Pardon'));
  return parts.length ? parts.join(' + ') : 'нічого';
}

export function tradeAdvice(s, pid, t, P, profileOf = null) {
  const after = applyTrade(s, t);
  const other = t.initiatorId === pid ? t.recipientId : t.recipientId === pid ? t.initiatorId : null;
  const name = (id) => s.participants.find((p) => p.id === id)?.name || '?';
  const role = t.recipientId === pid ? 'incoming' : t.initiatorId === pid ? 'outgoing' : 'others';
  const res = { id: t.id, role, from: name(t.initiatorId), to: name(t.recipientId),
    give: describeOffer(s, t.initiatorOffer || {}), get: describeOffer(s, t.recipientOffer || {}) };
  if (role === 'others') {
    const dA = portfolio(after, t.initiatorId, P) - portfolio(s, t.initiatorId, P);
    const dB = portfolio(after, t.recipientId, P) - portfolio(s, t.recipientId, P);
    res.text = dA > dB + 50 ? `Вигідніше для ${res.from}` : dB > dA + 50 ? `Вигідніше для ${res.to}` : 'Приблизно рівний обмін';
    res.danger = Math.max(dA, dB) > 600;
    return res;
  }
  const dMe = portfolio(after, pid, P) - portfolio(s, pid, P);
  const dOther = portfolio(after, other, P) - portfolio(s, other, P);
  const prT = PR(s), score = dMe - prT.deny * dOther;
  const myOffer = role === 'incoming' ? t.recipientOffer || {} : t.initiatorOffer || {};
  const theirOffer = role === 'incoming' ? t.initiatorOffer || {} : t.recipientOffer || {};
  res.score = Math.round(score); res.dMe = Math.round(dMe); res.dOther = Math.round(dOther);
  res.verdict = score > prT.acceptMargin ? 'accept' : score > -Math.abs(prT.acceptMargin) ? 'neutral' : 'reject';
  // Максимальна доплата з мого боку, при якій обмін ще вигідний
  res.maxExtraPay = Math.max(0, Math.round((myOffer.money || 0) + score / 1.6));
  // Якщо я віддаю ділянку, що завершує набір суперника, — нижня межа як у попередженні (ціна + 0.6·T)
  let floor = 0;
  for (const i of myOffer.propertyIndices || []) {
    const b = s.blocks[i];
    if (b?.type === 'city' && setOwner(after, b.countryId) === other) floor += b.price + prT.deny * Math.max(0, groupT(s, b.countryId, P));
  }
  // обмін, де я теж збираю набір: правило floor можна вимкнути (floorInSwap = 0)
  const iGetSet = (theirOffer.propertyIndices || []).some((i) => s.blocks[i]?.type === 'city' && setOwner(after, s.blocks[i].countryId) === pid && setOwner(s, s.blocks[i].countryId) !== pid);
  if (floor && !(iGetSet && prT.floorInSwap < 0.5) && (theirOffer.money || 0) < floor) { res.verdict = 'reject'; }
  res.minAskIfReject = res.verdict === 'reject' ? Math.round(Math.max(floor, (theirOffer.money || 0) - score / 1.6)) : null;
  res.fairOk = tradeFairnessOk(s, pid, myOffer, theirOffer);
  if (role === 'outgoing' && profileOf) {
    const op = s.participants.find((p) => p.id === other), pr = op ? profileOf(op) : null;
    if (pr && pr.tradeN >= 2) {
      res.acceptHint = pr.minAcceptGain != null && res.dOther >= pr.minAcceptGain
        ? `${op.name} раніше погоджувався на схожі (${pr.tradeAcc}/${pr.tradeN})` : `${op.name} зазвичай хоче більше: приймав від +$${pr.minAcceptGain ?? '?'} вигоди (${pr.tradeAcc}/${pr.tradeN})`;
    }
  }
  res.text = res.verdict === 'accept' ? 'ПРИЙМАЙ' : res.verdict === 'neutral' ? 'Майже рівно, дивись на % перемоги' : 'ВІДХИЛЯЙ';
  res.after = after;
  return res;
}

// Ідеї обмінів: докупити останню ділянку набору / обмін 1↔1
export function tradeIdeas(s, pid, P, profileOf = null) {
  const ideas = [], groups = [...new Set(s.blocks.filter((b) => b.type === 'city').map((b) => b.countryId))];
  const me = s.participants.find((p) => p.id === pid); if (!me) return ideas;
  const needs = []; // [group, missingIdx, ownerId]
  for (const g of groups) {
    const idx = groupIndices(s, g);
    if (idx.some((i) => s.blocks[i].level > 0)) continue;
    const mine = idx.filter((i) => s.blocks[i].ownerId === pid);
    const miss = idx.filter((i) => s.blocks[i].ownerId !== pid);
    if (mine.length && miss.length === 1 && s.blocks[miss[0]].ownerId) needs.push([g, miss[0], s.blocks[miss[0]].ownerId]);
  }
  for (const [g, j, q] of needs) {
    const b = s.blocks[j], T = Math.max(0, groupT(s, g, P)), I3 = groupIncome(s, g, 3, P);
    const prI = PR(s), buyerMax = Math.round(b.price + prI.buyShare * T), sellerAsk = Math.round(1.5 * b.price + prI.H * I3 * 0.5);
    const qn = s.participants.find((p) => p.id === q)?.name || '?';
    // після покупки мають лишитися гроші хоча б на 1 будинок на кожну ділянку набору
    const n = groupIndices(s, g).length, buildCash = b.housePrice * n * Math.max(0.5, prI.buildCashLots);
    const cap = Math.min(buyerMax, me.money - Math.max(100, buildCash));
    const open = Math.round(b.price * prI.openMult / 10) * 10;
    const pr = profileOf ? profileOf(s.participants.find((p) => p.id === q) || {}) : null;
    const habit = pr && pr.tradeN >= 2 ? ` (${qn} прийняв ${pr.tradeAcc} з ${pr.tradeN} обмінів)` : '';
    if (cap >= open) ideas.push({ kind: 'buy', text: `Купи ${b.name} у ${qn}: почни з ~$${open}, стеля $${cap} (лишиться на будинки). Для нього чесна ціна ~$${sellerAsk}${habit}`, group: g, gain: T });
    else ideas.push({ kind: 'buy-hard', text: `${b.name} (у ${qn}) завершить ${groupName(g)}, варта до $${buyerMax}. Зараз грошей замало: краще обмін ділянками`, group: g, gain: T });
  }
  // Обмін 1↔1: у суперника бракує моєї ділянки, а в мене його
  for (const [g, j, q] of needs) {
    for (const g2 of groups) {
      if (g2 === g) continue;
      const idx2 = groupIndices(s, g2);
      if (idx2.some((i) => s.blocks[i].level > 0)) continue;
      const theirs = idx2.filter((i) => s.blocks[i].ownerId === q), mineThere = idx2.filter((i) => s.blocks[i].ownerId === pid);
      if (theirs.length === idx2.length - 1 && mineThere.length === 1) {
        const bal = Math.round(0.5 * PR(s).swapPay * (groupT(s, g, P) - groupT(s, g2, P)));
        const qp = s.participants.find((p) => p.id === q), qn = qp?.name || '?';
        let tail = ', без доплати';
        if (bal > 20) { const c = Math.max(0, Math.min(bal, me.money - 100)); tail = `, ти доплачуєш до $${c}` + (c < bal ? ' (більше не варто: потрібні гроші на будинки)' : ''); }
        else if (bal < -20) { const c = Math.max(0, Math.min(-bal, qp ? qp.money : 0)); tail = c < -bal ? `, він доплачує все, що може (~$${c} з $${-bal} чесних) або додає ділянку` : `, він доплачує тобі $${c}`; }
        ideas.push({ kind: 'swap', text: `Обмін з ${qn}: твоя ${s.blocks[mineThere[0]].name} ↔ його ${s.blocks[j].name}` + tail, group: g, gain: groupT(s, g, P) });
      }
    }
  }
  // Попередження: суперникові бракує МОЄЇ ділянки
  for (const g of groups) {
    const idx = groupIndices(s, g); const mineI = idx.filter((i) => s.blocks[i].ownerId === pid);
    if (mineI.length !== 1) continue;
    const others = idx.filter((i) => i !== mineI[0]); const o = s.blocks[others[0]].ownerId;
    if (o && o !== pid && others.every((i) => s.blocks[i].ownerId === o)) {
      const on = s.participants.find((p) => p.id === o)?.name || '?';
      const T = Math.max(0, groupT(s, g, P));
      ideas.push({ kind: 'warn', text: `${on} чекає на твою ${s.blocks[mineI[0]].name} (${groupName(g)}). Не віддавай дешевше ~$${Math.round(s.blocks[mineI[0]].price + PR(s).deny * T)}`, group: g, gain: -T });
    }
  }
  return ideas.sort((a, b) => b.gain - a.gain).slice(0, 6);
}

export function buildPlan(s, pid, P, budgetOverride) {
  const me = s.participants.find((p) => p.id === pid); if (!me) return { steps: [], budget: 0 };
  const dz = danger(s, pid), opp = nOpp(s);
  const prB = PR(s), round = Math.floor((s.stats?.turnsCount || 0) / Math.max(1, alivePlayers(s).length));
  const bReserve = Math.max(dz.reserve, Math.round(prB.bRes + prB.bResGrow * round));
  let budget = budgetOverride ?? (me.money - bReserve);
  // self-play (mortForBuild): закласти ділянки поза наборами, щоб будувати швидше
  const hasSet = s.blocks.some((b, i) => b.type === 'city' && b.ownerId === pid && setOwner(s, b.countryId) === pid && canUpgrade(s, i, pid));
  const mortCash = budgetOverride == null && prB.mortForBuild >= 0.5 && hasSet ? Math.round(mortgageCapacity(s, pid)) : 0;
  const cash0 = budget; budget += mortCash;
  const c = JSON.parse(JSON.stringify({ blocks: s.blocks, settings: s.settings, participants: s.participants, boardConfig: s.boardConfig }));
  const steps = [];
  const unm = [];
  s.blocks.forEach((b, i) => {
    if (b.ownerId === pid && b.isMortgaged && b.type === 'city' && groupIndices(s, b.countryId).every((j) => s.blocks[j].ownerId === pid)) unm.push(i);
  });
  for (let guard = 0; guard < 30 && budget > 0; guard++) {
    let best = -1, bestRoi = 0;
    c.blocks.forEach((b, i) => {
      if (!canUpgrade(c, i, pid) || b.housePrice > budget || (b.level || 0) >= Math.round(prB.maxLevel)) return;
      const L = b.level || 0, dbl = !!c.settings?.payDoubleRentWhenOwnFullSet && L === 0 ? 2 : 1;
      const roi = P[i] * (rentAt(b, L + 1) - rentAt(b, L) * dbl) / b.housePrice;
      if (roi > bestRoi) { bestRoi = roi; best = i; }
    });
    if (best < 0) break;
    const b = c.blocks[best], L = b.level || 0, dbl = !!c.settings?.payDoubleRentWhenOwnFullSet && L === 0 ? 2 : 1;
    const gain = P[best] * (rentAt(b, L + 1) - rentAt(b, L) * dbl) * opp;
    steps.push({ idx: best, name: b.name, from: L, to: L + 1, cost: b.housePrice, gainPerRound: Math.round(gain), payback: gain > 0 ? Math.ceil(b.housePrice / gain) : null });
    b.level = L + 1; budget -= b.housePrice;
  }
  // Підсумок по наборах: скільки коштує довести до 3 будинків і що це дасть
  const sets = [];
  for (const g of [...new Set(s.blocks.filter((b) => b.type === 'city').map((b) => b.countryId))]) {
    if (setOwner(s, g) !== pid) continue;
    const idx = groupIndices(s, g), dbl = !!s.settings?.payDoubleRentWhenOwnFullSet;
    let cost = 0, gain = 0;
    for (const i of idx) {
      const b = s.blocks[i], L = b.level || 0;
      if (L >= 3) continue;
      cost += (3 - L) * b.housePrice;
      gain += P[i] * (rentAt(b, 3) - rentAt(b, L) * (L === 0 && dbl ? 2 : 1)) * opp;
    }
    if (cost > 0) sets.push({ name: groupName(g), cost, gainPerRound: Math.round(gain), payback: gain > 0 ? Math.ceil(cost / gain) : null });
  }
  const spent = steps.reduce((x, st) => x + st.cost, 0);
  const mortgageFor = mortCash && spent > Math.max(0, cash0) ? Math.round(spent - Math.max(0, cash0)) : 0;
  return { steps, sets, budget: Math.max(0, me.money - bReserve), reserve: bReserve, maxLevel: Math.round(prB.maxLevel), mortgagedInSets: unm.map((i) => s.blocks[i].name), mortgageFor };
}

export function debtPlan(s, pid, P) {
  const me = s.participants.find((p) => p.id === pid); if (!me || me.money >= 0) return null;
  const c = JSON.parse(JSON.stringify({ blocks: s.blocks, settings: s.settings, participants: s.participants }));
  let money = me.money; const steps = [];
  for (let guard = 0; guard < 80 && money < 0; guard++) {
    let best = null;
    c.blocks.forEach((b, i) => {
      if (canDowngrade(c, i, pid)) {
        const L = b.level, loss = P[i] * (rentAt(b, L) - rentAt(b, L - 1)) / (b.housePrice / 2);
        if (!best || loss < best.loss) best = { i, kind: 'sell', loss, amount: b.housePrice / 2 };
      } else if (canMortgage(c, i, pid)) {
        const loss = P[i] * (rentFor(c, i, 7) || rentAt(b, 0) || 25) * 2 / (b.price / 2);
        if (!best || loss < best.loss) best = { i, kind: 'mortgage', loss, amount: b.price / 2 };
      }
    });
    if (!best) break;
    const b = c.blocks[best.i];
    if (best.kind === 'sell') b.level--; else b.isMortgaged = true;
    money += best.amount;
    steps.push({ idx: best.i, name: b.name, kind: best.kind, amount: Math.round(best.amount) });
  }
  return { steps, enough: money >= 0, short: Math.round(-me.money), liquidation: Math.round(liquidationValue(s, pid)) };
}

export function jailAdvice(s, pid) {
  if (!inPrison(s, pid)) return null;
  const st = stage(s);
  const oppDanger = s.blocks.some((b) => b.ownerId && b.ownerId !== pid && (b.level || 0) >= PR(s).jailDanger);
  const hasPardon = ['treasure', 'surprise'].some((d) => s.bonusCards?.[d]?.pardonCardHolderId === pid);
  const me = s.participants.find((p) => p.id === pid);
  const leave = st.unownedShare > PR(s).jailU && !oppDanger;
  if (leave) return { verdict: hasPardon ? 'pardon' : 'pay', text: hasPardon ? 'Використай Pardon і виходь' : `Плати $${PRISON_FEE} і виходь: ще є що купувати`, reasons: [`вільних ділянок ${Math.round(st.unownedShare * 100)}% (поріг ${Math.round(PR(s).jailU * 100)}%)`] };
  return { verdict: 'stay', text: 'Сиди й кидай на дубль: у тюрмі безпечніше', reasons: [oppDanger ? 'у суперників є будинки' : 'майже все розкуплено', me && me.money < 200 ? 'мало грошей' : ''].filter(Boolean) };
}

export function playersSummary(s, pid) {
  const cur = currentPlayer(s);
  return s.participants.map((p) => ({
    id: p.id, name: p.name, money: p.money, color: p.appearance, isBot: p.isBot, alive: !p.bankruptedAt,
    net: Math.round(p.money + assetValue(s, p.id)), liq: Math.round(p.money + liquidationValue(s, p.id)),
    isMe: p.id === pid, isCurrent: cur && cur.id === p.id, inPrison: inPrison(s, p.id),
    sets: [...new Set(s.blocks.filter((b) => b.type === 'city' && b.ownerId === p.id).map((b) => b.countryId))].filter((g) => setOwner(s, g) === p.id).map(groupName)
  }));
}

export function groupTable(s, P) {
  const groups = [...new Set(s.blocks.filter((b) => b.type === 'city').map((b) => b.countryId))];
  return groups.map((g) => {
    const idx = groupIndices(s, g), hp = s.blocks[idx[0]].housePrice;
    const I3 = groupIncome(s, g, 3, P), cost = idx.reduce((a, i) => a + s.blocks[i].price, 0) + 3 * hp * idx.length;
    return { key: g, name: groupName(g), owner: setOwner(s, g), I0: groupIncome(s, g, 0, P), I3, payback3: I3 > 0 ? Math.round(cost / (I3 * nOpp(s))) : null, lots: idx.map((i) => ({ i, name: s.blocks[i].name, owner: s.blocks[i].ownerId, level: s.blocks[i].level || 0, mort: !!s.blocks[i].isMortgaged })) };
  }).sort((a, b) => (a.payback3 || 1e9) - (b.payback3 || 1e9));
}

/** Головна функція: повний аналіз для панелі. */
export function analyze(s, pid, profileOf = null) {
  const P = boardProbs(s).leave;
  const me = s.participants.find((p) => p.id === pid) || null;
  const cur = currentPlayer(s);
  const myTurn = !!(me && cur && cur.id === pid);
  const out = { phase: s.phase, myTurn, meId: me ? pid : null, players: playersSummary(s, pid), stage: stage(s), colors: colorMap(s), board: boardOwnership(s, pid) };
  const fsm = TUNED.meta && TUNED.meta.firstSet && TUNED.meta.firstSet[s.settings?.payDoubleRentWhenOwnFullSet ? 'dbl1' : 'dbl0'];
  out.firstSet = fsm ? Object.entries(fsm).filter(([k]) => k !== 'none').sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: groupName(k), p: v })) : null;
  out.tuned = !!(TUNED.meta);
  if (s.phase === 'lobby') { out.groups = groupTable(s, P); return out; }
  if (!me || me.bankruptedAt) { out.trades = (s.trades || []).filter((t) => t.status === 'pending').map((t) => tradeAdvice(s, pid, t, P, profileOf)); return out; }
  out.danger = danger(s, pid);
  out.debt = debtPlan(s, pid, P);
  out.auction = auctionAdvice(s, pid, P, profileOf);
  out.trades = (s.trades || []).filter((t) => !t.status || t.status === 'pending').map((t) => tradeAdvice(s, pid, t, P, profileOf));
  out.jail = myTurn && !s.cubesRolledInTurn ? jailAdvice(s, pid) : null;
  const here = s.blocks[me.position];
  if (myTurn && s.cubesRolledInTurn && isBuyable(here) && !here.ownerId && !out.auction) out.buy = buyAdvice(s, pid, me.position, P, profileOf);
  out.build = buildPlan(s, pid, P);
  out.ideas = tradeIdeas(s, pid, P, profileOf);
  out.threats = rivalThreats(s, pid, P);
  if (profileOf) out.rivals = s.participants.filter((p) => p.id !== pid).map((p) => ({ name: p.name, color: p.appearance, isBot: p.isBot, ...(profileOf(p) || {}) }));
  out.cards = cardsSummary(s);
  // Головна порада зараз
  if (out.debt) out.now = { kind: 'debt', title: `Борг $${out.debt.short}: продай/заклади`, tone: 'bad' };
  else if (out.auction) out.now = { kind: 'auction', title: out.auction.text, tone: out.auction.verdict === 'bid' ? 'good' : 'neutral' };
  else if (out.trades.some((t) => t.role === 'incoming')) { const t = out.trades.find((x) => x.role === 'incoming'); out.now = { kind: 'trade', title: `Обмін від ${t.from}: ${t.text}`, tone: t.verdict === 'accept' ? 'good' : t.verdict === 'reject' ? 'bad' : 'neutral' }; }
  else if (out.buy) out.now = { kind: 'buy', title: out.buy.text, tone: out.buy.verdict === 'buy' ? 'good' : out.buy.verdict === 'cant' ? 'bad' : 'neutral' };
  else if (out.jail) out.now = { kind: 'jail', title: out.jail.text, tone: 'neutral' };
  else if (myTurn && out.build.steps.length) out.now = { kind: 'build', title: `Будуй: ${out.build.steps[0].name} (${out.build.steps[0].from}→${out.build.steps[0].to})`, tone: 'good' };
  else if (myTurn) out.now = { kind: 'turn', title: s.cubesRolledInTurn ? 'Можна завершувати хід' : 'Кидай кубики', tone: 'neutral' };
  else out.now = { kind: 'wait', title: `Хід: ${cur ? cur.name : '…'}`, tone: 'neutral' };
  return out;
}

// Кольори для панелі: нік -> колір гравця, ділянка -> колір власника
export function colorMap(s) {
  const pc = {}; s.participants.forEach((p) => { pc[p.name] = p.appearance || '#999'; });
  const bc = {};
  s.blocks.forEach((b) => { if (isBuyable(b)) { const o = s.participants.find((p) => p.id === b.ownerId); bc[b.name] = o ? (o.appearance || '#999') : null; } });
  return { players: pc, blocks: bc };
}

// Мапа власності по наборах для панелі
export function boardOwnership(s, pid) {
  const rows = [], seen = new Set();
  s.blocks.forEach((b) => {
    if (!isBuyable(b)) return;
    const key = groupKey(b); if (seen.has(key)) return; seen.add(key);
    const idx = groupIndices(s, key);
    rows.push({
      key, name: key === '@airport' ? 'Аеропорти' : key === '@company' ? 'Компанії' : groupName(key), full: setOwner(s, key),
      lots: idx.map((i) => { const x = s.blocks[i], o = s.participants.find((p) => p.id === x.ownerId); return { i, name: x.name, color: o ? o.appearance : null, owner: o ? o.name : null, mine: x.ownerId === pid, level: x.level || 0, mort: !!x.isMortgaged }; })
    });
  });
  return rows;
}

// Підрахунок карток: що лишилось у колодах
export function cardsSummary(s) {
  const out = [];
  for (const deck of ['surprise', 'treasure']) {
    const d = deckInfo(s, deck); if (!d) continue;
    const kinds = { earn: 0, pay: 0, move: 0, jail: 0, pardon: 0 };
    d.next.forEach(({ card, p }) => { kinds[cardKind(card.effect)] += p; });
    const moves = [...new Set(d.next.filter(({ card }) => cardKind(card.effect) === 'move').map(({ card }) => cardText(s, card.effect)))];
    out.push({ deck, title: deck === 'treasure' ? 'Treasure' : 'Surprise', known: d.known, seen: d.seen, total: d.total, left: d.next.length,
      nextText: d.known ? (d.next[0].card.description || cardText(s, d.next[0].card.effect)) : null, nextEffect: d.known ? cardText(s, d.next[0].card.effect) : null,
      kinds, moves });
  }
  return out;
}

// Загрози: двоє суперників можуть обмінятися й обидва зібрати набори (або один продасть іншому)
export function rivalThreats(s, pid, P = boardProbs(s).leave) {
  const opps = alivePlayers(s).filter((p) => p.id !== pid);
  const groups = [...new Set(s.blocks.filter((b) => b.type === 'city').map((b) => b.countryId))];
  const need = {}; // need[a] = [{ g, lots(all owned by one holder), holder }]
  for (const a of opps) {
    need[a.id] = [];
    for (const g of groups) {
      const idx = groupIndices(s, g);
      if (idx.some((i) => s.blocks[i].level > 0)) continue;
      const mine = idx.filter((i) => s.blocks[i].ownerId === a.id), miss = idx.filter((i) => s.blocks[i].ownerId !== a.id);
      if (!mine.length || !miss.length || miss.length > 2) continue;
      const holder = s.blocks[miss[0]].ownerId;
      if (holder && holder !== pid && miss.every((i) => s.blocks[i].ownerId === holder)) need[a.id].push({ g, lots: miss, holder });
    }
  }
  const out = [], name = (id) => s.participants.find((p) => p.id === id)?.name || '?';
  const me = s.participants.find((p) => p.id === pid);
  for (let x = 0; x < opps.length; x++) for (let y = x + 1; y < opps.length; y++) {
    const a = opps[x].id, b = opps[y].id;
    const aFromB = need[a].filter((n) => n.holder === b), bFromA = need[b].filter((n) => n.holder === a);
    if (!aFromB.length && !bFromA.length) continue;
    const T = (n) => (n ? Math.max(0, groupT(s, n.g, P)) : 0);
    // найкраща пара РІЗНИХ наборів (не США ↔ США)
    let na = null, nb = null, bestSum = -1;
    for (const u of aFromB) for (const v of bFromA) {
      if (u.g === v.g) continue;
      const score = T(u) + T(v) - 1e-3 * (u.lots.length + v.lots.length); // при рівності — менше ділянок (1↔1)
      if (score > bestSum) { bestSum = score; na = u; nb = v; }
    }
    if (!na) { // обміну немає — можливий продаж одному з них
      const all = aFromB.map((n) => ['a', n]).concat(bFromA.map((n) => ['b', n])).sort((u, v) => T(v[1]) - T(u[1]));
      if (!all.length) continue;
      if (all[0][0] === 'a') na = all[0][1]; else nb = all[0][1];
    }
    const ta = T(na), tb = T(nb);
    const kind = na && nb ? 'swap' : 'sale';
    const lotsName = (l) => l.map((i) => s.blocks[i].name).join(' + ');
    let text;
    if (kind === 'swap') text = `${name(a)} і ${name(b)} можуть обмінятися: ${lotsName(nb.lots)} ↔ ${lotsName(na.lots)}. Тоді ${name(a)} збере ${groupName(na.g)}, а ${name(b)} збере ${groupName(nb.g)}`;
    else { const n = na || nb, buyer = na ? a : b, seller = na ? b : a; text = `${name(seller)} може продати ${name(buyer)} ${lotsName(n.lots)}, і той збере ${groupName(n.g)}`; }
    // Як перебити: купити ключову ділянку в того, кому вона потрібна менше (вартість блокування)
    const key = kind === 'swap' ? (ta >= tb ? na : nb) : (na || nb);
    const keyHolder = key.holder, lot = key.lots[0], lb = s.blocks[lot];
    const block = Math.round(lb.price + PR(s).block * PR(s).H * groupIncome(s, key.g, 3, P) / key.lots.length);
    const cap = me ? Math.max(0, Math.min(block, me.money - Math.max(100, danger(s, pid).reserve))) : 0;
    const counter = cap >= lb.price ? `Перебий: запропонуй ${name(keyHolder)} за ${lb.name} до $${cap}, щоб зламати ${groupName(key.g)}` : `Грошей на перехоплення ${lb.name} замало: тримай запас і не продавай їм ключових ділянок`;
    out.push({ a, b, kind, text, counter, gain: ta + tb,
      transfer: kind === 'swap' ? { toA: na.lots, toB: nb.lots } : (na ? { toA: na.lots, toB: [] } : { toA: [], toB: nb.lots }) });
  }
  return out.sort((u, v) => v.gain - u.gain).slice(0, 2);
}
