// Перевірка параметрів, знайдених окремо під розмір столу, на свіжих seed (арена + evolve), проти поточних єдиних.
// node tools/selfplay/arena/bysize-validate.mjs --games 20000
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { makePool } from './pool.mjs';
import { V050 } from './space.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GAMES = +arg('games', 20000), DIR = 'tools/selfplay/out/bysize';
const pool = makePool(); const out = [];
for (const n of [3, 4, 5, 6]) for (const dbl of [1, 0]) {
  const f = `${DIR}/n${n}-dbl${dbl}.json`; if (!existsSync(f)) continue;
  const j = JSON.parse(readFileSync(f, 'utf8')), cand = j.bestEver?.params || j.final, base = V050(dbl);
  const o = { from: 60_000_000 + n * 1_000_000, to: 60_000_000 + n * 1_000_000 + GAMES, dbl, sizes: [n], mix: { human: 0.5, def: 0.5, hof: 0 }, defBot: base };
  const r = {};
  for (const [name, c] of [['base', base], ['cand', cand]]) {
    const a = await pool.evalRange(c, o), e = await pool.evalRange(c, { ...o, engine: 'evolve', hof: [base] });
    r[name] = { arena: a.mean, arenaSe: a.se, evolve: e.mean, evolveSe: e.se, avg: (a.mean + e.mean) / 2, se: Math.hypot(a.se, e.se) / 2 };
  }
  const row = { n, dbl, ...r, gain: r.cand.avg - r.base.avg, gainArena: r.cand.arena - r.base.arena, gainEvolve: r.cand.evolve - r.base.evolve };
  out.push(row);
  console.log(`n=${n} x2=${dbl}: база ${r.base.avg.toFixed(3)} → кандидат ${r.cand.avg.toFixed(3)} (±${r.base.se.toFixed(3)})  Δарена ${row.gainArena.toFixed(3)}  Δevolve ${row.gainEvolve.toFixed(3)}`);
}
writeFileSync(`${DIR}/validate.json`, JSON.stringify(out, null, 1)); pool.close();
