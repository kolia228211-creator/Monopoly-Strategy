// Пошук стратегій: sep-CMA-ES (діагональна коваріація) по параметрах з space.mjs.
// Фітнес: відносна частка перемог (1.0 = чесна частка 1/n) у турнірах 3–6 гравців проти суміші
// людиноподібних ботів, параметрів за замовчуванням і "залу слави" (найкращих попередніх).
// Старт — параметри v0.5.0 (TUNED), у залі слави від початку v0.5.0; "def" = v0.4 (BASE).
// Запуск: node tools/selfplay/arena/search.mjs --dbl 1 --gens 40 --games 1500 --out tools/selfplay/out/arena-dbl1.json
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { makePool } from './pool.mjs';
import { SPACE, D, encode, decode, V04, V050 } from './space.mjs';
import { DEFAULT_BOT } from './evaluate.mjs';
import { rng } from '../../../src/helper/rng.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dbl = +arg('dbl', 0), GENS = +arg('gens', 30), GAMES = +arg('games', 1500), LAMBDA = +arg('lambda', 16);
const OUT = arg('out', `tools/selfplay/out/arena-dbl${dbl}.json`), SIGMA0 = +arg('sigma', 0.18), SEED = +arg('seed', 1);
const VAL = +arg('val', 3000), RESUME = arg('resume', null), ROBUST = arg('robust', '0') === '1';
// --robust 1: фітнес = середнє двох рушіїв (арена + evolve.mjs) — стійкість до моделі суперників
const SIZES = arg('sizes', '3,4,5,6').split(',').map(Number); // --sizes 3 : окремий пошук під один розмір столу
const MIX = { human: 0.4, def: 0.2, hof: 0.4 };
const START = arg('start', 'tuned') === 'base' ? V04 : V050(dbl);

const pool = makePool();
const R = rng(SEED * 99991 + dbl);
const gauss = () => { let u = 0, v = 0; while (u === 0) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// CMA-ES константи
const mu = Math.floor(LAMBDA / 2);
let w = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
const ws = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / ws);
const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
const cs = (mueff + 2) / (D + mueff + 5), ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (D + 1)) - 1) + cs;
const cc = 4 / (D + 4), c1 = 2 / ((D + 1.3) ** 2 + mueff) * (D + 2) / 3;
const cmu = Math.min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((D + 2) ** 2 + mueff) * (D + 2) / 3);
const chiN = Math.sqrt(D) * (1 - 1 / (4 * D) + 1 / (21 * D * D));

let m = encode(START), sigma = SIGMA0, C = new Array(D).fill(1), ps = new Array(D).fill(0), pc = new Array(D).fill(0);
let hof = [START], log = [], gen0 = 0, bestEver = null;
if (RESUME && existsSync(RESUME)) {
  const st = JSON.parse(readFileSync(RESUME, 'utf8'));
  ({ m, sigma, C, ps, pc, hof, log } = st.state); gen0 = st.state.gen + 1; bestEver = st.bestEver;
  console.log('resume from gen', gen0);
}

// контроль: проти людиноподібних + v0.5.0 (те, що зараз у помічнику)
const valOpts = { from: 9_000_000, to: 9_000_000 + VAL, dbl, mix: { human: 0.5, def: 0.5, hof: 0 }, sizes: SIZES, defBot: V050(dbl) };
async function fit(cand, opts) {
  const a = await pool.evalRange(cand, opts);
  if (!ROBUST) return a;
  const e = await pool.evalRange(cand, { ...opts, sizes: SIZES, engine: 'evolve', hof: opts.hof ? opts.hof.slice(-3) : [] });
  return { mean: (a.mean + e.mean) / 2, se: Math.hypot(a.se, e.se) / 2, fa: a.mean, fe: e.mean };
}
async function valFit(cand) {
  const a = await pool.evalRange(cand, valOpts);
  if (!ROBUST) return a;
  const e = await pool.evalRange(cand, { from: valOpts.from, to: valOpts.to, dbl, sizes: SIZES, engine: 'evolve', hof: [V050(dbl)] });
  return { mean: (a.mean + e.mean) / 2, se: Math.hypot(a.se, e.se) / 2, fa: a.mean, fe: e.mean };
}
const t0 = Date.now();
if (!log.length) {
  const v = await valFit(START);
  log.push({ gen: -1, val: v.mean, valSe: v.se, valA: v.fa, valE: v.fe, note: 'start' });
  bestEver = { gen: -1, val: v.mean, se: v.se, x: m.slice(), params: START };
  console.log(`start: val ${v.mean.toFixed(3)} ± ${v.se.toFixed(3)}`);
}

