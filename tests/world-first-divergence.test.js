const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { KIT: { world: W } } = studio.load();
const estate = require('../examples/world-worker-estate.js');
const copy = value => JSON.parse(JSON.stringify(value));
const R = W.runtime;

const canal = { format: 'ink-studio/world', id: 'diagnostic-canal', dt: 0.05, systems: {
  canal: { kind: 'water', config: { width: 12, height: 6, cell: 0.5,
    initial: [{ bounds: { min: [0, 0], max: [3, 3] }, value: 0.7 }],
    gates: { sluice: { bounds: { min: [2.99, 0], max: [3.01, 3] }, axis: 0, opening: 0 } }
  } }
} };
const gate = (tick, opening) => ({ tick, action: 'canal/gate', args: { gate: 'sluice', opening } });
const dynamic = {
  id: 'substeps', dt: 0.2,
  systems: { knob: { kind: 'control', config: { op: 'pass' } },
    meter: { kind: 'test-meter', schedule: { substeps: 2 } } },
  commands: [{ tick: 1, action: 'world/input', args: { port: 'knob/value', value: 5 } }],
  connections: [{ from: 'knob/value', to: 'meter/load' }]
};
function implementations(perturb = false, crash = false) {
  return { 'test-meter': () => ({
    inputs: { load: 'number' }, outputs: { reading: 'number' },
    initial: () => ({ reading: 0 }),
    output: state => ({ reading: state.reading }),
    step(state, ctx) {
      if (crash && ctx.tick === 3 && ctx.substep === 1) throw Error('meter refused the sample');
      return { reading: ctx.input.load + (perturb && ctx.tick === 3 && ctx.substep === 1 ? 2 : 0) };
    }
  }) };
}
function record(world, options, at, actions = []) {
  const run = R.create(world, options);
  run.schedule(actions);
  run.advance(at);
  return copy(run.recording());
}

test('finds an applied action at its tick and reports the affected solver and fields', () => {
  const left = record(canal, {}, 8), right = record(canal, {}, 8, [gate(5, 1)]);
  const report = R.firstDivergence(left, right);
  assert.equal(report.status, 'diverged');
  assert.deepEqual(report.sources, { left: 'replayed', right: 'replayed' });
  assert.equal(report.first.tick, 5);
  assert.equal(report.first.kind, 'actions');
  assert.equal(report.first.system, 'canal');
  assert.deepEqual(report.first.actions.right, gate(5, 1));
  assert.deepEqual(report.first.inputs.right, { 'gate.sluice': 0 });
  assert(report.first.changes.some(row => row.path.join('/') === 'outputs/canal/gate.sluice' && row.right === 1));
  assert.equal(R.firstDivergence(left, right, { to: 4 }).status, 'equal');
});

test('recorded step evidence catches a transient substep regression with identical endpoints', () => {
  const left = record(dynamic, { implementations: implementations(), traceSteps: 12 }, 6);
  const right = record(dynamic, { implementations: implementations(true), traceSteps: 12 }, 6);
  assert(W.data.equal(left.end, right.end));
  const report = R.firstDivergence(left, right);
  assert.deepEqual(report.sources, { left: 'recorded-steps', right: 'recorded-steps' });
  assert.equal(report.first.tick, 3);
  assert.equal(report.first.kind, 'state');
  assert.equal(report.first.system, 'meter');
  assert.deepEqual(report.first.inputs, { left: { load: 5 }, right: { load: 5 } });
  assert.equal(report.first.phase.right.fraction, 0.5);
  assert.deepEqual(report.first.changes.find(row => row.path.join('/') === 'state/reading'),
    { path: ['state', 'reading'], left: 5, right: 7 });
  const replay = R.firstDivergence(right, undefined, { rightOptions: { implementations: implementations() } });
  assert.equal(replay.first.tick, 3);
  assert.equal(replay.sources.right, 'replayed');
});

