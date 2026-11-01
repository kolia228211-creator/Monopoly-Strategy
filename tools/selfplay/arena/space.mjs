// Простір пошуку арени: ті самі назви, що в src/helper/params.js (BASE/TUNED), межі ширші за evolve.mjs.
import { BASE, TUNED } from '../../../src/helper/params.js';

export const SPACE = [
  ['stageEarly', 0.7, 1.7], ['stageLate', 0.4, 1.6], ['H', 8, 50], ['complete', 0, 1.5], ['step', 0, 0.8], ['block', 0, 1.5], ['air', 0, 1.2],
  ['buyMin', 0, 1.6], ['resBase', 0, 300], ['resLate', 0, 500], ['aucMult', 0.6, 2.2], ['aucKeep', 0, 250],
  ['bRes', 0, 400], ['bResGrow', 0, 10], ['maxLevel', 2, 5, 'int'], ['unmortCash', 100, 1200], ['jailU', 0, 0.9],
  ['trade', 0, 1], ['buyShare', 0, 1.6], ['swapPay', 0, 2], ['deny', 0, 2], ['acceptMargin', -100, 300], ['buildCashLots', 0, 3],
  ['openMult', 1, 2.5], ['floorInSwap', 0, 1, 'bool'], ['jailDanger', 1, 6, 'int'], ['mortForBuild', 0, 1, 'bool']
];
export const D = SPACE.length;
export const V04 = { ...BASE };
export const V050 = (dbl) => ({ ...BASE, ...(TUNED[dbl ? 'dbl1' : 'dbl0'] || {}) });

export function encode(params) {
  return SPACE.map(([k, lo, hi]) => Math.min(1, Math.max(0, ((params[k] ?? BASE[k]) - lo) / (hi - lo))));
}
export function decode(x, base = BASE) {
  const p = { ...base };
  SPACE.forEach(([k, lo, hi, ty], d) => {
    const u = Math.min(1, Math.max(0, x[d]));
    let v = lo + u * (hi - lo);
    if (ty === 'int') v = Math.round(v); else if (ty === 'bool') v = u >= 0.5 ? 1 : 0; else v = Math.round(v * 1000) / 1000;
    p[k] = v;
  });
  return p;
}
