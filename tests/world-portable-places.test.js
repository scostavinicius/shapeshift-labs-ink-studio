const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const workshopExample = require('../examples/portable-workshop.js');

const door = { origin: [0, 1.25, 0] };
const aperture = { halfWidth: 1, halfHeight: 1.25 };
const spec = { id: 'workshop-1', template: 'workshop', seed: 41, params: { finish: 'oak' } };
const returnTo = { position: [4.25, 1.25, 8.5], forward: [1, 0, 0], up: [0, 1, 0] };
const tool = { id: 'chisel', wear: 2 };
const roundTrip = value => JSON.parse(JSON.stringify(value));

function prepareRoom({ instance, state }) {
  let opened = state?.opened ?? false;
  return { world: { seed: instance.seed }, openChest() { opened = true; }, checkpoint: () => ({ opened }) };
}

function create({ field = () => ({ world: {} }), room = prepareRoom } = {}) {
  return KIT.world.portals.create({
    places: [{ id: 'field', prepare: field }],
    templates: [{ id: 'workshop', anchors: { door }, prepare: room }]
  });
}

function open(session, { id = 'visit', place = spec.id, at = { origin: [4, 1.25, 8] }, pose = returnTo } = {}) {
  return session.openEntrance({ id, to: { place, anchor: 'door' }, at, aperture, returnTo: pose });
}

function movement(link) {
  const { origin, normal } = link.from.at;
  return { previous: KIT.V.mad(origin, normal, 0.25), actor: {
    position: KIT.V.mad(origin, normal, -0.25), velocity: KIT.V.mul(normal, -1),
    forward: KIT.V.mul(normal, -1), carried: tool
  } };
}
const cross = (session, link) => session.cross(link.id, movement(link));

test('the workshop keeps moved geometry through reload and visits from different openings', async () => {
  assert.deepEqual(await workshopExample(), {
    crate: [-0.5, 0.3, 2.3], firstReturn: [4, 1.25, 8.5], secondReturn: [10, 1.25, 4.5]
  });
});

test('portable entrances retain a painted mask and mirror the return aperture', async () => {
  const session = create();
  session.registerInstance(spec);
  await session.enter('field');
  const entry = session.openEntrance({ id: 'painted', to: { place: spec.id, anchor: 'door' },
    at: { origin: [4, 1.25, 8] }, aperture: { ...aperture, maskThreshold: 1,
      mask: { width: 3, height: 1, channels: 1, data: [1, 1, 0] } } });
  assert(await cross(session, entry));
  const saved = roundTrip(session.checkpoint());
  assert.deepEqual(saved.portable.entrances[0].aperture.mask.data, [255, 255, 0]);
  session.dispose();
  const restored = create();
  await restored.restore(saved);
  assert.deepEqual(restored.linksFrom(spec.id)[0].opening.mask.data, [0, 255, 255]);
  restored.dispose();
});

test('templates keep independent instance checkpoints and open entrances survive reload', async () => {
  const session = create();
  const first = session.registerInstance(spec);
  assert.equal(session.registerInstance(roundTrip(spec)), first);
  assert.throws(() => session.registerInstance({ ...spec, seed: 3 }), /already in use/);
  session.registerInstance({ ...spec, id: 'workshop-2' });
  await session.enter('field');
  const entry = open(session);
  const other = open(session, { id: 'another', place: 'workshop-2' });
  const preview = await session.approach([4, 1.25, 8.25]).ready;
  assert.equal(session.view(other.id).asset, preview);
  assert.equal((await cross(session, other)).place.asset, preview);
  await cross(session, session.linksFrom('workshop-2')[0]);
  (await cross(session, entry)).place.asset.openChest();
  await cross(session, session.linksFrom(spec.id)[0]);
  const saved = roundTrip(session.checkpoint());
  assert.deepEqual(saved.saved[spec.id], { opened: true });
  assert.deepEqual(saved.saved['workshop-2'], { opened: false });
  session.dispose();

  const restored = create();
  await restored.restore(saved);
  assert.deepEqual(restored.linksFrom('field').map(link => link.id), [entry.id, other.id]);
  assert.deepEqual((await cross(restored, restored.linksFrom('field')[0])).place.asset.checkpoint(), { opened: true });
  restored.dispose();
});

