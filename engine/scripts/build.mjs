// A static build in engine/dist: index.html, kit.js, main.js and sort-worker.js, servable by any static file server.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { kitScript } from './kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
fs.mkdirSync(OUT, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: path.join(OUT, 'main.js')
});
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'render', 'sort-worker.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: path.join(OUT, 'sort-worker.js')
});
fs.writeFileSync(path.join(OUT, 'kit.js'), kitScript({ minify: true }));
fs.copyFileSync(path.join(ROOT, 'public', 'index.html'), path.join(OUT, 'index.html'));
// precompressed copies for static hosts that serve them (nginx gzip_static / brotli_static, most CDNs)
const sizes = [];
for (const f of ['kit.js', 'main.js', 'sort-worker.js']) {
  const raw = fs.readFileSync(path.join(OUT, f));
  const gz = zlib.gzipSync(raw, { level: 9 });
  const br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
  fs.writeFileSync(path.join(OUT, f + '.gz'), gz);
  fs.writeFileSync(path.join(OUT, f + '.br'), br);
  sizes.push(`${f} ${(raw.length / 1e6).toFixed(2)} MB (gzip ${(gz.length / 1e6).toFixed(2)}, brotli ${(br.length / 1e6).toFixed(2)})`);
}
console.log('built', OUT);
for (const s of sizes) console.log('  ' + s);
