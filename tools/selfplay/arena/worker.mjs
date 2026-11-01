import { parentPort } from 'node:worker_threads';
import { evaluate, evaluateEvolve } from './evaluate.mjs';
parentPort.on('message', (m) => {
  const r = m.opts.engine === 'evolve' ? evaluateEvolve(m.cand, m.opts) : evaluate(m.cand, m.opts);
  parentPort.postMessage({ id: m.id, ...r });
});
