// Stage 7: combat and enemies. The stage's "done when": a scripted headless fight in which the player kills an enemy and
// loses health to its blows, checked on the game's state and events (not on the picture). Then the rules one by one, on a
// small flat scene: reach, arc, one hit per swing, time unhittable, teams, death and respawn, the chaser's eyes, and the
// ground's memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { flatScene, loadInk, loadTs, ROOT, sceneFn } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const H = await loadTs('src/headless/run.ts');
const fightMod = await loadTs('test/fixtures/fight/game.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');
const fight = fightMod.default;
const fightScript = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'fight', 'fight.json'), 'utf8'));

/** run a game with a script, step by step, collecting every event with the time it happened */
function play(def, scene, script, seconds) {
  const { game } = H.runHeadless(def, loadInk(), scene, script, 0);
  const player = new G.ScriptPlayer(script),
    log = [];
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    game.core.shown = game.core.view(900, 620);
    game.runSteps(1, k => player.apply(k, game.core.input));
    for (const e of game.events) log.push({ t: game.t, ...e });
  }
  return { game, log };
}

test('farol-fight: scripted, the player kills both grunts and loses health to their blows', tc => {
  const { game, log } = play(fight, sceneFn('showcase/farol.js'), fightScript, 12);
  const s = game.snapshot();
  const hitsOnPlayer = log.filter(e => e.name === 'hit' && e.data.target === 1),
    kills = log.filter(e => e.name === 'death' && e.data.team === 'enemy');
  tc.diagnostic(log.map(e => `${e.t.toFixed(2)} ${e.name} ${JSON.stringify(e.data)}`).join('\n'));
  // the player was hit, health going down one at a time
  assert.ok(hitsOnPlayer.length >= 2, 'the grunts landed blows');
  hitsOnPlayer.slice(0, 3).forEach((h, k, a) => k && assert.ok(h.data.hp < a[k - 1].data.hp || h.data.hp === 4, 'health goes down'));
  assert.ok(hitsOnPlayer.every(h => h.data.by === 2 || h.data.by === 3), 'by the grunts');
  // both grunts killed by the player
  assert.equal(kills.length, 2);
  assert.ok(kills.every(k => k.data.by === 1));
  // the state says so too
  assert.equal(s.state.kills, 2);
  assert.equal(s.state.won, true);
  assert.deepEqual(
    s.entities.filter(e => e.type === 'actor').map(e => e.kind),
    ['player'],
    'only the player is left on stage'
  );
  // it died once on the way and came back at the start with full health
  assert.equal(s.state.deaths, 1);
  assert.ok(log.some(e => e.name === 'respawn'));
  assert.equal(s.entities[0].hp, 5);
  // where each grunt fell the grass is scorched, and still is at the end (seconds after the fire went out)
  for (const k of kills) assert.ok(game.effects.eco.burntAt(k.data.at[0], k.data.at[2]) > 0.5, 'scorched where it fell: ' + k.data.at);
});

test('farol-fight: the same script gives the same fight, blow for blow', () => {
  const a = play(fight, sceneFn('showcase/farol.js'), fightScript, 9),
    b = play(fight, sceneFn('showcase/farol.js'), fightScript, 9);
  assert.equal(a.game.hash(), b.game.hash());
  assert.deepEqual(
    a.log.map(e => [e.t, e.name, e.data]),
    b.log.map(e => [e.t, e.name, e.data])
  );
});

/** the flat scene with a hero and dummies (they do nothing) */
const arena = (extra = {}) =>
  G.createGame(
    G.defineGame({
      id: 'yard',
      scene: 'x',
      actors: { hero: { spec: walker, hp: 3 }, dummy: { spec: walker, max: 4, hp: 2 } },
      combat: { invuln: 0.6, respawn: 1.5 },
      init: () => ({}),
      ...extra
    }),
    loadInk(),
    { scene: flatScene(), bones: 'cpu' }
  );
// a swing: press attack for a step, then run the swing out (K.character's wind-up and strike take about 0.2 s)
const swing = (game, face) => {
  game.player.ch.st.face = face;
  game.core.input.press('attack');
  game.runSteps(1);
  game.core.input.release('attack');
  game.run(0.4);
};
/** put an actor back at (x, z), standing still (a hit throws it out of reach) */
const put = (game, a, x, z) => {
  const st = a.ch.st;
  st.x = x;
  st.z = z;
  st.vx = st.vz = 0;
  a.pos = [x, a.pos[1], z];
  game.runSteps(1);
};

