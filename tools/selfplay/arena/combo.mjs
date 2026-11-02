// Перевірка комбінації дрібних покращень на свіжих seed (3-6 гравців, суміш людиноподібних і v0.5.0).
// node tools/selfplay/arena/combo.mjs --games 30000 --out tools/selfplay/out/mass/combo.json
import { writeFileSync } from 'node:fs';
import { makePool } from './pool.mjs';
import { V050 } from './space.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GAMES = +arg('games', 30000), OUT = arg('out', 'tools/selfplay/out/mass/combo.json');
const pool = makePool(); const res = {};
for (const dbl of [0, 1]) {
  const b = V050(dbl);
  const V = { 'база': b, 'swapPay 0': { ...b, swapPay: 0 }, 'swapPay 0 + floor 0': { ...b, swapPay: 0, floorInSwap: 0 },
    'swapPay 0 + floor 0 + лише гроші': { ...b, swapPay: 0, floorInSwap: 0, swapOn: 0 } };
  res[dbl] = {};
  for (const [name, c] of Object.entries(V)) {
    const r = await pool.evalRange(c, { from: 50_000_000, to: 50_000_000 + GAMES, dbl, mix: { human: 0.5, def: 0.5, hof: 0 }, defBot: b });
    res[dbl][name] = { mean: r.mean, se: r.se, by: Object.fromEntries(Object.entries(r.by).map(([n, x]) => [n, x.w / x.g * n])) };
    console.log(`x2=${dbl} ${name.padEnd(36)} ${r.mean.toFixed(3)}±${r.se.toFixed(3)}  ` + Object.entries(res[dbl][name].by).map(([n, v]) => n + ':' + v.toFixed(2)).join(' '));
  }
}
writeFileSync(OUT, JSON.stringify(res, null, 1)); pool.close();
