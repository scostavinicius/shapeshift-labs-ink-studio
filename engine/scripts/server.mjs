// The engine's HTTP server, shared by `npm run dev` and the parity harness: the pages in public/, each page's engine
// entry (rebuilt by esbuild on every request, so a reload always shows the latest code), the toolkit bundle, and scene
// modules from the repository.
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { kitScript, sceneScript } from './kit.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// one esbuild entry per page, and the sort worker
const ENTRIES = { '/main.js': 'src/main.ts', '/parity.js': 'src/parity.ts', '/sort-worker.js': 'src/render/sort-worker.ts' };
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

/** Start the server. port 0 picks a free one. Resolves to { url, close }. */
export async function startServer({ port = 5173, host = '127.0.0.1' } = {}) {
  const contexts = {};
  for (const [route, entry] of Object.entries(ENTRIES))
    contexts[route] = await esbuild.context({
      entryPoints: [path.join(ROOT, entry)],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      sourcemap: 'inline',
      write: false,
      outfile: route.slice(1),
      logLevel: 'silent'
    });
  const send = (res, code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  // big text (the toolkit is several MB) goes gzipped when the browser takes it; the last few results are kept by
  // content hash, so a reload with nothing changed costs a hash, not a compression
  const zipped = new Map();
  const sendText = (req, res, type, body) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (buf.length < 64 * 1024 || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return send(res, 200, type, buf);
    const key = crypto.createHash('md5').update(buf).digest('hex');
    let gz = zipped.get(key);
    if (!gz) {
      gz = zlib.gzipSync(buf, { level: 6 });
      zipped.set(key, gz);
      if (zipped.size > 6) zipped.delete(zipped.keys().next().value);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' });
    res.end(gz);
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (contexts[url.pathname]) {
        const out = await contexts[url.pathname].rebuild();
        return sendText(req, res, 'text/javascript', Buffer.from(out.outputFiles[0].contents));
      }
      if (url.pathname === '/favicon.ico') return send(res, 204, 'image/x-icon', '');
      if (url.pathname === '/kit.js') return sendText(req, res, 'text/javascript', kitScript());
      // a game module (engine/examples/<name>/game.ts), bundled for the page
      const game = /^\/game\/([\w-]+)\.js$/.exec(url.pathname);
      if (game) {
        const entry = path.join(ROOT, 'examples', game[1], 'game.ts');
        if (!fs.existsSync(entry)) return send(res, 404, 'text/plain', 'no such game');
        const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', write: false, logLevel: 'silent' });
        return send(res, 200, 'text/javascript', out.outputFiles[0].contents);
      }
      // the examples' own files (input scripts)
      if (url.pathname.startsWith('/examples/') && url.pathname.endsWith('.json')) {
        const ex = path.join(ROOT, 'examples'),
          file = path.join(ex, decodeURIComponent(url.pathname.slice('/examples/'.length)));
        if (!file.startsWith(ex + path.sep) || !fs.existsSync(file)) return send(res, 404, 'text/plain', 'not found');
        return send(res, 200, 'application/json', fs.readFileSync(file));
      }
      if (url.pathname.startsWith('/scene/')) {
        const js = sceneScript(decodeURIComponent(url.pathname.slice('/scene/'.length)));
        return js ? send(res, 200, 'text/javascript', js) : send(res, 404, 'text/plain', 'no such scene');
      }
      const pub = path.join(ROOT, 'public');
      const file = path.join(pub, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!file.startsWith(pub) || !fs.existsSync(file)) return send(res, 404, 'text/plain', 'not found');
      return send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
    } catch (err) {
      // build errors go to the page as a script that reports them, so they show in the browser console too
      const msg = String(err && err.message ? err.message : err);
      console.error(msg);
      return send(res, 200, 'text/javascript', `console.error(${JSON.stringify(msg)});`);
    }
  });
  await new Promise(ok => server.listen(port, host, ok));
  const url = `http://${host}:${server.address().port}/`;
  return {
    url,
    async close() {
      await new Promise(ok => server.close(ok));
      for (const c of Object.values(contexts)) await c.dispose();
    }
  };
}
