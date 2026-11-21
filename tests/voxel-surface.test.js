const test = require('node:test'),
  assert = require('node:assert/strict'),
  core = require('..'),
  kit = core.load(),
  K = kit.KIT,
  F = K.voxelSurface;
const bounds = { min: [-1, -1, -1], max: [1, 1, 1] },
  sphere = (x, y, z) => Math.hypot(x, y, z) - 0.9;
const near = (a, b, e = 1e-5) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
function volume(p) {
  return p.blocks.reduce((s, b) => s + b.span.reduce((a, n) => a * n, 1), 0);
}
function occupied(p) {
  const s = new Set();
  for (const b of p.blocks)
    for (let x = 0; x < b.span[0]; x++)
      for (let y = 0; y < b.span[1]; y++)
        for (let z = 0; z < b.span[2]; z++) s.add([x, y, z].map((n, k) => n + b.index[k]).join('/'));
  return [...s].sort();
}
test('real cubes cull interior faces, retain outward planes and stable JSON plans', () => {
  const p = F.fromSdf(() => -1, { bounds: { min: [0, 0, 0], max: [2, 2, 2] }, size: 1 });
  assert.equal(p.blocks.length, 8);
  assert.equal(p.faces.length, 24);
  assert.equal(p.stats.samples, 8);
  for (const f of p.faces) {
    const [a, b, c] = f.points,
      n = K.V.norm(K.V.cross(K.V.sub(b, a), K.V.sub(c, a)));
    near(K.V.dot(n, f.normal), 1);
  }
  assert(Object.isFrozen(p.blocks[0].center));
  assert.deepEqual(
    p,
    F.fromSdf(() => -1, { bounds: { min: [0, 0, 0], max: [2, 2, 2] }, size: 1 })
  );
  const B = kit.makeBuilder(1),
    batch = F.draw(B, JSON.parse(JSON.stringify(p)), { object: 'building' }),
    W = B.finish();
  assert.equal(W.count, 48);
  assert.equal(batch.blocks.length, 8);
  assert.deepEqual(batch.stats, p.stats);
  assert.equal(W.splatFootprints.styles[0].depth, 'plane');
  assert(W.renderMetadata.objects.includes('building'));
  assert.throws(() => F.groups(batch), /closed/);
  const closed = F.fromSdf(() => -1, { bounds: { min: [0, 0, 0], max: [2, 2, 2] }, size: 1, closed: true });
  assert.equal(closed.faces.length, 48);
});
test('columns and slabs preserve the same occupied volume including tunnels and overhangs', () => {
  const cave = (x, y, z) => Math.max(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - 0.95, 0.31 - Math.hypot(y, z));
  const p = F.fromSdf(cave, { bounds, size: 0.2 });
  for (const mode of ['columns', 'slabs'])
    for (let axis = 0; axis < 3; axis++) {
      const q = F.fromSdf(cave, { bounds, size: 0.2, mode, axis });
      assert.deepEqual(occupied(q), occupied(p));
      assert(q.blocks.length < p.blocks.length);
      assert.equal(volume(q), volume(p));
    }
});
test('relief follows the first visible depth from either side, with bounded stepped thickness', () => {
  const field = (x, y, z) => Math.min(Math.abs(z - 0.6) - 0.1, Math.abs(z + 0.6) - 0.1),
    box = { min: [-0.3, -0.3, -1], max: [0.3, 0.3, 1] };
  const a = F.fromSdf(field, { bounds: box, size: 0.1, mode: 'relief', axis: 2, thickness: 0.24 }),
    b = F.fromSdf(field, { bounds: box, size: 0.1, mode: 'relief', axis: 2, side: -1, thickness: 0.24 });
  assert(a.blocks.length > 0);
  assert(a.blocks.every(q => q.center[2] > 0.4 && q.span[2] === 3));
  assert(b.blocks.every(q => q.center[2] < -0.4 && q.span[2] === 3));
});
test('oriented anisotropic grids rotate cells without rotating the source field', () => {
  const p = F.fromSdf(sphere, { bounds, size: [0.2, 0.3, 0.25], orientation: [0.1, 0.4, 0.2] });
  assert(p.blocks.length > 0);
  for (const b of p.blocks) assert(sphere(...b.center) <= 1e-8);
  assert(p.faces.some(f => f.normal.filter(n => Math.abs(n) > 0.01).length > 1));
});
test('strict resource budgets fail before sampling or drawing, malformed plans fail safely', () => {
  let calls = 0;
  assert.throws(
    () =>
      F.fromSdf(
        () => {
          calls++;
          return -1;
        },
        { bounds, size: 0.001, maxCells: 20 }
      ),
    /budget/
  );
  assert.equal(calls, 0);
  for (const options of [
    { mode: 'blob' },
    { size: 0 },
    { axis: 3 },
    { gap: 1 },
    { closed: 1 },
    { thickness: 0 },
    { maxSamples: 1 }
  ])
    assert.throws(() => F.fromSdf(sphere, { bounds, ...options }));
  assert.throws(() => F.fromSdf(() => NaN, { bounds }));
  assert.throws(() => F.fromSdf(sphere, { bounds, maxBlocks: 1 }), /budget/);
  assert.throws(() => F.fromSdf(sphere, { bounds, maxFaces: 1 }), /budget/);
  const p = F.fromSdf(sphere, { bounds, size: 0.3 }),
    B = kit.makeBuilder(1);
  assert.throws(() => F.draw(B, p, { color: () => [NaN, 0, 0] }));
  assert.equal(B.count(), 0);
  const bad = JSON.parse(JSON.stringify(p));
  bad.blocks.push(bad.blocks[0]);
  assert.throws(() => F.draw(B, bad));
  assert.equal(F.fromSdf(() => 1, { bounds }).bounds, null);
});
function fixture(kit) {
  const K = kit.KIT,
    B = kit.makeBuilder(1, [0x111c2a, 0xffffff]),
    p = K.voxelSurface.fromSdf((x, y, z) => Math.hypot(x, y, z) - 0.9, {
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      size: 0.3,
      closed: true
    });
  const batch = K.voxelSurface.draw(B, p, { color: '#ecaf69', variation: 0 }),
    world = B.finish({
      cam: { target: [0, 0, 0], dist: 4.7, yaw: 0.45, pitch: 0.25 },
      radius: 20,
      dither: 0,
      fog: { c: 0, start: 1, max: 0 },
      look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
    });
  return { world, batch };
}
test('seekable block transforms reuse existing GPU bone rigs and preserve complete solid pieces', () => {
  const { world, batch } = fixture(kit),
    rest = world.data.slice();
  const rig = F.bind(world, batch, {
    pose: (b, t) => ({ translation: K.V.mul(b.center, t), rotation: K.M.rot([0, 1, 0], t) })
  });
  rig.update(0, 1);
  const posed = K.bones.posed(world);
  assert(posed.some((n, i) => i % 16 < 3 && Math.abs(n - rest[i]) > 0.01));
  assert(batch.blocks.every(b => b.ids.length === 12));
  rig.update(0, 0);
  const back = K.bones.posed(world);
  for (let i = 0; i < back.length; i++) if (i % 16 < 3) near(back[i], rest[i]);
});
test('destruction rubble and debris rotate native frames and reset restores every face', () => {
  for (const mode of ['rubble', 'debris']) {
    const { world, batch } = fixture(kit),
      st = K.stage(world),
      saved = world.splatFootprints.frames.slice(),
      groups = F.groups(batch, { prefix: 'test', mode }),
      d = K.destruction(st, { groups, maxPieces: 512, gravity: 0, ground: () => -20 });
    const g = groups[0],
      p = d.release(g.id, { v: [1, 0, 0], w: [0, 3, 0] })[0];
    d.update(1 / 60);
    assert(world.splatFootprints.frames.some((n, i) => Math.abs(n - saved[i]) > 1e-5));
    for (const id of g.ids) {
      const want = K.M.app(p.R, Array.from(saved.subarray(id * 6, id * 6 + 3)));
      want.forEach((n, k) => near(world.splatFootprints.frames[id * 6 + k], n));
    }
    d.reset();
    assert.deepEqual(world.splatFootprints.frames, saved);
    assert.deepEqual(world.data, st.base);
    d.dispose();
  }
});
test('destruction preserves frame slots when a group also owns splats beyond the layout', () => {
  const { world, batch } = fixture(kit);
  const { styles, indices, frames } = world.splatFootprints;
  const beyond = world.count - 1;
  world.splatFootprints = kit.SplatFootprints.layout(
    beyond,
    styles,
    indices.slice(0, beyond),
    frames.slice(0, beyond * 6)
  );
  const saved = world.splatFootprints.frames.slice();
  const groups = [{ id: 'mixed', ids: [beyond, ...batch.blocks[0].ids] }];
  const stage = K.stage(world),
    d = K.destruction(stage, { groups, gravity: 0 });
  const [body] = d.release('mixed', { w: [0, 3, 0] });
  d.update(1 / 60);
  const id = batch.blocks[0].ids[0];
  const expected = K.M.app(body.R, Array.from(saved.subarray(id * 6, id * 6 + 3)));
  expected.forEach((n, k) => near(world.splatFootprints.frames[id * 6 + k], n));
  d.reset();
  assert.deepEqual(world.splatFootprints.frames, saved);
  d.dispose();
});
test('graph nodes and mesh export retain optional native planar representation', () => {
  const A = K.procedural.sceneGraph,
    source = A.shape('sphere', { radius: 0.8 }),
    p = A.operations['sdf.voxels'].run({ source, options: { size: 0.3, mode: 'columns' } }, { time: 0 }).value;
  const w = A.operations['voxels.world'].run({ source: p, options: {} }, {}).value,
    m = A.operations['voxels.mesh'].run({ source: p, options: {} }, {}).value;
  assert.equal(w.count, p.faces.length * 2);
  assert(w.splatFootprints);
  assert.equal(m.tri.length, p.faces.length * 6);
});
test(
  'hardware block faces remain visible through camera orbit and block transforms',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const { world, batch } = build(kit),
          b = backend(120, 100, { raw: true, damp: false });
        b.draw(world);
        const a = b.image();
        b.draw(world, { camera: { ...world.cam, yaw: 1.3 } });
        const c = b.image();
        const rig = kit.KIT.voxelSurface.bind(world, batch, {
          pose: (block, t) => ({ translation: kit.KIT.V.mul(block.center, t), rotation: kit.KIT.M.rot([0, 1, 0], t) })
        });
        rig.update(0, 0.45);
        b.draw(world, { changedRows: Array.from({ length: Math.ceil(world.count / 512) }, (_, i) => i) });
        const d = b.image();
        b.close();
        return { a, c, d };
      }
    );
    assert.notEqual(result.a, result.c);
    assert.notEqual(result.a, result.d);
  }
);
