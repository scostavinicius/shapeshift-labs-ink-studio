const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('..');
const { render } = require('../cli/render.js');
const { traceMedia } = require('../cli/scene-optics.js');
const runWebGL = require('../cli/look-webgl.js');

const kit = load();
const { KIT: K } = kit;
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-6, actual + ' differs from ' + expected);

function scene({ makeBuilder, makeSculpt, KIT: K }, { thickness = 0, glass = false, pixel = false, medium = false } = {}) {
  const B = makeBuilder(3, [0x141414, 0xaaaaaa, 0xffffff, 0x1026a0, 0x00124d]);
  const S = K.sculpt(makeSculpt(B));
  S.pixel = pixel;
  S.box([0, 0, -0.8], [1.5, 1.2, 0.15], { r: [1, 2] }, { res: 0.15 });
  if (thickness) {
    const optical = K.optical.material({
      absorption: 1, scattering: 0.2, scatteringColor: '#0055ff',
      reflection: 0.12, reflectionColor: '#0022ff', depth: { thickness }
    });
    S.box([0, 0, 0.65], [0.55, 0.55, 0.02], { r: [2], optical, glass }, { res: 0.085, ghost: true });
  }
  const optical = K.optical.material({ absorption: 0.5, reflection: 0.3, reflectionColor: '#1177ee' });
  const waterBodies = K.procedural.waterBodies;
  const water = medium && waterBodies.scene([waterBodies.create({ id: 'tank', bounds: { min: [-2, -2], max: [2, 2] },
    sample: () => ({ bed: -2, surface: 1.5 }), optics: { optical, foam: 0, caustics: 0, refraction: 0 } })]);
  const atmosphere = medium ? [K.atmosphere.fog({ near: 1, far: 9, density: 0.4, optical })] : [];
  S.bake();
  return B.finish({ cam: { target: [0, 0, 0], yaw: 0, pitch: 0.1, dist: 5 }, radius: 4,
    detail: 20, dither: 0, look: { pixel }, water, atmosphere });
}

test('one optical profile controls attenuation and return in fog and water', () => {
  const optical = K.optical.material({ absorption: 0.5, scattering: 0.25, reflection: 0.25,
    scatteringColor: '#00ff00', reflectionColor: '#0000ff', depth: { scale: 2 } });
  assert.equal(K.optical.material(optical), optical);
  assert(Object.isFrozen(optical.depth) && Object.isFrozen(optical.scatteringColor));
  assert.throws(() => K.optical.material({ absorption: -1 }), /Absorption/);
  assert.throws(() => K.optical.material({ depth: { thickness: 0 } }), /thickness/);

  const fog = K.atmosphere.prepare([K.atmosphere.fog({ near: 1, far: 2, density: 1, optical })]);
  const fogResult = K.atmosphere.trace(fog, [0, 2, 0], [0, -1, 0], 3);
  near(fogResult[3], Math.exp(-2));
  near(fogResult[1], 0.25 * (1 - fogResult[3]));
  near(fogResult[2], fogResult[1]);

  const water = K.procedural.waterBodies;
  const body = water.create({ id: 'pool', bounds: { min: [-1, -1], max: [1, 1] },
    sample: () => ({ bed: -1, surface: 0 }), optics: { optical } });
  const origin = [0, 1, 0], ray = [0, -1, 0];
  const segments = water.scene([body]).raySegments(origin, ray, 3);
  const wet = traceMedia([], segments, origin, ray, 3, new Float64Array(6), []);
  near(wet[3], 0.75 * Math.exp(-1.5));
  near(wet[1], 0.75 * (1 - Math.exp(-1.5)) / 3);
  near(wet[2], 0.25);
});

test('optical glass and translucent splats transmit the background without owning its depth', () => {
  const settings = { w: 64, h: 48, samples: true, px: 1 };
  for (const pixel of [false, true]) {
    const clear = render(scene(kit, { pixel }), settings);
    const center = 24 * 64 + 32;
    for (const glass of [false, true]) {
      const thin = render(scene(kit, { thickness: 0.1, glass, pixel }), settings);
      const world = scene(kit, { thickness: 1, glass, pixel });
      const thick = render(world, settings);
      assert.equal(thick.depth[center], clear.depth[center]);
      assert(thin.color[center * 3] < clear.color[center * 3] - 10);
      assert(thick.color[center * 3] < thin.color[center * 3] - 20);
      assert(thick.color[center * 3 + 2] > thick.color[center * 3] + 10);
      const pick = K.procedural.contributions.create(world).ray({ origin: [0, 0, 5], direction: [0, 0, -1] });
      assert(world.opticalSplats[pick.contributions[0].index * 12 + 3]);
      assert(pick.solid && !world.opticalSplats[pick.solid.index * 12 + 3]);
    }
  }
});

test('diorama materials preserve optical settings through subsets and placements', async () => {
  const spec = { id: 'glass-test', solids: [
    { kind: 'ball', at: [0, 0, 0], r: .6, res: .2,
      mat: { role: 'stone', glass: true, optical: { absorption: 0.6, depth: { thickness: 0.25 } } } }
  ] };
  const world = K.diorama.build(spec);
  const slot = world.opticalSplats.findIndex((value, i) => i % 12 === 3 && value === 0.25);
  assert(slot >= 0);
  const index = (slot - 3) / 12;
  assert.equal(world.opticalSplats[index * 12 + 3], 0.25);
  assert(Math.round(world.data[index * 16 + 11]) & 256);
  const prototype = K.procedural.splatProvenance.subset(world, [index]);
  const { createSplatInstances } = await import('../webgl.mjs');
  const group = createSplatInstances({ pane: prototype }, [{ id: 'placed', prototype: 'pane' }]);
  const expanded = group.flatten(world);
  assert.deepEqual(expanded.opticalSplats.subarray(world.count * 12), prototype.opticalSplats);
  spec.solids[0].mat.optical.depth.thickness = -1;
  assert.throws(() => K.diorama.build(spec), /mat\.optical[\s\S]*thickness/);
});

test('WebGL composites optical splats, fog and water with the patterned material shader', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, scene, (kit, scene, backend) => {
    const draw = backend(64, 48, { dither: 0, damp: false, colored: false });
    const center = { center: [32, 24] };
    const sample = (options, overrides) => {
      draw.draw(scene(kit, { ...options, pixel: true }), overrides);
      return draw.sample(center).center;
    };
    try {
      return { base: sample(), thin: sample({ thickness: 0.1, glass: true }),
        thick: sample({ thickness: 1, glass: true }),
        fog: sample({ medium: true }, { water: false }),
        water: sample({ medium: true }, { atmosphere: false }),
        combined: sample({ medium: true, thickness: 0.1, glass: true }, { raw: true }) };
    } finally {
      draw.close();
    }
  });
  assert(result.thin[0] < result.base[0] - 10, JSON.stringify(result));
  assert(result.thick[2] < result.thin[2] - 30, JSON.stringify(result));
  assert(result.thick[2] > result.thick[0] + 10, JSON.stringify(result));
  assert(result.fog[0] < result.base[0] - 10, JSON.stringify(result));
  assert(result.water[0] < result.base[0] - 10, JSON.stringify(result));
  assert(result.combined[2] > result.combined[0] + 20, JSON.stringify(result));
});
