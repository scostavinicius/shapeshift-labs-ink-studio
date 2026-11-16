// A static build in engine/dist: index.html, kit.js and main.js, servable by any static file server.
import fs from 'node:fs';
import path from 'node:path';
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
fs.writeFileSync(path.join(OUT, 'kit.js'), kitScript());
fs.copyFileSync(path.join(ROOT, 'public', 'index.html'), path.join(OUT, 'index.html'));
console.log('built', OUT);
