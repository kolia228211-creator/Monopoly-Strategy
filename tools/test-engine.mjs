// Юніт-тести "мозку" на справжній дошці richup Classic
import { makeState, own, idxOf } from './mock-state.mjs';
import { analyze, valueOf, danger, tradeAdvice } from '../src/helper/advisor.js';
import { rentFor } from '../src/helper/rules.js';
import { boardProbs } from '../src/helper/probability.js';
import { winProbs } from '../src/helper/sim.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')); if (!cond) fails++; };

// 1. Ймовірності
let s = makeState();
let t0 = performance.now();
const P = boardProbs(s).leave;
const top = [...P].map((p, i) => [p, s.blocks[i].name, i]).sort((a, b) => b[0] - a[0]).slice(0, 6);
ok('ймовірності пораховано швидко', performance.now() - t0 < 1500, `${Math.round(performance.now() - t0)} мс; топ: ${top.map((x) => x[1] + ' ' + (x[0] * 100).toFixed(2) + '%').join(', ')}`);
ok('сума потраплянь за хід ≈ 1.0–1.3', P.reduce((a, b) => a + b, 0) > 0.95 && P.reduce((a, b) => a + b, 0) < 1.4, P.reduce((a, b) => a + b, 0).toFixed(3));

// 2. Оренда: x2 на повному наборі без будинків, аеропорти, компанії
own(s, 'p1', ['Lyon', 'Toulouse', 'Paris', 'TLV Airport', 'MUC Airport', 'Power Company']);
ok('x2 оренда на повному наборі', rentFor(s, idxOf(s, 'Paris')) === 50, String(rentFor(s, idxOf(s, 'Paris'))));
ok('2 аеропорти = $50', rentFor(s, idxOf(s, 'TLV Airport')) === 50);
ok('1 компанія = 4×кубики', rentFor(s, idxOf(s, 'Power Company'), 8) === 32);
s.blocks[idxOf(s, 'Paris')].level = 3;
ok('3 будинки на Paris = $850', rentFor(s, idxOf(s, 'Paris')) === 850);

// 3. Купівля на початку гри
s = makeState(); s.participants[0].position = idxOf(s, 'Shanghai'); s.cubesRolledInTurn = true;
let a = analyze(s, 'p0');
ok('рання гра: радить купити Shanghai', a.buy && a.buy.verdict === 'buy', a.buy && a.buy.text);

// 4. Завершення набору цінніше
s = makeState(); own(s, 'p0', ['Lyon', 'Toulouse']);
const vComplete = valueOf(s, idxOf(s, 'Paris'), 'p0').value, vPlain = valueOf(s, idxOf(s, 'Paris'), 'p1').value;
ok('ділянка, що завершує набір, цінніша', vComplete > vPlain * 1.5, `${vComplete} vs ${vPlain}`);

// 5. Мало грошей => аукціон
s = makeState(); s.participants[0].money = 250; s.participants[0].position = idxOf(s, 'Paris'); s.cubesRolledInTurn = true;
own(s, 'p1', ['London', 'Liverpool', 'Manchester']); s.blocks[idxOf(s, 'London')].level = 3; s.blocks[idxOf(s, 'Liverpool')].level = 3; s.blocks[idxOf(s, 'Manchester')].level = 3;
a = analyze(s, 'p0');
ok('мало грошей + небезпека попереду => аукціон', a.buy && a.buy.verdict === 'auction', a.buy && a.buy.text + ' | запас ' + a.danger.reserve);

// 6. Аукціон
s = makeState(); own(s, 'p0', ['Lyon', 'Toulouse']); s.auction = { blockIndex: idxOf(s, 'Paris'), currentBid: 150, currentBidderId: 'p2', bidderIds: ['p0', 'p1', 'p2', 'p3'], state: 'active', endsAt: Date.now() + 9000 };
a = analyze(s, 'p0');
ok('аукціон за останню ділянку набору: ставити', a.auction.verdict === 'bid' && a.auction.myMax > 280, a.auction.text);

// 7. Будівництво
s = makeState(); own(s, 'p0', ['Frankfurt', 'Munich', 'Berlin']); s.participants[0].money = 1200; s.currentPlayerIndex = 0;
a = analyze(s, 'p0');
ok('план будинків рівномірний і не більше бюджету', a.build.steps.length >= 3 && a.build.steps.reduce((x, y) => x + y.cost, 0) <= 1200, a.build.steps.map((x) => `${x.name} ${x.from}→${x.to}`).join(', '));