test('reports coverage for retained tails and legacy endpoint-only evidence', () => {
  const trace = record(dynamic, { implementations: implementations(true), traceSteps: 2 }, 6);
  const tail = R.firstDivergence(trace, undefined, { rightOptions: { implementations: implementations() } });
  assert.deepEqual(tail.coverage, { from: 5, to: 6, mode: 'continuous', startsAtCommonOrigin: false });
  assert.equal(tail.status, 'equal');
  const legacy = record(dynamic, { implementations: implementations() }, 6);
  const old = R.firstDivergence(legacy, undefined, { rightOptions: { implementations: implementations(true) } });
  assert.equal(old.status, 'equal');
  assert.equal(old.coverage.mode, 'checkpoints');
  assert.equal(old.comparedTicks, 2);
  const drift = copy(legacy);
  drift.end.states.meter.reading = 42;
  const mismatch = R.firstDivergence(drift, undefined, { rightOptions: { implementations: implementations() } });
  assert.equal(mismatch.first.system, 'meter');
  assert.equal(mismatch.first.tick, 6);
  assert.equal(mismatch.coverage.mode, 'checkpoints');
});

test('reports the failing solver and its sampled inputs without committing a failed tick', () => {
  const run = R.create(dynamic, { implementations: implementations(false, true), traceSteps: 6 });
  run.advance(2);
  const before = run.stepFrame();
  assert.throws(() => run.step(), /refused the sample/);
  assert.equal(run.stepFrame(), before);
  assert.equal(run.recording().trace.frames.at(-1).tick, 2);
  const report = R.firstDivergence(dynamic, dynamic, {
    to: 6, leftOptions: { implementations: implementations() }, rightOptions: { implementations: implementations(false, true) }
  });
  assert.equal(report.first.tick, 3);
  assert.equal(report.first.system, 'meter');
  assert.equal(report.first.kind, 'failure');
  assert.deepEqual(report.first.failures.right.inputs, { load: 5 });
});

test('identifies the substep that emitted a different effect even when solver state is equal', () => {
  const revision = enabled => {
    const values = implementations(), factory = values['test-meter'];
    values['test-meter'] = () => {
      const meter = factory();
      return { ...meter, step(state, ctx) {
        if (enabled && ctx.tick === 3 && ctx.substep === 1) ctx.emit('sample-warning', { load: ctx.input.load });
        return meter.step(state, ctx);
      } };
    };
    return values;
  };
  const report = R.firstDivergence(dynamic, dynamic, {
    to: 5, leftOptions: { implementations: revision(false) }, rightOptions: { implementations: revision(true) }
  });
  assert.equal(report.first.kind, 'effects');
  assert.equal(report.first.system, 'meter');
  assert.equal(report.first.phase.right.substep, 1);
  assert.equal(report.first.changes.find(row => row.path[0] === 'events').right[0].kind, 'sample-warning');
});

test('compares a resumed branch at its checkpoint tick without treating unknown earlier steps as missing', () => {
  const starting = R.create(canal, { traceSteps: 8 });
  starting.schedule([gate(2, 1)]);
  starting.advance(2);
  const continuation = starting.fork();
  starting.advance(5);
  continuation.advance(5);
  assert.equal(R.firstDivergence(copy(starting.recording()), copy(continuation.recording())).status, 'equal');
});

test('matched worker runs use the same phase trace with one and eight worker threads', t => {
  const one = studio.createSimulationWorkers(1), eight = studio.createSimulationWorkers(8);
  t.after(() => { one.close(); eight.close(); });
  const report = R.firstDivergence(estate, estate, { to: 8, leftOptions: { workerPool: one }, rightOptions: { workerPool: eight } });
  assert.equal(report.status, 'equal');
  assert.equal(report.comparedTicks, 9);
});

test('CLI reads stored traces, can verify a replay, and keeps matched-checkpoint diff', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-divergence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const invoke = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'sim', ...args, '--json'], { cwd: dir, encoding: 'utf8' }));
  fs.writeFileSync(path.join(dir, 'canal.json'), JSON.stringify(canal));
  fs.writeFileSync(path.join(dir, 'actions.json'), JSON.stringify([gate(4, 1)]));
  invoke('run', 'canal.json', '--ticks', '6', '--record', 'hold.json', '--trace-steps', '--checkpoint-store', 'blocks');
  invoke('run', 'canal.json', '--ticks', '6', '--record', 'open.json', '--trace-steps', '12', '--actions', 'actions.json');
  const report = invoke('diff', 'hold.json', 'open.json', '--first', '--limit', '5');
  assert.equal(report.first.tick, 4);
  assert.equal(report.first.system, 'canal');
  assert(report.first.changes.length <= 5);
  assert.equal(invoke('diff', 'open.json', '--first', '--right-workers', '1').status, 'equal');
  assert.equal(invoke('diff', 'hold.json', 'open.json').tick, 6);
});
