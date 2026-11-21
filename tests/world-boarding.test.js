const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const cartExample = require('../examples/boarding-traversal.js');

const up = [0, 1, 0];
const pose = (position, yaw = 0) => ({ position, yaw });
const start = pose([0, 0.4, 0]);
const rider = { id: 'rider', radius: 0.2, height: 1.6, position: [1.25, 0.8, 0] };
const seat = { at: [0, 1.2, 0], exits: [[1.25, -0.4, 0], [-1.25, -0.4, 0]], maxHeight: 1.9 };
const cart = { collider: { kind: 'box', half: [0.55, 0.4, 0.8] }, seats: { front: seat } };
const floor = { id: 'floor', position: [0, -0.5, 0], half: [32, 0.5, 12] };
const flat = (x, z, low, high) => low <= 0 && high >= 0 ? [{ y: 0, normal: up, id: 'ground' }] : [];
const world = (...solids) => ({ solids: [floor, ...solids], supports: flat });
const make = (carriers = { cart }) => KIT.world.boarding.create({ carriers });
const board = (run, space = world(), actor = rider) => run.board({
  carrier: 'cart', seat: 'front', actor, pose: start, world: space
});
const move = (run, to, space) => run.move({ carrier: 'cart', from: start, to, world: space });
const dismount = (run, space) => run.dismount({ rider: 'rider', pose: start, world: space });

test('board checks reach, body size and actual approach before claiming seats', () => {
  const run = make();
  assert.equal(board(run, world(), { ...rider, position: [10, .8, 0] }).reason, 'out-of-reach');
  assert.equal(board(run, world(), { ...rider, height: 2 }).reason, 'body-size');
  const barrier = { id: 'barrier', position: [0.9, 1.3, 0], half: [0.04, 1.3, 1] };
  assert.equal(board(run, world(barrier)).reason, 'boarding-obstructed');
  assert.deepEqual(run.checkpoint().riders, []);
  const result = board(run);
  assert.equal(result.status, 'boarded');
  assert.deepEqual(result.pose.position, [0, 1.6, 0]);
  assert.equal(board(run).reason, 'already-boarded');
  assert.equal(board(run, world(), { ...rider, id: 'other' }).reason, 'occupied');
});

test('the occupied compound catches thin overhead obstacles between two clear poses', () => {
  const beam = { id: 'beam', position: [0, 2.32, 2], half: [1, 0.12, 0.03] };
  const run = make(), end = pose([0, 0.4, 4]);
  assert.equal(move(run, end, world(beam)).status, 'ready');
  board(run);
  const blocked = move(run, end, world(beam));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.obstacle.solid, 'beam');
  assert.equal(blocked.obstacle.rider, 'rider');
  assert(blocked.obstacle.fraction > 0 && blocked.obstacle.fraction < 1);
  assert.deepEqual(blocked.pose, start);
  assert.deepEqual(blocked.occupants[0].pose.position, [0, 1.6, 0]);
  const accepted = move(run, end, world());
  assert.deepEqual(accepted.occupants[0].pose.position, [0, 1.6, 4]);
  assert.equal(run.body('cart', accepted.pose).collider.kind, 'compound');
});

test('turning checks the arc of an off-center passenger and carries the seat pose', () => {
  const craft = { collider: { kind: 'box', half: [.5, .4, 1.6] }, seats: {
    rear: { ...seat, at: [0, 1.2, 1.4] }
  } };
  const run = make({ cart: craft });
  const boarded = run.board({ carrier: 'cart', seat: 'rear', actor: { ...rider, position: [1.25, .8, 1.4] },
    pose: start, world: world() });
  assert.equal(boarded.status, 'boarded');
  const post = { id: 'overhead-post', position: [1, 2, 1], half: [.035, .1, .035] };
  const turned = pose(start.position, Math.PI / 2);
  const blocked = move(run, turned, world(post));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.obstacle.rider, 'rider');
  const moved = move(run, turned, world());
  assert.equal(moved.status, 'ready');
  assert(KIT.V.dist(moved.occupants[0].pose.position, [1.4, 1.6, 0]) < 1e-8);
  assert(KIT.V.dist(moved.occupants[0].pose.forward, [-1, 0, 0]) < 1e-8);
});