for (let gen = gen0; gen < gen0 + GENS; gen++) {
  const pop = [];
  for (let k = 0; k < LAMBDA; k++) {
    const z = Array.from({ length: D }, gauss);
    const x = m.map((mi, d) => Math.min(1, Math.max(0, mi + sigma * Math.sqrt(C[d]) * z[d])));
    pop.push({ x });
  }
  const opts = { from: 100_000 + gen * GAMES, to: 100_000 + (gen + 1) * GAMES, dbl, mix: MIX, hof, sizes: SIZES };
  const res = await Promise.all(pop.map((c) => fit(decode(c.x), opts)));
  pop.forEach((c, k) => { c.f = res[k].mean; c.se = res[k].se; c.fa = res[k].fa; c.fe = res[k].fe; });
  pop.sort((a, b) => b.f - a.f);
  // оновлення
  const old = m.slice();
  m = m.map((_, d) => pop.slice(0, mu).reduce((a, c, i) => a + w[i] * c.x[d], 0));
  const step = m.map((v, d) => (v - old[d]) / sigma);
  ps = ps.map((v, d) => (1 - cs) * v + Math.sqrt(cs * (2 - cs) * mueff) * step[d] / Math.sqrt(C[d]));
  const psn = Math.sqrt(ps.reduce((a, b) => a + b * b, 0));
  const hs = psn / Math.sqrt(1 - (1 - cs) ** (2 * (gen + 1))) < (1.4 + 2 / (D + 1)) * chiN ? 1 : 0;
  pc = pc.map((v, d) => (1 - cc) * v + hs * Math.sqrt(cc * (2 - cc) * mueff) * step[d]);
  C = C.map((v, d) => (1 - c1 - cmu) * v + c1 * pc[d] ** 2 + cmu * pop.slice(0, mu).reduce((a, c, i) => a + w[i] * ((c.x[d] - old[d]) / sigma) ** 2, 0));
  sigma *= Math.exp((cs / ds) * (psn / chiN - 1));
  sigma = Math.min(0.4, Math.max(0.02, sigma));
  const entry = { gen, best: pop[0].f, bestSe: pop[0].se, popMean: pop.reduce((a, c) => a + c.f, 0) / LAMBDA, sigma };
  if ((gen + 1) % 5 === 0 || gen === gen0 + GENS - 1) {
    const cand = decode(m);
    const v = await valFit(cand);
    entry.val = v.mean; entry.valSe = v.se; entry.valA = v.fa; entry.valE = v.fe;
    hof.push(cand); if (hof.length > 6) hof.splice(1, 1); // v0.5.0 лишається в залі слави завжди
    if (!bestEver || v.mean > bestEver.val) bestEver = { gen, val: v.mean, se: v.se, x: m.slice(), params: cand };
  }
  log.push(entry);
  console.log(`gen ${gen} best ${entry.best.toFixed(3)} popMean ${entry.popMean.toFixed(3)} σ ${sigma.toFixed(3)}` + (entry.val != null ? ` VAL ${entry.val.toFixed(3)}±${entry.valSe.toFixed(3)}` + (ROBUST ? ` (арена ${entry.valA.toFixed(3)}, evolve ${entry.valE.toFixed(3)})` : '') : '') + ` t=${((Date.now() - t0) / 1000).toFixed(0)}s`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ dbl, robust: ROBUST, games: GAMES, lambda: LAMBDA, space: SPACE, final: decode(m), bestEver, log, state: { m, sigma, C, ps, pc, hof, log, gen } }, null, 1));
}
pool.close();
