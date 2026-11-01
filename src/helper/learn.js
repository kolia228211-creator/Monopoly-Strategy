// Навчання: спостерігаємо за змінами стану гри й запам'ятовуємо, як грає кожен суперник,
// а також ведемо журнал партій (події + мої рішення з порадою + результат).
// Усе зберігається тільки в браузері (localStorage) і експортується файлом за бажанням.
import { isBuyable, groupIndices, assetValue } from './rules.js';
import { portfolio } from './advisor.js';
import { boardProbs } from './probability.js';

const K_PROF = 'ruhelp:profiles', K_JOUR = 'ruhelp:journal';
const MAX_GAMES = 30, MAX_EVENTS = 600, MAX_SAMPLES = 60;

export function makeStorage(ls) {
  const get = (k, d) => { try { const v = ls && ls.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const set = (k, v) => { try { ls && ls.setItem(k, JSON.stringify(v)); } catch (e) { /* переповнено або приватний режим */ } };
  return { get, set };
}

export const playerKey = (p) => (p.userId ? 'u:' + p.userId : 'n:' + String(p.name || '').trim().toLowerCase());

function quantile(arr, q) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y), i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

// Короткий підсумок профілю для порад і панелі
export function summarize(pr) {
  if (!pr) return null;
  const auc = pr.auctions || [], top = auc.map((x) => x.r);
  const buy = pr.buys || { yes: 0, no: 0 };
  const tr = pr.trades || { accepted: [], rejected: [] };
  const acc = tr.accepted || [], rej = tr.rejected || [];
  return {
    name: pr.name, games: pr.games || 0,
    auctionN: auc.length, auctionP75: quantile(top, 0.75), auctionMed: quantile(top, 0.5), auctionWins: auc.filter((x) => x.won).length,
    buyN: buy.yes + buy.no, buyRate: buy.yes + buy.no ? buy.yes / (buy.yes + buy.no) : null,
    tradeN: acc.length + rej.length, tradeAcc: acc.length,
    minAcceptGain: acc.length ? Math.min(...acc) : null, // найменша вигода (з потенціалом наборів), на яку погоджувався
    houses: pr.houses || 0, mortgages: pr.mortgages || 0
  };
}

export function createLearner(storage, { now = () => Date.now() } = {}) {
  const profiles = storage.get(K_PROF, {});
  const journal = storage.get(K_JOUR, []);
  let prev = null, game = null, auc = null, trades = new Map(), dirty = false, lastAdvice = {}, recentAuction = {};

  const prof = (p) => {
    const k = playerKey(p);
    if (!profiles[k]) profiles[k] = { name: p.name, games: 0, auctions: [], buys: { yes: 0, no: 0 }, trades: { accepted: [], rejected: [] }, houses: 0, mortgages: 0 };
    profiles[k].name = p.name;
    return profiles[k];
  };
  const push = (arr, v) => { arr.push(v); if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES); };
  const byId = (s, id) => s.participants.find((p) => p.id === id);
  const completesFor = (s, i, pid) => {
    const b = s.blocks[i]; if (!b || b.type !== 'city') return false;
    return groupIndices(s, b.countryId).filter((j) => j !== i).every((j) => s.blocks[j].ownerId === pid);
  };

  function ev(e) {
    if (!game) return;
    e.t = now();
    if (game.events.length < MAX_EVENTS) game.events.push(e);
    dirty = true;
  }

  function startGame(s, meId) {
    const startedAt = s.stats?.startedAt || now();
    const id = s.id + ':' + startedAt;
    game = journal.find((g) => g.id === id);
    if (!game) {
      game = { id, room: s.id, startedAt, me: meId ? playerKey(byId(s, meId) || {}) : null,
        settings: s.settings, players: s.participants.map((p) => ({ key: playerKey(p), name: p.name, bot: !!p.isBot })),
        events: [], decisions: [], end: null };
      journal.push(game);
      if (journal.length > MAX_GAMES) journal.splice(0, journal.length - MAX_GAMES);
      s.participants.forEach((p) => { if (p.id !== meId) prof(p).games++; });
      dirty = true;
    }
  }

  // Порада, показана зараз, — щоб пов'язати її з тим, що я зробив
  function noteAdvice(model, winBase) {
    if (!model) return;
    if (model.buy) lastAdvice.buy = { idx: model.buy.idx, verdict: model.buy.verdict, maxBid: model.buy.maxBid, value: model.buy.value, win: winBase, affordable: model.buy.affordable !== false, at: now() };
    if (model.auction) lastAdvice.auction = { idx: model.auction.idx, myMax: model.auction.myMax, win: winBase };
    (model.trades || []).forEach((t) => { if (t.role !== 'others') (lastAdvice.trades = lastAdvice.trades || {})[t.id] = { verdict: t.verdict, score: t.score, win: winBase }; });
  }
  // порада про купівлю рахується лише для цієї ж клітинки й лише якщо показана щойно (не з минулого кола)
  function freshBuy(i) { const b = lastAdvice.buy; return b && b.idx === i && now() - (b.at || 0) < 90000 ? b : null; }
  function decision(d) { if (game) { game.decisions.push({ t: now(), ...d }); dirty = true; } }

  function observe(s, meId, model, winBase) {
    if (!s || !s.blocks || s.phase === 'lobby') { prev = s && JSON.parse(JSON.stringify(slim(s))); return []; }
    startGame(s, meId);
    noteAdvice(model, winBase);
    const out = [];
    const P = prev;
    const curId = s.participants[s.currentPlayerIndex]?.id;

    // ---- аукціони ----
    const a = s.auction && s.auction.state !== 'ended' ? s.auction : null;
    if (a && (!auc || auc.idx !== a.blockIndex)) {
      auc = { idx: a.blockIndex, bids: {}, landedBy: curId, price: s.blocks[a.blockIndex].price, need: {} };
      s.participants.forEach((p) => { auc.need[p.id] = completesFor(s, a.blockIndex, p.id); });
      const lp = byId(s, curId);
      if (lp) { prof(lp).buys.no++; out.push({ type: 'decline', who: lp.name, idx: a.blockIndex }); ev({ type: 'decline', who: playerKey(lp), idx: a.blockIndex, money: lp.money });
        if (lp.id === meId) decision({ kind: 'buy', idx: a.blockIndex, action: 'auction', advice: freshBuy(a.blockIndex) }); }
    }
    if (a && auc && a.currentBidderId) auc.bids[a.currentBidderId] = Math.max(auc.bids[a.currentBidderId] || 0, a.currentBid || 0);
    if (!a && auc) {
      // аукціон завершився: переможець = власник ділянки
      const owner = s.blocks[auc.idx].ownerId;
      const bidders = new Set([...Object.keys(auc.bids), ...(s.auction?.bidderIds || [])]);
      bidders.forEach((pid) => {
        const p = byId(s, pid); if (!p) return;
        const last = auc.bids[pid] || 0; if (!last && pid !== owner) return;
        const final = owner === pid ? (s.auction?.currentBid || last) : last;
        if (pid !== meId) push(prof(p).auctions, { r: +(final / auc.price).toFixed(3), won: owner === pid, need: !!auc.need[pid] });
      });
      const w = owner && byId(s, owner);
      out.push({ type: 'auction-end', idx: auc.idx, winner: w ? w.name : null, price: s.auction?.currentBid || auc.bids[owner] || 0 });
      ev({ type: 'auction-end', idx: auc.idx, winner: w ? playerKey(w) : null, price: s.auction?.currentBid || auc.bids[owner] || 0, bids: Object.fromEntries(Object.entries(auc.bids).map(([k, v]) => [playerKey(byId(s, k) || { name: k }), v])) });
      if (meId && (auc.bids[meId] || owner === meId)) decision({ kind: 'auction', idx: auc.idx, won: owner === meId, paid: owner === meId ? (s.auction?.currentBid || auc.bids[meId]) : null, myLastBid: auc.bids[meId] || 0, advice: lastAdvice.auction && lastAdvice.auction.idx === auc.idx ? lastAdvice.auction : null });
      recentAuction[auc.idx] = now() + 8000;
      auc = null;
    }

    if (P) {
      // ---- купівлі (без аукціону), будинки, застави ----
      s.blocks.forEach((b, i) => {
        const pb = P.blocks[i]; if (!pb || !isBuyable(b)) return;
        if (!pb.ownerId && b.ownerId && !(P.auctionIdx === i) && !(recentAuction[i] > now())) {
          const p = byId(s, b.ownerId);
          if (p) { prof(p).buys.yes++; out.push({ type: 'buy', who: p.name, idx: i }); ev({ type: 'buy', who: playerKey(p), idx: i, price: b.price });
            if (p.id === meId) decision({ kind: 'buy', idx: i, action: 'buy', advice: freshBuy(i) }); }
        }
        if ((b.level || 0) > (pb.level || 0) && b.ownerId) { const p = byId(s, b.ownerId); if (p) { prof(p).houses += b.level - (pb.level || 0); ev({ type: 'build', who: playerKey(p), idx: i, level: b.level }); } }
        if (b.isMortgaged && !pb.isMortgaged && b.ownerId) { const p = byId(s, b.ownerId); if (p) { prof(p).mortgages++; ev({ type: 'mortgage', who: playerKey(p), idx: i }); } }
      });
      // ---- банкрутства ----
      s.participants.forEach((p) => { const pp = P.participants.find((x) => x.id === p.id); if (pp && !pp.bankruptedAt && p.bankruptedAt) { out.push({ type: 'bankrupt', who: p.name }); ev({ type: 'bankrupt', who: playerKey(p) }); } });
    }

    // ---- обміни ----
    const pend = new Map((s.trades || []).filter((t) => !t.status || t.status === 'pending').map((t) => [t.id, t]));
    for (const [id, t] of pend) if (!trades.has(id)) {
      const Pr = boardProbs(s).leave;
      trades.set(id, { t: JSON.parse(JSON.stringify(t)), before: JSON.parse(JSON.stringify(slim(s))),
        gainRecipient: null, gainInitiator: null, P: Pr });
      ev({ type: 'trade-proposed', from: playerKey(byId(s, t.initiatorId) || {}), to: playerKey(byId(s, t.recipientId) || {}), io: t.initiatorOffer, ro: t.recipientOffer });
    }
    for (const [id, rec] of [...trades]) {
      if (pend.has(id)) continue;
      trades.delete(id);
      const t = rec.t, statusNow = (s.trades || []).find((x) => x.id === id)?.status;
      const moved = (t.initiatorOffer?.propertyIndices || []).concat(t.recipientOffer?.propertyIndices || []);
      let accepted;
      if (statusNow) accepted = /accept/i.test(statusNow);
      else if (moved.length) accepted = (t.initiatorOffer?.propertyIndices || []).every((i) => s.blocks[i]?.ownerId === t.recipientId) && (t.recipientOffer?.propertyIndices || []).every((i) => s.blocks[i]?.ownerId === t.initiatorId);
      else { const r = byId(s, t.recipientId), pr = rec.before.participants.find((x) => x.id === t.recipientId); accepted = !!(r && pr && Math.abs((r.money - pr.money) - ((t.initiatorOffer?.money || 0) - (t.recipientOffer?.money || 0))) < 1); }
      const cancelled = statusNow && /cancel/i.test(statusNow);
      // вигода для отримувача (з потенціалом наборів), порахована на стані ДО обміну
      const before = rec.before, after = applyTradeSlim(before, t);
      const gainR = Math.round(portfolio(after, t.recipientId, rec.P) - portfolio(before, t.recipientId, rec.P));
      const rp = byId(s, t.recipientId), ip = byId(s, t.initiatorId);
      if (rp && t.recipientId !== meId && !cancelled) push(prof(rp).trades[accepted ? 'accepted' : 'rejected'], gainR);
      out.push({ type: 'trade-' + (cancelled ? 'cancelled' : accepted ? 'accepted' : 'rejected'), from: ip?.name, to: rp?.name, gainRecipient: gainR });
      ev({ type: 'trade-' + (cancelled ? 'cancelled' : accepted ? 'accepted' : 'rejected'), id, gainRecipient: gainR });
      if (t.recipientId === meId || t.initiatorId === meId) decision({ kind: 'trade', id, role: t.recipientId === meId ? 'recipient' : 'initiator', accepted, cancelled: !!cancelled, advice: lastAdvice.trades?.[id] || null });
    }

    // ---- кінець партії ----
    const ended = s.winnerId || /end|finish/i.test(s.phase || '');
    if (ended && game && !game.end) {
      const rank = s.participants.slice().sort((x, y) => (x.bankruptedAt ? 1 : 0) - (y.bankruptedAt ? 1 : 0) || ((y.bankruptedAt || 0) - (x.bankruptedAt || 0)) || (y.money + assetValue(s, y.id)) - (x.money + assetValue(s, x.id)));
      game.end = { at: now(), winner: s.winnerId ? playerKey(byId(s, s.winnerId) || {}) : playerKey(rank[0]), ranking: rank.map(playerKey), turns: s.stats?.turnsCount || null };
      dirty = true; out.push({ type: 'game-end' });
    }

    prev = JSON.parse(JSON.stringify(slim(s)));
    if (prev) prev.auctionIdx = a ? a.blockIndex : (auc ? auc.idx : null);
    return out;
  }

  function flush() { if (dirty) { storage.set(K_PROF, profiles); storage.set(K_JOUR, journal); dirty = false; } }
  function profileFor(p) { return summarize(profiles[playerKey(p)]); }
  function stats() {
    const done = journal.filter((g) => g.end);
    const decs = journal.flatMap((g) => g.decisions);
    const followed = decs.filter((d) => d.advice && (d.kind !== 'buy' || (d.advice.verdict !== 'cant' && d.advice.affordable !== false)) && ((d.kind === 'buy' && ((d.advice.verdict === 'buy') === (d.action === 'buy'))) || (d.kind === 'trade' && !d.cancelled && ((d.advice.verdict === 'accept') === d.accepted))));
    const fair = (d) => d.kind !== 'buy' || (d.advice.verdict !== 'cant' && d.advice.affordable !== false);
    const judged = decs.filter((d) => d.advice && fair(d) && (d.kind === 'buy' || (d.kind === 'trade' && !d.cancelled)));
    return { games: journal.length, finished: done.length, myWins: done.filter((g) => g.end.winner === g.me).length,
      decisions: decs.length, followRate: judged.length ? followed.length / judged.length : null, profiles: Object.keys(profiles).length };
  }
  function exportData() { return { exportedAt: new Date(now()).toISOString(), version: 1, profiles, journal }; }
  function importData(d) {
    if (!d || typeof d !== 'object') return false;
    if (d.profiles) Object.assign(profiles, d.profiles);
    if (Array.isArray(d.journal)) d.journal.forEach((g) => { if (!journal.find((x) => x.id === g.id)) journal.push(g); });
    dirty = true; flush(); return true;
  }
  function reset() { for (const k of Object.keys(profiles)) delete profiles[k]; journal.length = 0; dirty = true; flush(); }
  return { observe, flush, profileFor, stats, exportData, importData, reset, profiles, journal };
}

