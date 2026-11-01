// Еволюційний пошук стратегії (ES з common random numbers) на worker_threads.
// node tools/selfplay/evolve.mjs --dbl 1 --gens 50 --games 480 --out tools/selfplay/out/best-dbl1.json
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { makeState } from '../mock-state.mjs';
import { makeBoard, playGame, DEFAULT, BOUNDS, humanLike } from './engine.mjs';
import { rng } from '../../src/helper/rng.js';

const KEYS = Object.keys(BOUNDS);
const toVec = (p) => KEYS.map((k) => (p[k] - BOUNDS[k][0]) / (BOUNDS[k][1] - BOUNDS[k][0]));
const toParams = (v) => Object.fromEntries(KEYS.map((k, i) => [k, BOUNDS[k][0] + Math.min(1, Math.max(0, v[i])) * (BOUNDS[k][1] - BOUNDS[k][0])]));

// Розклад партій: розмір столу, місце кандидата, суперники (індекси в пулі), seed
function schedule(nGames, seed, poolSize) {
  const R = rng(seed), out = [];
  for (let g = 0; g < nGames; g++) {
    const size = [3, 4, 4, 4, 5, 6][Math.floor(R() * 6)];
    const opp = Array.from({ length: size - 1 }, () => Math.floor(R() * poolSize));
    out.push({ size, seat: Math.floor(R() * size), opp, seed: Math.floor(R() * 2 ** 31), hr: Math.floor(R() * 2 ** 31) });
  }
  return out;
}

if (!isMainThread) {
  const B = makeBoard(makeState());
  parentPort.on('message', ({ id, cand, pool, games, dbl }) => {
    let wins = 0, share = 0;
    for (const g of games) {
      const R = rng(g.hr);
      const others = g.opp.map((k) => (pool[k] === 'human' ? humanLike(R) : pool[k]));
      const params = others.slice(); params.splice(g.seat, 0, cand);
      const r = playGame(B, params, g.seed, { dbl });
      if (r.winner === g.seat) { wins++; share += g.size / 4; } // нормуємо на стіл з 4
    }
    parentPort.postMessage({ id, wins, n: games.length, share });
  });
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const DBL = arg('dbl', '1') === '1', GENS = +arg('gens', 40), GAMES = +arg('games', 480), LAMBDA = +arg('lambda', 14), MU = +arg('mu', 4);
  const OUT = arg('out', `tools/selfplay/out/best-dbl${DBL ? 1 : 0}.json`);
  const nW = Math.max(1, os.cpus().length);
  const workers = Array.from({ length: nW }, () => new Worker(new URL(import.meta.url), { workerData: {} }));
  let jid = 0; const pending = new Map();
  workers.forEach((w) => w.on('message', (m) => { pending.get(m.id)(m); pending.delete(m.id); }));
  const run = (w, payload) => new Promise((res) => { const id = jid++; pending.set(id, res); w.postMessage({ id, ...payload }); });
  async function evaluate(cands, pool, games) {
    // кожного кандидата ділимо між воркерами
    return Promise.all(cands.map(async (c) => {
      const parts = workers.map((w, k) => run(w, { cand: c, pool, games: games.filter((_, i) => i % nW === k), dbl: DBL }));
      const rs = await Promise.all(parts);
      const wins = rs.reduce((a, r) => a + r.wins, 0), n = rs.reduce((a, r) => a + r.n, 0), share = rs.reduce((a, r) => a + r.share, 0);
      return { wr: wins / n, norm: share / n };
    }));
  }
  const fame = [];
  let mean = toVec(DEFAULT), sigma = 0.15, best = { p: DEFAULT, fit: -1 };
  const R = rng(DBL ? 77 : 78);
  const gauss = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const log = [];
  const t0 = Date.now();
  for (let gen = 0; gen < GENS; gen++) {
    // пул суперників: дефолт, людиноподібні (×2 ваги), зал слави (до 3 найкращих)
    const pool = [DEFAULT, 'human', 'human', ...fame.slice(-3)];
    const games = schedule(GAMES, 1000 + gen * 7919, pool.length);
    const vecs = [mean.slice()];
    for (let k = 1; k < LAMBDA; k++) vecs.push(mean.map((x) => Math.min(1, Math.max(0, x + sigma * gauss()))));
    const cands = vecs.map(toParams); cands.forEach((c) => { c.maxLevel = Math.round(c.maxLevel); });
    const res = await evaluate(cands, pool, games);
    const order = res.map((r, i) => [r.norm, i]).sort((a, b) => b[0] - a[0]);
    const elite = order.slice(0, MU).map(([, i]) => vecs[i]);
    const w = elite.map((_, i) => Math.log(MU + 0.5) - Math.log(i + 1)), ws = w.reduce((a, b) => a + b, 0);
    mean = KEYS.map((_, d) => elite.reduce((a, v, i) => a + v[d] * w[i] / ws, 0));
    sigma = Math.max(0.03, sigma * 0.97);
    const top = order[0];
    if (gen % 5 === 4) fame.push(cands[top[1]]);
    log.push({ gen, best: +top[0].toFixed(4), meanCand: +res[0].norm.toFixed(4), sigma: +sigma.toFixed(3) });
    console.log(`gen ${gen}: кращий ${(100 * top[0]).toFixed(1)}% (норм. на стіл з 4), поточне середнє ${(100 * res[0].norm).toFixed(1)}%, σ ${sigma.toFixed(3)}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
  // Валідація: середнє (mean) і дефолт на окремих seed проти дефолт+людиноподібних
  const finalP = toParams(mean); finalP.maxLevel = Math.round(finalP.maxLevel);
  const valPool = [DEFAULT, 'human', 'human'];
  const val = schedule(6000, 424242, valPool.length);
  const [vBest, vDef] = await evaluate([finalP, DEFAULT], valPool, val);
  const humanOnly = schedule(4000, 515151, 1);
  const [hBest, hDef] = await evaluate([finalP, DEFAULT], ['human'], humanOnly);
  const result = { dbl: DBL, gens: GENS, gamesPerCand: GAMES, lambda: LAMBDA, totalGames: GENS * LAMBDA * GAMES + 2 * (6000 + 4000),
    params: finalP, default: DEFAULT,
    validation: { mixed: { best: vBest, default: vDef }, vsHumans: { best: hBest, default: hDef } }, log };
  await mkdir(new URL('./out/', import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(result, null, 1));
  console.log('ВАЛІДАЦІЯ (норм. на стіл з 4, рівний шанс = 25%):');
  console.log(`  проти суміші: знайдене ${(100 * vBest.norm).toFixed(1)}%  vs  дефолт ${(100 * vDef.norm).toFixed(1)}%`);
  console.log(`  проти людиноподібних: знайдене ${(100 * hBest.norm).toFixed(1)}%  vs  дефолт ${(100 * hDef.norm).toFixed(1)}%`);
  console.log(JSON.stringify(finalP));
  workers.forEach((w) => w.terminate());
}
