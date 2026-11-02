// Оцінка набору параметрів у турнірах 3–6 гравців проти суміші суперників.
import { playGame, HUMAN } from './engine.mjs';
import { rng } from '../../../src/helper/rng.js';
import { BASE } from '../../../src/helper/params.js';

export const DEFAULT_BOT = { ...BASE };

// mix: { human, def, hof } — частки суперників; sizes — розміри столів
export function table(seed, cand, { mix = { human: 0.4, def: 0.3, hof: 0.3 }, sizes = [3, 4, 5, 6], hof = [], defBot = DEFAULT_BOT }) {
  const R = rng(seed * 2654435761 + 12345);
  const n = sizes[seed % sizes.length], seat = Math.floor(R() * n);
  const bots = [];
  const tot = mix.human + mix.def + (hof.length ? mix.hof : 0);
  for (let k = 0; k < n; k++) {
    if (k === seat) { bots.push(cand); continue; }
    const r = R() * tot;
    if (r < mix.human) bots.push(HUMAN); else if (r < mix.human + mix.def || !hof.length) bots.push(defBot); else bots.push(hof[Math.floor(R() * hof.length)]);
  }
  return { bots, seat, n };
}

/** Повертає суму "відносних перемог" (перемога × n; 1.0 = чесна частка), кількість партій і розбивку за n. */
export function evaluate(cand, { from, to, dbl, vacCash = true, mix, sizes, hof, defBot, maxRounds = 250 }) {
  let score = 0, wins = 0, games = 0, sq = 0;
  const by = {};
  for (let s = from; s < to; s++) {
    const { bots, seat, n } = table(s, cand, { mix, sizes, hof, defBot });
    const r = playGame(bots, { dbl, vacCash, maxRounds }, s * 7 + 3);
    const w = r.winner === seat ? 1 : 0;
    score += w * n; sq += (w * n) ** 2; wins += w; games++;
    const b = by[n] || (by[n] = { g: 0, w: 0 }); b.g++; b.w += w;
  }
  return { score, sq, wins, games, by };
}

// Той самий кандидат у рушії evolve.mjs (tools/selfplay/engine.mjs) з ЙОГО людиноподібними ботами —
// друга, незалежна модель суперників. Пул: v0.4, 2× людиноподібні, зал слави.
import { makeState } from '../../mock-state.mjs';
import { makeBoard, playGame as playOld, humanLike, DEFAULT as OLD_DEFAULT } from '../engine.mjs';
let OB = null;
export function evaluateEvolve(cand, { from, to, dbl, hof = [], humanOnly = false, sizes = [3, 4, 5, 6] }) {
  OB = OB || makeBoard(makeState());
  const poolB = humanOnly ? ['human'] : [OLD_DEFAULT, 'human', 'human', ...hof];
  let score = 0, sq = 0, wins = 0, games = 0; const by = {};
  for (let s = from; s < to; s++) {
    const R = rng(s * 2246822519 + 777), n = sizes[s % sizes.length], seat = Math.floor(R() * n);
    const ps = Array.from({ length: n - 1 }, () => { const x = poolB[Math.floor(R() * poolB.length)]; return x === 'human' ? humanLike(R) : x; });
    ps.splice(seat, 0, cand);
    const r = playOld(OB, ps, s * 11 + 5, { dbl: !!dbl });
    const w = r.winner === seat ? 1 : 0;
    score += w * n; sq += (w * n) ** 2; wins += w; games++;
    const b = by[n] || (by[n] = { g: 0, w: 0 }); b.g++; b.w += w;
  }
  return { score, sq, wins, games, by };
}
