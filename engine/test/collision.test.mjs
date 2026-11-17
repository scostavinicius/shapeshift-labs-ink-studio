// Stage 6: the collision map (docs/engine-stage6-design.md §4). The farol sampled after its bakes: the splat box finds the
// same columns as marching the whole region, the map agrees with the sculpt's own S.heightAt, and it is quick to make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatScene, loadInk, loadTs, sceneFn } from './load.mjs';

const G = await loadTs('src/game/index.ts');

/** the farol built with its sculpt's bakes watched: two maps (splat box, whole region), and S.heightAt at seeded points */
function farolSampled() {
  const ink = loadInk();
  const fast = new G.CollisionBuilder(),
    slow = new G.CollisionBuilder({ region: { min: [-20, -20, -20], max: [20, 30, 20] } });
  const pts = [],
    ref = [];
  let bakes = 0;
  const facade = {
    ...ink,
    makeSculpt(B) {
      const S = ink.makeSculpt(B),
        bake = S.bake;
      S.bake = (...a) => {
        const before = B.count(),
          r = bake.apply(S, a);
        fast.wants();
        slow.wants();
        fast.sample(S, { near: G.splatBox(B, before, B.count()) });
        slow.sample(S);
        if (bakes++ === 0) {
          let s = 12345;
          const r01 = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
          for (let k = 0; k < 2000; k++) {
            const p = [-14 + 28 * r01(), -14 + 28 * r01(), -1 + 5 * r01()];
            pts.push(p);
            ref.push(S.heightAt(p[0], p[1], p[2]));
          }
        }
        return r;
      };
      return S;
    }
  };
  sceneFn('showcase/farol.js')(facade).build(11);
  return { fast, slow, pts, ref };
}

test('farol: the splat box finds what marching the whole region finds, quickly, and agrees with S.heightAt', tc => {
  const { fast, slow, pts, ref } = farolSampled();
  const A = G.makeCollision(fast.finish()),
    Bm = G.makeCollision(slow.finish());
  let differ = 0,
    asked = 0;
  for (let i = -80; i <= 80; i++)
    for (let k = -80; k <= 80; k++)
      for (const y of [-6, -2, 0, 1, 2, 4, 8, 15]) {
        asked++;
        if (Math.abs(A.height(i * 0.25, k * 0.25, y) - Bm.height(i * 0.25, k * 0.25, y)) > 0.01) differ++;
      }
  let agree = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x, z, y] = pts[k],
      h = A.height(x, z, y);
    if (h === ref[k] || Math.abs(h - ref[k]) < 0.1) agree++;
  }
  const ms = fast.stats.reduce((s, b) => s + b.ms, 0);
  tc.diagnostic(
    `bakes ${JSON.stringify(fast.stats)}; ${differ} of ${asked} queries differ from the whole-region map; ` +
      `${agree} of ${pts.length} agree with S.heightAt; ${ms} ms sampling`
  );
  assert.ok(differ / asked < 0.001, `${differ} of ${asked} differ`);
  assert.ok(agree / pts.length >= 0.95, `${agree} of ${pts.length} agree with S.heightAt`);
  assert.ok(ms <= 300, `${ms} ms`);
  assert.ok(fast.stats[0].columns > 1500 && fast.stats[1].columns === 0, 'the island is ground; the beam (a ghost) is not');
});

test('queries mean what S.heightAt means, and block / open change the map', () => {
  const ink = loadInk();
  const def = G.defineGame({
    id: 'flat',
    scene: 'x',
    collision: { block: [{ min: [-1, 0, -1], max: [1, 1, 1] }], open: [{ min: [3.5, 0.5, -0.5], max: [4.5, 3, 0.5] }] },
    init: () => ({})
  });
  const c = G.createGame(def, ink, { scene: flatScene() }).collision;
  const near = (a, b) => Math.abs(a - b) < 0.05;
  // the floor (top at 0): standing above it, inside it, under it
  assert.ok(near(c.height(-7, 5, 2), 0));
  assert.equal(c.height(-7, 5, -0.2), 1e9, 'inside the floor');
  assert.equal(c.height(-7, 5, 7), -1e9, 'looks down 6 units at most, as S.heightAt does');
  assert.ok(near(c.ground(-7, 5), 0), 'ground() looks all the way down');
  assert.equal(c.height(12, 0, 1), -1e9, 'off the edge: nothing below');
  // the pillar at (-4, 0): a wall at walking height, its top from above
  assert.equal(c.height(-4, 0, 1), 1e9);
  assert.ok(near(c.ground(-4, 0), 3.5));
  // block: an invisible box 2 x 1 x 2 at the middle
  assert.equal(c.height(0, 0, 0.5), 1e9);
  assert.ok(near(c.ground(0, 0), 1));
  // open: the middle of the block at (4, 0) has a hole from 0.5 up: what is left is a slab 0.5 high
  assert.ok(near(c.ground(4, 0), 0.5), 'cut down to 0.5: ' + c.ground(4, 0));
  assert.equal(c.height(4.8, 0, 1), 1e9, 'the rest of the block stands');
  // blocked / clear
  assert.equal(c.blocked([-4.6, 0, 0], 0.3, 1.2), true);
  assert.equal(c.blocked([-6, 0, 3], 0.3, 1.2), false);
  assert.equal(c.clear([-7, 1, 0], [-1.5, 1, 0]), false, 'the pillar is in the way');
  assert.equal(c.clear([-7, 1, 3], [-1.5, 1, 3]), true);
});

test('a ramp is smooth between columns, a step is not', async () => {
  const C = await loadTs('src/game/collision.ts');
  // a slope y = 0.2 x for x in [0, 4], a wall (step of 1) at x >= 6
  const b = new C.CollisionBuilder({ cell: 0.25 });
  b.wants();
  b.sample({ sdf: (x, y) => (x >= 6 ? Math.min(y - 0.2 * 4 - 1, 0) : y - 0.2 * Math.min(Math.max(x, 0), 4)) }, {
    near: { min: [-1, -2, -1], max: [8, 3, 1] }
  });
  const c = C.makeCollision(b.finish());
  // between columns 1.0 and 1.25 the ground follows the slope, not the nearest column
  for (const x of [1.05, 1.1, 1.17, 1.22]) assert.ok(Math.abs(c.height(x, 0, 2) - (0.2 * x + 0.02)) < 0.01, `x ${x}: ${c.height(x, 0, 2)}`);
  // at the foot of the wall: the nearest column, no blending into it
  assert.ok(Math.abs(c.height(5.8, 0, 2) - 0.82) < 0.02, String(c.height(5.8, 0, 2)));
});
