const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { KIT: { world: W } } = studio.load();
const newScene = require('../examples/world-checkpoint-branch.js');
const estate = require('../examples/world-worker-estate.js');
const estuary = require('../examples/world-aggregate-estuary.json');
const roundTrip = value => JSON.parse(JSON.stringify(value));
const gate = (tick, opening) => ({ tick, action: 'canal/gate', args: { gate: 'sluice', opening } });

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-checkpoints-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  return dir;
}

test('live checkpoint forks share unchanged state and isolate commands, entity edits and gate flow', () => {
  const run = W.runtime.create(newScene);
  const saved = run.checkpoint();
  assert.equal(run.checkpoint(), saved);
  const hold = run.fork(), open = run.fork(), isolated = run.fork();
  assert.equal(hold.checkpoint(), saved);
  assert.equal(open.recording().origin, saved);
  open.schedule([gate(1, 1)]);
  assert.notEqual(open.checkpoint(), saved);
  assert.equal(open.checkpoint().states, saved.states);
  assert.equal(hold.checkpoint(), saved);
  assert.equal(run.checkpoint().pending.length, 0);
  isolated.schedule([{ tick: 1, action: 'world/patch', args: {
    edits: [{ op: 'set', path: '/entities/plot-0/position', value: [0, 1, 0] }]
  } }]);
  isolated.step();
  assert.notEqual(isolated.view().world.entities['plot-0'], saved.world.entities['plot-0']);
  assert.equal(isolated.view().world.entities['plot-1'], saved.world.entities['plot-1']);
  assert.equal(isolated.fork().checkpoint().states, isolated.checkpoint().states);
  hold.advance(3);
  open.advance(3);
  assert.equal(hold.checkpoint().states.canal.fluid.bed, saved.states.canal.fluid.bed);
  assert.equal(open.checkpoint().states.canal.fluid.bed, saved.states.canal.fluid.bed);
  assert.equal(open.view().world.entities, saved.world.entities);
  assert(open.view().signals['canal/depth.outlet'] > hold.view().signals['canal/depth.outlet']);
  assert.equal(open.reset().checkpoint(), saved);
  const corrupt = roundTrip(saved);
  corrupt.states.canal.fluid.depth[0] = -1;
  assert.throws(() => W.runtime.create(corrupt.world, { checkpoint: corrupt }), /Invalid shallow-water checkpoint/);
  open.schedule([{ tick: 4, action: 'canal/bed', args: {
    bounds: { min: [0, 0], max: [1, 1] }, height: 0.28
  } }]);
  open.step();
  assert.notEqual(open.checkpoint().states.canal.fluid.bed, saved.states.canal.fluid.bed);
  assert.equal(hold.checkpoint().states.canal.fluid.bed[0], saved.states.canal.fluid.bed[0]);
});

test('one numeric edit and one entity edit write only their changed blocks and the new root', t => {
  const store = studio.openCheckpointStore(directory(t));
  const initial = W.runtime.create(newScene).checkpoint();
  const base = store.save(initial);
  assert(base.writtenBlocks > 40);
  const next = structuredClone(initial);
  next.states.canal.fluid.bed[1025] = 0.2;
  next.states.canal.fluid.mx[0] = -0;
  next.world.entities['plot-51'].position[1] = -0;
  next.world.entities['plot-52'].position[1] = 0.25;
  const altered = store.save(next);
  assert.equal(altered.writtenBlocks, 5);
  assert(altered.reusedBlocks > 35);
  assert(altered.writtenBytes < base.writtenBytes / 5);
  assert.deepEqual(store.load(altered.reference), next);
  assert.deepEqual(Object.keys(store.load(altered.reference).world.entities), Object.keys(next.world.entities));
  assert.equal(store.save(next).writtenBlocks, 0);
  assert.deepEqual(store.load(base.reference), initial);
  const log = store.save({ format: 'ink-studio/run', version: 1, commands: [], origin: initial, end: next });
  assert.equal(log.writtenBlocks, 1);
  const loaded = store.load(log.reference);
  assert.equal(loaded.origin.states.canal.fluid.depth, loaded.end.states.canal.fluid.depth);
  assert.equal(loaded.origin.world.entities['plot-1'], loaded.end.world.entities['plot-1']);
  assert(Object.isFrozen(loaded.end.world.entities['plot-51']));
});

test('checkpoint references reject altered blocks and missing blocks', t => {
  const directoryPath = directory(t);
  const store = studio.openCheckpointStore(directoryPath);
  const { reference } = store.save(W.runtime.create({ systems: {} }).checkpoint());
  const file = path.join(directoryPath, reference.root.slice(0, 2), reference.root.slice(2));
  fs.appendFileSync(file, 'untracked change');
  assert.throws(() => store.load(reference), /Corrupt checkpoint block/);
  fs.rmSync(file);
  assert.throws(() => store.load(reference), /Missing checkpoint block/);
  assert.throws(() => store.load({ ...reference, root: '../bad' }), /Invalid checkpoint block reference/);
});

test('portable block recordings retain aggregate chunks and typed boundary state', t => {
  const store = studio.openCheckpointStore(directory(t));
  for (const [scene, from, end] of [[estuary, 21, 31], [estate, 13, 28]]) {
    const run = W.runtime.create(scene);
    run.advance(from);
    const saved = store.load(store.save(run.checkpoint()).reference);
    run.advance(end);
    const continuation = W.runtime.create(saved.world, { checkpoint: saved });
    continuation.advance(end);
    assert(W.data.equal(continuation.checkpoint(), run.checkpoint()));
    const log = store.load(store.save(run.recording()).reference);
    assert(W.data.equal(W.runtime.replay(log).checkpoint(), run.checkpoint()));
  }
});

test('CLI forks a referenced checkpoint, replays it, and writes a standalone checkpoint on request', t => {
  const dir = directory(t), repo = path.join(__dirname, '..');
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(repo, 'cli/ink-studio.js'), ...args, '--json'],
    { cwd: dir, encoding: 'utf8' }));
  fs.mkdirSync(path.join(dir, 'branches'));
  const scene = path.join(repo, 'examples/world-checkpoint-branch.js');
  const first = cli('sim', 'run', scene, '--ticks', '0', '--checkpoint', 'start.json', '--checkpoint-store', './blocks');
  assert(first.storage.checkpoint.writtenBlocks > 40);
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify([gate(1, 1)]));
  const branch = cli('sim', 'fork', 'start.json', '--ticks', '2', '--actions', 'gate.json',
    '--checkpoint', 'branches/end.json', '--record', 'branches/experiment.json');
  assert(branch.storage.checkpoint.reusedBytes > branch.storage.checkpoint.writtenBytes);
  const report = cli('sim', 'replay', 'branches/experiment.json', '--checkpoint', 'plain.json', '--checkpoint-store', 'off');
  assert.equal(report.tick, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'plain.json'))).format, 'ink-studio/checkpoint');
  assert.deepEqual(cli('sim', 'diff', 'branches/end.json', 'plain.json').edits, []);
  assert(cli('probe', 'branches/end.json', '--field', 'canal/mass').value.volume > 0);
  assert.equal(cli('validate', 'branches/experiment.json').valid, true);
});
