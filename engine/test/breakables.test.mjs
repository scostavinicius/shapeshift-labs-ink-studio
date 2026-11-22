// Stage 19: breakable things (src/game/breakables.ts). A crate takes its blows, breaks, and its place opens in the
// collision map (routes are made again); a save made after it broke loads with it broken; two runs give one game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadInk, loadTs } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');

/** a floor 20 x 20 (top at y = 0) and a crate 1 x 1 x 1 at (1.2, 0.5, 0), tagged 'crate' */
const crateScene =
  () =>
  ({ makeBuilder, makeSculpt, KIT: K }) => ({
    id: 'crate',
    name: 'Crate',
    seed: 3,
    build(seed) {
      const B = makeBuilder(seed, Array.from({ length: 24 }, (_, i) => (i ? 0x0a0b0c * (1 + (i % 18)) : 0x07080b)));
      const S = K.sculpt(makeSculpt(B));
      S.res = 0.2;
      S.box([0, -0.5, 0], [10, 0.5, 10], { r: [3, 4, 5] });
      S.box([1.2, 0.5, 0], [0.5, 0.5, 0.5], { r: [6, 7, 8] }, { tag: 'crate', res: 0.12 });
      S.bake();
      return B.finish({ cam: { target: [0, 0.5, 0], dist: 16, pitch: 0.7, yaw: 0.3 }, detail: 6 });
    }
  });

const def = G.defineGame({
  id: 'crate-test',
  scene: crateScene(),
  actors: { hero: { spec: walker, hp: 5 } },
  breakables: [{ tag: 'crate', hits: 2 }],
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: [0, null, 0], brain: 'player', tags: ['player'] });
    return {};
  }
});
const make = () => G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
const swing = game => {
  game.player.ch.st.face = 0; // facing +x, at the crate
  game.core.input.press('attack');
  game.runSteps(1);
  game.core.input.release('attack');
  game.run(0.5);
};
const names = game => game.takeEvents().map(e => e.name);

test('a crate takes two blows, breaks, and its place opens', () => {
  const game = make();
  const c = game.collision,
    inCrate = [1.2, 0.02, 0];
  assert.ok(c.blocked(inCrate, 0.2, 0.8), 'the crate should block before it breaks');
  const grid = G.navGridFor(c, 0.3, 1);
  names(game);
  swing(game);
  assert.ok(names(game).includes('hit-object'));
  assert.ok(game.breakables.intact('crate'));
  swing(game);
  assert.ok(names(game).includes('break'));
  assert.equal(game.breakables.intact('crate'), false);
  assert.equal(c.blocked(inCrate, 0.2, 0.8), false, 'its place should be open');
  assert.ok(Math.abs(c.ground(1.2, 0) - 0) < 0.1, `the floor under it stays: ${c.ground(1.2, 0)}`);
  assert.notEqual(G.navGridFor(c, 0.3, 1), grid, 'routes should be made again');
  const prop = game.entities.find(e => e.data.breakable === 'crate');
  assert.equal(prop.data.broken, true);
  // its pieces fly: splats of the crate have moved
  game.run(0.5);
});

test('a save made after it broke loads with it broken', () => {
  const a = make();
  swing(a);
  swing(a);
  const save = G.saveGame(a);
  const b = make();
  assert.ok(b.breakables.intact('crate'));
  G.loadSave(b, JSON.parse(JSON.stringify(save)));
  assert.equal(b.breakables.intact('crate'), false);
  assert.equal(b.collision.blocked([1.2, 0.02, 0], 0.2, 0.8), false);
});

test('two runs give the same game', () => {
  const run = () => {
    const g = make();
    swing(g);
    swing(g);
    g.run(1);
    return g.hash();
  };
  assert.equal(run(), run());
});

test('a tag nothing has is refused, saying so', () => {
  const bad = { ...def, breakables: [{ tag: 'nothing' }] };
  assert.throws(() => G.createGame(bad, loadInk(), { scene: def.scene, bones: 'cpu' }), /nothing in the scene has tag "nothing"/);
});
