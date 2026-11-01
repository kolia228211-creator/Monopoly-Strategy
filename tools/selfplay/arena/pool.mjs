// Пул worker_threads: розкидає оцінки на всі ядра.
import { Worker } from 'node:worker_threads';
import os from 'node:os';

export function makePool(nw = os.cpus().length) {
  const workers = [], queue = [], idle = [];
  let nextId = 1; const pending = new Map();
  for (let i = 0; i < nw; i++) {
    const w = new Worker(new URL('./worker.mjs', import.meta.url));
    w.on('message', (m) => { const cb = pending.get(m.id); pending.delete(m.id); cb(m); idle.push(w); pump(); });
    w.on('error', (e) => { console.error('worker error', e); process.exit(1); });
    workers.push(w); idle.push(w);
  }
  function pump() { while (idle.length && queue.length) { const w = idle.pop(), t = queue.shift(); w.postMessage(t); } }
  function run(cand, opts) { return new Promise((res) => { const id = nextId++; pending.set(id, res); queue.push({ id, cand, opts }); pump(); }); }
  // оцінити cand на [from,to), порізавши на шматки
  async function evalRange(cand, opts, chunk = 250) {
    const parts = [];
    for (let s = opts.from; s < opts.to; s += chunk) parts.push(run(cand, { ...opts, from: s, to: Math.min(opts.to, s + chunk) }));
    const rs = await Promise.all(parts);
    const out = { score: 0, sq: 0, wins: 0, games: 0, by: {} };
    for (const r of rs) {
      out.score += r.score; out.sq += r.sq; out.wins += r.wins; out.games += r.games;
      for (const [n, b] of Object.entries(r.by)) { const o = out.by[n] || (out.by[n] = { g: 0, w: 0 }); o.g += b.g; o.w += b.w; }
    }
    out.mean = out.score / out.games;
    out.se = Math.sqrt(Math.max(0, out.sq / out.games - out.mean ** 2) / out.games);
    return out;
  }
  return { run, evalRange, close: () => workers.forEach((w) => w.terminate()), size: nw };
}
