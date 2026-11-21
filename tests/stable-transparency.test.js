const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { stabilize } = require('../src/splat-order.js');
const runWebGL = require('../cli/look-webgl.js');
const kit = ink.load();

function scene({ makeBuilder }, optical = false, refract = 0) {
  const b = makeBuilder(1, [0, 0xff0000, 0x0000ff]);
  b.disc(-0.26, 0, 0, [0, 0, 1], 0.65, 0.04, b.P[1], optical ? 3 : 0.84, { gl: true, nd: true });
  b.disc(0.26, 0, 0, [0, 0, 1], 0.65, 0.04, b.P[2], optical ? 3 : 0.84, refract ? { gl: true, nd: true } : undefined);
  if (optical) b.describeOptical(0, 2, { scattering: 1.7 });
  return b.finish({ cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 3 }, radius: 3, refract,
    look: { stableTransparency: true, coverageAware: refract > 0 } });
}

const sweep = [-0.18, -0.04, 0.04, -0.04, 0.04, 0.18, -0.04];
const dominant = pixel => pixel[0] > pixel[2];
const oldOrder = [true, true, false, true, false, false, true];
const stableOrder = [true, true, true, true, true, false, false];

test('stability respects opaque barriers and chains of translucent depths', () => {
  const depth = [0.08, 0.035, 0, 0.09, 0.11, 0.1];
  const order = Int32Array.of(2, 1, 0, 3, 5, 4);
  stabilize(order, 0.05, i => depth[i], i => i !== 3);
  assert.deepEqual([...order], [1, 2, 0, 3, 4, 5]);
});

test('the CPU holds both ordinary and optical layers through shallow camera reversals', () => {
  const view = { w: 48, h: 48, px: 1, raw: true, ortho: true };
  const center = (24 * 48 + 24) * 3;
  for (const optical of [false, true]) {
    const world = scene(kit, optical);
    for (const splatOrder of ['center', 'surface']) {
      const transparencyHistory = kit.KIT.stableTransparency.history();
      const pixels = stableTransparency => sweep.map((yaw, t) =>
        ink.render(world, { ...view, yaw, t, splatOrder, stableTransparency, transparencyHistory })
          .rgb.subarray(center, center + 3));
      assert.deepEqual(pixels(false).map(dominant), oldOrder);
      assert.deepEqual(pixels(true).map(dominant), stableOrder);
      transparencyHistory.reset();
      assert(dominant(ink.render(world, { ...view, yaw: -0.04, transparencyHistory }).rgb.subarray(center, center + 3)));
    }
    const frames = stableTransparency => sweep.slice(1, 5).map(yaw =>
      ink.render(world, { ...view, yaw, stableTransparency }).rgb.subarray(center, center + 3));
    const maxChange = pixels => Math.max(...pixels.slice(1).map((pixel, i) =>
      Math.abs(pixel[0] - pixels[i][0]) + Math.abs(pixel[2] - pixels[i][2])));
    assert(maxChange(frames(true)) < maxChange(frames(false)) / 3);
  }
});

test('WebGL keeps the order through jitter and resets on a cut or rewind', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, scene, (kit, scene, backend, sweep) => {
    let world = scene(kit, true);
    const draw = backend(48, 48, { raw: true, dither: 0, damp: false });
    const sample = (yaw, time, flags) => {
      draw.draw(world, { camera: { yaw, ortho: true }, time, ...flags });
      const [red, , blue] = draw.sample({ center: [24, 24] }).center;
      return red > blue;
    };
    try {
      const plain = sweep.map((yaw, time) => sample(yaw, time, { stableTransparency: false }));
      const stable = sweep.map((yaw, time) => sample(yaw, time));
      const rewind = sample(-0.04, 3);
      sample(0.18, 4);
      const cut = sample(-0.04, 5, { resetTransparency: true });
      world = scene(kit, true, 16);
      const refracted = sweep.map((yaw, time) => sample(yaw, time, { raw: false }));
      return { plain, stable, rewind, cut, refracted };
    } finally {
      draw.close();
    }
  }, sweep);
  assert.deepEqual(result.plain, oldOrder);
  assert.deepEqual(result.stable, stableOrder);
  assert(result.rewind);
  assert(result.cut);
  assert.deepEqual(result.refracted, stableOrder);
});
