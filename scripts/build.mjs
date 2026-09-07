import { build } from 'esbuild';
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';
import { mkdir, copyFile, cp, writeFile, readFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['browser/entry.js', 'browser/doc-worker.js'], outdir: 'dist/browser', bundle: true,
  splitting: true, format: 'esm', minify: true, target: 'es2022',
  plugins: [nodeModulesPolyfillPlugin({ globals: { Buffer: true, process: true }, modules: { buffer: true, stream: true, events: true, util: true, process: true, fs: 'empty' } })] });
for (const file of ['index.html', 'app.js', 'live.js', 'styles.css']) await copyFile(file, `dist/${file}`);
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/browser/pdf.worker.min.mjs');
await cp('node_modules/pdfjs-dist/cmaps', 'dist/browser/cmaps', { recursive: true });
await cp('node_modules/pdfjs-dist/standard_fonts', 'dist/browser/standard_fonts', { recursive: true });
await cp('node_modules/pdfjs-dist/wasm', 'dist/browser/wasm', { recursive: true });
// Keep upstream licences with the shipped browser dependencies.
const notices = [];
for (const name of ['pdfjs-dist', 'jszip', 'word-extractor', 'docx']) {
  const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  notices.push(`${name} ${pkg.version} — ${pkg.license}\n${JSON.stringify(pkg.repository)}`);
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT.txt']) {
    try { notices.push(await readFile(`node_modules/${name}/${file}`, 'utf8')); } catch {}
  }
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n'));
