const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const workshopExample = require('../examples/carry-workshop.js');
const { carry, portals } = KIT.world;
const world = { solids: [] }, open = { halfWidth: 1, halfHeight: 1.2 };
const rect = { kind: 'box', half: [.2, .2, .2] };
const door = { origin: [0, 1, 0] };
const actor = { id: 'maker', position: [0, 1, 1],
  sockets: { hand: [.48, 0, -.3], back: [-.48, 0, 0] } };
const json = value => JSON.parse(JSON.stringify(value));
const item = (key, at = [.48, 1, .7], collider = rect) =>
  ({ id: key, place: 'yard', pose: at, collider, data: { condition: 'original' } });
const make = (...items) => carry.create({ items: items.length ? items : [item('crate')] });
const grab = (registry, key = 'crate', by = actor, socket = 'hand', space = world) =>
  registry.pickup({ item: key, place: 'yard', actor: by, socket, world: space });
const path = { previous: [0, 1, .1], actor: { ...actor, position: [0, 1, -.3] } };

function travel(registry, { aperture = open, source, destination, mode } = {}) {
  return portals.create({ carry: registry,
    places: [
      { id: 'yard', anchors: { door }, prepare: source ?? (() => ({ carryWorld: world })) },
      { id: 'shop', anchors: { door: { ...door, origin: [5, 1, 2], normal: [1, 0, 0] } },
        prepare: destination ?? (() => ({ carryWorld: world })) }
    ],
    links: [{ id: 'into-shop', from: { place: 'yard', anchor: 'door' }, to: { place: 'shop', anchor: 'door' },
      aperture, mode }]
  });
}

test('carry reservations preserve identity and placement rejects intersecting solids', () => {
  const registry = make(item('crate'), item('second', [.88, 1, .7]));
  assert.equal(grab(registry, 'missing').reason, 'unavailable-item');
  assert.equal(grab(registry, 'crate', { ...actor, position: [10, 1, 1] }).reason, 'out-of-reach');
  const first = grab(registry);
  assert.equal(first.status, 'held');
  assert.equal(grab(registry, 'crate', { ...actor, id: 'visitor' }).reason, 'unavailable-item');
  assert.equal(grab(registry, 'second').reason, 'occupied-socket');
  const clear = registry.place({ item: 'crate', place: 'yard', actor, pose: [2, 1, .7], world });
  assert.equal(clear.reason, 'clearance');
  assert.equal(clear.solid, 'second');
  assert.equal(registry.item('crate'), first.item);
  const released = registry.place({ item: 'crate', place: 'yard', actor, pose: [.48, 1, .1], world });
  assert.equal(released.status, 'placed');
  assert.deepEqual(released.item.data, { condition: 'original' });
  assert.deepEqual(registry.poses('yard', actor), []);
});

test('an animated socket drives a collision-checked carry pose and throw starts from it', () => {
  const registry = carry.create({ items: [item('crate')], socket: (actor, name) => actor.sockets[name] });
  grab(registry);
  const to = { ...actor, position: [2, 1, 1], sockets: { ...actor.sockets, hand: [.55, .28, -.3] } };
  const wall = { id: 'rail', position: [1.35, 1, .7], half: [.025, .8, .8] };
  assert.deepEqual(registry.move({ place: 'yard', from: actor, to, world: { solids: [wall] } }),
    { status: 'blocked', reason: 'clearance', item: 'crate', solid: 'rail' });
  const moved = registry.move({ place: 'yard', from: actor, to, world });
  assert.equal(moved.status, 'ready');
  assert.deepEqual(moved.items[0].position, [2.55, 1.28, .7]);
  const thrown = registry.throw({ item: 'crate', place: 'yard', actor: { ...to, velocity: [2, 0, 0] },
    velocity: [1, 3, -2], angular: [0, 2, 0], world });
  assert.deepEqual(thrown.item.pose.position, moved.items[0].position);
  assert.deepEqual(thrown.item.velocity, [3, 3, -2]);
  assert.deepEqual(thrown.item.angular, [0, 2, 0]);
  assert.equal(registry.updateLoose('crate', { pose: [3, 2, .1] }).id, 'crate');
  assert.deepEqual(registry.item('crate').pose.position, [3, 2, .1]);
});

test('rotating a held shape sweeps its arc between clear endpoint poses', () => {
  const center = [0, 1, 1], registry = make(item('crate', center, { kind: 'box', half: [.1, .1, .6] }));
  const from = { ...actor, position: center, sockets: { hand: [0, 0, 0] } };
  const to = { ...from, rotation: KIT.M.rot([1, 0, 0], Math.PI / 2) };
  assert.equal(grab(registry, 'crate', from).status, 'held');
  const space = { solids: [{ id: 'peg', position: [0, .63, 1.37], half: [.025, .025, .025] }] };
  assert.equal(registry.move({ place: 'yard', from, to, world: space }).solid, 'peg');
  assert.equal(registry.move({ place: 'yard', from, to, world }).status, 'ready');
});

