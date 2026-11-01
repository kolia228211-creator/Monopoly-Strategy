// Тест навчання: послідовність станів гри -> профілі суперників і журнал
import { makeState, idxOf } from './mock-state.mjs';
import { createLearner, makeStorage, playerKey } from '../src/helper/learn.js';
import { analyze } from '../src/helper/advisor.js';

let fails = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  — ' + x : '')); if (!c) fails++; };
const mem = new Map();
const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
let clock = 1_000_000;
const L = createLearner(makeStorage(ls), { now: () => clock });
const clone = (x) => JSON.parse(JSON.stringify(x));
let s = makeState(); s.stats = { startedAt: 42 };
const step = (f) => { s = clone(s); f(s); clock += 1000; return L.observe(s, 'p0', null, 0.25); };

step(() => {});
// Аукціон 1: p1 не купив Paris, p2 ставить 300, p3 виграє за 320
const paris = idxOf(s, 'Paris'), lyon = idxOf(s, 'Lyon'), rome = idxOf(s, 'Rome');
step((x) => { x.currentPlayerIndex = 1; x.participants[1].position = paris; x.cubesRolledInTurn = true; x.auction = { blockIndex: paris, currentBid: 0, currentBidderId: null, bidderIds: ['p0', 'p1', 'p2', 'p3'], state: 'active' }; });
step((x) => { x.auction.currentBid = 300; x.auction.currentBidderId = 'p2'; });
step((x) => { x.auction.currentBid = 320; x.auction.currentBidderId = 'p3'; });
step((x) => { x.auction.state = 'ended'; x.blocks[paris].ownerId = 'p3'; x.participants[3].money -= 320; });
step((x) => { x.auction = null; });
// Аукціон 2: Rome, p2 виграє за 250 (ціна 160), p3 дав 200
step((x) => { x.currentPlayerIndex = 3; x.auction = { blockIndex: rome, currentBid: 200, currentBidderId: 'p3', bidderIds: ['p0', 'p1', 'p2', 'p3'], state: 'active' }; });
step((x) => { x.auction.currentBid = 250; x.auction.currentBidderId = 'p2'; });
step((x) => { x.auction.state = 'ended'; x.blocks[rome].ownerId = 'p2'; });
// p2 купує Lyon напряму
step((x) => { x.auction = null; x.currentPlayerIndex = 2; x.blocks[lyon].ownerId = 'p2'; x.participants[2].money -= 260; });
// Обмін: я (p0) пропоную p2 $400 за Lyon -> прийнято
step((x) => { x.trades = [{ id: 'T1', initiatorId: 'p0', recipientId: 'p2', initiatorOffer: { money: 400, propertyIndices: [], pardonCards: [] }, recipientOffer: { money: 0, propertyIndices: [lyon], pardonCards: [] }, status: 'pending' }]; });
step((x) => { x.trades = []; x.blocks[lyon].ownerId = 'p0'; x.participants[0].money -= 400; x.participants[2].money += 400; });
// Обмін: я пропоную p3 $50 за Paris -> відхилено
step((x) => { x.trades = [{ id: 'T2', initiatorId: 'p0', recipientId: 'p3', initiatorOffer: { money: 50, propertyIndices: [], pardonCards: [] }, recipientOffer: { money: 0, propertyIndices: [paris], pardonCards: [] }, status: 'pending' }]; });
const evs = step((x) => { x.trades = []; });
// p1 будує (немає набору, але перевіряємо лічильник)
step((x) => { x.blocks[idxOf(x, 'Salvador')].ownerId = 'p1'; });
step((x) => { x.blocks[idxOf(x, 'Salvador')].level = 1; });
// Кінець гри
step((x) => { x.participants[1].bankruptedAt = 5; x.participants[2].bankruptedAt = 6; x.participants[3].bankruptedAt = 7; x.winnerId = 'p0'; });
L.flush();

