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

// Закладка = мініфікований завантажувач (найсвіжіший коміт з GitHub -> jsDelivr)
const { transform } = await import('esbuild');
const loaderSrc = await readFile(new URL('src/loader/loader.js', root), 'utf8');
const loaderMin = (await transform(loaderSrc, { minify: true, target: 'es2015' })).code.trim().replace(/;$/, '');
await writeFile(new URL('dist/helper.bookmarklet.txt', root), 'javascript:' + encodeURIComponent('void ' + loaderMin) + '\n');

// Розширення Chrome (Manifest V3): завантажувач + локальна копія як запасний варіант
await mkdir(new URL('extension/', root), { recursive: true });
await copyFile(new URL('dist/helper.js', root), new URL('extension/helper.js', root));
await writeFile(new URL('extension/loader.js', root), `var __FALLBACK__ = chrome.runtime.getURL('helper.js');\n` + loaderSrc);
const manifest = {
  manifest_version: 3,
  name: 'RichUp Помічник',
  version: pkg.version,
  description: 'Поради в реальному часі для richup.io: купівля, аукціон, обміни, будинки, шанси на перемогу.',
  content_scripts: [{ matches: ['https://richup.io/*'], js: ['loader.js'], run_at: 'document_idle' }],
  web_accessible_resources: [{ resources: ['helper.js'], matches: ['https://richup.io/*'] }],
  icons: { 128: 'icon128.png' }
};
await writeFile(new URL('extension/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
const size = (await readFile(new URL('dist/helper.js', root))).length;
console.log(`helper.js: ${(size / 1024).toFixed(1)} KB, extension/ оновлено`);
