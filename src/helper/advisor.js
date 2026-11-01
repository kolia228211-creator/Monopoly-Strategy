// "Мозок" помічника: оцінка ділянок, купівля, аукціон, обміни, будівництво, борги, тюрма.
// Формули узгоджені з математичним звітом (sim/): T_g, buyerMaxPay, sellerAsk, обмін 1↔1.
import {
  rentAt, rentFor, isBuyable, groupKey, groupIndices, setOwner, inPrison, alivePlayers, currentPlayer,
  canUpgrade, canDowngrade, canMortgage, assetValue, liquidationValue, groupName, PRISON_FEE, tradeFairnessOk, prisonIndex
} from './rules.js';
import { boardProbs, DICE } from './probability.js';

export const HORIZON = 25;   // скільки ходів кожного суперника враховуємо для окупності

export function stage(s) {
  let u = 0, t = 0;
  s.blocks.forEach((b) => { if (isBuyable(b)) { t++; if (!b.ownerId) u++; } });
  const share = t ? u / t : 0;
  return { unownedShare: share, mult: share > 0.6 ? 1.15 : share > 0.25 ? 1 : 0.8, name: share > 0.6 ? 'рання' : share > 0.25 ? 'середина' : 'пізня' };
}

const nOpp = (s) => Math.max(1, (s.phase === 'lobby' ? Math.max(alivePlayers(s).length, s.settings?.maxPlayers || 4) : alivePlayers(s).length) - 1);

// Дохід набору за один хід ОДНОГО суперника при рівні L на всіх містах
export function groupIncome(s, key, L, P = boardProbs(s).leave) {
  const dbl = !!s.settings?.payDoubleRentWhenOwnFullSet;
  return groupIndices(s, key).reduce((a, i) => a + P[i] * rentAt(s.blocks[i], L) * (L === 0 && dbl ? 2 : 1), 0);
}
export function groupT(s, key, P) {
  const idx = groupIndices(s, key), hp = s.blocks[idx[0]]?.housePrice || 0;
  return nOpp(s) * HORIZON * groupIncome(s, key, 3, P) - 3 * hp * idx.length;
}

// Цінність ділянки i для гравця pid (у $)
export function valueOf(s, i, pid, P = boardProbs(s).leave) {
  const b = s.blocks[i]; if (!isBuyable(b)) return 0;
  const st = stage(s); let v = b.price * st.mult; const why = [];
  if (b.type === 'city') {
    const g = groupIndices(s, b.countryId), others = g.filter((j) => j !== i);
    const mine = others.filter((j) => s.blocks[j].ownerId === pid).length;
    const T = Math.max(0, groupT(s, b.countryId, P));
    if (mine === others.length) { v += 0.5 * T; why.push('завершує твій набір ' + groupName(b.countryId)); }
    else if (mine > 0 && others.every((j) => !s.blocks[j].ownerId || s.blocks[j].ownerId === pid)) { v += 0.15 * T * (mine + 1) / g.length; why.push('крок до набору ' + groupName(b.countryId)); }
    const opp = others.map((j) => s.blocks[j].ownerId);
    if (opp.length && opp.every((o) => o && o !== pid && o === opp[0])) {
      v += 0.35 * HORIZON * groupIncome(s, b.countryId, 3, P); why.push('блокує набір суперника');
    }
  } else if (b.type === 'airport' || b.type === 'company') {
    const k = s.blocks.filter((x, j) => j !== i && x.type === b.type && x.ownerId === pid).length;
    const pAvg = s.blocks.reduce((a, x, j) => a + (x.type === b.type ? P[j] : 0), 0) / Math.max(1, s.blocks.filter((x) => x.type === b.type).length);
    const r = (n) => b.type === 'airport' ? ((Array.isArray(b.rentPrices) ? b.rentPrices : [25, 50, 100, 200])[n - 1] || 0) * n : (n >= 2 ? 10 : n === 1 ? 4 : 0) * 7 * n;
    v += 0.4 * nOpp(s) * HORIZON * pAvg * (r(k + 1) - r(k));
    if (k > 0) why.push(`${k + 1}-й ${b.type === 'airport' ? 'аеропорт' : 'компанія'}`);
  }
  return { value: Math.round(v), why };
}