test('a blow lands in reach and in front, once a swing, on the other team only', () => {
  const game = arena();
  game.spawnActor({ actor: 'hero', at: [0, 0, 0], brain: 'player' });
  const ahead = game.spawnActor({ actor: 'dummy', at: [1, 0, 0], brain: G.dummy }),
    behind = game.spawnActor({ actor: 'dummy', at: [-1, 0, 0], brain: G.dummy }),
    far = game.spawnActor({ actor: 'dummy', at: [0, 0, 3], brain: G.dummy });
  const events = [];
  const watch = () => events.push(...game.events.filter(e => e.name === 'hit'));
  game.run(0.3);
  // facing +x (face 0): only the one ahead is hit, once, though the strike lasts several steps
  game.player.ch.st.face = 0;
  game.core.input.press('attack');
  game.runSteps(1);
  game.core.input.release('attack');
  for (let n = 0; n < 30; n++) {
    game.runSteps(1);
    watch();
  }
  assert.deepEqual(events.map(e => e.data.target), [ahead.id]);
  assert.deepEqual([ahead.hp, behind.hp, far.hp], [1, 2, 2]);
  // while it is unhittable a swing does nothing to it; once that has run out, the next one lands
  game.run(0.6);
  put(game, ahead, 1, 0);
  ahead.invuln = 0.6;
  swing(game, 0);
  assert.equal(ahead.hp, 1, 'unhittable for a moment after a hit');
  game.run(0.5);
  put(game, ahead, 1, 0);
  swing(game, 0);
  assert.equal(ahead.hp, 0, 'and hittable again after');
  // turned round, it hits the one behind
  game.run(0.7);
  put(game, behind, -1, 0);
  swing(game, Math.PI);
  assert.equal(behind.hp, 1);
  // two of the same team do not hurt each other
  const friend = game.spawnActor({ actor: 'dummy', at: [0, 0, 1], brain: G.dummy, team: 'player' });
  swing(game, Math.PI / 2);
  assert.equal(friend.hp, 2);
});

test('an enemy at 0 health dies, leaves the stage and frees its place; the player dies and comes back', () => {
  const game = arena({ effects: { eco: false } });
  game.spawnActor({ actor: 'hero', at: [0, 0, 0], brain: 'player' });
  const d = game.spawnActor({ actor: 'dummy', at: [1, 0, 0], brain: G.dummy });
  game.run(0.3);
  const seen = [];
  const run = s => {
    for (let n = 0; n < Math.round(s * 60); n++) {
      game.runSteps(1);
      seen.push(...game.events.map(e => e.name));
    }
  };
  for (let k = 0; k < 4 && d.alive; k++) {
    game.player.ch.st.face = Math.atan2(d.pos[2] - game.player.pos[2], d.pos[0] - game.player.pos[0]);
    game.core.input.press('attack');
    run(1 / 60);
    game.core.input.release('attack');
    run(0.8);
  }
  assert.equal(d.alive, false, 'the dummy died');
  assert.ok(seen.includes('death'));
  assert.ok(!game.entities.includes(d), 'and left the stage');
  // its place in the pool is free again: all four dummies can be on stage
  game.spawnActor({ actor: 'dummy', at: [2, 0, 2], brain: G.dummy });
  game.spawnActor({ actor: 'dummy', at: [2, 0, -2], brain: G.dummy });
  game.spawnActor({ actor: 'dummy', at: [-2, 0, 2], brain: G.dummy });

  // the player: three blows from a friend-turned-foe, and it is down; 1.5 s later it is back at home with full health
  const p = game.player;
  for (let k = 0; k < 3; k++) {
    new G.Combat({ invuln: 0 }).hit(game, null, p, 1, 0, null);
  }
  assert.equal(p.deadFor, 0);
  run(1.0);
  assert.ok(p.deadFor > 0.9 && p.hp <= 0, 'still down after 1 s');
  run(0.6);
  assert.equal(p.deadFor, -1, 'back on its feet');
  assert.equal(p.hp, 3);
  assert.ok(Math.hypot(p.pos[0], p.pos[2]) < 0.1, 'at home: ' + p.pos);
  assert.ok(seen.includes('respawn'));
});

test('a chaser comes for the player it can see, swings in reach, and does not see through a wall', () => {
  // the flat scene's pillar stands at (-4, 0, 0), radius 0.5
  const seeing = arena();
  seeing.spawnActor({ actor: 'hero', at: [0, 0, 3], brain: 'player' });
  const c = seeing.spawnActor({ actor: 'dummy', at: [-6, 0, 3], brain: G.chaser({ sight: 9 }) });
  const start = Math.hypot(c.pos[0] - 0, c.pos[2] - 3);
  let swung = false;
  for (let n = 0; n < 240; n++) {
    seeing.runSteps(1);
    if (c.input.attack) swung = true;
  }
  const end = Math.hypot(c.pos[0] - seeing.player.pos[0], c.pos[2] - seeing.player.pos[2]);
  assert.ok(end < start - 3, `it came closer: ${start.toFixed(2)} -> ${end.toFixed(2)}`);
  assert.ok(swung, 'and swung');
  assert.ok(seeing.player.hp < 3, 'and hit');

  const blind = arena();
  blind.spawnActor({ actor: 'hero', at: [-2, 0, 0], brain: 'player' });
  const b = blind.spawnActor({ actor: 'dummy', at: [-6.5, 0, 0], brain: G.chaser({ sight: 9 }) });
  blind.run(2);
  assert.equal(b.data.brain.mode, 'idle', 'the pillar is between them');
  assert.ok(Math.abs(b.pos[0] + 6.5) < 0.2, 'it stayed put: ' + b.pos);
});

