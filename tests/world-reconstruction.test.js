const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ makeBuilder }, spin = 0) {
  const B = makeBuilder(5, [0x101010, 0x387f3e, 0xee1111, 0x1616aa, 0xbaba30]);
  for (const x of [-.9, -.8, .7, .8]) {
    B.fineTile(11, 22, 33, 44, 1, 0, 0, 0, 1, 0, 7);
    B.pixNext([1], 1, null, 0, 0, 1, 0, 0, 1);
    B.disc(x, 0, 0, [0, 0, 1], .12, .013, B.P[1], 3);
  }
  B.describeSplats(0, 4, { object: 'panel', material: 'ink' });
  B.disc(0, -.6, 0, [0, 0, 1], .11, .015, B.P[4], 3);
  B.describeSplats(4, 5, { object: 'neighbor' });
  return B.finish({ detail: 8, cam: { target: [0, 0, 0], dist: 5, pitch: 0, yaw: 0 },
    splatIds: ['panel-0', 'panel-1', 'panel-2', 'panel-3', 'neighbor-0'],
    paint: { decals: [[.8, 0, 0, 0, 0, 1, 3]], layers: [
      { id: 'front', view: { direction: [0, 0, 1] }, decals: [
        [-.9, 0, 0, 0, 0, 1, 2], [0, -.6, 0, 0, 0, 1, 2]
      ] },
      { id: 'angle', view: { direction: [1, 0, 1] }, opacity: .5, decals: [[-.9, 0, 0, 0, 0, 1, 3]] }
    ] },
    look: { reconstruction: { select: { object: 'panel' }, cell: .6, distance: .8, spin, keys: [
      { time: 0, state: 'solid', ease: 'linear' }, { time: 1, state: 'fragmented' },
      { time: 2, state: 'sparse', withdrawal: 1 }, { time: 3, state: 'reassembled' }
    ] } }
  });
}

const kit = studio.load(), reconstruction = kit.KIT.reconstruction, { V, M } = kit.KIT;
const row = (world, i) => world.data.subarray(i * 16, (i + 1) * 16);
const position = (world, i) => Array.from(row(world, i).subarray(0, 3));
const close = (a, b) => assert(V.dist(a, b) < 1e-6, JSON.stringify({ a, b }));

test('reconstruction seeks deterministically and carries paint and texture frames with original splats', () => {
  const world = fixture(kit, 1.4), original = world.data.slice();
  const broken = reconstruction.frame(world, 1);
  const half = reconstruction.frame(world, .5);
  assert.equal(broken.count, world.count);
  assert.equal(broken.splatIds, world.splatIds);
  assert.equal(broken.renderMetadata.objectIds, world.renderMetadata.objectIds);
  assert.deepEqual(row(broken, 4), row(world, 4));
  assert(V.dist(position(world, 0), position(broken, 0)) > .4);
  const fullTravel = V.dist(position(world, 0), position(broken, 0));
  assert(Math.abs(V.dist(position(world, 0), position(half, 0)) / fullTravel - .5) < .02);
  assert(Math.abs(V.dist(position(broken, 0), position(broken, 1)) - V.dist(position(world, 0), position(world, 1))) < 1e-6);
  const legacy = world.paintDecals[0], correction = world.paintCorrections.rows[0];
  const marks = broken.paintCorrections.rows;
  const frame = kit.KIT.splatFrames.create(broken, 1, M)(0);
  const { anchor } = frame.basis();
  close(Array.from(frame.rest), position(world, 0));
  close(frame.normal, M.app(anchor, [0, 0, 1]));
  close(Array.from(broken.fine.subarray(4, 7)), M.app(anchor, [1, 0, 0]));
  close(Array.from(broken.fine.subarray(8, 11)), M.app(anchor, [0, 1, 0]));
  assert.deepEqual(broken.fine.subarray(0, 4), world.fine.subarray(0, 4));
  assert.notDeepEqual(row(world, 0).slice(4, 7), row(broken, 0).slice(4, 7));
  close(marks[0].at, position(broken, 0));
  close(marks[0].samples[1].toward, M.app(anchor, correction.samples[1].toward));
  assert.equal(marks[1], world.paintCorrections.rows[1]);
  assert(V.dist(position(broken, legacy.index), position(broken, 3)) < .05);
  const sparse = reconstruction.frame(world, 2);
  assert.equal(row(sparse, legacy.index)[3], 0);
  assert.equal(row(sparse, correction.index)[3], 0);
  assert.equal(sparse.paintCorrections.rows.length, 1);
  const partial = reconstruction.frame(world, 2, { ...world.look.reconstruction, keys: [{ time: 0, state: 'sparse', withdrawal: .5 }] });
  assert([0, 1, 2, 3].some(i => row(partial, i)[3] === 0));
  assert([0, 1, 2, 3].some(i => row(partial, i)[3] > 0));
  assert.equal(reconstruction.frame(world, 3), world);
  assert.equal(reconstruction.frame(broken, 1), broken);
  assert.deepEqual(world.data, original);
  assert.deepEqual(reconstruction.frame(world, 1).data, broken.data);
  const take = kit.SplatProvenance.subset(world, [legacy.index, 3]);
  assert.equal(take.paintDecals[0].index, 0);
  assert.equal(kit.SplatProvenance.join([take, take]).paintDecals[1].index, 2);
});

