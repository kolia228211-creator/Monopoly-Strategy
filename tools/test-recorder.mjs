// Тест записувача у справжньому Chromium: імітуємо гру з WebSocket, відкритим ДО запуску закладки.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const root = new URL('..', import.meta.url);
const bookmarklet = (await readFile(new URL('dist/recorder.bookmarklet.txt', root), 'utf8')).trim();
const code = decodeURIComponent(bookmarklet.slice('javascript:'.length));

const PAGE = `<!doctype html><html><body><div id="app"><button id="roll">Roll the dice</button><button>Buy for 280$</button></div>
<script>
  // фейковий Vue app з Pinia, як у багатьох іграх
  const st = { game: { players: [{ id: 'a', name: 'Kolia', money: 1500, position: 0 }], board: [{ name: 'Paris', price: 280 }], turn: 'a' } };
  document.getElementById('app').__vue_app__ = { version: '3.4.0', config: { globalProperties: { $pinia: { state: { value: st } } } }, _context: { provides: {} } };
  window.sock = new WebSocket('ws://' + location.host + '/socket?token=SECRET123');
  window.sock.onmessage = (e) => { if (String(e.data).startsWith('2')) window.sock.send('3'); };
  document.getElementById('roll').onclick = () => window.sock.send(JSON.stringify(['roll', { authToken: 'abcdefSECRET' }]));
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api')) { res.setHeader('content-type', 'application/json'); return res.end('{"board":"classic","ok":true}'); }
  res.setHeader('content-type', 'text/html'); res.end(PAGE);
});
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.send('0{"sid":"x"}');
  let n = 0;
  const iv = setInterval(() => {
    n++;
    ws.send(n % 2 ? '2' : '42["state",{"players":[{"id":"a","money":' + (1500 - n * 10) + '}]}]');
    ws.send(Buffer.from([0x81, 0xa1, 0x61, n]));
  }, 150);
  ws.on('message', (m) => { if (String(m).includes('roll')) ws.send('42["dice",[3,4]]'); });
  ws.on('close', () => clearInterval(iv));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(500);              // сокет уже відкритий — як у реальній грі
await page.evaluate(code);                    // "натискання" закладки
await page.evaluate(() => fetch('/api/board').then((r) => r.json()));
await page.waitForTimeout(700);
await page.click('#roll');
await page.waitForTimeout(800);
await page.evaluate(code);                    // повторний запуск не має дублювати
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.evaluate(() => {
    const host = [...document.body.children].find((el) => el.shadowRoot && el.shadowRoot.getElementById('save'));
    host.shadowRoot.getElementById('save').click();
  })
]);
const path = await download.path();
const data = JSON.parse(await readFile(path, 'utf8'));
await page.screenshot({ path: new URL('tools/test-shot.png', root).pathname });
await browser.close(); server.close(); wss.close();

const ins = data.msgs.filter((m) => m.d === 'in');
const outs = data.msgs.filter((m) => m.d === 'out');
const checks = {
  'сокет знайдено після запуску (send-hook)': data.sockets.length === 1 && data.sockets[0].how === 'send-hook',
  'токен у URL сокета замасковано': !data.sockets[0].url.includes('SECRET123'),
  'вхідні текстові повідомлення': ins.some((m) => m.s && m.s.startsWith('42["state"')),
  'вхідні бінарні повідомлення (base64)': ins.some((m) => m.b64),
  'вихідні повідомлення (roll)': outs.some((m) => m.s && m.s.includes('roll')),
  'токен у вихідному повідомленні замасковано': !JSON.stringify(outs).includes('abcdefSECRET'),
  'fetch з тілом JSON': data.http.some((h) => h.url.includes('/api/board') && h.body && h.body.includes('classic')),
  'знімок стану Pinia': data.snaps.some((s) => s.vue && s.vue[0].pinia && s.vue[0].pinia.game.players[0].money === 1500),
  'кнопки гри прочитано': data.snaps[0].buttons.some((b) => b.t === 'Roll the dice'),
  'немає дубля при повторному запуску': data.sockets.length === 1,
  'без помилок на сторінці': pageErrors.length === 0,
  'внутрішніх помилок записувача немає': data.errors.length === 0
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log((v ? 'PASS ' : 'FAIL ') + k); ok = ok && v; }
console.log(`msgs=${data.msgs.length} in=${ins.length} out=${outs.length} http=${data.http.length} snaps=${data.snaps.length} cdn=${data.probes.cdnScript}`);
if (!ok) { console.log('errors:', data.errors, pageErrors); process.exit(1); }
