const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT: { world: W } } = require('..').load();
const example = require('../examples/world-region-revisions.json');
const estuary = require('../examples/world-aggregate-estuary.json');
const west = { regions: ['west'] }, east = { regions: ['east'] };
const open = (world = example, params = {}, runtime = {}) =>
  W.runtime.create(world, { ...runtime, regionRevisions: { stream: 'test-reaches', ...params } });
const portable = value => JSON.parse(JSON.stringify(value));

test('nearby state contains just selected systems and entities, including place identity', () => {
  const run = open(), source = run.regions;
  const first = source.pull({ at: [2, 0, 2], radius: 0 });
  assert.deepEqual(first.cursor.regions, ['west']);
  assert.deepEqual(Object.keys(first.state.regions.west.entities), ['cart', 'western-marker']);
  assert.deepEqual(Object.keys(first.state.regions.west.systems), ['west-signal', 'west-tank']);
  assert.deepEqual(source.select({ at: [2, 0, 2], radius: 7 }), ['east', 'west']);
  assert.deepEqual(source.select({ at: [2, 0, 2], place: 'annex' }), ['annex']);
  const global = source.pull({ regions: [], includeGlobal: true }).state.regions['@global'];
  assert.deepEqual(Object.keys(global.entities), ['distant-marker']);
  assert.deepEqual(Object.keys(global.systems), ['global-signal']);
  assert.equal(W.runtime.create(example).regions, undefined);
});

test('changes against the applied baseline carry ordered local actions and remove moved or deleted entities', () => {
  const run = open(), source = run.regions, mirror = W.regionRevisions.receiver();
  const start = source.pull(west);
  mirror.apply(portable(start));
  run.advance(4);
  const update = source.pull(west, { since: start.cursor });
  assert.equal(update.type, 'delta');
  assert.equal(update.actionsComplete, true);
  assert.deepEqual(update.actions.map(row => row.tick), [1, 2, 3, 4]);
  assert.equal(update.actions[0].args.port, 'west-signal/value');
  assert.deepEqual(update.actions[1].args.edits.map(edit => edit.path), ['/entities/cart/position']);
  assert(update.edits.some(row => row.op === 'remove' && row.path.at(-1) === 'cart'));
  assert(update.edits.some(row => row.op === 'remove' && row.path.at(-1) === 'western-marker'));
  assert.equal(mirror.apply(portable(update)).status, 'applied');
  assert.deepEqual(mirror.snapshot().state, source.pull(west).state);
  assert.equal(mirror.apply(update).status, 'duplicate');
  const switchScope = source.pull(east, { since: update.cursor });
  assert.equal(switchScope.type, 'delta');
  assert.equal(mirror.apply(portable(switchScope)).status, 'applied');
  assert.deepEqual(Object.keys(mirror.snapshot().state.regions), ['east']);
  assert.deepEqual(mirror.snapshot().state.regions.east.entities.cart.position, [9, 0, 2]);
  assert.deepEqual(mirror.snapshot().state, source.pull(east).state);
});

test('solver-owned poses cross regions while the solver state stays with its authored owner', () => {
  const scene = {
    ...example, commands: [],
    systems: { ...example.systems, rig: { kind: 'mechanics', config: {
      gravity: [0, 0, 0], bodies: { crate: { position: [7.8, 1, 2], velocity: [10, 0, 0], half: [0.1, 0.1, 0.1] } }
    } } },
    simulationChunks: { ...example.simulationChunks, chunks: { ...example.simulationChunks.chunks,
      west: { ...example.simulationChunks.chunks.west, systems: ['west-tank', 'west-signal', 'rig'] }
    } }
  };
  const run = open(scene), source = run.regions;
  assert.deepEqual(source.pull(west).state.regions.west.entities.crate, { entity: null, position: [7.8, 1, 2] });
  run.step();
  assert.equal(source.pull(west).state.regions.west.entities.crate, undefined);
  assert(source.pull(west).state.regions.west.systems.rig.state.bodies.crate.position[0] > 8);
  assert(source.pull(east).state.regions.east.entities.crate.position[0] > 8);
  assert.equal(source.pull(east).state.regions.east.systems.rig, undefined);
});