const pk = (i) => playerKey(s.participants[i]);
const pr = L.profiles;
ok('p1: відмова від купівлі записана', pr[pk(1)].buys.no === 1, JSON.stringify(pr[pk(1)].buys));
ok('p3: аукціони (виграв Paris ×1.14, програв Rome ×1.25)', pr[pk(3)].auctions.length === 2 && pr[pk(3)].auctions.some((a) => a.won && Math.abs(a.r - 320 / 280) < 0.01), JSON.stringify(pr[pk(3)].auctions));
ok('p2: аукціони + купівля', pr[pk(2)].auctions.length === 2 && pr[pk(2)].buys.yes === 1, JSON.stringify(pr[pk(2)]));
ok('p2: прийнятий обмін з оцінкою вигоди', pr[pk(2)].trades.accepted.length === 1, JSON.stringify(pr[pk(2)].trades));
ok('p3: відхилений обмін', pr[pk(3)].trades.rejected.length === 1, JSON.stringify(pr[pk(3)].trades));
ok('подія відхилення в потоці', evs.some((e) => e.type === 'trade-rejected'));
ok('p1: будинок порахований', pr[pk(1)].houses === 1);
ok('про себе (p0) профіль не ведемо', !pr[pk(0)]);
const st = L.stats();
ok('журнал: 1 партія, завершена, я переміг', st.games === 1 && st.finished === 1 && st.myWins === 1, JSON.stringify(st));
const g = L.journal[0];
ok('журнал: мої рішення (2 обміни)', g.decisions.filter((d) => d.kind === 'trade').length === 2, JSON.stringify(g.decisions.map((d) => d.kind + ':' + d.accepted)));
ok('журнал: події', g.events.length >= 8, g.events.map((e) => e.type).join(','));

// Збереження й відновлення
const L2 = createLearner(makeStorage(ls));
ok('профілі відновлюються з localStorage', L2.profileFor(s.participants[3]).auctionN === 2);
const sum = L2.profileFor(s.participants[2]);
ok('підсумок p2: медіана аукціону і обміни', sum.auctionMed > 1 && sum.tradeAcc === 1, JSON.stringify(sum));

// Порада на аукціоні враховує досвід
let s2 = makeState(); s2.auction = { blockIndex: idxOf(s2, 'Toulouse'), currentBid: 100, currentBidderId: 'p1', bidderIds: ['p0', 'p1', 'p2', 'p3'], state: 'active' };
const a = analyze(s2, 'p0', (p) => L2.profileFor(p));
const e2 = a.auction.est.find((e) => e.id === 'p2');
ok('аукціон: оцінка p2 з досвіду', e2.learned != null && e2.n === 2, JSON.stringify(e2));
ok('панель: картка суперників', a.rivals && a.rivals.length === 3 && a.rivals.some((r) => r.auctionN === 2));

// Експорт / імпорт
const mem2 = new Map(); const L3 = createLearner(makeStorage({ getItem: (k) => mem2.get(k) ?? null, setItem: (k, v) => mem2.set(k, v) }));
ok('імпорт журналу на іншому пристрої', L3.importData(JSON.parse(JSON.stringify(L2.exportData()))) && L3.stats().games === 1 && L3.profileFor(s.participants[3]).auctionN === 2);

// «не вистачає грошей» не псує відсоток дотриманих порад
{
  const mem3 = new Map(); let c3 = 5e6; const L4 = createLearner(makeStorage({ getItem: (k) => mem3.get(k) ?? null, setItem: (k, v) => mem3.set(k, v) }), { now: () => c3 });
  let x = makeState(); x.stats = { startedAt: 7 }; const par = idxOf(x, 'Paris');
  L4.observe(x, 'p0', null, 0.2);
  x = JSON.parse(JSON.stringify(x)); x.participants[0].position = par; x.cubesRolledInTurn = true; c3 += 1000;
  L4.observe(x, 'p0', { buy: { idx: par, verdict: 'cant', maxBid: 0, value: 300, affordable: false } }, 0.2);
  x = JSON.parse(JSON.stringify(x)); x.auction = { blockIndex: par, currentBid: 0, currentBidderId: null, bidderIds: ['p0', 'p1'], state: 'active' }; c3 += 1000;
  L4.observe(x, 'p0', null, 0.2);
  const st4 = L4.stats();
  ok('«не вистачає грошей» не рахується як недотримана порада', st4.decisions === 1 && st4.followRate === null, JSON.stringify(st4));
}
if (fails) { console.log(fails + ' FAIL'); process.exit(1); } else console.log('\nНавчання: усе пройдено');
