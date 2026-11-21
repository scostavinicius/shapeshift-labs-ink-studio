#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const studio = require('..');
const { KIT: { world: W } } = studio.load();
const scene = require('../examples/world-checkpoint-branch.js');

const run = W.runtime.create(scene);
const initial = run.checkpoint();
const portable = JSON.parse(JSON.stringify(initial));
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
function perCall(fn, iterations) {
  fn();
  return median(Array.from({ length: 5 }, () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    return (performance.now() - start) / iterations;
  }));
}
const fork = () => assert.equal(run.fork().checkpoint(), initial);
const loaded = () => W.runtime.create(portable.world, { checkpoint: portable, validated: true });
assert(W.data.equal(loaded().checkpoint(), initial));
const forkMs = perCall(fork, 40);
const restoreMs = perCall(loaded, 3);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-checkpoint-bench-'));

try {
  const store = studio.openCheckpointStore(directory);
  const record = (name, document) => {
    const { reference, ...stats } = store.save(document);
    assert(W.data.equal(store.load(reference), document));
    return { name, ...stats, referenceBytes: Buffer.byteLength(JSON.stringify(reference)),
      standaloneBytes: Buffer.byteLength(JSON.stringify(document)) };
  };
  const base = record('start', initial);
  const baseline = run.fork(), experiment = run.fork();
  experiment.schedule([{ tick: 1, action: 'canal/gate', args: { gate: 'sluice', opening: 1 } }]);
  baseline.advance(4);
  experiment.advance(4);
  const baselineSnapshot = baseline.checkpoint(), experimentSnapshot = experiment.checkpoint();
  assert.equal(experimentSnapshot.states.canal.fluid.bed, initial.states.canal.fluid.bed);
  assert.equal(experimentSnapshot.world.entities, initial.world.entities);
  const closed = record('gate-closed', baselineSnapshot);
  const opened = record('gate-open', experimentSnapshot);
  const log = record('gate-open recording', experiment.recording());
  const depth = branch => branch.view().signals['canal/depth.outlet'];
  assert(depth(experiment) > depth(baseline));
  console.log(JSON.stringify({
    machine: { cpu: os.cpus()[0]?.model, node: process.version },
    cells: initial.states.canal.fluid.bed.length, entities: Object.keys(initial.world.entities).length,
    medianMs: { liveFork: forkMs, restoreFromParsedCheckpoint: restoreMs },
    storage: [base, closed, opened, log], downstreamDepth: { closed: depth(baseline), open: depth(experiment) },
    sharedInMemory: { originalCheckpoint: true, terrain: true, entities: true }
  }, null, 2));
} finally {
  fs.rmSync(directory, { force: true, recursive: true });
}