test('missing and foreign baselines require a snapshot and a full region replaces departed membership', () => {
  const run = open(example, { retain: 2 }), source = run.regions, mirror = W.regionRevisions.receiver();
  const start = source.pull(west);
  mirror.apply(start);
  run.advance(1);
  const second = source.pull(west, { since: start.cursor });
  run.advance(2);
  const third = source.pull(west, { since: second.cursor });
  assert.equal(mirror.apply(third).status, 'needs-snapshot');
  assert.equal(mirror.apply(second).status, 'applied');
  assert.equal(mirror.apply(third).status, 'applied');
  assert.equal(mirror.apply(second).status, 'stale');
  run.advance(4);
  const obsolete = source.pull(east, { since: start.cursor });
  assert.equal(mirror.apply(obsolete).status, 'needs-snapshot');
  const recovered = source.pull(east, { since: third.cursor });
  assert.equal(recovered.type, 'snapshot');
  assert.equal(recovered.reason, 'history-gap');
  assert.equal(recovered.actionsComplete, false);
  assert.equal(mirror.apply(recovered).status, 'applied');
  assert.deepEqual(mirror.snapshot().state, source.pull(east).state);
  assert.equal(source.status().oldestRevision, 3);
  const other = open(example, { stream: 'other-run' }).regions.pull(west);
  assert.equal(mirror.apply(other).status, 'stream-mismatch');
  assert.equal(source.pull(west, { since: other.cursor }).reason, 'stream-mismatch');
  assert.equal(run.fork().regions, undefined);
});

test('bounded edits and action batches recover independently and invalid deltas are atomic', () => {
  const run = open(example, { maxEdits: 1, maxActions: 1 }), source = run.regions;
  const start = source.pull(west), mirror = W.regionRevisions.receiver();
  mirror.apply(start);
  const broken = { format: W.regionRevisions.format, version: 1, type: 'delta', base: start.cursor,
    cursor: { ...start.cursor, revision: 1 }, actions: [], actionsComplete: true,
    edits: [{ op: 'remove', path: ['regions', 'west', 'id'] }] };
  assert.throws(() => mirror.apply(broken), /membership/);
  assert.deepEqual(mirror.snapshot().state, start.state);
  run.advance(4);
  const update = source.pull(west, { since: start.cursor });
  assert.equal(update.type, 'snapshot');
  assert.equal(update.reason, 'edit-budget');
  assert.equal(update.actionsComplete, false);
  assert.deepEqual(update.actions, []);
  assert.equal(mirror.apply(update).status, 'applied');
  assert.deepEqual(mirror.snapshot().state, source.pull(west).state);
});

test('failed ticks publish no revision and dormant aggregate solver state is kept compact', () => {
  const broken = open({ systems: { pond: { kind: 'water', config: { width: 4, height: 4, rain: 10001 } } } });
  const selection = { regions: ['@global'] }, first = broken.regions.pull(selection);
  assert.throws(() => broken.step(), /Water steps need bounded time/);
  assert.deepEqual(broken.regions.pull(selection), first);
  const run = open(estuary);
  run.advance(21);
  const lagoon = run.regions.pull({ regions: ['estuary'] }).state.regions.estuary;
  assert.equal(lagoon.sleeping, true);
  assert.equal(lagoon.systems.lagoon.state.model, 'blocks');
  assert.equal(lagoon.systems.lagoon.state.data.fluid.depth.length, 24);
});

test('CLI produces and applies separate JSON region updates', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-regions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const scene = path.resolve(__dirname, '../examples/world-region-revisions.json');
  const invoke = (...args) => execFileSync(process.execPath, [cli, 'sim', ...args, '--json'], { cwd: dir, encoding: 'utf8' });
  invoke('regions', scene, '--stream', 'cli-reaches', '--near', '2,0,2', '--ticks', '0', '--out', 'snapshot.json');
  invoke('regions', scene, '--stream', 'cli-reaches', '--regions', 'west', '--ticks', '4', '--since', 'snapshot.json', '--out', 'delta.json');
  const state = JSON.parse(invoke('regions-apply', 'snapshot.json', 'delta.json'));
  const expected = JSON.parse(invoke('regions', scene, '--stream', 'cli-reaches', '--regions', 'west', '--ticks', '4'));
  assert.deepEqual(state.state, expected.state);
  assert.equal(state.cursor.revision, 4);
  invoke('run', scene, '--ticks', '4', '--record', 'timeline.json');
  const replayed = JSON.parse(invoke('regions', 'timeline.json', '--stream', 'cli-reaches', '--regions', 'west',
    '--since', 'snapshot.json'));
  assert.deepEqual(replayed, JSON.parse(fs.readFileSync(path.join(dir, 'delta.json'), 'utf8')));
});
