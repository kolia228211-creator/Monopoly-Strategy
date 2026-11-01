// Вписує параметри, знайдені в арені, у src/helper/params.js (TUNED.dbl0 / TUNED.dbl1), зберігаючи meta.
// node tools/selfplay/arena/embed.mjs --validate tools/selfplay/out/arena-validate.json [--dbl0 file] [--dbl1 file] [--only 0|1]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { TUNED } from '../../../src/helper/params.js';
import { SPACE } from './space.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const file = new URL('../../../src/helper/params.js', import.meta.url);
let src = readFileSync(file, 'utf8');
const val = JSON.parse(readFileSync(arg('validate', 'tools/selfplay/out/arena-validate.json'), 'utf8'));
const date = new Date().toISOString().slice(0, 10);
const T = JSON.parse(JSON.stringify(TUNED));
const notes = [];
let totalGames = 0;
for (const dbl of [0, 1]) {
  if (arg('only') != null && +arg('only') !== dbl) continue;
  const f = arg('dbl' + dbl, `tools/selfplay/out/arena-dbl${dbl}.json`);
  if (!existsSync(f)) continue;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const p = val.cand[dbl];
  const key = 'dbl' + dbl, prev = T[key] || {};
  T[key] = { ...prev };
  for (const [k] of SPACE) T[key][k] = p[k];
  const gens = j.log.filter((e) => e.gen >= 0).length;
  totalGames += gens * j.lambda * j.games;
  const rows = val.rows.filter((r) => r.dbl === dbl && r.opp === 'людиноподібні');
  const pr = (k) => rows.map((r) => (r[k] * 100).toFixed(0)).join('/');
  notes.push(`// x2 ${dbl ? 'ON' : 'OFF'}: проти людиноподібних (3/4/5/6 гравців) v0.4 ${pr('v0.4')}% → v0.5.0 ${pr('v0.5.0')}% → v0.5.1 ${pr('v0.5.1')}%`);
  T.meta = T.meta || {};
  T.meta.arena = T.meta.arena || {};
  T.meta.arena[key] = { date, gens, gamesPerCand: j.games, lambda: j.lambda, vsHumans: rows.map((r) => ({ n: r.n, v04: +r['v0.4'].toFixed(4), v050: +r['v0.5.0'].toFixed(4), v051: +r['v0.5.1'].toFixed(4) })) };
}
const header = `// Арена self-play ${date} (tools/selfplay/arena, sep-CMA-ES від v0.5.0, ~${Math.round(totalGames / 1000)} тис. партій + ${val.games * 6} перевірочних):\n${notes.join('\n')}\n`;
const re = /export const TUNED = \{[\s\S]*?\n\};/;
if (!re.test(src)) throw new Error('TUNED block not found');
src = src.replace(/\/\/ Арена self-play[^\n]*\n(\/\/ x2[^\n]*\n)*/, '');
src = src.replace(re, header + 'export const TUNED = ' + JSON.stringify(T, null, 1) + ';');
writeFileSync(file, src);
console.log(header);
