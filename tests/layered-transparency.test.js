const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { contributionLayers } = require('../cli/look-contributions.js');
const { blendLayers } = require('../cli/translucent-layers.js');
const { KIT: K, makeBuilder } = ink.load();

const blended = { mode: 'blend', depthTolerance: .12 };
const view = { w: 33, h: 33, px: 1, raw: true, passes: ['depth', 'coverage', 'fogTransmittance'] };
const center = 16 * 33 + 16;
const RGB = frame => Array.from(frame.rgb.subarray(center * 3, center * 3 + 3));
const delta = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
const gapped = depths => depths.map((sort, i) => ({ sort, opacity: [.7, .5, .32][i], transparent: true }));

test('near depth swaps conserve transmission and keep opaque barriers', () => {
  const order = gapped([4.03, 4, 3.96]);
  blendLayers(order, .1);
  assert(Math.abs(order.reduce((t, { opacity }) => t * (1 - opacity), 1) - .3 * .5 * .68) < 1e-10);
  assert(order.some(({ opacity }, i) => opacity !== [.7, .5, .32][i]));
  const separated = gapped([5, 4, 3]);
  blendLayers(separated, .1);
  assert.deepEqual(separated, gapped([5, 4, 3]));
  const divided = gapped([4.02, 4, 3.98]);
  divided[1].transparent = false;
  blendLayers(divided, .1);
  assert.deepEqual(divided.map(fragment => fragment.opacity), [.7, .5, .32]);
});

test('refraction holds within a pane and eases between competing depths', () => {
  const samePane = gapped([4.01, 4, 3.99]).map(fragment => ({ ...fragment, pane: 1 }));
  const otherPanes = samePane.map((fragment, i) => ({ ...fragment, pane: i + 1 }));
  blendLayers(samePane, .1);
  blendLayers(otherPanes, .1);
  assert(samePane.every(fragment => fragment.refraction === 1));
  assert(otherPanes.every(fragment => fragment.refraction < .15));

  const colors = Float32Array.of(0, 0, 0, .2, .2, .2, .8, .8, .8);
  const layers = contributionLayers(colors, null, 3, 1, false, 1);
  layers.before(1, 0, 0, 0, .25, false, true, .5);
  layers.refract(Float32Array.of(0, .5, .5), Float32Array.of(1, 1, 1), true);
  assert(Math.abs(colors[3] - .425) < 1e-6);
});

function paneThroughMist({ z, rain = true, mist = true, foreground = false, color = 1 }) {
  const B = makeBuilder(1, [0x20252c, 0x167cff, 0xff9828, 0xd9a87a, 0x4a795c, 0xffddac]);
  B.disc(0, 0, -1.8, [0, 0, 1], 1.6, .02, B.P[4], 2);
  B.disc(0, 0, z, [0, 0, 1], 1, .03, B.P[color], .80, { gl: true, nd: true });
  if (rain) B.axial(0, 0, .35, [0, 1, 0], .37, .042, B.P[2], .65,
    { k: 2, ph: 0, sp: .01, rg: 4 });
  if (foreground) B.disc(0, 0, 1.6, [0, 0, 1], .5, .03, B.P[5], 2);
  const atmosphere = mist ? [K.atmosphere.box({ min: [-2,-2,-1], max: [2,2,1],
    density: .9, color: '#d5cabb' })] : [];
  return B.finish({ cam: { target: [0,0,0], yaw: 0, pitch: 0, dist: 4, ortho: true },
    atmosphere, radius: 4, refract: 0, dither: 0, look: { splatCoverage: 'continuous' } });
}
const capture = (world, stableTransparency, extra) => ink.render(world, { ...view, stableTransparency, ...extra });

test('a moving blue pane stays tinted as mist and a rain streak cross its depth', () => {
  const sample = (z, stableTransparency) => capture(paneThroughMist({ z }), stableTransparency);
  const before = sample(.349, blended), after = sample(.351, blended);
  const hardBefore = sample(.349, false), hardAfter = sample(.351, false);
  assert(delta(RGB(hardBefore), RGB(hardAfter)) > 15);
  assert(delta(RGB(before), RGB(after)) <= 3);
  const front = sample(1.45, blended), rear = sample(-1.45, blended);
  assert(RGB(front)[2] > RGB(front)[0] + 65);
  assert(delta(RGB(front), RGB(rear)) > 65);
  assert.equal(before.passes.depth[center], front.passes.depth[center]);
  assert.equal(before.passes.fogTransmittance[center], front.passes.fogTransmittance[center]);
  assert.equal(before.passes.coverage[center], after.passes.coverage[center]);
  assert.deepEqual(RGB(sample(.349, blended)), RGB(before));
  const occluded = color => RGB(capture(paneThroughMist({ z:.35, foreground: true, color }), blended));
  assert.deepEqual(occluded(1), occluded(3));
  assert.throws(() => capture(paneThroughMist({ z: .35 }), blended, { fragmentBudget: 8 }), /fragment budget/);
});

test('the water surface eases into a moving pane while separated depths retain full water optics', () => {
  const pitch = .43;
  const water = K.procedural.waterBodies.scene([K.procedural.waterBodies.create({
    id: 'tank', bounds: { min: [-2,-3], max:[2,3] }, sample: () => ({ bed: -2, surface: 0 }),
    optics: { optical: { reflection: .52, reflectionColor: '#e8ba79', absorption: .7, scattering: .16 } }
  })]);
  function sample(distance, stableTransparency, enabled = true) {
    const B = makeBuilder(1, [0x152030,0x2f8aff,0xcacdb0]);
    B.disc(0, Math.sin(pitch) * distance, Math.cos(pitch) * distance,
      [0,Math.sin(pitch),Math.cos(pitch)], .52, .024, B.P[1], .75, { gl:true, nd:true });
    B.disc(0,-.78,-1.7,[0,0,1],4,.028,B.P[2],2);
    const scene = B.finish({ cam: { target:[0,0,0], dist:4, yaw:0, pitch, ortho:true }, water, refract:0, radius:5 });
    return RGB(capture(scene, stableTransparency, { water:enabled }));
  }
  assert(delta(sample(-.001, false), sample(.001, false)) > 31);
  assert(delta(sample(-.001, blended), sample(.001, blended)) <= 2);
  for (const t of [-.5,.5]) assert.deepEqual(sample(t, blended), sample(t, false));
  assert(delta(sample(-.5, blended), sample(-.5, blended, false)) > 28);
});
