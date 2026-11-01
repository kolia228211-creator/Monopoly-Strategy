// Відповіді на відкриті питання: варіації знайденої стратегії проти суміші (дефолт + людиноподібні).
// node tools/selfplay/questions.mjs tools/selfplay/out/best-dbl1.json
import { readFile, writeFile } from 'node:fs/promises';
import { makeState } from '../mock-state.mjs';
import { makeBoard, playGame, DEFAULT, humanLike } from './engine.mjs';
import { rng } from '../../src/helper/rng.js';
import { groupName } from '../../src/helper/rules.js';

const file = process.argv[2];
const res = JSON.parse(await readFile(file, 'utf8'));
const best = res.params, DBL = res.dbl, B = makeBoard(makeState());
const N = +(process.argv[3] || 6000);

function evalVariant(p, seed0, { pool = 'mixed' } = {}) {
  const R = rng(seed0); let w = 0, norm = 0;
  const groupWins = {}, groupHave = {};
  for (let g = 0; g < N; g++) {
    const size = [3, 4, 4, 4, 5, 6][Math.floor(R() * 6)], seat = Math.floor(R() * size);
    const others = Array.from({ length: size - 1 }, () => (pool === 'human' || R() < 0.6 ? humanLike(R) : DEFAULT));
    const ps = others.slice(); ps.splice(seat, 0, p);
    const r = playGame(B, ps, Math.floor(R() * 2 ** 31), { dbl: DBL });
    if (r.winner === seat) { w++; norm += size / 4; }
    const fs = r.firstSet?.[seat]; if (fs) { groupHave[fs] = (groupHave[fs] || 0) + 1; if (r.winner === seat) groupWins[fs] = (groupWins[fs] || 0) + 1; }
    else { groupHave.none = (groupHave.none || 0) + 1; if (r.winner === seat) groupWins.none = (groupWins.none || 0) + 1; }
  }
  return { wr: w / N, norm: norm / N, ci: 1.96 * Math.sqrt((norm / N) * (1 - norm / N) / N), groupWins, groupHave };
}
const pct = (x) => (100 * x).toFixed(1) + '%';
const variants = [
  ['знайдена стратегія', best],
  ['поточна (до self-play)', DEFAULT],
  ['купувати все підряд', { ...best, buyMin: 0, resBase: 0, resLate: 0 }],
  ['дуже обережна купівля', { ...best, buyMin: 1.2, resBase: 200, resLate: 300 }],
  ['аукціон: не вище ×0.8 цінності', { ...best, aucMult: 0.8 }],
  ['аукціон: переплачувати ×1.3', { ...best, aucMult: 1.3 }],
  ['будувати максимум до 3 будинків', { ...best, maxLevel: 3 }],
  ['будувати до 4 будинків', { ...best, maxLevel: 4 }],
  ['будувати до готелю', { ...best, maxLevel: 5 }],
  ['тюрма: завжди виходити', { ...best, jailU: 0 }],
  ['тюрма: майже завжди сидіти', { ...best, jailU: 0.8 }],
  ['без обмінів', { ...best, trade: 0 }],
  ['обмін 1↔1 без доплати', { ...best, swapPay: 0 }],
  ['не продавати ключові ділянки (deny ×1.2)', { ...best, deny: 1.2 }],
  ['легко продавати (deny 0.1)', { ...best, deny: 0.1 }]
];
const out = [];
for (const [name, p] of variants) {
  const r = evalVariant(p, 777);
  out.push({ name, ...r });
  console.log(`${name.padEnd(42)} ${pct(r.norm)} ±${pct(r.ci)}`);
}
// Які набори дають перемогу (для знайденої стратегії)
const g = out[0];
const sets = Object.keys(g.groupHave).map((k) => ({ group: k, name: k === 'none' ? 'жодного' : groupName(k), had: g.groupHave[k], winRate: (g.groupWins[k] || 0) / g.groupHave[k] })).sort((a, b) => b.winRate - a.winRate);
console.log('\nПерший зібраний набір → як часто перемагаєш:');
sets.forEach((x) => console.log(`  ${x.name.padEnd(12)} ${pct(x.winRate)} (партій з набором: ${x.had})`));
const vsH = evalVariant(best, 999, { pool: 'human' }), vsHd = evalVariant(DEFAULT, 999, { pool: 'human' });
console.log(`\nПроти лише людиноподібних: знайдена ${pct(vsH.norm)} vs поточна ${pct(vsHd.norm)}`);
await writeFile(file.replace('best-', 'questions-'), JSON.stringify({ dbl: DBL, games: N, variants: out.map(({ groupWins, groupHave, ...x }) => x), sets, vsHumans: { best: vsH.norm, current: vsHd.norm } }, null, 1));
