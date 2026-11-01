// Тест рушія арени (tools/selfplay/arena): детермінованість, коректність станів, обміни й аукціони відбуваються.
import { playGame, HUMAN } from './selfplay/arena/engine.mjs';
import { BASE, TUNED } from '../src/helper/params.js';
let fail = 0;
const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  — ' + x : '')); if (!c) fail++; };
const S = { ...BASE }, L0 = { ...BASE, ...TUNED.dbl0 }, L1 = { ...BASE, ...TUNED.dbl1 };
const a = playGame([S, HUMAN, L0, HUMAN], { dbl: 0 }, 42), b = playGame([S, HUMAN, L0, HUMAN], { dbl: 0 }, 42);
ok(a.winner === b.winner && a.rounds === b.rounds, 'однаковий seed → однакова партія', `winner ${a.winner}, раундів ${a.rounds}`);
let bad = 0, trades = 0, auctions = 0, ends = 0;
for (let s = 0; s < 300; s++) {
  const r = playGame([S, HUMAN, L1, HUMAN, L0].slice(0, 3 + (s % 3)), { dbl: s % 2 }, 1000 + s);
  const G = r.G;
  for (let q = 0; q < G.n; q++) if (!Number.isFinite(G.money[q]) || (G.alive[q] && G.money[q] < 0)) bad++;
  for (let i = 0; i < 40; i++) { if (G.owner[i] >= 0 && !G.alive[G.owner[i]]) bad++; if (G.level[i] && G.mort[i]) bad++; }
  if (r.winner < 0 || !G.alive[r.winner]) bad++;
  trades += G.stats.trades; auctions += G.stats.auctions; if (!r.timeout) ends++;
}
ok(bad === 0, 'стан коректний (гроші, власники живі, без будинків на заставі)', 'порушень ' + bad);
ok(trades > 100, 'боти обмінюються', 'обмінів ' + trades);
ok(auctions > 100, 'аукціони відбуваються', 'аукціонів ' + auctions);
ok(ends > 150, 'більшість партій закінчується банкрутством', ends + '/300');
const t0 = Date.now(); let n = 0; while (Date.now() - t0 < 1000) { playGame([L0, HUMAN, HUMAN, HUMAN], { dbl: 0 }, 5000 + n); n++; }
ok(n > 50, 'швидкість', n + ' партій/с на одному ядрі');
console.log(fail ? `\nАрена self-play: ${fail} помилок` : '\nАрена self-play: усе пройдено');
process.exit(fail ? 1 : 0);
