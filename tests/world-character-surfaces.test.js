const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const ferryExample = require('../examples/ferry-spring-traversal.js');
const { characters, colliders } = KIT.world;
const dt = 1 / 60, up = [0, 1, 0], rotation = KIT.M.id();
const tuning = { radius: .14, height: .82, stepUp: .22 };
const seat = (y = 0, normal = up) => ({ y, normal, id: 'floor', material: 'stone' });
const flat = { supports: () => [seat()], clearance: p => p[1] };
const approx = (actual, expected) => assert(Math.abs(actual - expected) < 1e-6, actual + ' ≈ ' + expected);

test('a traveler walks on the ferry, inherits its velocity, and rebounds from the dock spring', () => {
  const result = ferryExample();
  approx(result.deckWalk, .4);
  approx(result.liftOff[0], 1.8 + 28 * dt);
  assert.equal(result.spring, 'spring');
  assert(result.impactSpeed > 2);
  approx(result.rebound[0], 3.8);
  approx(result.rebound[1], 5.2);
  assert.deepEqual(result.inventory, ['lantern']);
});

test('carry follows current rigid poses once per call and stops at solid obstacles', () => {
  const controller = characters.create({ tuning });
  let platform = { id: 'deck', half: [1.8, .25, 1.8], position: [0, -.25, 0], rotation };
  let wall;
  const world = {
    supports: (x, z, low, high) => colliders.columns(platform, x, z, low, high),
    clearance(p, radius, without) {
      return Math.min(without === 'deck' ? Infinity : colliders.distance(platform, p),
        wall ? colliders.distance(wall, p) : Infinity);
    },
    surfaceMotion: id => id === 'deck' ? platform : null
  };
  const first = controller.step({ position: [.8, .41, 0], mode: 'ground' }, {}, dt, world);
  const saved = JSON.parse(JSON.stringify(first.actor));
  platform = { ...platform, position: [1, .05, 0], rotation: KIT.M.rot(up, Math.PI / 2) };
  const moved = controller.step(saved, {}, dt * 3, world);
  for (const [axis, value] of [1, .71, -.8].entries()) approx(moved.actor.position[axis], value);
  assert.equal(moved.segments.length, 1);
  assert.deepEqual(moved.support.support, 'deck');
  assert.deepEqual(controller.step(moved.actor, {}, 0, world).actor, moved.actor);

  wall = { id: 'wall', half: [.04, 2, 2], position: [1.45, .5, 0], rotation };
  platform = { ...platform, position: [2, .05, 0] };
  const blocked = controller.step(moved.actor, {}, dt, world);
  assert(blocked.blocked);
  assert(blocked.events.some(event => event.type === 'surface-blocked' && event.support === 'deck'));
  assert(blocked.actor.position[0] < 1.28);
  assert(controller.fits(world, blocked.actor.position));
});

test('a rising carrier reports a blocked carry when it leaves no valid pose beneath a ceiling', () => {
  const controller = characters.create({ tuning });
  let y = 0;
  const world = { supports: () => [seat(y)], surfaceMotion: () => ({ position: [0, y, 0] }),
    clearance: (p, radius, without) => Math.min(without === 'floor' ? Infinity : p[1] - y, 1.2 - p[1]) };
  const start = controller.step({ position: [0, .41, 0], mode: 'ground' }, {}, dt, world).actor;
  y = .8;
  const result = controller.step(start, {}, dt, world);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.actor, start);
  assert.deepEqual(result.segments, []);
  assert.equal(result.events[0].type, 'surface-blocked');
});

test('drift stays along the contact plane and low traction keeps speed after input stops', () => {
  const controller = characters.create({ tuning });
  const responses = characters.surfaces({ byMaterial: { stone: { traction: 0, drift: [1.2, 20, 0] } } });
  const belt = { ...flat, surfaceResponse: responses };
  const start = controller.state({ position: [0, .41, 0], velocity: [0, 0, 1], mode: 'ground' });
  const carried = controller.step(start, {}, .25, belt);
  approx(carried.actor.position[0], .3);
  approx(carried.actor.position[1], .41);
  approx(carried.actor.position[2], .25);
  approx(carried.actor.velocity[2], 1);
  assert(controller.step(start, {}, .25, flat).actor.position[2] < .04);
  const stopped = characters.surfaces({ byMaterial: { stone: { drift: [1, 0, 0] } }, bySupport: { floor: null } });
  approx(controller.step(start, {}, .25, { ...flat, surfaceResponse: stopped }).actor.position[0], 0);
});

