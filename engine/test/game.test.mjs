// Stage 6: the game model and the determinism contract (docs/engine-stage6-design.md §2, §3, §5), and the farol-walk
// acceptance: a character walks the farol's island without going through the lighthouse or off the edge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { flatScene, loadInk, loadTs, ROOT, sceneFn } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const H = await loadTs('src/headless/run.ts');
const walk = (await loadTs('examples/farol-walk/game.ts')).default;
const walker = (await loadTs('examples/farol-walk/game.ts')).walker;
const walkScript = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'farol-walk', 'walk.json'), 'utf8'));
const farol = sceneFn('showcase/farol.js');

/** a game on the small flat scene, with walkers */
const flatGame = (extra = {}, { scene, ...o } = {}) =>
  G.createGame(
    G.defineGame({
      id: 'flat',
      scene: 'x',
      actors: { walker: { spec: walker, max: 3 } },
      spawns: { a: [0, null, 3], b: [2, null, 3] },
      init: () => ({}),
      ...extra
    }),
    loadInk(),
    { scene: flatScene(scene), bones: 'cpu', ...o }
  );

test('the dice: the kit generator as the kit has it, and swapped back after use even when something throws', () => {
  const ink = loadInk(),
    K = ink.KIT;
  const d = new G.Dice(7);
  // the game's K.rnd is the kit's own xorshift: the same numbers from the same seed
  K.seed(1234);
  const kits = [K.rnd(), K.rnd(), K.rnd()];
  const ours = d.during(K, () => (K.seed(1234), [K.rnd(), K.rnd(), K.rnd()]));
  assert.deepEqual(ours, kits);
  // the same seed, the same game dice
  const a = new G.Dice(99),
    b = new G.Dice(99);
  assert.deepEqual([a.game.next(), a.game.next()], [b.game.next(), b.game.next()]);
  // put back after a throw, and nested calls keep the outer swap
  const mr = Math.random,
    kr = K.rnd,
    ks = K.seed;
  assert.throws(() =>
    d.during(K, () => {
      d.during(K, () => assert.notEqual(Math.random, mr));
      assert.notEqual(Math.random, mr);
      throw new Error('boom');
    })
  );
  assert.equal(Math.random, mr);
  assert.equal(K.rnd, kr);
  assert.equal(K.seed, ks);
});

test('the facade: the farol builds the same splats with a walker added after them, hidden until spawned', () => {
  const plain = farol(loadInk()).build(11);
  // the level as built (before the core starts the world's clock, which moves its particles)
  const ink = loadInk();
  const level = new G.Dice(11).during(ink.KIT, () =>
    G.buildLevel(
      G.defineGame({ id: 'idle', scene: 'showcase/farol.js', actors: { walker: { spec: walker, max: 2 } }, init: () => ({}) }),
      ink,
      farol,
      11
    )
  );
  const game = { world: level.world, level };
  const W = game.world,
    n = plain.count * 16;
  let diff = 0;
  for (let i = 0; i < n; i++) if (plain.data[i] !== W.data[i]) diff++;
  assert.equal(diff, 0, 'the scene\'s own splats are untouched');
  const slots = game.level.slots;
  assert.equal(slots.length, 2);
  assert.equal(slots[0].at, plain.count);
  assert.equal(W.count, plain.count + slots[0].total + slots[1].total);
  for (const s of slots) for (let i = s.at; i < s.at + s.total; i++) assert.equal(W.data[i * 16 + 1], -99);
});

test('a scene with no stage gets one; spawning puts a walker on the ground and shows it', () => {
  const game = flatGame({}, { scene: { stage: false } });
  assert.ok(game.world.anim && game.world.anim.rows, 'a stage, with rows');
  const a = game.spawnActor({ actor: 'walker', at: 'a' });
  assert.ok(Math.abs(a.pos[1]) < 0.05, 'stands on the floor: ' + a.pos[1]);
  game.run(0.5);
  const s = game.level.slots[0];
  let shown = 0;
  for (let i = s.at; i < s.at + s.total; i++) if (game.world.data[i * 16 + 1] > -50) shown++;
  assert.ok(shown > s.total * 0.5, `${shown} of ${s.total} splats shown`);
});

