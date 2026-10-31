// Збірка: src/recorder/recorder.js -> dist/recorder.min.js, dist/recorder.bookmarklet.txt, docs/index.html
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { minify } from 'terser';

const root = new URL('..', import.meta.url);
const src = await readFile(new URL('src/recorder/recorder.js', root), 'utf8');
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

const { code } = await minify(src, {
  compress: { passes: 2 },
  mangle: true,
  format: { comments: false, ascii_only: true }
});

const bookmarklet = 'javascript:' + encodeURIComponent('void ' + code.replace(/;?\s*$/, ''));

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/recorder.min.js', root), code + '\n');
await writeFile(new URL('dist/recorder.bookmarklet.txt', root), bookmarklet + '\n');

const tpl = await readFile(new URL('tools/install.template.html', root), 'utf8');
const html = tpl
  .replaceAll('{{VERSION}}', pkg.version)
  .replaceAll('{{SIZE_KB}}', (bookmarklet.length / 1024).toFixed(1))
  .replace('{{BOOKMARKLET_JSON}}', JSON.stringify(bookmarklet).replace(/</g, '\\u003c'));
await writeFile(new URL('docs/index.html', root), html);

console.log(`recorder.min.js: ${code.length} B, bookmarklet: ${bookmarklet.length} B`);
