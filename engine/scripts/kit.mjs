// The ink-studio toolkit as one browser script. The toolkit's sources are plain scripts, so they are used as they stand
// (index.js bundle() and demos()) and the names the engine needs are handed to the page on window.INK.
// Scene files written as CommonJS modules (showcase/farol.js and the like) are wrapped so a page can load them too.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const studio = require(path.join(REPO, 'index.js'));

export function kitScript() {
  return [
    studio.bundle(),
    'const SCENES = [];',
    studio.demos(),
    // the scene modules a page loads later add themselves here (see sceneScript)
    'window.INK = { SCENES, makeBuilder, makeSculpt, KIT, PixelLook, PALETTES, PAL_HEX, extra: [], sceneFns: {} };',
    ''
  ].join('\n');
}

// A scene module (module.exports = kit => ({ id, name, seed, build })) wrapped for the page: its scene goes on INK.extra,
// and the function itself on INK.sceneFns[path] (a game hands it its own kit facade). Only files inside the repository
// are served.
export function sceneScript(rel) {
  const file = path.resolve(REPO, rel);
  if (!file.startsWith(REPO + path.sep) || !file.endsWith('.js') || !fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  return (
    '(function () {\n  const module = { exports: {} };\n' +
    src +
    `\n  window.INK.sceneFns[${JSON.stringify(rel)}] = module.exports;` +
    '\n  window.INK.extra.push(module.exports(window.INK));\n})();\n'
  );
}
