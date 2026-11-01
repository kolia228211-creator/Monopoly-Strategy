// Збірка помічника: src/helper/main.js -> dist/helper.js (+ копія в extension/), закладка-завантажувач
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const CDN = 'https://cdn.jsdelivr.net/gh/kolia228211-creator/Monopoly-Strategy@main/dist/helper.js';

const banner = `/* RichUp Помічник v${pkg.version} — https://github.com/kolia228211-creator/Monopoly-Strategy */`;
await build({
  entryPoints: [new URL('src/helper/main.js', root).pathname],
  bundle: true, format: 'iife', target: 'es2020', minify: true, charset: 'utf8',
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: { js: banner },
  outfile: new URL('dist/helper.js', root).pathname
});

const loader = `(function(){if(window.__RUHELP){window.__RUHELP.ui.show();return}var s=document.createElement('script');s.src='${CDN}?v='+Math.floor(Date.now()/36e5);s.onerror=function(){alert('Помічник: не вдалося завантажити '+s.src)};(document.head||document.documentElement).appendChild(s)})()`;
await writeFile(new URL('dist/helper.bookmarklet.txt', root), 'javascript:' + encodeURIComponent(loader) + '\n');

// Розширення Chrome (Manifest V3): той самий скрипт у "MAIN world" сторінки
await mkdir(new URL('extension/', root), { recursive: true });
await copyFile(new URL('dist/helper.js', root), new URL('extension/helper.js', root));
const manifest = {
  manifest_version: 3,
  name: 'RichUp Помічник',
  version: pkg.version,
  description: 'Поради в реальному часі для richup.io: купівля, аукціон, обміни, будинки, шанси на перемогу.',
  content_scripts: [{ matches: ['https://richup.io/*'], js: ['helper.js'], world: 'MAIN', run_at: 'document_idle' }],
  icons: { 128: 'icon128.png' }
};
await writeFile(new URL('extension/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
const size = (await readFile(new URL('dist/helper.js', root))).length;
console.log(`helper.js: ${(size / 1024).toFixed(1)} KB, extension/ оновлено`);