// Скільки можуть забрати на наступному кидку (розподіл платежу) => безпечний запас
export function danger(s, pid) {
  const p = s.participants.find((x) => x.id === pid); if (!p) return { expected: 0, q85: 0, worst: 0, reserve: 50 };
  const N = s.blocks.length, outcomes = [];
  for (let d = 2; d <= 12; d++) {
    const j = (p.position + d) % N, b = s.blocks[j];
    let pay = 0;
    if (isBuyable(b) && b.ownerId && b.ownerId !== pid) pay = rentFor(s, j, d);
    else if (b.bonusType === 'tax') pay = Math.floor(Math.max(0, p.money) * (b.taxPercentage || 10) / 100);
    else if (b.bonusType === 'premium-tax') pay = b.taxAmount || 75;
    outcomes.push([pay, DICE[d], s.blocks[j].name]);
  }
  outcomes.sort((a, b) => a[0] - b[0]);
  let acc = 0, q85 = 0; const expected = outcomes.reduce((a, [v, pr]) => a + v * pr, 0);
  for (const [v, pr] of outcomes) { acc += pr; if (acc >= 0.85) { q85 = v; break; } }
  const worstO = outcomes[outcomes.length - 1];
  return { expected: Math.round(expected), q85, worst: worstO[0], worstName: worstO[2], reserve: Math.max(50, q85, Math.round(expected * 2)) };
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
  const after = me.money - b.price, cap = mortgageCapacity(s, pid);
  const maxBid = Math.max(0, Math.min(value, me.money - Math.min(dz.reserve, 80)));
  let verdict, text;
  if (after >= dz.reserve && value >= b.price * 0.85) { verdict = 'buy'; text = `КУПУЙ за $${b.price}`; }
  else if (after >= 0 && after + cap >= dz.reserve && value >= b.price * 1.15) { verdict = 'buy'; text = `КУПУЙ (за потреби заклади непотрібне)`; }
  else if (after >= 0 && value >= b.price * 1.3 && stage(s).unownedShare > 0.4) { verdict = 'buy'; text = `КУПУЙ, ризиковано: запас буде $${after}`; }
  else { verdict = 'auction'; text = `Аукціон: став до $${maxBid}`; }
  const reasons = [...why];
  reasons.push(`цінність для тебе ≈ $${value} (ціна $${b.price}, ${stage(s).name} гра)`);
  reasons.push(`після покупки: $${after}, безпечний запас $${dz.reserve}`);
  if (profileOf) {
    const meds = alivePlayers(s).filter((p) => p.id !== pid).map(profileOf).filter((x) => x && x.auctionN >= 3 && x.auctionMed);
    if (meds.length) {
      const top = Math.max(...meds.map((x) => x.auctionMed));
      if (top < 0.85 && verdict === 'buy') reasons.push(`суперники на аукціонах зазвичай дають до ×${top.toFixed(2)} ціни: аукціон може бути дешевшим, але ризикуєш віддати`);
      if (top > 1.15 && verdict === 'auction') reasons.push(`суперники зазвичай переплачують на аукціонах (×${top.toFixed(2)}): не бійся віддати, хай платять більше`);
    }
  }
  return { idx: i, name: b.name, price: b.price, value, verdict, text, maxBid, reasons };
}

export function auctionAdvice(s, pid, P, profileOf = null) {
  const a = s.auction; if (!a || a.state === 'ended') return null;
  const i = a.blockIndex, b = s.blocks[i];
  const me = s.participants.find((p) => p.id === pid);
  const est = alivePlayers(s).map((p) => {
    const { value } = valueOf(s, i, p.id, P);
    let max = Math.min(value, p.money - 40), learned = null;
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
  const score = dMe - 0.6 * dOther;
  const myOffer = role === 'incoming' ? t.recipientOffer || {} : t.initiatorOffer || {};
  const theirOffer = role === 'incoming' ? t.initiatorOffer || {} : t.recipientOffer || {};
  res.score = Math.round(score); res.dMe = Math.round(dMe); res.dOther = Math.round(dOther);
  res.verdict = score > 40 ? 'accept' : score > -40 ? 'neutral' : 'reject';
  // Максимальна доплата з мого боку, при якій обмін ще вигідний
  res.maxExtraPay = Math.max(0, Math.round((myOffer.money || 0) + score / 1.6));
  // Якщо я віддаю ділянку, що завершує набір суперника, — нижня межа як у попередженні (ціна + 0.6·T)
  let floor = 0;
  for (const i of myOffer.propertyIndices || []) {
    const b = s.blocks[i];
    if (b?.type === 'city' && setOwner(after, b.countryId) === other) floor += b.price + 0.6 * Math.max(0, groupT(s, b.countryId, P));
  }
  if (floor && (theirOffer.money || 0) < floor) { res.verdict = 'reject'; }
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
    const buyerMax = Math.round(b.price + 0.6 * T), sellerAsk = Math.round(1.5 * b.price + HORIZON * I3 * 0.5);
    const qn = s.participants.find((p) => p.id === q)?.name || '?';
    // після покупки мають лишитися гроші хоча б на 1 будинок на кожну ділянку набору
    const n = groupIndices(s, g).length, buildCash = b.housePrice * n;
    const cap = Math.min(buyerMax, me.money - Math.max(100, buildCash));
    const open = Math.round(b.price * 1.5 / 10) * 10;
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
        const bal = Math.round(0.5 * (groupT(s, g, P) - groupT(s, g2, P)));
        const qn = s.participants.find((p) => p.id === q)?.name || '?';
        ideas.push({ kind: 'swap', text: `Обмін з ${qn}: твоя ${s.blocks[mineThere[0]].name} ↔ його ${s.blocks[j].name}` +
          (bal > 20 ? `, ти доплачуєш до $${bal}` : bal < -20 ? `, він доплачує тобі $${-bal}` : ', без доплати'), group: g, gain: groupT(s, g, P) });
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
      ideas.push({ kind: 'warn', text: `${on} чекає на твою ${s.blocks[mineI[0]].name} (${groupName(g)}). Не віддавай дешевше ~$${Math.round(s.blocks[mineI[0]].price + 0.6 * T)}`, group: g, gain: -T });
    }
  }
  return ideas.sort((a, b) => b.gain - a.gain).slice(0, 6);
}

