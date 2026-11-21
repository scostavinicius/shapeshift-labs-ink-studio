// The toolkit as the engine runs it has no `**` left (scripts/kit-node.cjs, docs/engine-determinism.md section 5).
// The engine swaps Math.pow and the rest for deterministic versions while a game builds or steps; the `**` operator is
// computed by the JavaScript engine and would go around that swap. Since the upstream merge of 2026-11-21 the
// toolkit's own source uses it in about 165 files, so the engine rewrites each `a ** b` as a call to a helper that
// squares exactly and otherwise looks Math.pow up when called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { lowerPow, kitSource, loadKit } = require('../scripts/kit-node.cjs');

/** The code of a source with comments, strings, template literals and regular expressions blanked out (roughly). */
function codeOf(src) {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i],
      d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i = src.indexOf('*/', i + 2);
      i = i < 0 ? src.length : i + 2;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const HELPER_POWERS = 1; // the helper keeps `a ** b` for BigInt, where it is exact on every engine

test('the toolkit as the engine loads it has no ** outside the helper, readable and minified', () => {
  for (const minify of [false, true]) {
    const n = (codeOf(kitSource({ minify })).match(/\*\*/g) || []).length;
    assert.equal(n, HELPER_POWERS, `minify ${minify}: ${n} ** in the engine's kit`);
  }
});

test('the helper squares exactly, keeps BigInt powers, and calls whatever Math.pow is at the moment of the call', () => {
  const sandbox = { Math: Object.create(Math) };
  vm.createContext(sandbox);
  vm.runInContext(lowerPow('globalThis.sq = x => x ** 2; globalThis.p = (x, y) => x ** y; globalThis.big = 3n ** 4n;'), sandbox);
  assert.equal(sandbox.sq(0.1), 0.1 * 0.1);
  assert.equal(sandbox.big, 81n);
  sandbox.Math.pow = () => 42; // what the engine does while a game steps: swap Math.pow
  assert.equal(sandbox.p(2, 0.5), 42);
  assert.equal(sandbox.sq(3), 9);
});

test('the Node toolkit the tests and the CLI use is the lowered one', () => {
  const K = loadKit();
  assert.equal(typeof K.KIT.wobble, 'function');
  assert.match(K.KIT.wobble.toString(), /__pow\(/);
});