test('a closed entrance preserves its saved exit across a blocked return', async () => {
  const session = create();
  session.registerInstance(spec);
  await session.enter('field');
  const entry = open(session);
  let observedExit;
  session.onCross(({ place }) => { observedExit = session.linksFrom(place.id)[0]; });
  await cross(session, entry);
  const exit = observedExit;
  assert.equal(exit.to.place, 'field');
  assert.equal(session.closeEntrance('visit'), true);
  assert.equal(session.closeEntrance('visit'), false);
  assert.deepEqual(session.linksFrom('field'), []);
  const saved = roundTrip(session.checkpoint());
  session.dispose();

  let clear = false;
  const restored = create({ field({ anchor }) {
    assert.deepEqual(anchor.origin, returnTo.position);
    return { canArrive(actor) { assert.deepEqual(actor.position, returnTo.position); return clear; } };
  } });
  await restored.restore(saved);
  const restoredExit = restored.linksFrom(spec.id)[0];
  assert.equal(restoredExit.id, exit.id);
  assert.equal(await cross(restored, restoredExit), null);
  assert.deepEqual(roundTrip(restored.checkpoint()), saved);
  clear = true;
  const arrived = await cross(restored, restoredExit);
  assert.deepEqual(arrived.actor, { ...returnTo, carried: tool, velocity: [0, 0, 0] });
  assert.equal(restored.current().id, 'field');
  assert.deepEqual(restored.linksFrom(spec.id), []);
  assert.deepEqual(restored.checkpoint().portable.entrances, []);
  restored.dispose();
});

test('closing an entrance aborts its loading preview and retires the late payload', async () => {
  const jobs = [];
  const session = create({ room({ signal }) {
    return new Promise(resolve => jobs.push({ signal, resolve }));
  } });
  session.registerInstance(spec);
  await session.enter('field');
  const entry = open(session);
  const pending = session.prepare(entry.id);
  await Promise.resolve();
  assert.equal(jobs.length, 1);
  assert.equal(session.closeEntrance('visit'), true);
  assert.equal(jobs[0].signal.aborted, true);
  const replacement = open(session, { at: { origin: [10, 1.25, 4] } });
  let releases = 0;
  jobs[0].resolve({ dispose: () => { releases++; } });
  assert.equal(await pending, null);
  assert.equal(releases, 1);
  assert.equal(session.current().id, 'field');
  assert.deepEqual(session.linksFrom('field'), [replacement]);
  assert.equal(session.view(), null);
  session.dispose();
});

test('nested portable visits retain their specific return destinations across reload', async () => {
  const session = create();
  session.registerInstance(spec);
  session.registerInstance({ ...spec, id: 'nested-room' });
  await session.enter('field');
  await cross(session, open(session));
  const inside = { position: [0, 1.25, 2] };
  const nested = open(session, { id: 'inside', place: 'nested-room', at: { origin: inside.position }, pose: inside });
  await cross(session, nested);
  const restored = create();
  await restored.restore(roundTrip(session.checkpoint()));
  assert.deepEqual((await cross(restored, restored.linksFrom('nested-room')[0])).actor.position, inside.position);
  assert.equal(restored.current().id, spec.id);
  assert.deepEqual((await cross(restored, restored.linksFrom(spec.id)[0])).actor.position, returnTo.position);
  assert.equal(restored.current().id, 'field');
  session.dispose();
  restored.dispose();
});

test('a failed restore leaves room registrations and entrances unpublished and can be retried', async () => {
  const session = create();
  session.registerInstance(spec);
  await session.enter('field');
  await cross(session, open(session));
  const saved = roundTrip(session.checkpoint());
  let unavailable = true;
  const restored = create({ room(context) {
    if (unavailable) throw new Error('Workshop unavailable');
    return prepareRoom(context);
  } });
  await assert.rejects(restored.restore(saved), /Workshop unavailable/);
  assert.equal(restored.current(), null);
  assert.equal(restored.place(spec.id), null);
  assert.deepEqual(restored.linksFrom('field'), []);

  const invalid = roundTrip(saved);
  invalid.portable.entrances[0].to.anchor = 'missing';
  await assert.rejects(restored.restore(invalid), /declared place and anchor/);
  unavailable = false;
  assert.equal((await restored.restore(saved)).id, spec.id);
  assert.equal(restored.linksFrom('field').length, 1);
  session.dispose();
  restored.dispose();
});