test('headless drawing, picking and overrides use the same world-space pose', () => {
  const world = fixture(kit);
  const draw = (t, o = {}) => studio.render(world, { w: 96, h: 64, px: 1, raw: true, ortho: true, t, ...o }).rgb;
  const ray = { origin: [...position(reconstruction.frame(world, 1), 0).slice(0, 2), 3], direction: [0, 0, -1] };
  const pick = (time, reconstruction) => studio.createSplatPicker(world, { time, reconstruction }).ray(ray).contributions;
  assert(pick(1).some(hit => hit.id === 'panel-0'));
  assert(!pick(1, false).some(hit => hit.id === 'panel-0'));
  assert(!pick(2).some(hit => hit.id === 'panel-0'));
  assert.notDeepEqual(draw(1), draw(0));
  assert.notDeepEqual(draw(1), draw(1, { paintCorrections: false }));
  assert.notDeepEqual(draw(2), draw(1));
  const resolved = reconstruction.frame(world, 1);
  assert.deepEqual(studio.render(resolved, { w: 96, h: 64, px: 1, raw: true, ortho: true, t: 1 }).rgb, draw(1));
  assert.deepEqual(draw(3), draw(0));
  assert.deepEqual(draw(1, { reconstruction: false }), draw(0));
  assert.throws(() => reconstruction.prepare({ ...world.look.reconstruction, keys: [{ time: 1, state: 'missing' }] }), /increasing finite times/);
  assert.throws(() => reconstruction.prepare({ ...world.look.reconstruction, keys: [{ time: 1, spread: 5 }] }), /range from 0 to 1/);
});

test('WebGL displays the reconstructed geometry and follows its authored identity when picking', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({}, fixture, (kit, build, backend) => {
    const world = build(kit), draw = backend(96, 64, { raw: true, dither: 0, camera: { ortho: true } });
    const frame = kit.KIT.reconstruction.frame(world, 1);
    const ray = { origin: [frame.data[0], frame.data[1], 3], direction: [0, 0, -1] };
    try {
      const images = [0, 1, 2, 3].map(time => {
        draw.draw(world, { time });
        return draw.image();
      });
      draw.draw(world, { time: 1, paintCorrections: false });
      return { images, withoutPaint: draw.image(), hits: [1, 2].map(time => draw.pick(world, ray, { time }).contributions.map(hit => hit.id)) };
    } finally {
      draw.close();
    }
  });
  assert.equal(result.images[0], result.images[3]);
  assert.notEqual(result.images[0], result.images[1]);
  assert.notEqual(result.images[1], result.images[2]);
  assert.notEqual(result.images[1], result.withoutPaint);
  assert(result.hits[0].includes('panel-0'));
  assert(!result.hits[1].includes('panel-0'));
});
