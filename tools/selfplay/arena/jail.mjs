// Тюрма: чи виходити попри чужі будинки, коли вільно багато ділянок (jailFree = частка вільних, вище якої небезпека ігнорується).
import { makePool } from './pool.mjs'; import { V050 } from './space.mjs';
const pool = makePool(); const G = +(process.argv[2] || 20000);
for (const dbl of [0, 1]) { const b = V050(dbl);
  for (const jf of [9, 0.6, 0.45, 0.3, 0.15]) {
    const o = { dbl, mix: { human: 0.5, def: 0.5, hof: 0 }, defBot: b };
    const a = await pool.evalRange({ ...b, jailFree: jf }, { ...o, from: 70_000_000, to: 70_000_000 + G });
    const e = await pool.evalRange({ ...b, jailFree: jf }, { ...o, from: 70_000_000, to: 70_000_000 + G / 2, engine: 'evolve', hof: [b] });
    console.log(`x2=${dbl} jailFree=${jf}: арена ${a.mean.toFixed(3)}±${a.se.toFixed(3)}  evolve ${e.mean.toFixed(3)}±${e.se.toFixed(3)}`);
  } }
pool.close();