// 8. Борг
s = makeState(); own(s, 'p0', ['Frankfurt', 'Munich', 'Berlin', 'Salvador']); ['Frankfurt', 'Munich', 'Berlin'].forEach((n) => s.blocks[idxOf(s, n)].level = 2); s.participants[0].money = -180;
a = analyze(s, 'p0');
ok('борг: план продажу покриває нестачу', a.debt && a.debt.enough, a.debt && a.debt.steps.map((x) => `${x.kind} ${x.name} +$${x.amount}`).join(', '));

// 9. Обмін: віддати суперникові останню ділянку набору за копійки — погано
s = makeState(); own(s, 'p1', ['Lyon', 'Toulouse']); own(s, 'p0', ['Paris']);
const bad = tradeAdvice(s, 'p0', { id: 't1', initiatorId: 'p1', recipientId: 'p0', initiatorOffer: { money: 300, propertyIndices: [], pardonCards: [] }, recipientOffer: { money: 0, propertyIndices: [idxOf(s, 'Paris')], pardonCards: [] }, status: 'pending' }, P);
ok('віддати Paris суперникові за $300 — відхилити', bad.verdict === 'reject', `${bad.text}; мінімум просити ~$${bad.minAskIfReject}`);
ok('межа обміну = межа попередження', bad.minAskIfReject > 2000, String(bad.minAskIfReject));
const good = tradeAdvice(s, 'p0', { id: 't2', initiatorId: 'p1', recipientId: 'p0', initiatorOffer: { money: 3000, propertyIndices: [], pardonCards: [] }, recipientOffer: { money: 0, propertyIndices: [idxOf(s, 'Paris')], pardonCards: [] }, status: 'pending' }, P);
ok('за $3000 — уже можна', good.verdict !== 'reject', good.text + ' score ' + good.score);

// 10. Ідеї обмінів
s = makeState(); own(s, 'p0', ['Lyon', 'Toulouse', 'Rome']); own(s, 'p1', ['Paris', 'Venice', 'Milan']);
a = analyze(s, 'p0');
ok('ідея обміну 1↔1 знайдена', a.ideas.some((i) => i.kind === 'swap'), a.ideas.map((i) => i.text).join(' | '));

// 11. Тюрма
s = makeState(); s.blocks[10].suspendedTurnsRemaining = { p0: 3 }; s.participants[0].position = 10;
a = analyze(s, 'p0');
ok('тюрма на початку: платити й виходити', a.jail && a.jail.verdict === 'pay', a.jail && a.jail.text);

// 12. Симулятор
s = makeState(); own(s, 'p0', ['Frankfurt', 'Munich', 'Berlin']); ['Frankfurt', 'Munich', 'Berlin'].forEach((n) => s.blocks[idxOf(s, n)].level = 3);
t0 = performance.now();
const w = winProbs(s, { n: 200 });
const dt = performance.now() - t0;
const sum = Object.values(w.base).reduce((x, y) => x + y, 0);
ok('симулятор: сума шансів ≈ 100%', sum > 0.97 && sum <= 1.0001, sum.toFixed(3));
ok('гравець з Німеччиною на 3 будинках — фаворит', w.base.p0 > 0.5, Object.entries(w.base).map(([k, v]) => k + ' ' + Math.round(v * 100) + '%').join(', ') + ` (${Math.round(dt)} мс / 200 партій)`);
const s2 = makeState();
const w2 = winProbs(s2, { n: 300 });
ok('рівний старт: шанси 15–35% у кожного', Object.values(w2.base).every((v) => v > 0.12 && v < 0.38), Object.values(w2.base).map((v) => Math.round(v * 100) + '%').join(', '));

if (fails) { console.log(`\n${fails} FAIL`); process.exit(1); } else console.log('\nУсе пройдено');

