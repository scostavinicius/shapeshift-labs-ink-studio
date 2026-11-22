// Stage 18: routes (src/game/nav.ts) and the hunter brain (src/game/brains.ts). A route from a dungeon's start to its
// exit exists, keeps to standable cells and is the same every time; a hunter walks round walls to a foe a chaser would
// get stuck behind; two runs give the same game; a hunter that loses its foe goes where it last saw it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadInk, loadTs } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');

const scene = G.makeDungeonScene({ kind: 'rooms', width: 26, height: 18 });

/** a dungeon game: a still 'player' (the bait) at `bait`, and one enemy with `brain` at `from` */
function game(brain, pick) {
  const def = G.defineGame({
    id: 'hunt',
    scene,
    actors: { bait: { spec: walker, hp: 99 }, foe: { spec: walker, hp: 3 } },
    combat: false,
    init(g) {
      const d = G.dungeonOf(g.world),
        { bait, from } = pick(d);
      g.spawnActor({ actor: 'bait', kind: 'bait', at: [bait[0], null, bait[1]], brain: G.dummy, team: 'player', tags: ['player'] });
      g.spawnActor({ actor: 'foe', kind: 'foe', at: [from[0], null, from[1]], brain, tags: ['enemy'] });
      return {};
    }
  });
  return G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
}
const dist2 = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
// start and exit: far apart by walking, with walls between
const far = d => ({ bait: d.exit, from: d.start });

test('a route from start to exit: found, on standable cells, the same every time', () => {
  const g = game(G.dummy, far),
    d = G.dungeonOf(g.world),
    grid = G.navGridFor(g.collision, 0.3, 1);
  const a = G.findPath(grid, [d.start[0], 0, d.start[1]], d.exit),
    b = G.findPath(grid, [d.start[0], 0, d.start[1]], d.exit);
  assert.ok(a && a.length >= 2, 'no route');
  assert.deepEqual(a, b);
  assert.deepEqual(a[a.length - 1], d.exit);
  // every corner on the floor, inside open cells
  for (const [x, z] of a) {
    const cx = Math.floor(x / d.cell + d.width / 2),
      cz = Math.floor(z / d.cell + d.height / 2);
    assert.equal(d.rows[cz][cx], '.', `corner (${x}, ${z}) is in a wall`);
  }
  // the route walks round walls: longer than the straight line
  let len = 0,
    p = d.start;
  for (const q of a) (len += Math.hypot(q[0] - p[0], q[1] - p[1])), (p = q);
  assert.ok(len > Math.hypot(d.exit[0] - d.start[0], d.exit[1] - d.start[1]) * 1.05, `route ${len}`);
});

test('a hunter that hears its foe across the map walks round the walls to it; a chaser stays stuck', () => {
  const senses = { sight: 60, fov: 360, hearing: 60, needsLine: false, speed: 1 };
  const h = game(G.hunter(senses), far),
    c = game(G.chaser({ sight: 60, needsLine: false, speed: 1 }), far);
  const [hb, hf] = h.entities,
    [cb, cf] = c.entities;
  const start = dist2(hb, hf);
  h.run(30);
  c.run(30);
  assert.ok(dist2(hb, hf) < 1.6, `hunter ended ${dist2(hb, hf).toFixed(2)} away (from ${start.toFixed(2)})`);
  assert.ok(dist2(cb, cf) > 2, `the chaser reached it too (${dist2(cb, cf).toFixed(2)}): the walls do not stand between start and exit`);
});

test('two runs of a hunt give the same game, step for step', () => {
  const run = () => {
    const g = game(G.hunter({ sight: 60, fov: 360, hearing: 60, needsLine: false }), far);
    const hashes = [];
    for (let i = 0; i < 6; i++) {
      g.run(2);
      hashes.push(g.hash());
    }
    return hashes;
  };
  assert.deepEqual(run(), run());
});

test('a hunter that loses sight of its foe goes where it last saw it, then gives up', () => {
  // the foe sees the bait at the start (it is behind it, but heard), then the bait is moved away out of reach
  // the bait at the spot nearest the hunter's, so it is heard from the first step
  const near = d => {
    const from = d.spots[0],
      others = d.spots.slice(1).sort((a, b) => Math.hypot(a[0] - from[0], a[1] - from[1]) - Math.hypot(b[0] - from[0], b[1] - from[1]));
    return { bait: others[0], from };
  };
  const g = game(G.hunter({ sight: 8, fov: 120, hearing: 7, memory: 6 }), near);
  const [bait, foe] = g.entities;
  g.run(0.5);
  const m = foe.data.brain;
  assert.ok(m.mode === 'chase' && m.seen, `it should be after the bait, not ${m.mode}`);
  const lastSeen = [bait.pos[0], bait.pos[2]];
  // the bait vanishes (taken out of the game): nothing to see or hear
  g.remove(bait);
  g.run(5);
  assert.equal(foe.data.brain.mode, 'search');
  assert.ok(Math.hypot(foe.pos[0] - lastSeen[0], foe.pos[2] - lastSeen[1]) < 1.5, 'it did not go to where it last saw the bait');
  g.run(3);
  assert.notEqual(foe.data.brain.mode, 'search');
});