test('the ground remembers: a fire scorches the ground splats round it, and the scorch stays', () => {
  const game = arena({ effects: { fx: 0, debris: 0 } });
  const W = game.world,
    eco = game.effects.eco;
  const colourAt = (x, z) => {
    // the packed colours of the ground splats within half a unit of (x, z)
    const out = [];
    for (let i = 0; i < W.count; i++) {
      const o = i * 16;
      if (Math.hypot(W.data[o] - x, W.data[o + 2] - z) < 0.5 && Math.abs(W.data[o + 1]) < 0.3) out.push(W.data[o + 7]);
    }
    return out;
  };
  const before = colourAt(2.5, 2.5),
    away = colourAt(-7.5, -7.5);
  game.effects.ignite(2.5, 2.5, 1);
  game.run(6);
  const after = colourAt(2.5, 2.5);
  let changed = 0;
  for (let k = 0; k < before.length; k++) if (before[k] !== after[k]) changed++;
  assert.ok(eco.burntAt(2.5, 2.5) > 0.5, 'burnt: ' + eco.burntAt(2.5, 2.5));
  assert.ok(changed > before.length * 0.8, `${changed} of ${before.length} ground splats repainted`);
  assert.deepEqual(colourAt(-7.5, -7.5), away, 'far away nothing changed');
  // well after the fire is out, it is still scorched
  game.run(6);
  assert.ok(eco.burntAt(2.5, 2.5) > 0.5);
  const later = colourAt(2.5, 2.5);
  let still = 0;
  for (let k = 0; k < before.length; k++) if (before[k] !== later[k]) still++;
  assert.ok(still > before.length * 0.8, 'the scorch stays');
});

test('stage 28: a blow marks the ground where it lands, the same splats every time, and marks: false leaves it bare', () => {
  const ring = (game, x, z, r) => {
    const W = game.world,
      out = [];
    for (let i = 0; i < W.count; i++) {
      const o = i * 16;
      // the ground's splats: still and flat (an actor's own move, and flash when hit)
      if (Math.hypot(W.data[o] - x, W.data[o + 2] - z) < r && Math.abs(W.data[o + 1]) < 0.06 && !moving.has(i)) out.push(W.data[o + 7]);
    }
    return out;
  };
  let moving = new Set();
  const fightAt = marks => {
    const game = arena({ effects: { fx: 0, debris: 0, eco: false, marks } });
    game.spawnActor({ actor: 'hero', at: [0, 0, 0], brain: 'player' });
    const dummy = game.spawnActor({ actor: 'dummy', at: [1, 0, 0], brain: G.dummy });
    game.run(0.3);
    // whatever moves between two steps is not ground
    const W = game.world,
      was = W.data.slice();
    game.runSteps(1);
    moving = new Set();
    for (let i = 0; i < W.count; i++) if (W.data[i * 16] !== was[i * 16] || W.data[i * 16 + 1] !== was[i * 16 + 1]) moving.add(i);
    for (const e of game.entities) for (let i = 0; i < W.count; i++) if (Math.hypot(W.data[i * 16] - e.pos[0], W.data[i * 16 + 2] - e.pos[2]) < 0.45 && W.data[i * 16 + 1] > 0.02) moving.add(i);
    const before = ring(game, 0.9, 0, 1.2),
      far = ring(game, -6, -6, 0.6);
    const hp = dummy.hp;
    swing(game, 0);
    assert.ok(dummy.hp < hp || dummy.deadFor >= 0, 'the blow landed');
    const after = ring(game, 0.9, 0, 1.2);
    let changed = 0;
    for (let k = 0; k < before.length; k++) if (before[k] !== after[k]) changed++;
    assert.deepEqual(ring(game, -6, -6, 0.6), far, 'far away nothing changed');
    return { changed, of: before.length, hash: game.hash() };
  };
  const a = fightAt(true),
    b = fightAt(true),
    off = fightAt(false);
  assert.ok(a.changed > 5 && a.changed < a.of, `${a.changed} of ${a.of} ground splats marked: a speckle, not a disc`);
  assert.equal(a.changed, b.changed);
  assert.equal(a.hash, b.hash, 'the same blow marks the same splats');
  assert.equal(off.changed, 0, 'marks: false');
});
