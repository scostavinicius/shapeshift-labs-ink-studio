// Stage 35: strands that show at a game's pixel size. Grass as tufts of short, thick blades (tufts(ctx, ...) in
// def.build): they stand on the ground, leave bare what they are told to, cost about 25 splats a blade, are the same every
// time, and never change how a game plays (they roll their own dice, not the kit's).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { flatScene, loadInk, loadTs, ROOT } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const H = await loadTs('src/headless/run.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');
const nest = (await loadTs('examples/ninho/game.ts')).default;

function field(o = {}) {
  let made = null,
    at = 0,
    end = 0;
  const def = G.defineGame({
    id: 'grass',
    name: 'grass',
    scene: flatScene(),
    combat: false,
    actors: { hero: { spec: walker } },
    build(ctx) {
      at = ctx.B.count();
      made = G.tufts(ctx, { count: 40, area: { min: [-4, -4], max: [4, 4] }, ...o });
      end = ctx.B.count();
      return {};
    },
    init: () => ({})
  });
  const game = G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
  return { game, made, at, end };
}

test('stage 35: tufts stand on the ground, about 25 splats a blade, leave bare what they are told, the same every time', () => {
  const { game, made, at, end } = field();
  assert.equal(made.tufts, 40);
  assert.ok(made.blades >= 40 * 3 && made.blades <= 40 * 5, `${made.blades} blades, 3 to 5 a tuft`);
  const per = (end - at) / made.blades;
  assert.ok(per <= 30, `${per.toFixed(1)} splats a blade (the kit's default would be 96)`);
  const D = game.world.data;
  for (let i = at; i < end; i++) {
    const x = D[i * 16],
      y = D[i * 16 + 1],
      z = D[i * 16 + 2],
      g = game.collision.ground(x, z);
    assert.ok(y >= g - 0.05 && y <= g + 0.7, `splat ${i} stands on the ground (y ${y.toFixed(2)}, ground ${g.toFixed(2)})`);
    assert.ok(Math.abs(x) < 4.4 && Math.abs(z) < 4.4, `splat ${i} in the area`);
  }
  // the same field every time
  const again = field();
  assert.deepEqual(Array.from(again.game.world.data.subarray(again.at * 16, again.end * 16)), Array.from(D.subarray(at * 16, end * 16)));
  // a bare half: nothing where skip says
  const half = field({ skip: x => x < 0 });
  const H2 = half.game.world.data;
  for (let i = half.at; i < half.end; i++) assert.ok(H2[i * 16] > -0.4, `splat ${i} not in the bare half`);
  assert.ok(half.made.tufts < 40 && half.made.tufts > 5);
});

test('stage 35: grass never changes how a game plays: the nest with and without its tufts', () => {
  const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'ninho', 'win.json'), 'utf8'));
  const bare = G.defineGame({ ...nest, build: undefined });
  const a = H.runHeadless(nest, loadInk(), nest.scene, script, 12).game,
    b = H.runHeadless(bare, loadInk(), bare.scene, script, 12).game;
  assert.ok(a.world.count > b.world.count + 5000, 'the nest has its grass');
  assert.deepEqual(a.snapshot().entities, b.snapshot().entities);
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.story.progress, b.story.progress);
});
