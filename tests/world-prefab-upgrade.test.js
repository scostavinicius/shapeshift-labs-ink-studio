const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const studio = require('..');
const kit = studio.load(), W = kit.KIT.world, R = W.runtime;
const scene = () => require('../examples/world-prefab-upgrade.js')(kit);
const migration = require('../examples/world-prefab-upgrade.migration.json');
const clone = value => JSON.parse(JSON.stringify(value));
const upgrade = (source, extras = {}) => W.upgradePrefab(source, 'lock', 'sluice.v2', { migration, ...extras });

test('rebuilds a placed revision and keeps overrides, parameters, sockets and typed boundary wires', () => {
  const source = scene();
  const edited = W.apply(source, [{ op: 'set', path: '/entities/lock/position', value: [3, 0, 2] },
    { op: 'set', path: '/entities/lock.panel/paint', value: 'green' }]).world;
  const { world, report } = upgrade(edited);
  assert.equal(report.ok, true, JSON.stringify(report.issues));
  assert.equal(world.entities.lock.revision, 2);
  assert.deepEqual(world.entities.lock.position, [3, 0, 2]);
  assert.equal(world.entities['lock.panel'].width, 2.4);
  assert.equal(world.entities['lock.panel'].thickness, 0.2);
  assert.equal(world.entities['lock.panel'].finish, 'green');
  assert.equal(world.entities['lock.panel'].paint, undefined);
  assert.deepEqual(world.entities.plaque.anchor, { entity: 'lock.housing', socket: 'lug' });
  assert.deepEqual(world.entities.rope.anchor, { entity: 'lock', socket: 'mount' });
  assert.deepEqual(world.connections, [{ from: 'enable/value', to: 'lock/run' },
    { from: 'lock/progress', to: 'display/value', delay: 2 }]);
  assert(report.connections.every(row => row.status === 'remapped'));
  assert.deepEqual(world.simulationChunks.focus.operator.at, { entity: 'lock', socket: 'mount' });
  assert.deepEqual(R.create(world).query().target({ entity: 'plaque' }).point, [3, 1.35, 2]);
  assert.equal(source.entities['lock.panel'].paint, 'bronze');
});

test('dry-run identifies missing mappings and occupied IDs and leaves source untouched', () => {
  const source = scene(), before = JSON.stringify(source);
  const incomplete = clone(migration);
  delete incomplete.sockets['frame/top'];
  delete incomplete.ports.arm;
  delete incomplete.overridePaths;
  const result = upgrade(source, { migration: incomplete });
  assert.equal(result.report.ok, false);
  assert.equal(result.world, undefined);
  for (const kind of ['connection', 'override', 'attachment'])
    assert(result.report.issues.some(row => row.kind === kind), JSON.stringify(result.report.issues));
  assert.equal(JSON.stringify(source), before);
  const collided = W.apply(source, [{ op: 'set', path: '/entities/lock.housing', value: { position: [0, 0, 0] } }]).world;
  const blocked = upgrade(collided);
  assert(blocked.report.issues.some(row => row.kind === 'ownership' && row.name === 'lock.housing'));
});

test('migrates a live timer, water gate, pending action, chunk clocks and buffered signal at the saved tick', () => {
  const run = R.create(scene());
  run.advance(4);
  const past = run.checkpoint();
  const result = upgrade(past.world, { checkpoint: past });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.issues));
  const saved = result.checkpoint;
  assert.equal(saved.tick, 4);
  assert.deepEqual(saved.states['lock.counter'], past.states['lock.clock']);
  assert.equal(saved.states['lock.basin'].gate.door, 0.35);
  assert.equal(saved.states['lock.basin'].manual['gate.door'], 0.35);
  assert.deepEqual(saved.states['lock.basin'].fluid, past.states['lock.pool'].fluid);
  assert.deepEqual(saved.delays['display/value'], past.delays['display/value']);
  assert.deepEqual(saved.simulationChunks.clocks['lock.basin'], past.simulationChunks.clocks['lock.pool']);
  assert.deepEqual(saved.causality.nodes, past.causality.nodes);
  assert.deepEqual(saved.pending, [{ tick: 8, action: 'lock.basin/gate', args: { gate: 'door', opening: 0.85 } }]);
  const resumed = R.create(saved.world, { checkpoint: clone(saved) });
  resumed.advance(9);
  assert.equal(resumed.view().states['lock.basin'].gate.door, 0.85);
  assert(resumed.view().states['lock.counter'].value > saved.states['lock.counter'].value);
  assert(W.data.equal(R.replay(clone(resumed.recording())).checkpoint(), resumed.checkpoint()));
});

test('rejects incompatible saved controls and permits an explicit state reset', () => {
  const run = R.create(scene());
  run.advance(4);
  const checkpoint = run.checkpoint(), incomplete = clone(migration);
  delete incomplete.state;
  const rejected = upgrade(checkpoint.world, { checkpoint, migration: incomplete });
  assert(rejected.report.issues.some(row => row.kind === 'state' && /water controls/.test(row.reason)));
  assert.equal(rejected.checkpoint, undefined);
  incomplete.state = { pool: { mode: 'reset' } };
  const reset = upgrade(checkpoint.world, { checkpoint, migration: incomplete });
  assert.equal(reset.report.ok, true, JSON.stringify(reset.report.issues));
  assert.equal(reset.checkpoint.states['lock.basin'].fluid.time, 0);
  assert(reset.report.state.some(row => row.from === 'lock.pool' && row.status === 'reset'));
});

test('upgrades older stamps using the original definition and an explicit mapping for a baked parameter', () => {
  const legacy = clone(scene());
  delete legacy.entities.lock.prefabStamp;
  const map = clone(migration);
  map.overridePaths['/entities/panel/span'] = '/entities/panel/width';
  const result = upgrade(legacy, { migration: map });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.issues));
  assert.equal(result.world.entities['lock.panel'].width, 2.4);
  assert.equal(result.world.entities['lock.panel'].finish, 'bronze');
});

test('CLI dry run reports repairs and valid upgrades can resume from a new checkpoint', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-prefab-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.resolve(__dirname, '..'), cli = path.join(repo, 'cli/ink-studio.js');
  const scene = path.join(repo, 'examples/world-prefab-upgrade.js');
  const mappings = path.join(repo, 'examples/world-prefab-upgrade.migration.json');
  const invoke = (...args) => {
    const text = execFileSync(process.execPath, [cli, ...args, '--json'], { cwd: dir, encoding: 'utf8' });
    return text ? JSON.parse(text) : undefined;
  };
  invoke('sim', 'run', scene, '--ticks', '4', '--checkpoint', 'before.json', '--checkpoint-store', './blocks');
  const report = invoke('scene', 'upgrade', 'before.json', 'lock', '--to', 'sluice.v2', '--migration', mappings, '--dry-run');
  assert.equal(report.ok, true);
  const blocked = spawnSync(process.execPath, [cli, 'scene', 'upgrade', 'before.json', 'lock', '--to', 'sluice.v2',
    '--out', 'blocked.json', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).ok, false);
  assert.equal(fs.existsSync(path.join(dir, 'blocked.json')), false);
  invoke('scene', 'upgrade', 'before.json', 'lock', '--to', 'sluice.v2', '--migration', mappings, '--out', 'after.json');
  const resumed = invoke('sim', 'resume', 'after.json', '--ticks', '9');
  assert.equal(resumed.tick, 9);
  assert(resumed.systems.includes('lock.basin'));
});
