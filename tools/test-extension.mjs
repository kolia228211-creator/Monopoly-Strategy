// Тест розширення Chrome: завантажуємо extension/ у Chromium, підміняємо https://richup.io фейковою сторінкою
// з React-fiber і Zustand-сховищем. GitHub/CDN тут недоступні, тож має спрацювати вбудована копія helper.js.
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { makeState } from './mock-state.mjs';

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
const root = new URL('..', import.meta.url);
const ext = new URL('extension', root).pathname;
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const testPage = (await readFile(new URL('tools/test-helper.mjs', root), 'utf8')).match(/const PAGE = `([\s\S]*?)`;/)[1];
const state = makeState();
// сторінка одразу створює сховище (як справжній richup до запуску розширення)
const PAGE = testPage.replace('</script></body>', `window.mkStore(${JSON.stringify(state)}, 'p0');</script></body>`);

const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'ruext-')), {
  channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
});
await ctx.route('https://richup.io/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
await ctx.route(/github|jsdelivr/, (r) => r.abort()); // імітуємо недоступну мережу
const page = await ctx.newPage();
const logs = []; page.on('console', (m) => logs.push(m.text()));
await page.goto('https://richup.io/room/mock');
let ok = false, ver = null;
try {
  await page.waitForFunction(() => window.__RUHELP && window.__RUHELP.store, null, { timeout: 20000 });
  ver = await page.evaluate(() => window.__RUHELP.version); ok = ver === pkg.version;
} catch (e) { /* впало */ }
const txt = ok ? await page.evaluate(() => document.getElementById('ruhelp-host').shadowRoot.querySelector('.panel').innerText.slice(0, 80)) : '';
await ctx.close();
console.log((ok ? 'PASS' : 'FAIL') + ` розширення запускає помічника v${ver} (очікувалось ${pkg.version}) — ${txt.replace(/\n/g, ' / ')}`);
console.log('   лог: ' + logs.filter((l) => /RU/.test(l)).join(' | '));
if (!ok) process.exit(1);
