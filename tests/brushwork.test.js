const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..'), kit = ink.load(), E = kit.Engraving;

function plate({ makeBuilder }) {
  const B = makeBuilder(11, [0x122536, 0xcda683]);
  B.dab(0, 0, 0, [0, 0, 1], [0, 1, 0], 12, 12, .003, B.P[1], 3);
  B.describeEngraving(0, 1, {
    brushwork: { direction: 'axis', axis: [0, 1, 0], groupScale: 5 }, scale: .27,
    seed: 0xe053892f, ink: '#233644', paper: '#e3bd9b', strength: .87, tone: 'luminance'
  });
  return B.finish({
    radius: 10, dither: 0, cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true },
    fog: { c: 0, start: 1, max: 0 }
  });
}

test('fine marks are directional and fade into retained broad pigment groups at art size', () => {
  const p = plate(kit).engraving.styles[0];
  const plain = E.prepare({ ...p, brushwork: { ...p.brushwork, groupContrast: 0 } });
  const n = [0, 0, 1], rgb = [.5, .5, .5], u = [1, 0, 0], v = [0, 1, 0];
  const samples = (settings, restTangent, footprint, artScale = 1, offset = 0) =>
    Array.from({ length: 50 }, (_, i) =>
      E.shade(settings, [i / 47 - .4 + offset, .081, -.064], n, rgb, { restTangent, footprint, artScale })[0]);
  const close = samples(p, u, .023);
  assert.notDeepEqual(close, samples(p, v, .023));
  assert.deepEqual(close, samples(p, u, .023));
  for (const [i, value] of samples(p, u, .023, 1, 1e-6).entries())
    assert(Math.abs(value - close[i]) < .0001);
  const far = samples(p, u, .27);
  assert.deepEqual(far, samples(p, v, .27));
  assert.deepEqual(far, samples(p, v, .135, 2));
  assert(far.some((n, i) => Math.abs(n - samples(plain, u, .27)[i]) > .02));
  assert.deepEqual(samples(p, u, 10), samples(plain, u, 10));
  assert.throws(() => E.prepare({ brushwork: { detailPixels: [2, 1] } }), /detailPixels/);
});

test('SDF curvature determines the rest chart on a cylinder and the chart survives a pose', () => {
  const { makeBuilder, makeSculpt, KIT: K } = kit;
  const B = makeBuilder(4), S = K.sculpt(makeSculpt(B));
  S.engraving = { brushwork: { axis: [1, 0, 0] } };
  S.lathe([0, -1, 0], 2, .45, { r: [2, 3, 4] }, { res: .09 });
  S.box([1, 0, 0], [.2, .3, .15], { r: [2, 3, 4], engraving: false }, { res: .09 });
  S.bake();
  const w = B.finish({ look: { engraving: S.engraving } });
  let rows = 0;
  for (let i = 0; i < w.count; i++) {
    const [x, y, z] = w.data.subarray(i * 16, i * 16 + 3);
    if (x > .75) assert.equal(w.engraving.indices[i], 0);
    if (Math.abs(y) > .4 || Math.abs(x) > .12 || z < .4) continue;
    assert(Math.abs(w.engraving.restFrames[i * 6 + 1]) > .95, 'strokes should run along the cylinder axis');
    rows++;
  }
  assert(rows > 12);
  const subset = kit.SplatProvenance.subset(w, [0, 1, 2]);
  const anchors = subset.engraving.anchors.slice(), axes = subset.engraving.restFrames.slice();
  const rest = K.deform.rest(subset, [0, 1, 2]), live = subset.splatFootprints.frames.slice();
  K.deform.apply(subset, [0, 1, 2], rest, ([x,y,z]) => [x + .3 * y, y + .5, z]);
  assert.deepEqual(subset.engraving.anchors, anchors);
  assert.deepEqual(subset.engraving.restFrames, axes);
  assert.notDeepEqual(subset.splatFootprints.frames, live);
});

test('material JSON round-trips and the toggle changes paint without moving coverage', () => {
  const scene = {
    id: 'brushwork-test', style: 'slate',
    camera: { target: [0, 0, 0], dist: 4, pitch: 0, yaw: 0 },
    solids: [{ id: 'stone', kind: 'box', at: [0, 0, 0], half: [.6, .6, .12],
      mat: { role: 'stone', engraving: { scale: .3, brushwork: true } } }]
  };
  const world = kit.KIT.diorama.build(JSON.parse(JSON.stringify(scene)));
  assert(world.engraving.styles[0].brushwork);
  const opts = { w: 56, h: 56, px: 1, raw: true, passes: ['splatId', 'depth'] };
  const lit = ink.render(world, opts), off = ink.render(world, { ...opts, brushwork: false });
  assert.notDeepEqual(lit.rgb, off.rgb);
  assert.deepEqual(lit.passes.splatId, off.passes.splatId);
  assert.deepEqual(lit.passes.depth, off.passes.depth);
});

test('WebGL brush marks and distance groups agree with the software render', { skip: !process.env.INK_TEST_CHROME }, () => {
  const world = plate(kit), view = { w: 64, h: 64, px: 1, raw: true, dither: 0, damp: false };
  const distances = [5, 32];
  const result = require('../cli/look-webgl')({ chrome: process.env.INK_TEST_CHROME }, plate,
    (kit, build, backend, distances) => {
      const world = build(kit), view = backend(64, 64, { raw: true, dither: 0, damp: false });
      const cases = distances.map(dist => {
        world.cam = { ...world.cam, dist };
        view.draw(world);
        return view.image();
      });
      view.draw(world, { brushwork: false });
      const disabled = view.image();
      view.close();
      return { cases, disabled };
    }, distances);
  const compare = (bytes, dist, brushwork) => {
    const w = { ...world, cam: { ...world.cam, dist } };
    const cpu = ink.render(w, { ...view, brushwork }).rgb, gpu = Buffer.from(bytes, 'base64');
    let worst = 0;
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) {
      const offset = (y * view.w + x) * 3;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(cpu[offset + c] - gpu[offset + c]));
    }
    assert(worst < 9, 'Brushwork parity error of ' + worst + ' bytes at distance ' + dist);
  };
  distances.forEach((dist, i) => compare(result.cases[i], dist, true));
  compare(result.disabled, distances.at(-1), false);
});
