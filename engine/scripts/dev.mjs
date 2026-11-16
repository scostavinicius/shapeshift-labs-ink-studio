// Development server: the page, the engine (rebuilt by esbuild on every request, so a reload always shows the latest code),
// the toolkit bundle, and scene modules from the repository.
//   npm run dev [-- --port 5173]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { kitScript, sceneScript } from './kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 5173;

const ctx = await esbuild.context({
  entryPoints: [path.join(ROOT, 'src', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: 'inline',
  write: false,
  outfile: 'main.js',
  logLevel: 'silent'
});

const send = (res, code, type, body) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/main.js') {
        const out = await ctx.rebuild();
        return send(res, 200, 'text/javascript', out.outputFiles[0].contents);
      }
      if (url.pathname === '/kit.js') return send(res, 200, 'text/javascript', kitScript());
      if (url.pathname.startsWith('/scene/')) {
        const js = sceneScript(decodeURIComponent(url.pathname.slice('/scene/'.length)));
        return js ? send(res, 200, 'text/javascript', js) : send(res, 404, 'text/plain', 'no such scene');
      }
      const file = path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
      if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file)) return send(res, 404, 'text/plain', 'not found');
      const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[path.extname(file)];
      return send(res, 200, type || 'application/octet-stream', fs.readFileSync(file));
    } catch (err) {
      // build errors go to the page as a script that reports them, so they show in the browser console too
      const msg = String(err && err.message ? err.message : err);
      console.error(msg);
      return send(res, 200, 'text/javascript', `console.error(${JSON.stringify(msg)});`);
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`ink-engine dev server: http://127.0.0.1:${port}/`));
