// Розбір журналу, експортованого з панелі (кнопка «⤓ журнал»).
// Використання: node tools/analyze-journal.mjs richup-zhurnal-2026-11-01.json [ще файли...]
// Показує: як грають суперники, наскільки поради збігались з діями, і де поради могли помилятися.
import { readFile } from 'node:fs/promises';
import { summarize } from '../src/helper/learn.js';

const files = process.argv.slice(2);
if (!files.length) { console.log('Вкажи файл(и) журналу'); process.exit(1); }
const profiles = {}, games = new Map();
for (const f of files) {
  const d = JSON.parse(await readFile(f, 'utf8'));
  Object.assign(profiles, d.profiles || {});
  for (const g of d.journal || []) games.set(g.id, g);
}
const all = [...games.values()];
const name = (g, k) => (g.players.find((p) => p.key === k) || {}).name || k;

console.log(`\n=== Партій: ${all.length}, завершено: ${all.filter((g) => g.end).length} ===`);
for (const g of all) {
  const res = g.end ? `переможець ${name(g, g.end.winner)}${g.end.winner === g.me ? ' (ТИ)' : ''}, місце ${g.end.ranking.indexOf(g.me) + 1}/${g.players.length}` : 'не завершена';
  console.log(`- ${new Date(g.startedAt).toISOString().slice(0, 16)} кімната ${g.room}: ${g.players.map((p) => p.name).join(', ')} — ${res}; подій ${g.events.length}, рішень ${g.decisions.length}`);
}

console.log('\n=== Суперники ===');
for (const [k, p] of Object.entries(profiles)) {
  const s = summarize(p);
  console.log(`- ${s.name} [${k}] ігор ${s.games}: аукціон медіана ×${s.auctionMed?.toFixed(2) ?? '—'} p75 ×${s.auctionP75?.toFixed(2) ?? '—'} (${s.auctionN}, виграв ${s.auctionWins}); ` +
    `купує ${s.buyRate != null ? Math.round(s.buyRate * 100) + '%' : '—'} (${s.buyN}); обміни ${s.tradeAcc}/${s.tradeN}, мін. вигода при згоді ${s.minAcceptGain ?? '—'}; будинків ${s.houses}, застав ${s.mortgages}`);
}

console.log('\n=== Мої рішення проти порад ===');
const rows = [];
for (const g of all) for (const d of g.decisions) {
  const won = g.end ? g.end.winner === g.me : null;
  if (d.kind === 'buy') rows.push([d.kind, d.advice?.verdict ?? '—', d.action, d.advice?.win, won]);
  if (d.kind === 'auction') rows.push([d.kind, d.advice ? `макс $${d.advice.myMax}` : '—', d.won ? `виграв за $${d.paid}` : `зупинився на $${d.myLastBid}`, d.advice?.win, won]);
  if (d.kind === 'trade') rows.push([d.kind + ' ' + d.role, d.advice?.verdict ?? '—', d.cancelled ? 'скасовано' : d.accepted ? 'прийнято' : 'відхилено', d.advice?.win, won]);
}
const agree = rows.filter((r) => (r[0] === 'buy' && ((r[1] === 'buy') === (r[2] === 'buy'))) || (r[0].startsWith('trade') && r[1] !== '—' && ((r[1] === 'accept') === (r[2] === 'прийнято'))));
rows.forEach((r) => console.log(`- ${r[0]}: порада ${r[1]}, дія ${r[2]}, шанс тоді ${r[3] != null ? Math.round(r[3] * 100) + '%' : '—'}, партію ${r[4] == null ? '—' : r[4] ? 'виграно' : 'програно'}`));
console.log(`Збіг з порадою: ${agree.length}/${rows.filter((r) => r[1] !== '—').length}`);

// Калібрування: чи збігаються передбачені шанси з реальними перемогами
const cal = all.filter((g) => g.end).flatMap((g) => g.decisions.filter((d) => d.advice?.win != null).map((d) => [d.advice.win, g.end.winner === g.me ? 1 : 0]));
if (cal.length >= 5) {
  const avgPred = cal.reduce((a, [p]) => a + p, 0) / cal.length, avgReal = cal.reduce((a, [, r]) => a + r, 0) / cal.length;
  console.log(`\nКалібрування: середній передбачений шанс ${Math.round(avgPred * 100)}%, реальна частка перемог ${Math.round(avgReal * 100)}% (${cal.length} точок)`);
}