test('entities: ids in order, a full pool says what to do, triggers say enter and leave once each', () => {
  const log = [];
  const game = flatGame({
    init(g) {
      g.spawnActor({ actor: 'walker', at: 'a', brain: 'player', tags: ['player'] });
      g.spawnActor({ actor: 'walker', at: 'b', brain: () => ({}), tags: ['enemy'] });
      g.spawnTrigger({
        at: [0, 0, -1],
        shape: { r: 1 },
        onEnter: (who, gm) => log.push(['enter', who.id, gm.steps]),
        onLeave: (who, gm) => log.push(['leave', who.id, gm.steps])
      });
      return {};
    }
  });
  assert.deepEqual(
    game.entities.map(e => [e.id, e.type]),
    [
      [1, 'actor'],
      [2, 'actor'],
      [3, 'trigger']
    ]
  );
  game.spawnActor({ actor: 'walker', at: [-6, 0, -6] });
  assert.throws(() => game.spawnActor({ actor: 'walker', at: [6, 0, 6] }), /walker: max is 3, all in use; raise actors\.walker\.max/);
  assert.throws(() => game.place('nowhere'), /no spawn point "nowhere"; known: a, b/);
  // walk the player (camera yaw 0.3) straight through the trigger: from z = 3 to z = -4
  const s = Math.sin(0.3),
    c = Math.cos(0.3); // stick for world direction (0, -1): x = wx c - wz s, y = -wx s - wz c
  game.core.input.stick(s, c);
  game.run(5);
  assert.deepEqual(
    log.map(l => l.slice(0, 2)),
    [
      ['enter', 1],
      ['leave', 1]
    ],
    JSON.stringify(log)
  );
  assert.ok(game.player.pos[2] < -2, 'it walked through: ' + game.player.pos);
  // removing returns the walker to its pool
  game.remove(game.entities[1]);
  assert.equal(game.entities.length, 3);
  game.spawnActor({ actor: 'walker', at: [6, 0, 6] });
});

test('a recorded session plays back as the same input, step for step', async () => {
  const C = await loadTs('src/core/index.ts');
  const live = new C.InputState();
  let step = 0;
  const rec = new G.InputRecorder(live, () => step);
  const got = [];
  const actions = [
    () => live.press('up'),
    () => live.stick(0.3, 0.5),
    () => (live.press('jump'), live.release('jump')),
    () => live.turn(0.1, 0, 1.2),
    () => live.release('up'),
    () => live.click(0.25, 0.75)
  ];
  for (step = 0; step < 12; step++) {
    if (step % 2 === 0) actions[step / 2]();
    got.push(live.sample(0.4));
  }
  rec.stop();
  const again = new C.InputState(),
    player = new G.ScriptPlayer(rec.script());
  for (let n = 0; n < 12; n++) {
    player.apply(n, again);
    assert.deepEqual(again.sample(0.4), got[n], 'step ' + n);
  }
});

test('determinism: the same script gives the same game every step; another script does not; games do not mix', () => {
  const run = script => H.runHeadless(walk, loadInk(), farol, script, 3, { hashEachStep: true }).hashes;
  const a = run(walkScript),
    b = run(walkScript);
  assert.equal(a.length, 180);
  assert.deepEqual(a, b);
  const other = run({ ...walkScript, events: [{ step: 0, stick: [1, 0] }] });
  assert.notEqual(other[179], a[179]);
  assert.equal(other[0] === a[0], false, 'the input differs from the first step');

  // two games stepping in turn give what each gives alone
  const p1 = new G.ScriptPlayer(walkScript),
    p2 = new G.ScriptPlayer({ events: [{ step: 0, stick: [1, 0] }] });
  const g1 = G.createGame(walk, loadInk(), { scene: farol, bones: 'cpu', seed: walkScript.seed }),
    g2 = G.createGame(walk, loadInk(), { scene: farol, bones: 'cpu' });
  const h1 = [],
    h2 = [];
  for (let n = 0; n < 180; n++) {
    g1.core.shown = g1.core.view(900, 620);
    g1.runSteps(1, k => p1.apply(k, g1.core.input));
    h1.push(g1.hash());
    g2.core.shown = g2.core.view(900, 620);
    g2.runSteps(1, k => p2.apply(k, g2.core.input));
    h2.push(g2.hash());
  }
  assert.deepEqual(h1, a);
  assert.deepEqual(h2, other);
});