function slim(s) {
  if (!s) return null;
  return { id: s.id, phase: s.phase, settings: s.settings, boardConfig: s.boardConfig, bonusCards: s.bonusCards,
    participants: s.participants.map((p) => ({ id: p.id, name: p.name, userId: p.userId, money: p.money, position: p.position, bankruptedAt: p.bankruptedAt })),
    blocks: s.blocks.map((b) => ({ ...b, suspendedTurnsRemaining: b.suspendedTurnsRemaining })), currentPlayerIndex: s.currentPlayerIndex, stampedFlags: s.stampedFlags };
}
function applyTradeSlim(s, t) {
  const c = JSON.parse(JSON.stringify(s));
  const a = c.participants.find((p) => p.id === t.initiatorId), b = c.participants.find((p) => p.id === t.recipientId);
  if (!a || !b) return c;
  const io = t.initiatorOffer || {}, ro = t.recipientOffer || {};
  a.money += (ro.money || 0) - (io.money || 0); b.money += (io.money || 0) - (ro.money || 0);
  (io.propertyIndices || []).forEach((i) => { if (c.blocks[i]) c.blocks[i].ownerId = b.id; });
  (ro.propertyIndices || []).forEach((i) => { if (c.blocks[i]) c.blocks[i].ownerId = a.id; });
  return c;
}
