// Відкриті питання: варіанти стратегії проти суміші людиноподібних ботів і v0.5.0 (окремі seed).
// Запуск: node tools/selfplay/arena/experiments.mjs --games 8000 --out tools/selfplay/out/arena-exp.json
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { makePool } from './pool.mjs';
import { V04, V050 } from './space.mjs';
import { playGame, HUMAN, BOARD } from './engine.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GAMES = +arg('games', 8000), OUT = arg('out', 'tools/selfplay/out/arena-exp.json');
const pool = makePool();
const results = { games: GAMES, date: new Date().toISOString(), dbl: {} };

function baseFor(dbl) {
  const f = arg('base' + dbl, `tools/selfplay/out/arena-dbl${dbl}.json`);
  if (f && existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); return j.bestEver?.params || j.final; }
  return V050(dbl);
}

const VARIANTS = (b, dbl) => ({
  'база (v0.5.1)': b, 'v0.5.0': V050(dbl), 'v0.4': V04,
  'купувати все підряд': { ...b, buyAll: 1 },
  'купувати лише з великим запасом': { ...b, buyMin: Math.max(1.1, b.buyMin), resBase: 300, resLate: 300 },
  'аукціон ×0.8': { ...b, aucMult: 0.8 }, 'аукціон ×1.0': { ...b, aucMult: 1.0 }, 'аукціон ×1.2': { ...b, aucMult: 1.2 },
  'аукціон ×1.5': { ...b, aucMult: 1.5 }, 'аукціон ×1.9': { ...b, aucMult: 1.9 },
  'не брати Британію і США': { ...b, avoid: ['united-kingdom', 'united-states-of-america'] },
  'не брати Бразилію й Ізраїль': { ...b, avoid: ['brazil', 'israel'] },
  'будинки до 1': { ...b, maxLevel: 1 }, 'будинки до 2': { ...b, maxLevel: 2 }, 'будинки до 3': { ...b, maxLevel: 3 },
  'будинки до 4': { ...b, maxLevel: 4 }, 'готелі (до 5)': { ...b, maxLevel: 5 },
  'тюрма: завжди виходити': { ...b, jailU: -1, jailDanger: 99 },
  'тюрма: завжди сидіти': { ...b, jailU: 2 },
  'тюрма: сидіти, якщо в суперників ≥1 будинку': { ...b, jailDanger: 1 },
  'тюрма: сидіти, якщо ≥3 будинки': { ...b, jailDanger: 3 },
  'обміни: лише 1↔1': { ...b, cashBuyOn: 0 }, 'обміни: лише купівля за гроші': { ...b, swapOn: 0 },
  '1↔1 без доплати': { ...b, swapPay: 0 }, 'без власних пропозицій обміну': { ...b, tradeOn: 0 },
  'floor і в 1↔1: так': { ...b, floorInSwap: 1 }, 'floor і в 1↔1: ні': { ...b, floorInSwap: 0 },
  'застава під будинки: так': { ...b, mortForBuild: 1 }, 'застава під будинки: ні': { ...b, mortForBuild: 0 }
});

for (const dbl of [0, 1]) {
  const b = baseFor(dbl), out = results.dbl[dbl] = { variants: {}, vac: {}, sets: {} };
  for (const [name, cand] of Object.entries(VARIANTS(b, dbl))) {
    const r = await pool.evalRange(cand, { from: 5_000_000, to: 5_000_000 + GAMES, dbl, mix: { human: 0.5, def: 0.5, hof: 0 }, defBot: V050(dbl) });
    const rh = await pool.evalRange(cand, { from: 6_000_000, to: 6_000_000 + GAMES / 2, dbl, mix: { human: 1, def: 0, hof: 0 } });
    out.variants[name] = { mix: r.mean, mixSe: r.se, human: rh.mean, humanSe: rh.se, by: r.by };
    console.log(`dbl${dbl} ${name.padEnd(28)} mix ${r.mean.toFixed(3)}±${r.se.toFixed(3)}  vsHuman ${rh.mean.toFixed(3)}±${rh.se.toFixed(3)}`);
  }
  // Vacation cash: вплив на довжину партії й перевагу навченого бота
  for (const vac of [true, false]) {
    const r = await pool.evalRange(b, { from: 7_000_000, to: 7_000_000 + GAMES / 2, dbl, vacCash: vac, mix: { human: 1, def: 0, hof: 0 } });
    let rounds = 0, pot = 0, to = 0; const n = 1500;
    for (let s = 0; s < n; s++) { const r2 = playGame([b, HUMAN, HUMAN, HUMAN].map((x, k, a) => a[(k + s) % 4]), { dbl, vacCash: vac }, 77_000 + s); rounds += r2.rounds; pot += r2.G.stats.pot; to += r2.timeout; }
    out.vac[vac ? 'on' : 'off'] = { vsHuman: r.mean, se: r.se, rounds: rounds / n, potPerGame: pot / n, timeout: to / n };
    console.log(`dbl${dbl} vacCash ${vac}: vsHuman ${r.mean.toFixed(3)} rounds ${(rounds / n).toFixed(1)} pot ${(pot / n).toFixed(0)}`);
  }
  // Хто зібрав набір першим — шанс перемоги (навчені боти, 4 гравці)
  const cnt = {}, win = {}; const n = 6000;
  for (let s = 0; s < n; s++) {
    const r = playGame([b, b, b, b], { dbl }, 88_000 + s);
    BOARD.cityGroups.forEach((g) => { const o = r.G.setFirst[g]; if (o < 0) return; const k = BOARD.gname[g]; cnt[k] = (cnt[k] || 0) + 1; if (o === r.winner) win[k] = (win[k] || 0) + 1; });
  }
  for (const k of Object.keys(cnt)) out.sets[k] = { pSet: cnt[k] / n, pWinIfSet: (win[k] || 0) / cnt[k] };
  console.log('sets', JSON.stringify(out.sets));
  writeFileSync(OUT, JSON.stringify(results, null, 1));
}
pool.close();
