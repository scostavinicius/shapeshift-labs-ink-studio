const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const studio = require('..');
const { KIT: { world: W } } = studio.load();
const estate = require('../examples/world-worker-estate.js');
const valley = require('../examples/world-persistent-valley.json');
const estuary = require('../examples/world-aggregate-estuary.json');

function pool(t, size) {
  const workers = studio.createSimulationWorkers(size);
  t.after(() => workers.close());
  return workers;
}

test('one and eight workers publish byte-identical checkpoints with mixed rates and cross-chunk boundaries', t => {
  const source = { ...estate, causality: true };
  const single = pool(t, 1);
  const many = pool(t, 8);
  const runs = [many, single, undefined].map(workerPool => W.runtime.create(source, { workerPool }));
  const [parallel, serialWorker, host] = runs;
  const volume = run => Object.entries(run.checkpoint().outputs)
    .filter(([port]) => port.endsWith('/volume')).reduce((total, [, value]) => total + value, 0);
  const initialVolume = volume(host);
  for (const tick of [1, 2, 4, 8, 13, 21, 28]) {
    for (const run of runs) run.advance(tick);
    const canonical = JSON.stringify(host.checkpoint());
    assert.equal(JSON.stringify(parallel.checkpoint()), canonical, 'eight workers at tick ' + tick);
    assert.equal(JSON.stringify(serialWorker.checkpoint()), canonical, 'one worker at tick ' + tick);
    if (tick === 2) {
      const { outputs } = parallel.checkpoint();
      assert.equal(outputs['pond-0/pump.circulation'], 2);
      assert.equal(outputs['pond-2/pump.circulation'], 0);
    }
    if (tick === 13)
      assert(Object.values(parallel.view().simulationChunks.entries).every(row => row.sleeping));
  }
  assert.equal(parallel.partitions().peakWorkers, 8);
  assert.equal(serialWorker.partitions().peakWorkers, 1);
  assert.deepEqual(Object.keys(parallel.partitions().systems), Object.keys(estate.systems).filter(key => key.startsWith('pond')));
  assert(parallel.history.some(row => row.kind === 'transfer' && row.from === 'pond-0/inlet' && row.applied > 0));
  assert(Math.abs(initialVolume - volume(parallel)) < 1e-9);
  const replay = W.runtime.replay(JSON.parse(JSON.stringify(parallel.recording())), { workerPool: single });
  assert.equal(JSON.stringify(replay.checkpoint()), JSON.stringify(serialWorker.checkpoint()));
});

test('worker effects retain event order, causal provenance, and spatial invalidations', t => {
  const source = {
    ...valley,
    causality: true,
    systems: { ...valley.systems, 'meadow-2': valley.systems.meadow }
  };
  const parallel = W.runtime.create(source, { workerPool: pool(t, 3) });
  const host = W.runtime.create(source);
  let writes = 0;
  for (let i = 1; i <= 12; i++) {
    parallel.step();
    host.step();
    assert.deepEqual(parallel.dependencies(), host.dependencies());
    assert.equal(JSON.stringify(parallel.checkpoint()), JSON.stringify(host.checkpoint()));
    writes += parallel.dependencies().pending.length;
  }
  assert(writes > 0);
  const harvest = parallel.history.filter(event => event.kind === 'recipe-completed');
  assert(harvest.some((event, index) => event.system === 'meadow' &&
    harvest[index + 1]?.system === 'meadow-2' && harvest[index + 1].tick === event.tick));
  assert.equal(parallel.partitions().systems.props, undefined);
});

test('an aggregate solver resumes from a checkpoint made by a different worker count', t => {
  const single = pool(t, 1), many = pool(t, 8);
  const run = W.runtime.create(estuary, { workerPool: single });
  run.advance(21);
  const saved = JSON.parse(JSON.stringify(run.checkpoint()));
  assert.equal(saved.states.lagoon.model, 'blocks');
  const resumed = W.runtime.create(saved.world, { checkpoint: saved, workerPool: many });
  resumed.advance(31);
  run.advance(31);
  const host = W.runtime.create(estuary);
  host.advance(31);
  assert.equal(JSON.stringify(resumed.checkpoint()), JSON.stringify(host.checkpoint()));
  assert.equal(JSON.stringify(run.checkpoint()), JSON.stringify(host.checkpoint()));
  assert.equal(resumed.partitions().peakWorkers, 2);
});

