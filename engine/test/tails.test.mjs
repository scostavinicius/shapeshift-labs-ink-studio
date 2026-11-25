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
  game.runSteps(1); // (its campaign wakes it on the first step: examples/ninho/mission.json)
  const serpent = game.entities.find(e => e.kind === 'serpent'),
    tail = tailOf(game, serpent),
    start = serpent.pos.slice();
  game.run(3);
  assert.ok(Math.hypot(serpent.pos[0] - start[0], serpent.pos[2] - start[2]) > 2, 'it came on');
  assert.ok(tail.live && tail.total > 50);
  // the player stands and swings (the swing turns to it: combat.assist)
  let fell = false;
  for (let n = 0; n < 60 * 50 && !fell; n++) {
    game.runSteps(1, k => {
      if (k % 20 === 0) game.core.input.press('attack');
      if (k % 20 === 2) game.core.input.release('attack');
    });
    fell = game.events.some(e => e.name === 'death' && e.data.kind === 'serpent');
  }
  assert.ok(fell, 'the serpent fell');
  assert.equal(tail.live, false, 'its body went with it');
});

test('stage 32: a save keeps the body as it lay: every joint, how it moved, its splats, and its actor\'s id', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { ROOT } = await import('./load.mjs');
  const H = await loadTs('src/headless/run.ts');
  const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'ninho', 'win.json'), 'utf8'));
  // in the middle of the brood: two hatchlings spawned during play, curling after the player
  const a = H.runHeadless(nest, loadInk(), nest.scene, script, 9).game;
  const save = JSON.parse(JSON.stringify(G.saveGame(a)));
  const bodies = a.entities.filter(e => a.tailOf(e));
  assert.ok(bodies.length >= 2, 'bodies on stage');
  for (const s of save.entities.filter(e => bodies.some(b => b.id === e.id))) assert.ok(s.tail, `${s.kind} ${s.id} has its body in the save`);
  const load = () => H.runHeadless(nest, loadInk(), nest.scene, { events: [] }, 0, { load: save }).game;
  const b = load();
  for (const e of bodies) {
    const f = b.entities.find(x => x.id === e.id);
    assert.ok(f, `${e.kind} ${e.id} came back with its id`);
    const ta = a.tailOf(e),
      tb = b.tailOf(f);
    assert.deepEqual(tb.motion(), ta.motion(), 'every joint where it was, moving as it moved');
    assert.ok(Math.abs(ta.points.at(-1)[0] - ta.points[0][0]) + Math.abs(ta.points.at(-1)[2] - ta.points[0][2]) > 0.5, 'not a heap');
    const A = a.world.data.subarray(ta.at * 16, (ta.at + ta.total) * 16),
      B = b.world.data.subarray(tb.at * 16, (tb.at + tb.total) * 16);
    assert.deepEqual(Array.from(B), Array.from(A), 'its splats too: not stretched out behind it');
  }
  assert.equal(b.nextId(), a.nextId(), 'what spawns next is numbered as it would have been');
  // and a save is a save: two loads of it run the same, step by step
  const c = load(),
    hb = [],
    hc = [];
  b.runSteps(120, () => hb.push(b.hash()));
  c.runSteps(120, () => hc.push(c.hash()));
  assert.deepEqual(hc, hb);
});

/** a game whose worm has a body of chains: a spine, and three branches (one at its tip) */
function branched(extra = {}) {
  const def = G.defineGame({
    id: 'branches',
    name: 'branches',
    scene: flatScene(),
    combat: false,
    actors: {
      hero: { spec: walker },
      worm: {
        spec: worm,
        body: {
          chains: {
            spine: { joints: 9, length: 3, width: 0.45 },
            left: { from: 'spine.3', dir: 100, joints: 4, length: 1, width: [0.35, 0.2], sway: { swing: 35, rate: 1.5 } },
            right: { from: 'spine.3', dir: -100, joints: 4, length: 1, width: [0.35, 0.2], sway: { swing: 35, rate: 1.5, phase: 0.5 } },
            fluke: { from: 'spine', dir: 180, joints: 3, length: 0.7, width: 0.3, solid: false },
            ...extra
          }
        }
      }
    },
    init: () => ({})
  });
  return G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
}

