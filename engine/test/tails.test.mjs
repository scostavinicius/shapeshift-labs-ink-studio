// Stages 29-30: a trailing body (actors.<name>.tail). The actor is an ordinary K.character (the head); behind it a chain
// of the kit's procedural body lies on the ground, drawn as one thick curve of curve splats. Checked: it follows, it lies
// on the ground, its splats are where the chain is, the same game gives the same body, it is solid to other actors, it
// goes with its actor and comes back with the next one; and the nest (examples/ninho) runs, and its serpent can be killed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatScene, loadInk, loadTs } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');
const nest = (await loadTs('examples/ninho/game.ts')).default;

const worm = { ...walker, id: 'worm', height: 0.7 };
const go = (x, z) => () => ({ move: x, mz: z });

function flat(tail = {}) {
  const def = G.defineGame({
    id: 'tails',
    name: 'tails',
    scene: flatScene(),
    combat: false,
    actors: {
      hero: { spec: walker },
      worm: { spec: worm, tail: { joints: 8, length: 2.4, width: 0.4, ...tail } }
    },
    init: () => ({})
  });
  return G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
}
const tailOf = (game, a) => game.level.slots.find(s => s.ch === a.ch).tail;

test('stage 29-30: a trailing body follows its actor on the ground, its splats where its chain is, the same every time', () => {
  const run = () => {
    const game = flat();
    const w = game.spawnActor({ actor: 'worm', at: [-4, 0, -3], face: 0, brain: go(0.7, 0.25) });
    game.run(2.5);
    return { game, w, tail: tailOf(game, w) };
  };
  const { game, w, tail } = run();
  const P = tail.points,
    gap = 2.4 / 7;
  assert.equal(P.length, 8);
  assert.ok(Math.hypot(P[0][0] - w.pos[0], P[0][2] - w.pos[2]) < 0.1, 'the first joint is at the actor');
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
    assert.ok(Math.abs(d - gap) < gap * 0.3, `joints ${i - 1}-${i} keep their length: ${d.toFixed(3)} for ${gap.toFixed(3)}`);
    assert.ok(P[i][1] > 0 && P[i][1] < 0.45, `joint ${i} lies on the ground (y ${P[i][1].toFixed(2)})`);
  }
  // behind it: the walk went toward +x, so the body trails toward -x
  assert.ok(P[7][0] < P[0][0] - 1.5, 'it trails behind');
  // every splat of the curve is near the chain (none left at rest, none hidden)
  const D = game.world.data,
    near = (x, y, z) => {
      let best = Infinity;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1],
          b = P[i],
          ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
          t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
        best = Math.min(best, Math.hypot(x - a[0] - ab[0] * t, y - a[1] - ab[1] * t, z - a[2] - ab[2] * t));
      }
      return best;
    };
  assert.ok(tail.total > 20, `${tail.total} curve splats`);
  for (let i = tail.at; i < tail.at + tail.total; i++) assert.ok(near(D[i * 16], D[i * 16 + 1], D[i * 16 + 2]) < 0.3, `splat ${i} on the chain`);
  assert.equal(run().game.hash(), game.hash(), 'the same game, the same body');
});

test('stage 29-30: other actors cannot walk through a trailing body, unless it says solid: false', () => {
  const cross = solid => {
    const game = flat({ solid });
    // lying still along x, from x = 2 back to x = -0.4, at z = 0
    game.spawnActor({ actor: 'worm', at: [2, 0, 0], face: 0, brain: G.dummy });
    const hero = game.spawnActor({ actor: 'hero', at: [0.8, 0, 2.5], brain: go(0, -0.8), team: 'player' });
    game.run(3);
    return hero.pos[2];
  };
  const blocked = cross(true),
    through = cross(false);
  assert.ok(blocked > 0.3, `stopped at the body: z ${blocked.toFixed(2)}`);
  assert.ok(through < -1, `walked through when not solid: z ${through.toFixed(2)}`);
});

test('stage 29-30: a trailing body goes with its actor and comes back, fresh, with the next one', () => {
  const game = flat();
  const w = game.spawnActor({ actor: 'worm', at: [-3, 0, 0], face: 0, brain: G.dummy });
  game.run(0.5);
  const tail = tailOf(game, w),
    D = game.world.data;
  game.remove(w);
  for (let i = tail.at; i < tail.at + tail.total; i++) assert.equal(D[i * 16 + 1], -99, 'hidden with its actor');
  assert.equal(tail.live, false);
  game.run(0.2);
  assert.equal(D[tail.at * 16 + 1], -99, 'and stays hidden');
  const again = game.spawnActor({ actor: 'worm', at: [-1, 0, 3], face: Math.PI / 2, brain: G.dummy });
  assert.equal(tailOf(game, again), tail, 'the same pool slot');
  game.run(0.3);
  // facing +z, it lies toward -z behind its new place
  assert.ok(Math.abs(tail.points[7][0] + 1) < 0.3 && tail.points[7][2] < 1.2, `back behind its new place: ${tail.points[7].map(v => v.toFixed(2))}`);
  for (let i = tail.at; i < tail.at + tail.total; i++) assert.ok(D[i * 16 + 1] > -1, 'shown again');
});

test('the nest: the serpent chases with its body behind it, and dies to the player\'s blows', () => {
  const game = G.createGame(nest, loadInk(), { scene: nest.scene, bones: 'cpu' });
  const serpent = game.entities.find(e => e.kind === 'serpent'),
    tail = tailOf(game, serpent),
    start = serpent.pos.slice();
  game.run(3);
  assert.ok(Math.hypot(serpent.pos[0] - start[0], serpent.pos[2] - start[2]) > 2, 'it came on');
  assert.ok(tail.live && tail.total > 50);
  // the player stands and swings (the swing turns to it: combat.assist)
  let won = false;
  for (let n = 0; n < 60 * 50 && !won; n++) {
    game.runSteps(1, k => {
      if (k % 20 === 0) game.core.input.press('attack');
      if (k % 20 === 2) game.core.input.release('attack');
    });
    won = game.state.won;
  }
  assert.ok(won, 'the serpent fell');
  assert.equal(tail.live, false, 'its body went with it');
});
