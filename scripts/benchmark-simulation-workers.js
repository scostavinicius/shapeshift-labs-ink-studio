#!/usr/bin/env node
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const studio = require('..');
const { KIT: { world: W } } = studio.load();

const counts = [0, 1, 8], trials = 3, ticks = 18;
const pools = new Map([1, 8].map(count => [count, studio.createSimulationWorkers(count)]));
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

function bench(id, width, height, cell, dt) {
  const systems = Object.fromEntries(Array.from({ length: 8 }, (_, i) => {
    const origin = [i * 24, 0];
    return ['pond-' + i, { kind: 'water', config: { width, height, cell, origin,
      initial: [{ bounds: {
        min: origin, max: [origin[0] + width * cell * 0.59, height * cell * 0.91]
      }, value: 0.65 + i * 0.025 }]
    } }];
  }));
  const world = { id, dt, systems, simulationChunks: {
    grid: { size: 24 },
    levels: [{ id: 'active', within: 200, every: 1 }, { id: 'sleep', sleep: true }],
    chunks: Object.fromEntries(Object.keys(systems).map((key, i) => [key, { index: [i, 0], systems: [key] }])),
    focus: { observer: { at: [8, 0, 8] } }
  } };
  const timing = new Map(counts.map(count => [count, []]));
  const peaks = new Map();
  let hash;
  for (let trial = 0; trial < trials; trial++) {
    for (let i = 0; i < counts.length; i++) {
      const count = counts[(i + trial) % counts.length];
      const run = W.runtime.create(world, { workerPool: pools.get(count) });
      run.advance(8);
      const start = performance.now();
      run.advance(8 + ticks);
      timing.get(count).push((performance.now() - start) / ticks);
      const actual = createHash('sha256').update(JSON.stringify(run.checkpoint())).digest('hex');
      hash ??= actual;
      assert.equal(actual, hash);
      const { peakWorkers, systems: partitioned } = run.partitions();
      if (count) assert(Object.values(partitioned).length === 8 && Object.values(partitioned).every(n => n === 8 + ticks));
      peaks.set(count, peakWorkers);
      assert.equal(peakWorkers, count);
    }
  }
  return { id, chunks: 8, cellsPerChunk: width * height, ticks, trials, checkpointSHA256: hash,
    runs: counts.map(workers => ({ workers, peakWorkers: peaks.get(workers),
      medianMsPerTick: median(timing.get(workers)), trialsMsPerTick: timing.get(workers) })) };
}

try {
  console.log(JSON.stringify({
    machine: { cpu: os.cpus()[0]?.model, node: process.version,
      availableParallelism: os.availableParallelism?.() ?? os.cpus().length },
    cases: [bench('small-ponds', 24, 16, 0.5, 0.06), bench('large-ponds', 80, 64, 0.25, 0.15)]
  }, null, 2));
} finally {
  for (const pool of pools.values()) pool.close();
}