test('dismount tries reachable supported exits and retains the rider if none qualify', () => {
  const run = make();
  board(run);
  assert.equal(dismount(run, { solids: [], supports: () => [] }).reason, 'no-safe-exit');
  assert.equal(dismount(run, { ...world(), allowSupport: () => false }).reason, 'no-safe-exit');
  const wall = { id: 'wall', position: [0.9, 1.2, 0], half: [0.04, 1.2, 1] };
  const result = dismount(run, world(wall));
  assert.equal(result.status, 'dismounted');
  assert.deepEqual(result.pose.position, [-1.25, .8, 0]);
  assert.equal(result.support.support, 'ground');
  assert.equal(result.pose.mode, 'ground');
  assert.deepEqual(run.poses('cart', start), []);
  assert.equal(board(run).status, 'boarded');
});

test('restoring multiple occupied seats is detached and rejects conflicting claims atomically', () => {
  const ferry = { collider: { kind: 'box', half: [0.55, .4, 1.15] }, seats: {
    first: { ...seat, at: [0, 1.2, -.65] }, second: { ...seat, at: [0, 1.2, .65] }
  } };
  const run = make({ ferry });
  for (const [key, z] of [['first', -.65], ['second', .65]]) {
    const result = run.board({ carrier: 'ferry', seat: key, actor: { ...rider, id: key, position: [1.25, .8, z] },
      pose: start, world: world() });
    assert.equal(result.status, 'boarded');
  }
  const saved = JSON.parse(JSON.stringify(run.checkpoint())), restored = make({ ferry });
  restored.restore(saved);
  assert.deepEqual(restored.poses('ferry', start), run.poses('ferry', start));
  saved.riders[1].seat = 'first';
  assert.throws(() => restored.restore(saved), /competing/);
  assert.deepEqual(restored.checkpoint(), run.checkpoint());
  assert.equal(restored.body('ferry', start).collider.parts.length, 3);
  assert.equal(restored.release('first'), true);
  assert.equal(restored.release('first'), false);
  assert.deepEqual(restored.poses('ferry', start).map(row => row.rider), ['second']);
});

test('agents compare reachable walking legs with ride, wait and transfer times', () => {
  const run = make(), from = [...rider.position], to = [21, .8, 0];
  const offer = { id: 'service', carrier: 'cart', seat: 'front', boardAt: [2, .8, 0], leaveAt: [19, .8, 0],
    rideSeconds: 4, waitSeconds: 1, boardSeconds: .5, leaveSeconds: .5 };
  const denied = { ...offer, id: 'delayed', waitSeconds: 30 };
  const walk = (start, end) => ({ status: 'ok', points: [start, end] });
  const plan = (offers, walker = walk) => run.plan({ actor: rider, to, walkSpeed: 1, walk: walker, offers });
  const result = plan([denied, offer]);
  assert.equal(result.choice.id, 'service');
  assert.equal(result.choice.seconds, 8.75);
  assert.deepEqual(result.choice.approach.points, [from, offer.boardAt]);
  assert.equal(plan([denied]).choice.type, 'walk');
  assert.deepEqual(plan([offer], (a, b) => b[0] === 2 ? { status: 'blocked' } : walk(a, b)).rejected,
    [{ id: 'service', reason: 'approach-unreachable' }]);
  assert.equal(plan([{ ...offer, rideSeconds: null }]).rejected[0].reason, 'ride-unreachable');
  assert.equal(plan([offer], (a, b) => a[0] === from[0] && b[0] === to[0] ? { status: 'blocked' } : walk(a, b)).choice.type, 'board');
  board(run, world(), { ...rider, id: 'other' });
  assert.equal(plan([offer]).rejected[0].reason, 'occupied');
});

test('the example composes sampled mechanics, navigation and independent actor state', () => {
  assert.deepEqual(cartExample(), {
    route: 'board', obstacle: 'beam', affectedRider: 'carpenter',
    dismount: [1.25, .8, 18], inventory: ['chisel']
  });
});