test('pipes, enclosed water and ventilation share a worker phase and keep boundary transfers on the host', t => {
  const yard = require('../examples/world-hydraulic-yard.json');
  const flood = require('../examples/world-cellar-flood.json').systems.flood;
  const air = require('../examples/world-ventilated-shelter.json').systems.air;
  const local = spec => {
    const config = JSON.parse(JSON.stringify(spec.config));
    delete config.windField;
    for (const opening of Object.values(config.openings)) delete opening.gate;
    return { ...spec, config };
  };
  const source = { dt: 0.05, causality: true, systems: {
    river: yard.systems.river, network: yard.systems.network, flood: local(flood), air: local(air)
  } };
  const workers = W.runtime.create(source, { workerPool: pool(t, 4) });
  const host = W.runtime.create(source);
  for (const run of [host, workers]) run.advance(12);
  assert.deepEqual(workers.partitions().systems, { air: 12, flood: 12, network: 12, river: 12 });
  assert.equal(JSON.stringify(workers.checkpoint()), JSON.stringify(host.checkpoint()));
  assert.deepEqual(workers.dependencies(), host.dependencies());
  assert(workers.history.some(row => row.kind === 'transfer' && row.requester === 'network' && row.applied > 0));
});

test('a worker failure leaves the checkpoint and pending commands intact and the pool can run another world', t => {
  const workerPool = pool(t, 2);
  const water = rain => ({ kind: 'water', config: { width: 4, height: 4, rain } });
  const bad = W.runtime.create({
    systems: { a: water(0.2), b: water(10001) },
    commands: [{ tick: 1, action: 'world/event', args: { kind: 'start' } }]
  }, { workerPool });
  const before = bad.checkpoint();
  for (let i = 0; i < 2; i++) {
    assert.throws(() => bad.step(), /Water steps need bounded time/);
    assert.deepEqual(bad.checkpoint(), before);
    assert.equal(bad.partitions().batches, 0);
  }
  const run = W.runtime.create({ systems: { a: water(0.2) } }, { workerPool });
  run.advance(2);
  assert.equal(run.partitions().systems.a, 2);
  assert(run.query().probe('a/mass').value.volume > 0);
});

test('host-installed factories run on workers with the same seeded randomness and live inputs', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-worker-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const moduleFile = path.join(directory, 'factory.cjs');
  fs.writeFileSync(moduleFile, `
    module.exports = {accumulator: config => ({
      partitionStep: true, combinational: true,
      inputs: {add: 'number'}, outputs: {value: 'number'},
      initial: () => 0,
      step(state, ctx) {
        if (config.bad) return ctx.states.accumulator;
        return state + ctx.input.add + ctx.random('pulse');
      },
      output: state => ({value: state})
    })};
  `);
  const workerPool = studio.createSimulationWorkers(8, { modules: [moduleFile] });
  t.after(() => workerPool.close());
  const systems = {
    first: { kind: 'accumulator' },
    second: { kind: 'accumulator', schedule: { substeps: 2 } }
  };
  const source = { seed: 42, systems, connections: [{ from: 'first/value', to: 'second/add' }] };
  const host = W.runtime.create(source, { implementations: workerPool.implementations });
  const workers = W.runtime.create(source, { workerPool });
  host.advance(10);
  workers.advance(10);
  assert.equal(JSON.stringify(host.checkpoint()), JSON.stringify(workers.checkpoint()));
  assert.deepEqual(workers.partitions().systems, { first: 10, second: 20 });
  const bad = W.runtime.create({ systems: { bad: { kind: 'accumulator', config: { bad: true } } } }, { workerPool });
  const saved = bad.checkpoint();
  assert.throws(() => bad.step(), /declared boundary inputs/);
  assert.deepEqual(bad.checkpoint(), saved);
});
