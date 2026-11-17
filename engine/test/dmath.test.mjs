// The deterministic Math (src/game/dmath.ts, docs/engine-determinism.md): close to the true values (within 1 ulp of the
// native functions for those the kit uses), right on every special value, the same bits as pinned here (the fingerprint
// every JavaScript engine, and any port of the engine, must reproduce), and swapped in only while a game runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadInk, loadTs } from './load.mjs';

const D = await loadTs('src/game/dmath.ts');
const G = await loadTs('src/game/index.ts');

/** the pinned fingerprint: change it only knowingly (a change here means recorded games may play out differently) */
const FINGERPRINT = '852e6b34ae4e5869';

const f64 = new Float64Array(1),
  i64 = new BigInt64Array(f64.buffer);
const ord = x => ((f64[0] = x), i64[0] < 0n ? -(i64[0] & 0x7fffffffffffffffn) : i64[0]);
const ulps = (a, b) => (Object.is(a, b) || (a !== a && b !== b) ? 0 : Number(ord(a) > ord(b) ? ord(a) - ord(b) : ord(b) - ord(a)));

test('the fingerprint is the pinned one', () => {
  assert.equal(D.fingerprint(), FINGERPRINT);
});

test('within 1 ulp of the native functions the kit uses (2 for the inverse hyperbolics and log1p), on 20 000 inputs each', () => {
  let s = 7;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const one = {
    sin: () => r() * 2000 - 1000,
    cos: () => r() * 2000 - 1000,
    tan: () => r() * 20 - 10,
    asin: () => r() * 2 - 1,
    acos: () => r() * 2 - 1,
    atan: () => r() * 200 - 100,
    exp: () => r() * 200 - 100,
    expm1: () => r() * 4 - 2,
    log: () => r() * 1e4,
    log2: () => r() * 1e4,
    log10: () => r() * 1e4,
    cbrt: () => r() * 2e4 - 1e4,
    sinh: () => r() * 20 - 10,
    cosh: () => r() * 20 - 10,
    tanh: () => r() * 20 - 10,
    log1p: () => r() * 4 - 0.9,
    asinh: () => r() * 20 - 10,
    acosh: () => 1 + r() * 20,
    atanh: () => r() * 2 - 1
  };
  const loose = new Set(['log1p', 'asinh', 'acosh', 'atanh']);
  for (const [name, gen] of Object.entries(one)) {
    let worst = 0;
    for (let k = 0; k < 20000; k++) {
      const x = gen();
      worst = Math.max(worst, ulps(D[name](x), Math[name](x)));
    }
    assert.ok(worst <= (loose.has(name) ? 2 : 1), `${name}: ${worst} ulp`);
  }
  for (const name of ['atan2', 'pow', 'hypot']) {
    let worst = 0;
    for (let k = 0; k < 20000; k++) {
      const x = name === 'pow' ? r() * 100 : r() * 200 - 100,
        y = name === 'pow' ? r() * 10 - 5 : r() * 200 - 100;
      worst = Math.max(worst, ulps(D[name](x, y), Math[name](x, y)));
    }
    assert.ok(worst <= 1, `${name}: ${worst} ulp`);
  }
});

test('special values come out as the standard says, and huge angles are reduced right', () => {
  const sp = [0, -0, 1, -1, 0.5, 2, -2, Infinity, -Infinity, NaN, 1e-310, 1e300, 710, -746];
  for (const name of D.DMATH_NAMES) {
    const two = name === 'atan2' || name === 'pow' || name === 'hypot';
    for (const x of sp)
      for (const y of two ? sp : [0]) {
        const a = two ? D[name](x, y) : D[name](x),
          b = two ? Math[name](x, y) : Math[name](x);
        const ok = Object.is(a, b) || (a !== a && b !== b) || (Number.isFinite(a) && Number.isFinite(b) && ulps(a, b) <= 2 && !(a === 0 && b === 0));
        assert.ok(ok, `${name}(${x}${two ? ', ' + y : ''}) = ${a}, the standard's ${b}`);
      }
  }
  // sin and cos of 1e22 (the classic test of argument reduction), exact powers
  assert.equal(D.sin(1e22), -0.8522008497671888);
  assert.equal(D.cos(1e22), 0.523214785395139);
  assert.deepEqual([D.log2(1024), D.log2(0.125), D.pow(2, 10), D.pow(10, 3), D.cbrt(-27), D.exp(0), D.hypot(3, 4)], [10, -3, 1024, 1000, -3, 1, 5]);
});

test('Math is the deterministic one only while a game builds or steps', () => {
  const native = Math.sin;
  const ink = loadInk();
  let inside = null;
  const d = new G.Dice(1);
  d.during(ink.KIT, () => (inside = Math.sin));
  assert.equal(inside, G.DMATH.sin);
  assert.equal(Math.sin, native, 'put back after');
  assert.throws(() =>
    d.during(ink.KIT, () => {
      throw new Error('x');
    })
  );
  for (const n of G.DMATH_NAMES) assert.notEqual(Math[n], G.DMATH[n], `${n} put back after a throw`);
  assert.equal(G.dmathFingerprint(), FINGERPRINT);
});
