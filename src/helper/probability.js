// Частоти потрапляння на клітинки за один хід гравця (з дублями, картками, тюрмою, відпусткою).
// Рахується симуляцією однієї фішки по справжній дошці кімнати; результат кешується за mapId.
import { rng, die } from './rng.js';
import { prisonIndex, vacationIndex } from './rules.js';

function cardMove(effect, pos, blocks) {
  switch (effect.type) {
    case 'move-to-block': return effect.blockIndex;
    case 'move-steps': return (pos + effect.steps + blocks.length) % blocks.length;
    case 'go-to-prison': return -1;
    case 'move-to-next-grouped': {
      const t = effect.group === 'airport' ? 'airport' : 'company';
      for (let k = 1; k <= blocks.length; k++) { const j = (pos + k) % blocks.length; if (blocks[j].type === t) return j; }
      return pos;
    }
    default: return null;
  }
}

/**
 * @param s  стан кімнати
 * @param jail 'leave' — платити й виходити одразу; 'stay' — сидіти, поки не викинеш дубль (до 3 ходів)
 * @returns Float64Array(40): очікувана кількість потраплянь на клітинку за хід
 */
export function landingFrequencies(s, jail = 'leave', turns = 120000, seed = 7) {
  const blocks = s.blocks, N = blocks.length, R = rng(seed);
  const prison = prisonIndex(s), vac = vacationIndex(s);
  const decks = {
    treasure: (s.bonusCards?.treasure?.cards || []).map((c) => c.effect),
    surprise: (s.bonusCards?.surprise?.cards || []).map((c) => c.effect)
  };
  const cnt = new Float64Array(N);
  let pos = 0, jailTurns = -1, skip = 0;
  for (let t = 0; t < turns; t++) {
    if (skip > 0) { skip--; continue; }
    let rolls = 0;
    while (true) {
      const a = die(R), b = die(R), dbl = a === b;
      if (jailTurns >= 0) {
        if (jail === 'leave' || dbl || jailTurns >= 2) { jailTurns = -1; }
        else { jailTurns++; break; }
        pos = (pos + a + b) % N;
        rolls = 3; // після виходу з тюрми додаткового кидка немає
      } else {
        rolls++;
        if (dbl && rolls === 3) { pos = prison; jailTurns = 0; break; }
        pos = (pos + a + b) % N;
      }
      cnt[pos]++;
      const bl = blocks[pos];
      if (bl.cornerType === 'go-to-prison') { pos = prison; jailTurns = 0; break; }
      if (bl.type === 'bonus' && decks[bl.bonusType] && decks[bl.bonusType].length) {
        const d = decks[bl.bonusType], e = d[Math.floor(R() * d.length)], np = cardMove(e, pos, blocks);
        if (np === -1) { pos = prison; jailTurns = 0; break; }
        if (np != null && np !== pos) {
          pos = np; cnt[pos]++;
          if (blocks[pos].cornerType === 'go-to-prison') { pos = prison; jailTurns = 0; break; }
        }
      }
      if (pos === vac) { skip = (blocks[vac].suspensionAmount ?? 1); break; }
      if (!dbl || rolls >= 3) break;
    }
  }
  for (let i = 0; i < N; i++) cnt[i] /= turns;
  return cnt;
}

const cache = new Map();
export function boardProbs(s) {
  const key = (s.mapId || 'map') + ':' + s.blocks.length + ':' + (s.bonusCards?.surprise?.cards?.length || 0);
  if (!cache.has(key)) cache.set(key, { leave: landingFrequencies(s, 'leave'), stay: landingFrequencies(s, 'stay', 120000, 11) });
  return cache.get(key);
}

// Розподіл суми двох кубиків
export const DICE = (() => { const p = new Array(13).fill(0); for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) p[a + b] += 1 / 36; return p; })();