test('stage 33: a body of chains: branches grow from the spine\'s joints, lie as they say, sway, and are drawn', () => {
  const run = () => {
    const game = branched();
    const w = game.spawnActor({ actor: 'worm', at: [-3, 0, -2], face: 0, brain: go(0.6, 0.2) });
    // the angle of the left branch about its root, against the spine, every tenth of a second
    const swing = [];
    for (let k = 0; k < 30; k++) {
      game.run(0.1);
      const t = game.tailOf(w),
        sp = t.chainPoints('spine'),
        l = t.chainPoints('left'),
        ahead = Math.atan2(sp[2][2] - sp[3][2], sp[2][0] - sp[3][0]),
        way = Math.atan2(l.at(-1)[2] - l[0][2], l.at(-1)[0] - l[0][0]);
      swing.push(Math.atan2(Math.sin(way - ahead), Math.cos(way - ahead)) / (Math.PI / 180));
    }
    return { game, w, body: game.tailOf(w), swing };
  };
  const { game, w, body, swing } = run();
  const sp = body.chainPoints('spine');
  assert.equal(body.chains.length, 4);
  assert.deepEqual(body.points, sp, 'points is the first chain');
  // a branch's root is its parent's joint, the same point
  assert.deepEqual(body.chainPoints('left')[0], sp[3]);
  assert.deepEqual(body.chainPoints('right')[0], sp[3]);
  assert.deepEqual(body.chainPoints('fluke')[0], sp[8], "'spine' alone is its tip");
  // the left one lies to the left of the spine and the right one to the right (left is the way face turns: +90)
  const side = name => {
    const p = body.chainPoints(name).at(-1),
      a = sp[2],
      b = sp[3];
    return Math.sign((a[0] - b[0]) * (p[2] - b[2]) - (a[2] - b[2]) * (p[0] - b[0]));
  };
  assert.equal(side('left'), 1);
  assert.equal(side('right'), -1);
  // it sways: the left branch's angle goes back and forth about 100 degrees, by more than 30 in all
  const lo = Math.min(...swing.slice(10)),
    hi = Math.max(...swing.slice(10));
  assert.ok(hi - lo > 30 && lo > 30 && hi < 170, `the branch swings between ${lo.toFixed(0)} and ${hi.toFixed(0)} degrees`);
  // every chain keeps its joints' lengths and lies near the ground
  for (const c of body.chains) {
    const P = body.chainPoints(c.name),
      gap = c.length / (c.joints - 1);
    for (let i = 1; i < P.length; i++) {
      const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
      assert.ok(Math.abs(d - gap) < gap * 0.35, `${c.name} ${i - 1}-${i}: ${d.toFixed(3)} for ${gap.toFixed(3)}`);
      assert.ok(P[i][1] > 0 && P[i][1] < 0.5, `${c.name} ${i} on the ground`);
    }
  }
  // all its splats are drawn (none left hidden at y -99)
  const D = game.world.data;
  for (let i = body.at; i < body.at + body.total; i++) assert.ok(D[i * 16 + 1] > -1, `splat ${i} drawn`);
  // solid chains push, the one that says solid: false does not
  const tip = body.chainPoints('fluke').at(-1);
  assert.equal(body.pushOut([tip[0], 0, tip[2]], 0.05), null, 'the fluke is not solid');
  const lp = body.chainPoints('left')[2];
  assert.ok(body.pushOut([lp[0], 0, lp[2]], 0.1), 'a fin is');
  // the same game, the same body; and a save brings every chain back
  assert.equal(run().game.hash(), game.hash());
  const save = JSON.parse(JSON.stringify(G.saveGame(game)));
  assert.equal(save.entities.find(e => e.id === w.id).tail.positions.length, (9 + 3 + 3 + 2) * 3, 'one point per joint, a branch sharing its root');
});

test('stage 33: the check: a body that cannot be built says why', () => {
  const def = chains => ({ id: 'b', name: 'b', scene: 'x', init: () => ({}), actors: { worm: { spec: worm, ...chains } } });
  const codes = d => G.checkDefinition(def(d)).filter(p => p.code === 'actor-body').map(p => p.level + ': ' + p.problem);
  assert.deepEqual(codes({ body: { chains: { a: { joints: 5 }, b: { from: 'a.2' } } } }), []);
  assert.match(codes({ body: { chains: { a: { from: 'nope.1' } } } })[0], /error: .*no chain "nope"/);
  assert.match(codes({ body: { chains: { a: { joints: 5 }, b: { from: 'a.9' } } } })[0], /error: .*joint 9 of a, which has 5/);
  assert.match(codes({ body: { chains: { a: { from: 'b.1' }, b: { from: 'a.1' } } } })[0], /error: .*ring: a, b/);
  assert.match(codes({ tail: {}, body: { chains: { a: {} } } })[0], /error: both tail and body/);
  assert.match(codes({ body: { chains: { a: { width: 0.1 } } } })[0], /warning: at most 0.1 wide/);
});