test('a portal maps all attached bodies and reports them only on successful handoff', async () => {
  const registry = make(item('crate'), item('toolbox', [-.48, 1, 1]));
  const sourceActor = { ...actor, rotation: KIT.M.id() };
  assert.equal(grab(registry, 'crate', sourceActor).status, 'held');
  assert.equal(grab(registry, 'toolbox', sourceActor, 'back').status, 'held');
  const session = travel(registry);
  await session.enter('yard');
  await session.prepare('into-shop');
  const movement = { ...path, actor: { ...sourceActor, position: path.actor.position } };
  const preview = session.checkArrival('into-shop', movement);
  assert.equal(preview.status, 'ready');
  const ids = preview.cargo.map(row => row.id);
  assert.deepEqual(ids, ['crate', 'toolbox']);
  assert.equal(registry.itemsAt('yard').length, 2);
  assert.equal(registry.itemsAt('shop').length, 0);
  let event;
  session.onCross(result => { event = { cargo: result.cargo, place: registry.item('crate').place }; });
  const crossed = await session.cross('into-shop', movement);
  assert.deepEqual(event, { cargo: preview.cargo, place: 'shop' });
  assert.deepEqual(crossed.cargo, registry.poses('shop', crossed.actor));
  assert.deepEqual(registry.poses('yard', movement.actor), []);
  assert.deepEqual(registry.itemsAt('yard'), []);
  const sourceBodies = make(item('crate'), item('toolbox', [-.48, 1, 1]));
  grab(sourceBodies, 'crate', sourceActor);
  grab(sourceBodies, 'toolbox', sourceActor, 'back');
  sourceBodies.poses('yard', movement.actor).forEach((body, i) => {
    assert(KIT.V.dist(crossed.cargo[i].position, crossed.link.opening.point(body.position)) < 1e-8);
  });
  session.dispose();
});

test('oversized cargo and destination obstructions leave the whole group in the source', async () => {
  const registry = make();
  grab(registry);
  const narrow = travel(registry, { aperture: { halfWidth: .6, halfHeight: 1.2 } });
  await narrow.enter('yard');
  await narrow.prepare('into-shop');
  assert.equal(narrow.checkArrival('into-shop', path).cargoBlocker.reason, 'aperture');
  assert.equal(await narrow.cross('into-shop', path), null);
  assert.equal(registry.item('crate').place, 'yard');
  narrow.dispose();

  const blocked = travel(registry, { destination: () => ({
    carryWorld: { solids: [{ id: 'partition', position: [5.6, 1, 2.48], half: [.12, .4, .25] }] }
  }) });
  await blocked.enter('yard');
  await blocked.prepare('into-shop');
  const candidate = blocked.checkArrival('into-shop', path);
  assert.equal(candidate.status, 'blocked');
  assert.equal(candidate.cargoBlocker.solid, 'partition');
  assert.equal(await blocked.cross('into-shop', path), null);
  assert.equal(registry.item('crate').place, 'yard');
  blocked.dispose();
});

test('a source checkpoint failure leaves an approved carry in its original place', async () => {
  const registry = make();
  grab(registry);
  let writable = false;
  const session = travel(registry, { source: () => ({
    checkpoint() { if (!writable) throw Error('Source save failed'); return { seen: true }; }
  }) });
  await session.enter('yard');
  await assert.rejects(session.cross('into-shop', path), /Source save failed/);
  assert.equal(registry.item('crate').place, 'yard');
  assert.equal(session.current().id, 'yard');
  writable = true;
  assert.equal((await session.cross('into-shop', path)).place.id, 'shop');
  assert.equal(registry.item('crate').place, 'shop');
  session.dispose();
});

test('fade travel only commits cargo after destination preparation, and a failed restore stays atomic', async () => {
  const registry = make();
  grab(registry);
  const session = travel(registry, { mode: 'fade' });
  await session.enter('yard');
  const fade = session.fade('into-shop', { actor: { ...actor, position: door.origin } });
  assert.equal(fade.advance(.4).phase, 'hold');
  assert.equal(registry.item('crate').place, 'yard');
  await session.prepare('into-shop');
  const ready = fade.advance(.4);
  assert.equal(ready.phase, 'done');
  assert.equal(registry.item('crate').place, 'shop');
  const save = json(session.checkpoint());
  session.dispose();

  const target = make();
  const failure = travel(target, { destination: () => { throw Error('Workshop unavailable'); } });
  await assert.rejects(failure.restore(save), /unavailable/);
  assert.equal(target.item('crate').place, 'yard');
  assert.equal(failure.current(), null);
  const restored = travel(target);
  await restored.restore(save);
  assert.equal(target.item('crate').place, 'shop');
  assert.equal(target.item('crate').held.carrier, 'maker');
  restored.dispose();
});

test('the portable workshop preserves a bench placement and lets the same crate be picked up after reload', async () => {
  assert.deepEqual(await workshopExample(),
    { id: 'oak-crate', restoredAt: [-1.35, 1.07, 2.35], recoveredBy: 'maker', contents: ['chisel', 'plane'] });
});
