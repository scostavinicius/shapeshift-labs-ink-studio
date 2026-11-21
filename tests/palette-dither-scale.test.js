const assert = require('node:assert/strict');
const { test } = require('node:test');
const studio = require('..');
const { KIT: K, PixelLook, makeBuilder, makeSculpt } = studio.load();

const bg = 0x222633, source = 0x707070;
const palette = ['#000000', '#ffffff'];
const policy = dither => ({ palette, dither: { pattern: 'bayer', strength: 1, pairs: [{ colors: palette }], ...dither } });
const rgb = [112/255, 112/255, 112/255];
const protect = { type: 'axis', axis: 'x', range: [-.04, .04], space: 'rest', interpolation: 'step' };

test('the grid scale applies before lookup and regions feather density in order', () => {
  const checker = PixelLook.preparePalette(policy({ pattern: 'checker', scale: 2,
    regions: [{ mask: protect, strength: 0 }, { mask: { ...protect, axis: 'y' }, scale: 1, strength: 1 }] }));
  const read = (x, y, position) => checker.index(rgb, x, y, true, { sample: { position, worldPosition: position } });
  assert.deepEqual([0, 1, 2, 3].map(x => read(x, 0, [-1, -1, 0])), [1, 1, 0, 0]);
  assert.deepEqual([0, 1, 2, 3].map(x => read(x, 0, [1, -1, 0])), [0, 0, 0, 0]);
  assert.deepEqual([0, 1, 2, 3].map(x => read(x, 0, [1, 1, 0])), [1, 0, 1, 0]);
  const world = PixelLook.preparePalette(policy({ pattern: 'checker', space: 'world', spacing: 1, scale: 2 }));
  assert.deepEqual([.25, 1.25, 2.25].map(x => world.index(rgb, 0, 0, true,
    { sample: { worldPosition: [x, .25, 0] } })), [1, 1, 0]);
});

test('fade reduces the number of visible dots even at an exact swatch midpoint', () => {
  const plan = PixelLook.preparePalette(policy({ space: 'world', spacing: 1, fade: [.5, 1.5] }));
  const count = pixels => {
    let dots = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      dots += plan.index([.5, .5, .5], 0, 0, true, { sample: {
        worldPosition: [i + .1, j + .1, 0], footprint: () => 1 / pixels
      } });
    }
    return dots;
  };
  assert.deepEqual([.5, 1, 1.5].map(count), [0, 4, 8]);
  for (const dither of [{ scale: 0 }, { fade: [1, 1] }, { regions: [{ strength: 0 }] },
    { regions: [{ mask: protect, strength: 2 }] }])
    assert.throws(() => PixelLook.preparePalette(policy(dither)), /Dither|dither/);
  const fit = K.palette.fitDither({ target: '#bcbcbc', policy: policy({ pattern: 'checker', scale: 2 }), size: [4, 4] });
  assert.deepEqual(fit.indexed().slots, [1,1,0,0, 1,1,0,0, 0,0,1,1, 0,0,1,1]);
});

function plate(scope, definition) {
  const b = makeBuilder(7, [bg, source]), s = K.sculpt(makeSculpt(b));
  s.amb = 1; s.sunK = 0; s.sky = 0;
  const material = { r: [1], materialId: 'plate' };
  const paint = scope === 'surface' ? K.surface.material(material, { paletteConstraint: definition }) : material;
  s.box([0, 0, -.06], [1.2, .83, .07], paint, { res: .055, objectId: 'plate' });
  s.bake();
  const select = { material: 'plate' };
  const look = scope === 'stage' ? { renderStages: [{ stage: 'palette', select, palette: definition }] } :
    scope === 'target' ? { paletteConstraints: { targets: [{ select, ...definition }] } } : {};
  return b.finish({ cam: { target: [0, 0, 0], dist: 4.3, yaw: 0, pitch: 0, sway: 0 },
    dither: 0, look: { splatCoverage: 'continuous', ...look } });
}
const view = { w: 96, h: 72, px: 1, ortho: true };
function white(frame, x0, x1) {
  let hits = 0;
  for (let y = 31; y < 40; y++) for (let x = x0; x < x1; x++) hits += Number(frame.rgb[(y * frame.w + x) * 3] >= 244);
  return hits;
}

test('native paths protect a region without removing quantization', () => {
  const tuning = policy({ scale: 2, regions: [{ mask: protect, strength: 0 }] });
  for (const [scope, mode] of [
    ['target', {}], ['target', { colored: true }], ['target', { coverageAware: true }],
    ['target', { stable: { resolve: 'coverage' } }], ['surface', {}], ['stage', {}]
  ]) {
    const world = plate(scope, tuning), options = { ...view, ...mode };
    const frame = studio.render(world, options);
    assert(white(frame, 37, 47) > 15, scope + JSON.stringify(mode));
    assert.equal(white(frame, 50, 59), 0, scope + JSON.stringify(mode));
    assert(frame.rgb[(35 * frame.w + 54) * 3] < 10);
    assert(white(studio.render(world, { ...options, lookMasks: false }), 50, 59) > 12);
  }
  const masked = plate('target', { ...tuning, mask: { type: 'axis', origin: [0, -3, 0] } });
  assert.equal(white(studio.render(masked, view), 50, 59), 0);
  assert(white(studio.render(masked, view), 37, 47) > 15);
});

test('world grain fades as it becomes subpixel in perspective and orthographic resolves', () => {
  const settings = policy({ space: 'world', spacing: .09, origin: [.013,.018,0], fade: [.65, 1.25] });
  const world = plate('target', settings);
  for (const ortho of [true, false]) for (const mode of [{}, { coverageAware: true }, { colored: true }]) {
    const options = { ...view, ortho, ...mode };
    const near = studio.render(world, options);
    assert(white(near, 44, 52) > 18, JSON.stringify(options));
    assert.equal(white(studio.render(world, { ...options, dist: 16 }), 44, 52), 0, JSON.stringify(options));
    const scaled = studio.render(world, { ...options, w: 192, h: 144, px: 2 });
    assert.deepEqual(near.rgb, scaled.rgb);
  }
});

test('WebGL scene targets apply screen cell scale and fade in both resolve paths', { skip: !process.env.INK_TEST_CHROME }, () => {
  const run = require('../cli/look-webgl.js');
  const settings = [
    policy({ pattern: 'checker', scale: 2, fade: [.75, 1.25] }),
    policy({ pattern: 'checker', scale: .5, fade: [.75, 1.25] })
  ];
  const { outputs } = run({}, ({ makeBuilder }) => {
    const b = makeBuilder(3, [0x222633, 0x707070]);
    b.disc(0, 0, 0, [0, 0, 1], .8, .045, b.P[1], 3);
    b.describeSplats(0, b.count(), { material: 'plate' });
    return b.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, sway: 0 }, dither: 0 });
  }, (kit, fixture, backend, settings) => {
    const draw = backend(48, 48, { ortho: true, dither: 0, outline: false });
    try {
      const world = fixture(kit);
      return { outputs: settings.map(policy => [false, true].map(coverageAware => {
        draw.draw(world, { coverageAware, paletteConstraints: { targets: [{ material: 'plate', ...policy }] } });
        return Object.values(draw.sample({ a: [22,24], b: [23,24], c: [24,24], d: [25,24] }))
          .map(rgb => Number(rgb[0] > 127));
      })) };
    } finally { draw.close(); }
  }, settings);
  assert.deepEqual(outputs, [[[0,0,1,1], [0,0,1,1]], [[0,0,0,0], [0,0,0,0]]]);
});