export function buildPlan(s, pid, P, budgetOverride) {
  const me = s.participants.find((p) => p.id === pid); if (!me) return { steps: [], budget: 0 };
  const dz = danger(s, pid), opp = nOpp(s);
  let budget = budgetOverride ?? (me.money - Math.max(dz.reserve, 100));
  const c = JSON.parse(JSON.stringify({ blocks: s.blocks, settings: s.settings, participants: s.participants, boardConfig: s.boardConfig }));
  const steps = [];
  const unm = [];
  s.blocks.forEach((b, i) => {
    if (b.ownerId === pid && b.isMortgaged && b.type === 'city' && groupIndices(s, b.countryId).every((j) => s.blocks[j].ownerId === pid)) unm.push(i);
  });
  for (let guard = 0; guard < 30 && budget > 0; guard++) {
    let best = -1, bestRoi = 0;
    c.blocks.forEach((b, i) => {
      if (!canUpgrade(c, i, pid) || b.housePrice > budget) return;
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
  return { steps, sets, budget: Math.max(0, me.money - Math.max(dz.reserve, 100)), reserve: dz.reserve, mortgagedInSets: unm.map((i) => s.blocks[i].name) };
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
  const oppDanger = s.blocks.some((b) => b.ownerId && b.ownerId !== pid && (b.level || 0) >= 2);
  const hasPardon = ['treasure', 'surprise'].some((d) => s.bonusCards?.[d]?.pardonCardHolderId === pid);
  const me = s.participants.find((p) => p.id === pid);
  const leave = st.unownedShare > 0.25 && !oppDanger;
  if (leave) return { verdict: hasPardon ? 'pardon' : 'pay', text: hasPardon ? 'Використай Pardon і виходь' : `Плати $${PRISON_FEE} і виходь: ще є що купувати`, reasons: [`вільних ділянок ${Math.round(st.unownedShare * 100)}%`] };
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
  const out = { phase: s.phase, myTurn, meId: me ? pid : null, players: playersSummary(s, pid), stage: stage(s) };
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
  if (profileOf) out.rivals = s.participants.filter((p) => p.id !== pid).map((p) => ({ name: p.name, color: p.appearance, isBot: p.isBot, ...(profileOf(p) || {}) }));
  // Головна порада зараз
  if (out.debt) out.now = { kind: 'debt', title: `Борг $${out.debt.short}: продай/заклади`, tone: 'bad' };
  else if (out.auction) out.now = { kind: 'auction', title: out.auction.text, tone: out.auction.verdict === 'bid' ? 'good' : 'neutral' };
  else if (out.trades.some((t) => t.role === 'incoming')) { const t = out.trades.find((x) => x.role === 'incoming'); out.now = { kind: 'trade', title: `Обмін від ${t.from}: ${t.text}`, tone: t.verdict === 'accept' ? 'good' : t.verdict === 'reject' ? 'bad' : 'neutral' }; }
  else if (out.buy) out.now = { kind: 'buy', title: out.buy.text, tone: out.buy.verdict === 'buy' ? 'good' : 'neutral' };
  else if (out.jail) out.now = { kind: 'jail', title: out.jail.text, tone: 'neutral' };
  else if (myTurn && out.build.steps.length) out.now = { kind: 'build', title: `Будуй: ${out.build.steps[0].name} (${out.build.steps[0].from}→${out.build.steps[0].to})`, tone: 'good' };
  else if (myTurn) out.now = { kind: 'turn', title: s.cubesRolledInTurn ? 'Можна завершувати хід' : 'Кидай кубики', tone: 'neutral' };
  else out.now = { kind: 'wait', title: `Хід: ${cur ? cur.name : '…'}`, tone: 'neutral' };
  return out;
}
