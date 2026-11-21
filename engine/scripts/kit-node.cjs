// The ink-studio toolkit as the engine runs it, in the page and in Node: the toolkit's own source (index.js bundle()),
// with one change, the `**` operator written as a call.
//
// Why: while a game builds or steps, the engine swaps Math.pow, Math.sin and the rest for deterministic versions
// (src/game/dmath.ts), so a game plays out bit for bit the same on every JavaScript engine. The `**` operator is
// computed by the JavaScript engine itself and never goes through that swap, and since the upstream merge of
// 2026-11-21 the toolkit uses it in about 165 files (K.wobble, deformers, matter...). esbuild rewrites each `a ** b`
// as `__pow(a, b)`; the helper it declares (`var __pow = Math.pow`) would hold on to the native function taken when
// the script loads, so it is replaced by one that looks Math.pow up on every call (the swapped one during a step)
// and squares exactly (x * x, the same on every engine) for the commonest case, an exponent of 2.
// See docs/engine-determinism.md, section 5.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const REPO = path.resolve(__dirname, '..', '..');
const studio = require(path.join(REPO, 'index.js'));

// the helper's declaration as esbuild writes it: `var __pow = Math.pow;`, or renamed and joined when minified
const HELPER = /\b([\w$]+)\s*=\s*Math\.pow(?=\s*[;,])/;
// the replacement: BigInt powers stay exact integer powers (the one `**` left in the engine's kit, and it cannot vary
// between engines); a square is x * x; anything else goes to Math.pow as it is at the moment of the call
const POW = '(a, b) => (typeof a === "bigint" ? a ** b : b === 2 ? a * a : Math.pow(a, b))';

/** Source code with every `**` (and `**=`) written as a call to a helper that looks Math.pow up on each call. */
function lowerPow(code, { minify = false } = {}) {
  const out = esbuild.transformSync(code, {
    supported: { 'exponent-operator': false },
    minify,
    legalComments: 'none',
    charset: 'utf8'
  }).code;
  const m = HELPER.exec(out);
  if (!m) return out; // no ** in this code
  return out.slice(0, m.index) + `${m[1]} = ${POW}` + out.slice(m.index + m[0].length);
}

/** The newest modification time among the toolkit's sources (a cache older than this is rebuilt). */
function newestSource() {
  return Math.max(...studio.files().concat(studio.demoFiles(), [path.join(REPO, 'index.js'), __filename]).map(f => fs.statSync(f).mtimeMs));
}

const CACHE = path.join(REPO, 'engine', 'out', 'kit');

/** A file built once and kept until a toolkit source changes. */
function cached(name, make) {
  const file = path.join(CACHE, name);
  const have = fs.statSync(file, { throwIfNoEntry: false });
  if (!have || have.mtimeMs < newestSource()) {
    fs.mkdirSync(CACHE, { recursive: true });
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    try {
      fs.writeFileSync(tmp, make());
      fs.renameSync(tmp, file);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }
  return file;
}

/** The toolkit for Node, as index.js load() gives it, but with `**` lowered. */
function loadKit() {
  return require(cached('ink-studio.engine.cjs', () => lowerPow(studio.bundle({ format: 'commonjs' }))));
}

/** The toolkit's browser script (index.js bundle()), with `**` lowered; minified when asked. */
function kitSource({ minify = false } = {}) {
  const file = cached(minify ? 'kit.bundle.min.js' : 'kit.bundle.js', () => lowerPow(studio.bundle(), { minify }));
  return fs.readFileSync(file, 'utf8');
}

module.exports = { lowerPow, loadKit, kitSource, studio, REPO };
