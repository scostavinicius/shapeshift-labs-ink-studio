const test = require('node:test'),
  assert = require('node:assert/strict'),
  studio = require('..'),
  kit = studio.load(),
  K = kit.KIT,
  E = kit.Engraving,
  F = kit.SplatFootprints;
function fixture(kit) {
  const b = kit.makeBuilder(43, [0x15263b, 0xf0dbb2]);
  b.dab(0, 0, 0, [0, 0, 1], [1, 0, 0], 3, 3, 0.01, b.P[1], 3);
  b.describeSplats(0, 1, { object: 'plate' });
  return b.finish({
    cam: { target: [0, 0, 0], dist: 5, pitch: 0, yaw: 0, ortho: true },
    radius: 10,
    dither: 0,
    fog: { start: 1, max: 0, c: 0 },
    look: {
      pixelSize: 1,
      engraving: { projection: 'plane', scale: 0.8, ink: '#15263b', paper: '#f0dbb2', ambient: 0.16 }
    }
  });
}
test('tonal maps are nested, periodic, deterministic and independent of paint controls', () => {
  for (const style of E.styles) {
    const p = E.prepare({ style, resolution: 32 }),
      m = E.maps(p);
    assert.equal(m.levels.length, 3);
    for (const l of m.levels) {
      const area = l.size * l.size;
      for (let t = 1; t < 8; t++)
        for (let i = 0; i < area; i++) assert(l.data[t * area + i] + 1e-6 >= l.data[(t - 1) * area + i], style);
      assert.equal(l.means[0], 0);
      assert.equal(l.means[7], 1);
    }
    assert.equal(E.maps({ ...p, ink: '#ff0000', scale: 2, density: 2 }).data, m.data);
    for (const f of [0, 0.001, 0.1, 10])
      assert(Math.abs(E.sample(p, 0.14, -0.27, 0.5, f) - E.sample(p, 0.14 + p.scale, -0.27, 0.5, f)) < 1e-5);
  }
});
test('invalid settings and malformed bindings reject atomically', () => {
  for (const bad of [
    { scale: 0 },
    { resolution: 127 },
    { density: Infinity },
    { tone: 'wat' },
    { along: [1, 0, 0], across: [2, 0, 0] },
    { ink: 'nonsense' },
    { seed: -1 },
    { jitter: 1 }
  ])
    assert.throws(() => E.prepare(bad));
  const w = fixture(kit),
    saved = w.engraving;
  assert.throws(() => E.bind(w, [2], true));
  assert.equal(w.engraving, saved);
  assert.throws(() => E.update(w, 1, { strokeWidth: NaN }));
  assert.equal(w.engraving, saved);
  assert.throws(() => E.sample(true, NaN, 0, 0.5));
  assert.throws(() => E.sample(true, 0, 0, 0.5, -1));
});
test('global defaults, per-material opt-outs and copied chunks preserve chart anchors', () => {
  const b = kit.makeBuilder(1),
    s = K.sculpt(kit.makeSculpt(b));
  s.ball([-0.5, 0, 0], 0.4, { r: [2, 3, 4] }, { res: 0.15 });
  s.ball([0.5, 0, 0], 0.4, { r: [2, 3, 4], engraving: false }, { res: 0.15 });
  s.bake();
  const w = b.finish({ look: { engraving: true } });
  assert(w.engraving.indices.some(Boolean));
  assert(w.engraving.indices.some(i => !i));
  const picked = kit.SplatProvenance.subset(w, [0, w.count - 1]),
    joined = kit.SplatProvenance.join([picked, picked]);
  assert.equal(joined.engraving.indices.length, 4);
  assert.deepEqual(
    joined.engraving.anchors,
    new Float32Array([...picked.engraving.anchors, ...picked.engraving.anchors])
  );
});
test('bindings retain surface coordinates through deformation, reset and cache snapshots', () => {
  const w = fixture(kit),
    anchor = w.engraving.anchors.slice(),
    frames = w.splatFootprints.frames.slice(),
    rest = K.deform.rest(w, [0]);
  K.deform.apply(w, [0], rest, p => [p[0] * 1.4 + p[1], p[1] * 0.7, p[2]]);
  assert.deepEqual(w.engraving.anchors, anchor);
  assert.notDeepEqual(w.splatFootprints.frames, frames);
  K.deform.apply(w, [0], rest, p => p);
  assert.deepEqual(
    Array.from(w.splatFootprints.frames, n => n || 0),
    Array.from(frames, n => n || 0)
  );
  const cache = K.authoring.bakeCache.create();
  cache.write('engraving', 'a', K.authoring.bakeCache.pack(w));
  w.engraving.anchors[0] = 99;
  assert.deepEqual(cache.read('engraving', 'a').engraving.anchors, anchor);
});
test('software engraving changes colour without changing coverage, ownership or depth', () => {
  const w = fixture(kit),
    r = require('../cli/render'),
    opts = { w: 96, h: 96, px: 1, raw: true, passes: ['splatId', 'depth'], engravingLight: [0.7, 0.1, 0.45] },
    a = r.render(w, opts),
    b = r.render(w, { ...opts, engraving: false });
  assert.notDeepEqual(a.rgb, b.rgb);
  assert.deepEqual(a.passes.splatId, b.passes.splatId);
  assert.deepEqual(a.passes.depth, b.passes.depth);
  const c = r.render(w, { ...opts, engravingLight: [0, 0, 1] });
  assert.notDeepEqual(c.rgb, a.rgb);
});
test('retained geometry attachments reuse buffers and relocate shifted tables', async () => {
  const { createAttachedData } = await import('../src/webgl/attached-data.mjs'),
    pack = createAttachedData(8),
    base = new Float32Array([1, 2, 3, 4]),
    a = new Float32Array([7, 8]),
    b = new Float32Array([9, 10]);
  const first = pack(base, 4, [a, b], []),
    same = pack(base, 4, [a, b], []);
  assert.equal(first.data, same.data);
  assert.deepEqual(same.changedRows, []);
  base[1] = 12;
  pack(base, 4, [a, b], [0]);
  assert.equal(first.data[1], 12);
  const next = pack(base, 4, [new Float32Array(10), b], []);
  assert.equal(next.data[next.offsets[1] * 8], 9);
});
test('live light and colour edits retain tonal-map data and chart uploads', async () => {
  const { createEngravingBinding } = await import('../src/webgl/engraving.mjs'),
    bind = createEngravingBinding(E),
    w = fixture(kit),
    a = bind(w, w.data, [], [1, 1, 1]),
    b = bind(w, w.data, [], [0, 1, 0]);
  assert.equal(a.data, b.data);
  assert.deepEqual(b.changedRows, []);
  const m = E.maps(w.engraving.styles[0]);
  E.update(w, 1, { ...w.engraving.styles[0], ink: '#002244' });
  const c = bind(w, w.data, [], [0, 1, 0]);
  assert.equal(E.maps(w.engraving.styles[0]), m);
  assert.equal(c.data, b.data);
  assert.deepEqual(c.changedRows, [c.offsets[1]]);
});
test('instances keep prototype texture anchors while moving the live surface frame', async () => {
  const { createSplatInstances } = await import('../src/webgl/instances.mjs'),
    w = fixture(kit),
    g = createSplatInstances({ plate: w }, [
      { id: 'copy', prototype: 'plate', position: [3, 0, 0], rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1] }
    ]),
    flat = g.flatten({ count: 0, data: new Float32Array() });
  assert.deepEqual(flat.engraving.anchors, w.engraving.anchors);
  assert.notDeepEqual(flat.splatFootprints.frames, w.splatFootprints.frames);
});
test(
  'GPU engraving matches CPU tonal-map sampling at the native art pixels',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const r = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const w = build(kit),
          E = kit.KIT.engraving,
          b = backend(128, 128, { raw: true, dither: 0, damp: false }),
          light = [0.7, 0.1, 0.45],
          reports = [],
          f = 128 / (2 * 5 * Math.tan((19 * Math.PI) / 180));
        for (const style of E.styles) {
          E.update(w, 1, { ...w.engraving.styles[0], style });
          b.draw(w, { engravingLight: light });
          const pixels = Uint8Array.from(atob(b.image()), c => c.charCodeAt(0)),
            p = w.engraving.styles[0];
          let bad = 0,
            max = 0;
          for (let y = 28; y < 100; y++)
            for (let x = 28; x < 100; x++) {
              const point = [(x + 0.5 - 64) / f, (64 - y - 0.5) / f, 0],
                expected = E.shade(p, point, [0, 0, 1], [240 / 255, 219 / 255, 178 / 255], { light, footprint: 1 / f });
              for (let c = 0; c < 3; c++) {
                const error = Math.abs(pixels[(y * 128 + x) * 3 + c] / 255 - expected[c]);
                if (error > 0.035) bad++;
                max = Math.max(max, error);
              }
            }
          reports.push({ style, bad, max });
        }
        b.close();
        return { reports };
      }
    );
    r.reports.forEach(row => assert.equal(row.bad, 0, JSON.stringify(row)));
  }
);
test('GPU animated bone charts agree with explicitly posed frames', { skip: !process.env.INK_TEST_CHROME }, () => {
  const r = require('../cli/look-webgl')(
    { chrome: process.env.INK_TEST_CHROME, hardware: true },
    fixture,
    (kit, build, backend) => {
      const w = build(kit),
        K = kit.KIT,
        b = backend(128, 128, { raw: true, dither: 0, damp: false }),
        M = new Float32Array([0.8, -0.6, 0, 0.6, 0.8, 0, 0, 0, 1, 0, 0, 0]);
      K.bones.bind(w, { ids: [0], bid: new Float32Array([0]), M, pose() {} });
      b.draw(w);
      const animated = b.image(),
        frames = Float32Array.from(K.splatFootprints.posedFrame(w, 0)),
        posed = { ...w, data: K.bones.posed(w), anim: undefined, rest: undefined };
      K.splatFootprints.setFrames(posed, frames);
      b.draw(posed);
      const reference = b.image();
      b.close();
      return { equal: animated === reference };
    }
  );
  assert(r.equal);
});