// ---- v0.4: прогноз кидка з START, податком і картками ----
{
  const { nextRoll, deckInfo } = await import('../src/helper/roll.js');
  let s = makeState(); s.participants[0].position = idxOf(s, 'JFK Airport'); s.participants[0].money = 828;
  let r = nextRoll(s, 'p0', { keepLeaves: true });
  ok('кидок: сума ймовірностей = 1', Math.abs(r.check - 1) < 1e-9, r.check.toFixed(6));
  const tax = r.leaves.find((l) => /^\+200 START → Earnings Tax$/.test(l.label));
  ok('кидок: податок після START = $102 (10% від 828+200)', tax && tax.pay === 102 && tax.cash === 98, tax && `${tax.label}: плата ${tax.pay}, разом ${tax.cash}`);
  ok('кидок: чистий результат враховує +200 за START', r.net > 50, `net ${r.net}, плата ${r.expected}`);
  // підрахунок карток
  s = makeState(); let d = deckInfo(s, 'surprise');
  ok('колода: на старті 17 невідомих карток', !d.known && d.next.length === 17);
  s.bonusCards.surprise.currentIndex = 5; d = deckInfo(s, 'surprise');
  ok('колода: вийшло 5 => лишилось 12', !d.known && d.next.length === 12 && Math.abs(d.next.reduce((a, x) => a + x.p, 0) - 1) < 1e-9);
  s.bonusCards.surprise.currentIndex = 17 + 3; d = deckInfo(s, 'surprise');
  ok('колода: друге коло => наступна відома з пам\'яті', d.known && d.next[0].card.id === s.bonusCards.surprise.cards[3].id, d.next[0].card.id);
  s.bonusCards.surprise.currentIndex = 17 + 6; s.bonusCards.surprise.pardonCardHolderId = 'p2'; d = deckInfo(s, 'surprise');
  ok('колода: Pardon пропускається, поки його тримають', d.next[0].card.effect.type !== 'get-pardon-card', d.next[0].card.id);
  // Surprise на 36: точно відома картка "на New York" з власником-суперником
  s = makeState(); own(s, 'p1', ['New York', 'San Francisco']); s.blocks[idxOf(s, 'New York')].level = 3;
  const ny = s.bonusCards.surprise.cards.findIndex((c) => c.effect.type === 'move-to-block' && c.effect.blockIndex === 39);
  s.bonusCards.surprise.currentIndex = 17 + ny; s.participants[0].position = idxOf(s, 'Surprise') - 8 >= 0 ? 28 : 28; // з Toulouse (28) до Surprise (36) = 8
  r = nextRoll(s, 'p0');
  ok('відома картка «на New York» потрапляє в прогноз', /Surprise: на New York/.test(r.worstName) && r.worst >= 1400, `${r.worst} (${r.worstName})`);
  // тюрма: без дубля лишаєшся
  s = makeState(); s.blocks[10].suspendedTurnsRemaining = { p0: 2 }; s.participants[0].position = 10;
  r = nextRoll(s, 'p0'); ok('у тюрмі: рух лише з дублем (1/6)', Math.abs(r.pPay + r.pBuy + 0) <= 0.2, `pBuy ${r.pBuy.toFixed(3)}`);
  if (fails) { console.log(fails + ' FAIL'); process.exit(1); } else console.log('Прогноз кидка: усе пройдено');
}

// ---- загрози обміну між суперниками ----
{
  const { rivalThreats } = await import('../src/helper/advisor.js');
  const { winProbs } = await import('../src/helper/sim.js');
  let s = makeState(); s.participants[0].money = 563;
  own(s, 'p1', ['Venice', 'San Francisco']); own(s, 'p3', ['Milan', 'Rome', 'New York']); s.participants[1].money = 1025; s.participants[3].money = 587; own(s, 'p0', ['Salvador', 'Jerusalem', 'Berlin', 'TLV Airport']);
  const th = rivalThreats(s, 'p0');
  ok('загроза: Andrii ↔ Ira обмін Venice ↔ New York', th.length >= 1 && th[0].kind === 'swap' && /Venice/.test(th[0].text) && /New York/.test(th[0].text), th[0] && th[0].text);
  ok('загроза: порада, як перебити', th[0] && /Перебий|замало/.test(th[0].counter), th[0] && th[0].counter);
  const w = winProbs(s, { n: 600, variants: { swap: (X) => { th[0].transfer.toA.forEach((i) => { X.owner[i] = X.ids.indexOf(th[0].a); }); th[0].transfer.toB.forEach((i) => { X.owner[i] = X.ids.indexOf(th[0].b); }); } } });
  const f = (o) => Object.entries(o).map(([k, v]) => k + ' ' + Math.round(v * 100) + '%').join(', ');
  ok('після їхнього обміну мій шанс падає', w.swap.p0 < w.base.p0, `до: ${f(w.base)} | після: ${f(w.swap)}`);
  if (fails) { console.log(fails + ' FAIL'); process.exit(1); } else console.log('Загрози: усе пройдено');
}
