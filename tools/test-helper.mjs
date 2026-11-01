// Тест помічника в Chromium: фейкова сторінка richup з React-fiber і Zustand-подібним сховищем.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { makeState, own, idxOf } from './mock-state.mjs';

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
const root = new URL('..', import.meta.url);
const helper = await readFile(new URL('dist/helper.js', root), 'utf8');
const shots = new URL('tools/shots/', root); await mkdir(shots, { recursive: true });

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#16122a;color:#fff;font-family:sans-serif"><div id="app"><div style="padding:20px">richup mock board</div></div>
<script>
  function createStore(init){ let st=init, ls=new Set(); const api={ getState:()=>st, setState:(p)=>{ st=Object.assign({},st,typeof p==='function'?p(st):p); ls.forEach(l=>l(st)); }, subscribe:(l)=>{ls.add(l); return ()=>ls.delete(l)}, getInitialState:()=>init }; return api; }
  window.mkStore = (state, self) => {
    window.store = createStore({ state, selfParticipantId: self, isReady: true, applyServerAction(){}, syncState(){} });
    const comp = { memoizedState: { memoizedState: 1, next: { memoizedState: window.store, next: null } }, child: null, sibling: null };
    const app = { child: comp, sibling: null, memoizedState: null }; const rootF = { child: app, memoizedState: null };
    app.return = rootF; comp.return = app;
    document.getElementById('app')['__reactFiber$test'] = app;
  };
</script></body></html>`;
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(PAGE); });
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/room/mock`;

const browser = await chromium.launch();
let fails = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  — ' + x : '')); if (!c) fails++; };
const panelText = (page) => page.evaluate(() => document.getElementById('ruhelp-host').shadowRoot.querySelector('.panel').innerText);
const waitSim = (page) => page.waitForFunction(() => window.__RUHELP && window.__RUHELP.sim && !window.__RUHELP.sim.busy, null, { timeout: 30000 });

async function scenario(name, state, viewport, check) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url);
  await page.evaluate(([s]) => window.mkStore(s, 'p0'), [state]);
  await page.evaluate(helper);
  await page.waitForTimeout(400);
  await waitSim(page).catch(() => {});
  await page.waitForTimeout(300);
  const txt = await panelText(page);
  await page.screenshot({ path: new URL(name + '.png', shots).pathname });
  await check(txt, page);
  ok(name + ': без помилок JS', errs.length === 0, errs.join(' | '));
  await ctx.close();
  return txt;
}
const desk = { width: 1366, height: 760 }, mob = { width: 412, height: 860 };

// 1. Купівля
let s = makeState(); own(s, 'p0', ['Lyon', 'Toulouse']); s.participants[0].position = idxOf(s, 'Paris'); s.cubesRolledInTurn = true;
own(s, 'p1', ['Frankfurt', 'Munich']); s.participants[1].money = 1300;
await scenario('1-buy', s, desk, async (t) => {
  ok('купівля: порада КУПУЙ', /КУПУЙ/.test(t), t.split('\n').slice(0, 3).join(' / '));
  ok('купівля: шанси з купівлею/аукціоном', /купиш \d+%/.test(t));
  ok('шанси всіх гравців показано', (t.match(/\d+%/g) || []).length >= 4);
});

// 2. Аукціон (телефон)
s = makeState(); own(s, 'p0', ['Shenzhen', 'Beijing']); s.auction = { blockIndex: idxOf(s, 'Shanghai'), currentBid: 180, currentBidderId: 'p2', bidderIds: ['p0', 'p1', 'p2', 'p3'], state: 'active', endsAt: Date.now() + 9000 };
s.currentPlayerIndex = 2;
await scenario('2-auction-mobile', s, mob, async (t) => ok('аукціон: Став!', /Став!/.test(t), t.split('\n').slice(0, 3).join(' / ')));

// 3. Вхідний обмін
s = makeState(); own(s, 'p1', ['Lyon', 'Toulouse']); own(s, 'p0', ['Paris', 'Venice']); s.currentPlayerIndex = 1;
s.trades = [{ id: 'tr1', initiatorId: 'p1', recipientId: 'p0', initiatorOffer: { money: 350, propertyIndices: [], pardonCards: [] }, recipientOffer: { money: 0, propertyIndices: [idxOf(s, 'Paris')], pardonCards: [] }, status: 'pending' }];
await scenario('3-trade', s, desk, async (t) => {
  ok('обмін: ВІДХИЛЯЙ', /ВІДХИЛЯЙ/.test(t));
  ok('обмін: шанс після обміну', /Шанс перемоги після обміну: \d+%/.test(t));
});

// 4. Будинки + ідеї
s = makeState(); own(s, 'p0', ['Frankfurt', 'Munich', 'Berlin', 'Rome']); own(s, 'p1', ['Venice', 'Milan', 'Paris']); s.participants[0].money = 1100; s.cubesRolledInTurn = true;
s.participants[0].position = 5; own(s, 'p2', ['TLV Airport']);
await scenario('4-build', s, desk, async (t) => {
  ok('будинки: план', /будинки/i.test(t) && /до 3 буд/.test(t));
  ok('ідеї обмінів / попередження', /чекає на твою Rome/.test(t), t.match(/.*Rome.*/)?.[0]);
});

// 5. Борг (телефон)
s = makeState(); own(s, 'p0', ['Frankfurt', 'Munich', 'Berlin', 'Salvador']); ['Frankfurt', 'Munich', 'Berlin'].forEach((n) => s.blocks[idxOf(s, n)].level = 2); s.participants[0].money = -230;
await scenario('5-debt-mobile', s, mob, async (t) => ok('борг: план продажу', /Борг \$230/.test(t) && /Продай будинок|Заклади/.test(t)));

// 6. Лобі
s = makeState(); s.phase = 'lobby';
await scenario('6-lobby', s, desk, async (t) => ok('лобі: найвигідніші набори', /найвигідніші набори/i.test(t)));

// 7. Живе оновлення: setState -> панель реагує
{
  const ctx = await browser.newContext({ viewport: desk }); const page = await ctx.newPage();
  await page.goto(url); s = makeState(); await page.evaluate(([x]) => window.mkStore(x, 'p0'), [s]); await page.evaluate(helper); await page.waitForTimeout(500);
  await page.evaluate((i) => { const st = window.store.getState().state; const p = st.participants.map((x, k) => k === 0 ? { ...x, position: i } : x); window.store.setState({ state: { ...st, participants: p, cubesRolledInTurn: true } }); }, idxOf(s, 'London'));
  await page.waitForTimeout(700);
  const t = await panelText(page);
  ok('живе оновлення: після ходу з\'являється порада про London', /КУПУЙ|Аукціон/.test(t), t.split('\n')[0]);
  await page.evaluate(helper); // повторний запуск
  ok('повторний запуск не дублює панель', await page.evaluate(() => document.querySelectorAll('#ruhelp-host').length === 1));
  await ctx.close();
}

await browser.close(); server.close();
if (fails) { console.log(fails + ' FAIL'); process.exit(1); } else console.log('\nПанель: усе пройдено');
