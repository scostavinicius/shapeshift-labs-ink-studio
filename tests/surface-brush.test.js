const test = require('node:test'),
  assert = require('node:assert/strict');
const kit = require('..').load(),
  K = kit.KIT,
  B = kit.SurfaceBrush,
  F = kit.SplatFootprints;
const near = (a, b, e = 1e-5) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
function stamped(kit) {
  const b = kit.makeBuilder(1, [0x000000, 0xf1ac64]);
  const f = kit.KIT.surfaceBrush.direction(
    { direction: 'axis', axis: [1, 1, 0], length: 2.5, width: 1.1 },
    [0, 0, 0],
    [0, 0, 1]
  );
  kit.KIT.surfaceBrush.stamp(b, f, b.P[1], { style: 'ink', direction: 'axis' });
  b.describeSplats(0, b.count(), { object: 'paint' });
  return b.finish({
    cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true },
    radius: 5,
    look: { pixelSize: 1, clean: 1 },
    fog: { start: 1, max: 0, c: 0 },
    dither: 0
  });
}
test('curvature selects the straighter cylinder direction with four normal queries', () => {
  let calls = 0;
  const f = B.direction({ axis: [1, 1, 0], length: 4 }, [2, 0, 0], [1, 0, 0], {
    spacing: 0.1,
    normalAt: (x, y, z) => {
      calls++;
      const l = Math.hypot(x, z);
      return [x / l, 0, z / l];
    }
  });
  near(Math.abs(f.tangent[1]), 1);
  near(dot(f.normal, f.tangent), 0);
  near(dot(f.normal, f.bitangent), 0);
  assert.equal(calls, 4);
  assert.equal(f.normalSamples, 4);
  assert(f.length < 1);
  assert(f.confidence > 0.9);
});
test('isotropic normals, discontinuities and zero authored fields have stable tangent fallbacks', () => {
  for (const normalAt of [
    () => [1, 0, 0],
    (x, y, z) => {
      const l = Math.hypot(x, y, z);
      return [x / l, y / l, z / l];
    }
  ]) {
    const a = B.direction(true, [0, 0, 1], [0, 0, 1], { normalAt }),
      b = B.direction(true, [0, 0, 1], [0, 0, 1], { normalAt });
    assert.deepEqual(a, b);
    assert(a.tangent.every(Number.isFinite));
    near(dot(a.tangent, a.normal), 0);
  }
  const a = B.direction({ direction: 'field', field: () => [0, 0, 0] }, [0, 0, 0], [0, 1, 0]);
  near(Math.hypot(...a.tangent), 1);
  const c = B.direction({ direction: 'field', field: { sample: () => [2, 4, 0] } }, [0, 0, 0], [0, 1, 0]);
  assert.deepEqual(c.tangent, [1, 0, 0]);
  assert.throws(() => B.prepare({ direction: 'field' }));
  assert.throws(() => B.prepare({ width: NaN }));
  assert.throws(() => B.direction(true, [0, 0, 0], [0, 0, 0]));
});
test('brush profiles are deterministic, bounded and cached without advancing scene randomness', () => {
  assert.equal(B.prepare('bristle'), B.prepare('bristle'));
  const p = B.prepare({ style: 'bristle', grain: 0.5, seed: 15 });
  assert.equal(B.profile(p, 1), B.profile(p, 1));
  assert.notDeepEqual(B.profile(p, 0).mask, B.profile(p, 1).mask);
  assert.deepEqual(B.profile(p, 0).mask, B.profile(B.prepare({ style: 'bristle', grain: 0.5, seed: 15 }), 0).mask);
  for (const style of B.styles) assert(F.field(B.profile({ style }, 0)).every(Number.isFinite));
  assert.throws(() => B.profile(p, 8));
});
test('signed surface projection preserves both axes and rejects edge-on degeneracy', () => {
  const p = F.prepare({ shape: 'wedge', rotation: 0.25 });
  for (const [ux, uy, vx, vy] of [
    [3, 2, -1, 4],
    [-3, 2, 1, 4],
    [0.03, 1, 2, -0.01]
  ]) {
    const m = F.frameTransform(p, ux, uy, vx, vy),
      a = 0.38,
      b = -0.21;
    const x = ux * a + vx * b,
      y = uy * a + vy * b;
    near(m[0] * x + m[1] * y, p.matrix[0] * a + p.matrix[1] * b);
    near(m[2] * x + m[3] * y, p.matrix[2] * a + p.matrix[3] * b);
  }
  assert.equal(F.frameTransform(p, 1, 1, 2, 2), null);
});
test('surface frames survive authoring, subsets, joins and cached plans', () => {
  const w = stamped(kit),
    frames = w.splatFootprints.frames;
  assert.equal(frames.length, 6);
  assert(frames.some(Boolean));
  assert.deepEqual(F.subset(w, [0]).frames, frames);
  assert.deepEqual(F.join([w, w]).frames, new Float32Array([...frames, ...frames]));
  const a = F.plan(w);
  F.setTransform(w, 1, { rotation: 0.3 });
  const b = F.plan(w);
  assert.equal(a.indices, b.indices);
  assert.equal(a.atlas, b.atlas);
  const f = frames.slice();
  f[0] *= 2;
  F.setFrames(w, f);
  const c = F.plan(w);
  assert.equal(b.atlas, c.atlas);
  assert.notEqual(c.indices, b.indices);
  F.assign(w, 'all', 'wedge');
  assert.deepEqual(w.splatFootprints.frames, f);
  assert.throws(() => F.layout(1, ['ink'], new Uint16Array([1]), new Float32Array(5)));
  assert.throws(() => F.layout(1, ['circle'], new Uint16Array([1]), new Float32Array([NaN, 0, 0, 0, 1, 0])));
});
test('sculpt uses per-material brushes and can opt out without changing other materials', () => {
  const b = kit.makeBuilder(9),
    s = K.sculpt(kit.makeSculpt(b));
  s.brush = { style: 'gouache', direction: 'contour', axis: [0, 1, 0], length: 0.22, width: 0.08 };
  s.ball([-0.5, 0, 0], 0.35, { r: [2, 3, 4] }, { res: 0.12, tag: 'paint' });
  s.ball([0.5, 0, 0], 0.35, { r: [2, 3, 4], brush: false }, { res: 0.12, tag: 'plain' });
  s.bake();
  const w = b.finish();
  assert(w.count > 20);
  assert(w.splatFootprints.indices.some(Boolean));
  assert(w.splatFootprints.indices.some(i => i === 0));
  assert(w.splatFootprints.frames.some(Boolean));
});
test('CPU deformation and stage rigs carry rest axes without accumulating drift', () => {
  const w = stamped(kit),
    rest = K.deform.rest(w, [0]),
    start = w.splatFootprints.frames.slice(),
    m = [0, -2, 0, 3, 0, 0, 0, 0, 1];
  const map = p => K.M.app(m, p);
  K.deform.apply(w, [0], rest, map);
  const frame = F.posedFrame(w, 0),
    expected = new Float32Array(6);
  F.carryFrame(expected, 0, start, 0, m);
  frame.forEach((v, i) => near(v, expected[i], 1e-3));
  K.deform.apply(w, [0], rest, map);
  assert.deepEqual(F.posedFrame(w, 0), frame);
  const w2 = stamped(kit),
    st = K.stage(w2),
    rig = K.rig.fromGroups(st, { paint: [0] });
  rig.set('paint', m, [0, 0, 0], [0, 0, 0]);
  rig.apply();
  F.posedFrame(w2, 0).forEach((v, i) => near(v, expected[i]));
});
test('native bones pose axes on demand while reusing GPU footprint data', () => {
  const w = stamped(kit),
    m = new Float32Array([0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0]);
  K.bones.bind(w, { ids: [0], bid: new Float32Array([0]), M: m, pose() {} });
  const a = F.plan(w),
    rest = w.splatFootprints.frames.slice(),
    expected = new Float32Array(6);
  F.carryFrame(expected, 0, rest, 0, m);
  F.posedFrame(w, 0).forEach((v, i) => near(v, expected[i]));
  assert.equal(F.plan(w).indices, a.indices);
});
test('instance transforms retain brush axes and follow placement edits', async () => {
  const { createSplatInstances } = await import('../src/webgl/instances.mjs'),
    { createExpandedInstances } = await import('../src/webgl/instance-draw.mjs');
  const w = stamped(kit),
    empty = { count: 0, data: new Float32Array() },
    rot = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const g = createSplatInstances({ paint: w }, [{ id: 'a', prototype: 'paint', rotation: rot, scale: 2 }]);
  const e = new Float32Array(6);
  F.carryFrame(e, 0, w.splatFootprints.frames, 0, rot, 2);
  assert.deepEqual(g.flatten(empty).splatFootprints.frames, e);
  const expand = createExpandedInstances();
  expand(empty, g);
  g.update('a', { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], scale: 1 });
  assert.deepEqual(expand(empty, g).world.splatFootprints.frames, w.splatFootprints.frames);
});
test('software raster and picking use the signed surface frame under camera orbit', () => {
  const w = stamped(kit),
    R = require('../cli/render');
  for (const yaw of [0, 0.55, -0.8]) {
    const a = R.render(w, { w: 160, h: 120, px: 1, raw: true, yaw, passes: ['splatId'] });
    assert(a.rgb.some(Boolean));
    const b = R.render({ ...w, splatFootprints: undefined }, { w: 160, h: 120, px: 1, raw: true, yaw });
    assert.notDeepEqual(a.rgb, b.rgb);
  }
  const hit = K.procedural.contributions.create(w).ray({ origin: [0, 0, 4], direction: [0, 0, -1] });
  assert.equal(hit.solid.index, 0);
});
test(
  'GPU brush coverage follows projected surface axes and native bone motion',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      stamped,
      (kit, build, backend) => {
        const w = build(kit),
          K = kit.KIT,
          F = K.splatFootprints,
          b = backend(128, 128, { raw: true }),
          images = [];
        for (const yaw of [0, 0.5, -0.65]) {
          b.draw(w, { camera: { ...w.cam, yaw } });
          images.push(b.image());
        }
        const m = new Float32Array([0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0]);
        K.bones.bind(w, { ids: [0], bid: new Float32Array([0]), M: m, pose() {} });
        b.draw(w, { changedRows: undefined });
        const skinned = b.image();
        const data = K.bones.posed(w),
          frames = Float32Array.from(F.posedFrame(w, 0));
        const posed = {
          ...w,
          data,
          anim: undefined,
          rest: undefined,
          splatFootprints: F.layout(1, w.splatFootprints.styles, w.splatFootprints.indices, frames)
        };
        b.draw(posed);
        const reference = b.image();
        b.close();
        return { images, skinned, reference };
      }
    );
    assert.equal(new Set(result.images).size, 3);
    assert(result.skinned !== result.images[0], 'bone rotation must change the image');
    assert(result.skinned === result.reference, 'GPU bones and explicitly posed frames must agree');
  }
);
test('reconstruction rotates the same surface axes and resets to the original layout', () => {
  const w = stamped(kit);
  w.look.reconstruction = {
    select: { object: 'paint' },
    cell: 0.6,
    distance: 0.8,
    spin: 1.7,
    keys: [
      { time: 0, state: 'solid', ease: 'linear' },
      { time: 1, state: 'fragmented' },
      { time: 2, state: 'reassembled' }
    ]
  };
  const original = w.splatFootprints,
    broken = K.reconstruction.frame(w, 1),
    r = broken.reconstructionPose.poses.get(0).rotation,
    expected = new Float32Array(6);
  F.carryFrame(expected, 0, original.frames, 0, r);
  assert.deepEqual(broken.splatFootprints.frames, expected);
  assert.equal(w.splatFootprints, original);
  assert.equal(K.reconstruction.frame(w, 2).splatFootprints, original);
});
test('afterimage snapshots freeze posed brush axes instead of reusing a later bone pose', () => {
  const w = stamped(kit),
    M = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  K.bones.bind(w, { ids: [0], bid: new Float32Array([0]), M, pose() {} });
  const h = K.afterimages.history(),
    rules = K.afterimages.prepare([{ select: { object: 'paint' }, duration: 2, interval: 0.1, maxSamples: 1 }]);
  h.frame(w, 0, rules);
  M[9] = 1;
  const rows = h.frame(w, 0.2, rules);
  assert.equal(rows.length, 16);
  const appended = K.afterimages.append(w, rows);
  assert.deepEqual(Array.from(appended.splatFootprints.frames.subarray(6, 12)), Array.from(w.splatFootprints.frames));
});
test(
  'GPU raster samples the signed surface projection, including the back side',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const r = require('../cli/look-webgl')(
      { hardware: true, chrome: process.env.INK_TEST_CHROME },
      stamped,
      (kit, build, backend) => {
        const w = build(kit),
          F = kit.KIT.splatFootprints,
          size = 128,
          b = backend(size, size, { raw: true, dither: 0, damp: false }),
          reports = [];
        w.pal = [0x000000, 0xffffff];
        w.data[7] = 0xffffff;
        F.update(w, 1, { shape: 'wedge', softness: 0.08 });
        const profile = w.splatFootprints.styles[0],
          f = size / (2 * 5 * Math.tan((19 * Math.PI) / 180)),
          axes = w.splatFootprints.frames;
        for (const yaw of [0, 0.7, 2.4]) {
          b.draw(w, { camera: { ...w.cam, yaw } });
          const rgb = Uint8Array.from(atob(b.image()), c => c.charCodeAt(0)),
            c = Math.cos(yaw),
            s = Math.sin(yaw),
            map = F.frameTransform(
              profile,
              f * (c * axes[0] - s * axes[2]),
              f * axes[1],
              f * (c * axes[3] - s * axes[5]),
              f * axes[4]
            );
          let bad = 0;
          for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
              const expected = Math.min(0.99, F.sample(profile, map, x + 0.5 - size / 2, size / 2 - y - 0.5)),
                actual = rgb[(y * size + x) * 3] / 255;
              if (Math.abs(expected - actual) > 0.025) bad++;
            }
          reports.push({ yaw, bad });
        }
        b.close();
        return { reports };
      }
    );
    r.reports.forEach(row => assert.equal(row.bad, 0, JSON.stringify(row)));
  }
);

test('bake snapshots isolate surface frames and malformed stamps leave the builder intact',()=>{
  const w=stamped(kit),cache=K.authoring.bakeCache,store=cache.create(),packed=cache.pack(w),rest=Array.from(w.splatFootprints.frames);
  store.write('brush','surface',packed);
  w.splatFootprints.frames[0]=99;
  const copied=store.read('brush','surface');assert.deepEqual(Array.from(copied.splatFootprints.frames),rest);assert(F.plan(copied).indices.some(Boolean));
  const builder=kit.makeBuilder(1),f=B.direction('ink',[0,0,0],[0,0,1]);
  assert.throws(()=>B.stamp(builder,{...f,tangent:[0,0,1]},builder.P[1],'ink'));
  assert.throws(()=>B.stamp(builder,{...f,width:NaN},builder.P[1],'ink'));
  assert.equal(builder.count(),0);
});
