// Stage 34: legs (actors.<name>.legs). The actor is an ordinary K.character (the trunk); its feet are the kit's K.gait,
// each leg a curve from a hip on the actor to its foot, the knee from K.ik2. Checked on a six-legged walker on flat ground:
// planted feet stay put and on the ground, the legs keep their lengths and reach their feet, feet of one group never lift
// together, it keeps up walking and turning, the same game gives the same legs, a save brings the feet back; the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatScene, loadInk, loadTs } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');

const crab = { ...walker, id: 'crab' };
const LEGS = {
  feet: [
    [0.6, 0.9],
    [0, 1],
    [-0.6, 0.9],
    [0.6, -0.9],
    [0, -1],
    [-0.6, -0.9]
  ],
  hip: 0.55,
  width: 0.2,
  // a walker's legs are quick: it runs at about 2.7 a second
  reach: 0.55,
  time: 0.15
};

function flat(legs = {}) {
  const def = G.defineGame({
    id: 'legs',
    name: 'legs',
    scene: flatScene(),
    combat: false,
    actors: { hero: { spec: walker }, crab: { spec: crab, legs: { ...LEGS, ...legs } } },
    init: () => ({})
  });
  return G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
}

/** a brain that walks one way, then the other */
const walk = turnAt => (self, game) => (game.t < turnAt ? { move: 1, mz: 0.2 } : { move: -0.6, mz: -1 });

function run(seconds, legs) {
  const game = flat(legs);
  const c = game.spawnActor({ actor: 'crab', at: [-4, 0, -3], face: 0, brain: walk(2) });
  const L = game.legsOf(c);
  const log = [];
  let prev = L.feet;
  for (let k = 0; k < seconds * 60; k++) {
    game.runSteps(1);
    const f = L.feet;
    log.push({ feet: f, prev, legs: L.legs.map(l => l.map(p => p.slice())), pos: c.pos.slice(), face: c.ch.st.face });
    prev = f;
  }
  return { game, c, L, log };
}

test('stage 34: legs: planted feet stay on the ground, legs keep their lengths, groups take turns, and it keeps up', () => {
  const { game, c, L, log } = run(4);
  const o = L.o;
  assert.equal(L.legs.length, 6);
  assert.ok(L.steps > 20, `${L.steps} steps in 4 s`);
  let reached = 0,
    far = 0,
    late = 0;
  for (const [k, s] of log.entries()) {
    s.feet.forEach((f, i) => {
      // a foot that stood and still stands has not moved, and stands on the ground
      if (f.u >= 1 && s.prev[i].u >= 1) {
        assert.deepEqual(f.p, s.prev[i].p, `step ${k}: planted foot ${i} stays put`);
        assert.ok(Math.abs(f.p[1] - game.collision.ground(f.p[0], f.p[2])) < 1e-9, `step ${k}: foot ${i} on the ground`);
      }
      const [hip, knee, tip] = s.legs[i];
      // thigh and shin keep their lengths; the knee is above a planted foot
      assert.ok(Math.abs(Math.hypot(knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]) - o.bones[i][0]) < 1e-6, 'thigh');
      assert.ok(Math.abs(Math.hypot(tip[0] - knee[0], tip[1] - knee[1], tip[2] - knee[2]) - o.bones[i][1]) < 1e-6, 'shin');
      if (f.u >= 1) assert.ok(knee[1] > tip[1], `step ${k}: knee ${i} above its planted foot`);
      const short = Math.hypot(tip[0] - f.p[0], tip[1] - f.p[1], tip[2] - f.p[2]);
      if (short < 0.01) reached++;
      // every foot keeps near its home
      const cs = Math.cos(s.face),
        sn = Math.sin(s.face),
        h = o.feet[i];
      const off = Math.hypot(s.pos[0] + cs * h[0] - sn * h[1] - f.p[0], s.pos[2] + sn * h[0] + cs * h[1] - f.p[2]);
      // walking straight, and in the last second (the turn at 2 s swings every home to the other side at once)
      if (k < 115) far = Math.max(far, off);
      if (k >= 180) late = Math.max(late, off);
    });
    // two feet of one group are never in the air together, walking straight (a foot left more than 2.2 reaches behind,
    // as when it turns right round, steps whatever its group: K.gait's own catch-up)
    const up = s.feet.map((f, i) => (f.u < 1 ? o.groups[i] : null)).filter(g => g !== null);
    if (k < 115) assert.equal(new Set(up).size, up.length, `step ${k}: one foot a group in the air`);
  }
  assert.ok(reached / (log.length * 6) > 0.97, `the legs reach their feet ${((100 * reached) / (log.length * 6)).toFixed(1)}% of the time`);
  assert.ok(far < 2.2 * o.reach + 0.6, `no foot left behind: at most ${far.toFixed(2)} from home`);
  assert.ok(late < 2.2 * o.reach + 0.6, `and none after the turn: at most ${late.toFixed(2)} from home`);
  // half the feet can be up at once: the default groups pair neighbours along each side
  assert.deepEqual(o.groups, [0, 0, 1, 8, 8, 9]);
  assert.ok(Math.max(...log.map(s => s.feet.filter(f => f.u < 1).length)) >= 3, 'three feet up at once, as a tripod');
  // the legs' splats are drawn
  const D = game.world.data;
  for (let i = L.at; i < L.at + L.total; i++) assert.ok(D[i * 16 + 1] > -1, `splat ${i} drawn`);
  assert.equal(run(4).game.hash(), game.hash(), 'the same game, the same legs');
  assert.ok(c.pos[2] < -3, 'it turned back');
});

test('stage 34: a save keeps where the feet stand, a step in the air included', () => {
  const { game, c, L } = run(2.6);
  const save = JSON.parse(JSON.stringify(G.saveGame(game)));
  const s = save.entities.find(e => e.id === c.id);
  assert.equal(s.legs.length, 6);
  const def = game.def;
  const b = G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
  b.withDice(() => b.spawnActor({ actor: 'crab', at: [-4, 0, -3], face: 0, brain: walk(2) }));
  G.loadSave(b, save);
  const Lb = b.legsOf(b.entities.find(e => e.id === c.id));
  assert.deepEqual(Lb.state(), L.state(), 'every foot, and the one in the air on its way');
  assert.deepEqual(Lb.legs, L.legs, 'the legs drawn to them');
});

test('stage 34: the kit\'s motion matching drives the same legs, one foot at a time', () => {
  const { L, log, game } = run(3, { matching: true });
  assert.ok(L.steps > 8, `${L.steps} steps`);
  for (const s of log) assert.ok(s.feet.filter(f => f.u < 1).length <= 1, 'one foot in the air');
  assert.equal(run(3, { matching: true }).game.hash(), game.hash(), 'the same every time');
});

test('stage 34: the check: legs that cannot stand say why', () => {
  const def = legs => ({ id: 'l', name: 'l', scene: 'x', init: () => ({}), actors: { crab: { spec: crab, legs } } });
  const codes = l => G.checkDefinition(def(l)).filter(p => p.code === 'actor-legs').map(p => p.problem);
  assert.deepEqual(codes(LEGS), []);
  assert.match(codes({ feet: [[0, 1]] })[0], /2 to 8 feet, not 1/);
  assert.match(codes({ ...LEGS, groups: [0, 1] })[0], /2 groups for 6 feet/);
});
