const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..'), kit = ink.load(), { ArtInk } = kit;

const palette = [0x181828, 0x353535, 0x606060, 0xbc997b, 0xf1dec3];
const gray = value => [value, value, value];
const view = { w: 3, h: 3 };
const pixel = 4, colorAt = (frame, p) => Array.from(frame.rgb.subarray(3 * p, 3 * p + 3));

function patch(value, backdrop, options = {}) {
  const rgb = Uint8Array.from(Array.from({ length: 9 }, (_, p) => gray(p === pixel ? value : backdrop)).flat());
  const depth = Float32Array.from({ length: 9 }, (_, p) => p === pixel ? options.depth ?? 5 : Infinity);
  const alpha = Uint8Array.from({ length: 9 }, (_, p) => p === pixel || !options.transparent ? 255 : 0);
  const passes = {
    depth, normal: new Float32Array(27), emission: new Float32Array(27),
    objectId: new Uint32Array(9), materialId: new Uint32Array(9), splatId: new Uint32Array(9), materials: [null]
  };
  if (options.emissive) passes.emission.fill(1, pixel * 3, pixel * 3 + 3);
  return { frame: { ...view, rgb, alpha }, passes };
}

test('an outline can soften independently of the blend that loses the visible edge', () => {
  const style = {
    silhouette: { color: '#181828', strength: .5, lost: { lightness: [.22, .4], contrast: [.07, .18] } },
    boundary: false, crease: false
  };
  const shade = (value, backdrop, options, rule = style) => {
    const { frame, passes } = patch(value, backdrop, options);
    return colorAt(ArtInk.apply(frame, passes, ArtInk.prepare(rule, palette), palette), pixel);
  };
  assert.deepEqual(shade(51, 38), gray(38));
  assert.deepEqual(shade(51, 132), [38, 38, 46], 'contrast gate preserves the line');
  assert.deepEqual(shade(165, 157), [95, 95, 103], 'bright detail keeps its line');
  assert.deepEqual(shade(51, 38, { transparent: true }), [38, 38, 46]);
  assert.deepEqual(shade(51, 38, { emissive: true }), [38, 38, 46]);
  assert.deepEqual(shade(51, 38, {}, { silhouette: { strength: 0, lost: {} } }), gray(38));
  assert.throws(() => ArtInk.prepare({ silhouette: { lost: { contrast: [.21, .14] } } }, palette), /contrast/);
  assert.throws(() => ArtInk.prepare({ silhouette: { strength: 1.2 } }, palette), /strength/);
});

test('distance feathers the edge into the adjacent colour in camera units', () => {
  const settings = ArtInk.prepare({
    silhouette: { strength: 0, lost: { distance: { near: 4, far: 8 } } }, boundary: false, crease: false
  }, palette);
  const shade = depth => {
    const { frame, passes } = patch(100, 40, { depth });
    return colorAt(ArtInk.apply(frame, passes, settings, palette, null, { depthOffset: 2 }), pixel);
  };
  assert.deepEqual(shade(6), gray(100));
  assert.deepEqual(shade(8), gray(70));
  assert.deepEqual(shade(10), gray(40));
});

test('creases and material boundaries can each lose their own edge', () => {
  for (const [kind, code] of [['crease', 2], ['boundary', 3]]) {
    const { frame, passes } = patch(93, 61);
    for (let p = 0; p < 9; p++) if (p !== pixel) passes.depth[p] = 6;
    passes.splatId[pixel] = 1;
    if (kind === 'boundary') passes.materialId[pixel] = 1;
    const settings = ArtInk.prepare({
      silhouette: false, crease: false, boundary: false, [kind]: { strength: 0, lost: {} }
    }, palette);
    const image = ArtInk.apply(frame, passes, settings, palette);
    assert.deepEqual(colorAt(image, pixel), gray(61));
    assert.equal(image.inkMask[pixel], code);
  }
});

test('a hand and face keep an authored edge when they override their courier’s shadow rule', () => {
  const { makeBuilder } = kit, B = makeBuilder(70, palette);
  const surfaces = ['cloak', 'face', 'hand'];
  for (const surface of surfaces) {
    const row = B.count();
    B.disc(0, 0, 0, [0, 0, 1], .2, .03, B.P[1], 3);
    B.describeSplats(row, row + 1, { object: 'courier', target: { surface } });
  }
  const world = B.finish(), settings = ArtInk.prepare({
    silhouette: { color: '#303030' },
    targets: [
      { select: { object: 'courier' }, silhouette: { lost: { lightness: [.26, .34] } } },
      ...surfaces.slice(1).map(surface => ({
        select: { surface }, silhouette: { lost: false, color: '#be997b' }
      }))
    ]
  }, palette);
  for (let i = 0; i < surfaces.length; i++) {
    const { frame, passes } = patch(51, 38);
    passes.splatId[pixel] = i + 1;
    const trace = [];
    ArtInk.apply(frame, passes, settings, palette, null, {
      world, inspect: { pixel, ink(colors, index, rgb, effect) { trace.push(effect); } }
    });
    assert.deepEqual(colorAt(frame, pixel), i ? [190, 153, 123] : gray(38));
    assert.deepEqual(trace, i ? ['silhouette'] : ['silhouette', 'lost-silhouette']);
  }
});

test('authored loss changes RGB while keeping occlusion, depth and object ownership', () => {
  const { KIT: K } = kit;
  const scene = {
    id: 'edge-hierarchy-test', style: 'slate',
    camera: { target: [0, .2, 0], dist: 4, yaw: 0, pitch: 0, projection: 'orthographic' },
    finish: { look: { ink: { occlusionSilhouettes: true, silhouette: { color: '#fab169' },
      targets: [{ select: { object: 'plate' }, silhouette: { lost: {} } }] } } },
    solids: [
      { id: 'wall', kind: 'box', at: [0, .2, -.65], half: [2, 1.5, .1], mat: 'stone' },
      { id: 'plate', kind: 'ball', at: [0, .25, .2], r: .52, mat: 'stone' }
    ]
  };
  const world = K.diorama.build(JSON.parse(JSON.stringify(scene)));
  const options = { w: 56, h: 44, px: 1, passes: ['depth', 'objectId', 'splatId'] };
  const a = ink.render(world, options), b = ink.render(world, { ...options,
    ink: { ...world.look.ink, targets: [] } });
  assert.notDeepEqual(a.rgb, b.rgb);
  assert.deepEqual(a.passes.depth, b.passes.depth);
  assert.deepEqual(a.passes.splatId, b.passes.splatId);
  assert.deepEqual(a.passes.objectId, b.passes.objectId);
});