test('downhill acceleration uses the actual support slope', () => {
  const controller = characters.create({ tuning });
  const normal = KIT.V.norm([.4, 1, 0]);
  const slope = { supports: x => [seat(-.4 * x, normal)], clearance: p => KIT.V.dot(p, normal),
    supportPadding: .1, surfaceResponse: characters.surfaces({ byMaterial: { stone: { traction: 0, downhill: 1 } } }) };
  const result = controller.step({ position: [0, .43, 0], mode: 'ground' }, {}, .25, slope);
  assert.equal(result.actor.mode, 'ground');
  assert(result.actor.position[0] > .12);
  assert(result.actor.position[1] < .4);
});

test('a spring responds once to an actual landing and respects its impact threshold', () => {
  const controller = characters.create({ tuning });
  const world = { ...flat, surfaceResponse: characters.surfaces({
    bySupport: { floor: { launch: { restitution: .5, minImpact: 2 } } }
  }) };
  const standing = controller.step({ position: [0, .41, 0], mode: 'ground' }, {}, .25, world);
  assert.equal(standing.events.filter(event => event.type === 'surface-launch').length, 0);
  const touching = controller.step({ position: [0, .41, 0], velocity: [0, -4, 0] }, {}, dt, world);
  const launches = touching.events.filter(event => event.type === 'surface-launch');
  assert.equal(launches.length, 1);
  approx(launches[0].velocity[1], launches[0].impact * .5);
  assert.equal(touching.support, null);
  assert.equal(touching.actor.mode, 'air');
  const gentle = controller.step({ position: [0, .42, 0], velocity: [0, -1, 0] }, {}, dt, world);
  assert.equal(gentle.actor.mode, 'ground');
  assert(!gentle.events.some(event => event.type === 'surface-launch'));
});

test('a directional spring samples and emits in world space under sideways gravity', () => {
  let contact;
  const world = {
    gravityAt: () => ({ acceleration: [-14, 0, 0], up: [1, 0, 0] }),
    clearance: p => p[0],
    supportAlong(origin, axis, span) {
      return origin[0] >= 0 && origin[0] <= span + 1e-8
        ? { point: [0, origin[1], origin[2]], normal: [1, 0, 0], id: 'spring' } : null;
    },
    surfaceResponse(support) {
      contact = support;
      return { launch: { speed: 4, direction: [1, 0, 1] } };
    }
  };
  const controller = characters.create({ tuning });
  const result = controller.step({ position: [.42, 0, 0], up: [1, 0, 0], velocity: [-4, 0, 0] }, {}, dt, world);
  const launch = result.events.find(event => event.type === 'surface-launch');
  assert.equal(launch.support, 'spring');
  assert.deepEqual(contact.normal, [1, 0, 0]);
  assert.deepEqual(launch.normal, contact.normal);
  assert.deepEqual(launch.point, [0, 0, 0]);
  approx(launch.velocity[0], Math.sqrt(8));
  approx(launch.velocity[2], Math.sqrt(8));
  assert.deepEqual(result.actor.velocity, launch.velocity);
});

test('declarative characters use mechanical support motion and preserve attachment across checkpoints', () => {
  const run = KIT.world.runtime.create({
    dt, systems: {
      g: { kind: 'gravity', config: { frame: { kind: 'uniform', acceleration: [0, -14, 0] } } },
      rig: { kind: 'mechanics', config: { bodies: {
        deck: { half: [1, .25, .8] }
      }, joints: { slide: { kind: 'slider', child: 'deck', anchor: [0, .2, 0], axis: [1, 0, 0],
        speed: 2, range: [0, 5] } } } },
      crew: { kind: 'characters', config: { gravity: 'g/frame', clearance: 'rig/clearance',
        support: 'rig/ray', surfaceBodies: 'rig/bodies', surfaces: { bySupport: { deck: { drift: [0, 0, .2] } } },
        characters: { rider: { position: [0, .86, 0], tuning } } } }
    }
  });
  run.advance(10);
  const read = session => session.query().probe('crew/actors').value.rider;
  const before = read(run);
  assert.equal(before.surfaceAnchor.id, 'deck');
  assert(before.position[0] > .25 && before.position[2] > .025);
  const checkpoint = JSON.parse(JSON.stringify(run.checkpoint()));
  const reloaded = KIT.world.runtime.create(checkpoint.world, { checkpoint });
  reloaded.advance(20);
  run.advance(20);
  assert.deepEqual(read(reloaded), read(run));
});
