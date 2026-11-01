// Швидкий бенчмарк і санітарні перевірки self-play рушія
import { makeState } from '../mock-state.mjs';
import { makeBoard, playGame, DEFAULT, humanLike } from './engine.mjs';
import { rng } from '../../src/helper/rng.js';

const B = makeBoard(makeState());
const t0 = performance.now();
let n = 0, rounds = 0, trades = 0, timeouts = 0; const wins = [0, 0, 0, 0];
for (let s = 0; s < 2000; s++) {
  const r = playGame(B, [DEFAULT, DEFAULT, DEFAULT, DEFAULT], 1000 + s);
  n++; rounds += r.rounds; trades += r.trades; timeouts += r.timeout ? 1 : 0; if (r.winner >= 0) wins[r.winner]++;
}
const dt = (performance.now() - t0) / 1000;
console.log(`дефолт×4: ${n} партій за ${dt.toFixed(1)} с (${Math.round(n / dt)}/с), раундів ${(rounds / n).toFixed(0)}, обмінів ${(trades / n).toFixed(2)}, таймаутів ${timeouts}, перемоги по місцях ${wins.join('/')}`);

// дефолт проти 3 людиноподібних
const R = rng(5); let w0 = 0; const N2 = 2000;
for (let s = 0; s < N2; s++) { const r = playGame(B, [DEFAULT, humanLike(R), humanLike(R), humanLike(R)], 5000 + s); if (r.winner === 0) w0++; }
console.log(`дефолт проти 3 людиноподібних: перемог ${(100 * w0 / N2).toFixed(1)}% (рівний шанс 25%)`);
// людиноподібний проти 3 дефолтних
let w1 = 0; for (let s = 0; s < N2; s++) { const r = playGame(B, [humanLike(R), DEFAULT, DEFAULT, DEFAULT], 9000 + s); if (r.winner === 0) w1++; }
console.log(`людиноподібний проти 3 дефолтних: ${(100 * w1 / N2).toFixed(1)}%`);
// без торгівлі проти торгівлі
const noTrade = { ...DEFAULT, trade: 0 };
let w2 = 0; for (let s = 0; s < N2; s++) { const r = playGame(B, [noTrade, DEFAULT, DEFAULT, DEFAULT], 13000 + s); if (r.winner === 0) w2++; }
console.log(`без обмінів проти 3 дефолтних: ${(100 * w2 / N2).toFixed(1)}%`);