test('disabled authoring does not allocate engraving or coordinate buffers', () => {
  const b = kit.makeBuilder(1);
  b.disc(0, 0, 0, [0, 0, 1], 0.2, 0.01, b.P[1], 3);
  b.describeEngraving(0, 1, false);
  const w = b.finish();
  assert(!w.engraving);
  assert(!w.splatFootprints);
});
test('equivalent materials share one GPU tone-map attachment', async () => {
  const { createEngravingBinding } = await import('../src/webgl/engraving.mjs'),
    w = fixture(kit),
    b = kit.makeBuilder(1, [0x15263b, 0xf0dbb2]);
  b.disc(0, 0, 0, [0, 0, 1], 0.1, 0.01, b.P[1], 3);
  const other = b.finish();
  E.bind(other, 'all', { ...w.engraving.styles[0], ink: '#552200' });
  const joined = kit.SplatProvenance.join([w, other]);
  const plan = createEngravingBinding(E)(joined, joined.data, [], [0, 0, 1]);
  assert.equal(plan.offsets.length, 3);
  const at = plan.offsets[1] * 8192;
  assert.equal(plan.data[at], plan.data[at + 36]);
});
function tiltedFixture(kit) {
  const b = kit.makeBuilder(3, [0x15263b, 0xf0dbb2]),
    n = kit.KIT.V.norm([0.35, 0.45, 0.8]);
  b.disc(0, 0, 0, n, 3, 0.02, b.P[1], 3);
  return b.finish({
    cam: { target: [0, 0, 0], dist: 5, pitch: 0, yaw: 0, ortho: true },
    radius: 10,
    dither: 0,
    fog: { c: 0, start: 0, max: 0.35 },
    look: { pixelSize: 1, engraving: { projection: 'triplanar', origin: [0.2, -0.3, 0.1] } }
  });
}
test(
  'oblique triplanar, cylindrical and spherical sampling keep CPU/GPU fog parity',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const results = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      tiltedFixture,
      (kit, build, backend) => {
        const w = build(kit),
          b = backend(96, 96, { raw: true, dither: 0, damp: false }),
          images = [];
        for (const projection of ['triplanar', 'cylinder', 'sphere']) {
          kit.KIT.engraving.update(w, 1, { ...w.engraving.styles[0], projection });
          b.draw(w);
          images.push(b.image());
        }
        b.close();
        return { images };
      }
    );
    const w = tiltedFixture(kit),
      R = require('../cli/render');
    for (const [i, projection] of ['triplanar', 'cylinder', 'sphere'].entries()) {
      E.update(w, 1, { ...w.engraving.styles[0], projection });
      const a = R.render(w, { w: 96, h: 96, px: 1, raw: true }).rgb,
        b = Buffer.from(results.images[i], 'base64');
      let bad = 0;
      for (let y = 30; y < 66; y++)
        for (let x = 30; x < 66; x++)
          for (let c = 0; c < 3; c++) if (Math.abs(a[(y * 96 + x) * 3 + c] - b[(y * 96 + x) * 3 + c]) > 12) bad++;
      assert.equal(bad, 0, projection);
    }
  }
);

test('reconstruction and afterimages retain engraving anchors with transported live axes', () => {
  const w = fixture(kit),
    original = w.engraving,
    settings = {
      select: { object: 'plate' },
      cell: 0.5,
      distance: 0.7,
      spin: 1.3,
      keys: [
        { time: 0, state: 'solid' },
        { time: 1, state: 'fragmented' }
      ]
    },
    broken = K.reconstruction.frame(w, 1, settings);
  assert.equal(broken.engraving, original);
  assert.notDeepEqual(broken.splatFootprints.frames, w.splatFootprints.frames);
  const history = K.afterimages.history(),
    rules = K.afterimages.prepare([{ select: { object: 'plate' }, duration: 1, interval: 0.1, maxSamples: 1 }]);
  history.frame(w, 0, rules);
  w.data[0] = 1;
  const ghosts = history.frame(w, 0.2, rules),
    appended = K.afterimages.append(w, ghosts);
  assert.equal(appended.count, 2);
  assert.equal(appended.engraving.indices[1], 1);
  assert.deepEqual(appended.engraving.anchors.subarray(3, 6), original.anchors.subarray(0, 3));
  assert(appended.splatFootprints.frames.subarray(6, 12).some(Boolean));
});
