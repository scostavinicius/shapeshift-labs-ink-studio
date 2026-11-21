const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ makeBuilder }, turn = false, pixel = false) {
  const B = makeBuilder(4, [0x101010, 0x00ff00, 0x999999, 0xff0000]);
  B.disc(-.75, 0, .35, [0, 0, 1], .19, .02, B.P[1], 3);
  B.describeSplats(0, 1, { object: 'runner' });
  B.disc(0, 0, 0, [0, 0, 1], .09, .02, B.P[2], 3, turn ? { k: 5, sp: Math.PI / 2 } : undefined);
  B.describeSplats(1, 2, { object: 'platform', target: { surface: 'deck' } });
  // A foreground wall can cover the historical position without hiding the live subject.
  B.disc(-.75, 0, .8, [0, 0, 1], .35, .03, B.P[2], 0);
  B.describeSplats(2, 3, { object: 'wall' });
  if (pixel) {
    B.pixNext([2], 1, null, 0, 0, 1);
    B.disc(-.75, 0, -.5, [0, 0, 1], .38, .02, B.P[2], 3);
  }
  return B.finish({ cam: { target: [0, 0, 0], dist: 4, pitch: 0, yaw: 0 }, radius: 3,
    look: { pixel, afterimages: [{ select: { object: 'runner' }, duration: 2, color: '#ff0000', opacity: .9 }] } });
}

const kit = studio.load(), FX = kit.KIT.afterimages;
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-5, actual + ' differs from ' + expected);
const options = { w: 96, h: 64, px: 1, raw: true, ortho: true };
function redPixels(frame) {
  let count = 0, sum = 0;
  for (let p = 0; p < frame.w * frame.h; p++) {
    const i = p * 3;
    if (frame.rgb[i] <= frame.rgb[i + 1] + 30 || frame.rgb[i] <= frame.rgb[i + 2] + 30) continue;
    count++;
    sum += p % frame.w;
  }
  return { count, x: sum / (count || 1) };
}

test('object and surface anchors reproject historical poses with the moving receiver', () => {
  for (const surface of [false, true]) {
    const world = fixture(kit, true);
    const rule = { ...world.look.afterimages[0], attach: surface ? { surface: 'deck' } : { object: 'platform' } };
    const rules = FX.prepare([rule]), history = FX.history();
    assert.equal(history.frame(world, 0, rules).length, 0);
    world.data[0] = .6;
    world.data[16 + 1] = .2;
    const ghost = history.frame(world, 1, rules);
    assert.equal(ghost.length, 16);
    close(ghost[0], surface ? .004 : .35);
    close(ghost[1], .2);
    close(ghost[2], .75);
    if (surface) assert(ghost[4] < ghost[10] / 100);
    assert.deepEqual(history.frame(world, 1, rules), ghost);
    world.data[16 + 3] = 0;
    assert.equal(history.frame(world, 1.1, rules).length, 0);
    assert.equal(history.frame(world, .1, rules).length, 0);
  }
});

test('headless trails stay in the scene across camera moves and disappear behind a wall', () => {
  const world = fixture(kit), afterimageHistory = FX.history();
  const draw = (t, overrides = {}) => studio.render(world, { ...options, t, afterimageHistory, ...overrides });
  assert.equal(redPixels(draw(0)).count, 0);
  world.data[0] = .75;
  const straight = redPixels(draw(.2));
  assert(straight.count > 30 && straight.x < 38);
  const pan = redPixels(draw(.2, { target: [.4, 0, 0] }));
  assert(pan.count > 20 && pan.x < straight.x - 7);
  world.data[2 * 16 + 3] = 3;
  const occluded = draw(.2);
  assert.equal(redPixels(occluded).count, 0);
  world.data[2 * 16 + 3] = 0;
  assert.equal(redPixels(draw(.3, { resetAfterimages: true })).count, 0);
  assert.equal(redPixels(draw(.4)).count, 0);
  assert.equal(world.count, 3);
});

test('WebGL draws world-space afterimages with occlusion and can reset at cuts', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, fixture, (kit, fixture, backend) => {
    const world = fixture(kit), draw = backend(96, 64, { raw: true, dither: 0, camera: { ortho: true } });
    const points = { ghost: [30, 32], panned: [21, 32], attached: [44, 32] };
    try {
      draw.draw(world, { time: 0 });
      const before = draw.sample(points).ghost;
      world.data[0] = .75;
      draw.draw(world, { time: .2, changedRows: [0] });
      const active = draw.sample(points).ghost;
      draw.draw(world, { time: .2, camera: { ortho: true, target: [.4, 0, 0] } });
      const panned = draw.sample(points).panned;
      world.data[35] = 3;
      draw.draw(world, { time: .2, changedRows: [0] });
      const hidden = draw.sample(points).ghost;
      world.data[35] = 0;
      draw.draw(world, { time: .3, resetAfterimages: true, changedRows: [0] });
      const cut = draw.sample(points).ghost;
      world.look.afterimages[0].attach = { surface: 'deck' };
      world.data[0] = -.75;
      draw.draw(world, { time: 1, changedRows: [0] });
      world.data[0] = .75;
      world.data[16] = .6;
      draw.draw(world, { time: 1.2, changedRows: [0] });
      const attached = draw.sample(points).attached;
      const patterned = fixture(kit, false, true);
      draw.draw(patterned, { time: 0, raw: false });
      patterned.data[0] = .75;
      draw.draw(patterned, { time: .2, raw: false, changedRows: [0] });
      const overPattern = draw.sample(points).ghost;
      const mirrored = fixture(kit);
      const water = kit.KIT.procedural.waterBodies;
      mirrored.water = water.scene([water.create({ id: 'pool', bounds: { min: [-2, -2], max: [2, 2] },
        sample: () => ({ bed: -1.5, surface: -1 }), optics: { reflection: { plane: 'pool' } } })]);
      mirrored.reflections = [kit.KIT.reflection.plane({ id: 'pool', at: [0, -1, 0] })];
      draw.draw(mirrored, { time: 0 });
      mirrored.data[0] = .75;
      draw.draw(mirrored, { time: .2, changedRows: [0] });
      const withCapture = draw.sample(points).ghost;
      draw.draw(mirrored, { time: .2, reflections: false });
      const withoutCapture = draw.sample(points).ghost;
      return { before, active, panned, hidden, cut, attached, overPattern, withCapture, withoutCapture };
    } finally {
      draw.close();
    }
  });
  assert(result.active[0] > result.active[1] + 40, JSON.stringify(result));
  assert(result.panned[0] > result.panned[1] + 40, JSON.stringify(result));
  assert(Math.abs(result.hidden[0] - result.hidden[1]) <= 3, JSON.stringify(result));
  assert.deepEqual(result.cut, [16, 16, 16]);
  assert(result.before[1] > result.before[0]);
  assert(result.attached[0] > result.attached[1] + 40, JSON.stringify(result));
  assert.deepEqual(result.overPattern, [255, 0, 0]);
  assert.deepEqual(result.withCapture, result.active);
  assert.deepEqual(result.withoutCapture, result.active);
});