test('determinism: K.play.fx rolls Math.random, and still gives the same game twice; the dice are put back after', () => {
  const ink0 = loadInk();
  const mr = Math.random;
  const fxGame = ink =>
    G.createGame(
      G.defineGame({
        id: 'sparks',
        scene: 'x',
        build: ctx => ({ fx: ctx.reserve(() => ctx.K.play.fx(ctx.B, 300)) }),
        init: () => ({}),
        step(g, dt) {
          const fx = g.built.fx;
          if (g.steps % 6 === 0) fx.sparks(g.rng() * 4 - 2, 1, g.rng() * 4 - 2, 15, 12, 5);
          fx.update(dt);
        }
      }),
      ink,
      { scene: flatScene(), bones: 'cpu' }
    );
  const a = fxGame(ink0),
    b = fxGame(loadInk());
  const ha = [],
    hb = [];
  for (let n = 0; n < 60; n++) {
    a.runSteps(1);
    b.runSteps(1);
    ha.push(a.hash());
    hb.push(b.hash());
  }
  assert.deepEqual(ha, hb);
  assert.equal(Math.random, mr, 'Math.random is the real one between steps');
  // the sparks did fly (the reserved splats moved off their hiding place)
  const r = a.level.reserved[0];
  let lit = 0;
  for (let i = r.at; i < r.at + r.total; i++) if (a.world.data[i * 16 + 1] > -40) lit++;
  assert.ok(lit > 0, 'sparks on screen: ' + lit);
});

test('farol-walk: the walker meets the lighthouse and the edge of the island and goes through neither', tc => {
  const run = H.runHeadless(walk, loadInk(), farol, walkScript, 0);
  const game = run.game,
    c = game.collision;
  // the lighthouse: the columns standing above 6, their middle; its walls at walking height reach as far as the ring of
  // columns round it that are still wall
  const tall = [];
  for (let x = -6; x <= 6; x += 0.25) for (let z = -6; z <= 6; z += 0.25) if (c.ground(x, z) > 6) tall.push([x, z]);
  const cx = tall.reduce((s, p) => s + p[0], 0) / tall.length,
    cz = tall.reduce((s, p) => s + p[1], 0) / tall.length;
  let wallR = Infinity; // the smallest reach of the tower's wall over 64 directions
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    let r = 0;
    while (r < 4 && c.height(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0.3 + 1.5) > 1e8) r += 0.05;
    wallR = Math.min(wallR, r);
  }
  const player = new G.ScriptPlayer(walkScript);
  let closest = Infinity,
    lowest = Infinity,
    offIsland = 0,
    stuckAt = null;
  for (let n = 0; n < 12 * 60; n++) {
    game.core.shown = game.core.view(900, 620);
    game.runSteps(1, k => player.apply(k, game.core.input));
    const p = game.player.pos;
    closest = Math.min(closest, Math.hypot(p[0] - cx, p[2] - cz));
    lowest = Math.min(lowest, p[1]);
    if (!(Math.abs(c.ground(p[0], p[2])) < 1e8)) offIsland++;
    if (n === 5 * 60 - 1) stuckAt = [...p];
  }
  const end = game.player.pos;
  tc.diagnostic(
    `tower at (${cx.toFixed(2)}, ${cz.toFixed(2)}), wall reach ${wallR.toFixed(2)}; walker came within ${closest.toFixed(2)} of its axis; ` +
      `at 5 s (${stuckAt.map(v => v.toFixed(2))}), at 12 s (${end.map(v => v.toFixed(2))}); lowest y ${lowest.toFixed(2)}`
  );
  assert.ok(wallR > 0.5, 'found the tower: ' + wallR);
  assert.ok(closest >= wallR - 0.1, `came within ${closest} of the tower's axis (its wall reaches ${wallR})`);
  assert.ok(Math.hypot(stuckAt[0] - cx, stuckAt[2] - cz) < wallR + 1.2, 'it walked up to the tower');
  assert.equal(offIsland, 0, 'never stood where there is no ground');
  assert.ok(lowest > -0.5, 'never fell: ' + lowest);
  assert.ok(end[0] > 4, 'it went east to the edge: ' + end);
  assert.ok(game.player.ch.st.ground, 'and stands there');
});
