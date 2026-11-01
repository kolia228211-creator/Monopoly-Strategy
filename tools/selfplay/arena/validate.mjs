// Перевірка на окремих seed: v0.4 (BASE) → v0.5.0 (TUNED) → кандидат арени, для 3–6 гравців і різних суперників.
// Плюс перехресна перевірка в рушії evolve.mjs (tools/selfplay/engine.mjs) з його людиноподібними ботами.
// node tools/selfplay/arena/validate.mjs --games 24000 --out tools/selfplay/out/arena-validate.json
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { makePool } from './pool.mjs';
import { V04, V050 } from './space.mjs';
import { makeState } from '../../mock-state.mjs';
import { makeBoard, playGame as playOld, humanLike, DEFAULT as OLD_DEFAULT } from '../engine.mjs';
import { rng } from '../../../src/helper/rng.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GAMES = +arg('games', 24000), OUT = arg('out', 'tools/selfplay/out/arena-validate.json');
const pool = makePool();
const candOf = (dbl) => {
  const f = arg('cand' + dbl, `tools/selfplay/out/arena-dbl${dbl}.json`);
  if (existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); return j.bestEver?.params || j.final; }
  return V050(dbl);
};
const OPP = (dbl) => ({ 'людиноподібні': [{ human: 1, def: 0, hof: 0 }, V04], 'v0.4': [{ human: 0, def: 1, hof: 0 }, V04], 'v0.5.0': [{ human: 0, def: 1, hof: 0 }, V050(dbl)],
  'суміш (люди + v0.5.0)': [{ human: 0.5, def: 0.5, hof: 0 }, V050(dbl)] });
const res = { games: GAMES, date: new Date().toISOString(), rows: [], cross: [], cand: {} };
for (const dbl of [0, 1]) {
  const C = candOf(dbl); res.cand[dbl] = C;
  const bots = { 'v0.4': V04, 'v0.5.0': V050(dbl), 'v0.5.1': C };
  for (const [oname, [mix, defBot]] of Object.entries(OPP(dbl))) {
    for (const n of [3, 4, 5, 6]) {
      const o = { from: 30_000_000 + n * 1_000_000, to: 30_000_000 + n * 1_000_000 + GAMES / 4, dbl, mix, sizes: [n], defBot };
      const row = { dbl, opp: oname, n, fair: 1 / n };
      for (const [bn, b] of Object.entries(bots)) { const r = await pool.evalRange(b, o); row[bn] = r.wins / r.games; row[bn + 'Se'] = r.se / n; }
      res.rows.push(row);
      console.log(`x2=${dbl} ${oname} n=${n}: ` + Object.keys(bots).map((k) => `${k} ${(row[k] * 100).toFixed(1)}%`).join('  ') + `  (чесна ${(100 / n).toFixed(1)}%)`);
    }
  }
  // перехресна перевірка в рушії evolve.mjs (один потік; людиноподібні з того рушія)
  const B = makeBoard(makeState());
  for (const [pname, pool2] of [['людиноподібні (evolve)', ['human']], ['v0.4 + людиноподібні (evolve)', [OLD_DEFAULT, 'human', 'human']]]) {
    const row = { dbl, opp: pname };
    for (const [bn, b] of Object.entries(bots)) {
      let share = 0; const n0 = +arg('cross', 6000);
      for (let g = 0; g < n0; g++) {
        const R = rng(4_000_000 + g * 13 + dbl), size = [3, 4, 5, 6][g % 4], seat = Math.floor(R() * size);
        const others = Array.from({ length: size - 1 }, () => { const x = pool2[Math.floor(R() * pool2.length)]; return x === 'human' ? humanLike(R) : x; });
        others.splice(seat, 0, b);
        const r = playOld(B, others, 5_000_000 + g, { dbl: !!dbl });
        if (r.winner === seat) share += size;
      }
      row[bn] = share / n0;
    }
    res.cross.push(row);
    console.log(`x2=${dbl} ${pname} (відносно, 1.0 = чесна частка): ` + Object.keys(bots).map((k) => `${k} ${row[k].toFixed(3)}`).join('  '));
  }
}
writeFileSync(OUT, JSON.stringify(res, null, 1));
pool.close();
