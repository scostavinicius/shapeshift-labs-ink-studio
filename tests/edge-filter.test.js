const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');

const palette = [0x263040, 0x463c59, 0x855469, 0xe28078, 0xfbd68f, 0xffffe3];
const view = { w: 96, h: 64, px: 1, passes: ['coverage', 'objectId'] };

function scene({ rail = true, actor = true, look = {}, ortho = true, patterned = false } = {}) {
  const B = ink.load().makeBuilder(43, palette);
  if (rail) {
    if (patterned) B.pixNext([4], .5, null, 0, 0, 1);
    B.axial(.63, .1, 0, [.89442719, .44721360, 0], .56, .015, B.P[4], 1.32);
    B.describeSplats(0, B.count(), { object: 'rail', material: 'iron', target: { tags: ['thin'] } });
  }
  if (actor) {
    const first = B.count();
    B.disc(-.65, 0, .12, [0, 0, 1], .2, .016, B.P[3], 2);
    B.describeSplats(first, B.count(), { object: 'actor', material: 'iron' });
  }
  return B.finish({ cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 4, ortho },
    radius: 3, dither: 0, look });
}

function colorAt(frame, p) {
  return (frame.rgb[p * 3] << 16) + (frame.rgb[p * 3 + 1] << 8) + frame.rgb[p * 3 + 2];
}

test('only the selected edges are sampled before the raw and indexed art-grid resolve', () => {
  const settings = { rules: [{ select: { object: 'actor' }, strength: 0 }, { select: { material: 'iron' } }] };
  for (const ortho of [false, true]) {
    const world = scene({ ortho, look: { edgeFilter: settings } });
    for (const raw of [false, true]) {
      const off = ink.render(world, { ...view, raw, edgeFilter: false });
      const on = ink.render(world, { ...view, raw });
      const all = ink.render(world, { ...view, raw, edgeFilter: true });
      const byTag = ink.render(world, { ...view, raw, edgeFilter: { rules: [{ select: { tag: 'thin' } }] } });
      assert.deepEqual(on.rgb, byTag.rgb);
      assert.deepEqual([on.w, on.h], [view.w, view.h]);
      let changed = 0, actorChanged = 0, selectedCoverage = 0;
      for (let p = 0; p < on.w * on.h; p++) {
        if (p % on.w < on.w / 2 - 6) {
          assert.equal(on.passes.coverage[p], off.passes.coverage[p]);
          assert.equal(colorAt(on, p), colorAt(off, p));
          actorChanged += Number(colorAt(all, p) !== colorAt(off, p));
        } else if (p % on.w >= on.w / 2) {
          changed += Number(colorAt(on, p) !== colorAt(off, p));
          selectedCoverage += Math.abs(on.passes.coverage[p] - off.passes.coverage[p]);
        }
        if (!raw) assert(palette.includes(colorAt(on, p)));
      }
      assert(actorChanged > 0);
      assert(changed > 8);
      assert(selectedCoverage > 1);
    }
  }
});

test('opacity resolves at export size and retains intermediate coverage on patterned geometry', () => {
  const world = scene({ actor: false, patterned: true, look: { pixel: true } });
  const options = { ...view, transparent: true, dither: 0 };
  const off = ink.render(world, { ...options, edgeFilter: false });
  const on = ink.render(world, { ...options, edgeFilter: true });
  const scale = ink.render(world, { ...options, w: view.w * 3, h: view.h * 3, px: 3, edgeFilter: true });
  const half = ink.render(world, { ...options, edgeFilter: { strength: .5 } });
  assert.deepEqual(scale.alpha, on.alpha);
  assert.deepEqual(scale.rgb, on.rgb);
  assert(on.alpha.some((a, p) => a > 18 && off.alpha[p] === 0));
  for (let p = 0; p < on.alpha.length; p++)
    assert(Math.abs(2 * half.alpha[p] - on.alpha[p] - off.alpha[p]) <= 2);
  assert.deepEqual(ink.render(world, { ...options, edgeFilter: { rules: [] } }).rgb, off.rgb);
});

test('JSON dioramas retain and validate the same selector settings', () => {
  const { KIT } = ink.load();
  const edgeFilter = { rules: [{ select: { object: 'diagonal' }, strength: .7 }] };
  const spec = { id: 'selective-edges', finish: { look: { edgeFilter } },
    solids: [{ id: 'diagonal', kind: 'box', at: [0, 0, 0], half: [.8, .2, .1], mat: 'stone', res: .15 }] };
  const world = KIT.diorama.build(spec);
  assert.deepEqual(world.look.edgeFilter, edgeFilter);
  assert.notDeepEqual(ink.render(world, { ...view, raw: true }).rgb,
    ink.render(world, { ...view, raw: true, edgeFilter: false }).rgb);
  const invalid = { ...spec, finish: { look: { edgeFilter: { strength: -1 } } } };
  assert.throws(() => KIT.diorama.build(invalid), /finish\.look\.edgeFilter/s);
});

test('a subpixel camera pan keeps the coverage of a thin rail more consistent', () => {
  const B = ink.load().makeBuilder(1, palette);
  B.axial(0, 0, 0, [1, 0, 0], 1, .008, B.P[4], 1.35);
  const world = B.finish({ cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 4, ortho: true }, radius: 3 });
  function coverageRange(edgeFilter) {
    const coverage = Array.from({ length: 16 }, (_, i) => {
      const frame = ink.render(world, { ...view, raw: true, edgeFilter, target: [0, i / 16 * .043, 0] });
      return frame.passes.coverage.reduce((sum, alpha) => sum + alpha, 0);
    });
    return Math.max(...coverage) - Math.min(...coverage);
  }
  assert(coverageRange(true) < .35 * coverageRange(false));
});
