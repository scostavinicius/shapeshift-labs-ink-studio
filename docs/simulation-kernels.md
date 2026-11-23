# Creator-authored simulation kernels

Register a synchronous JavaScript kernel through `KIT.world.kernels`.
Each prepared instance owns its working memory. Its typed buffers cross
the world, graph, and checkpoint boundaries as portable snapshots.

The [damped spring](../examples/simulation-kernels/damped-spring.cjs) shows
the complete contract. It publishes displacement, velocity, energy, and
zero crossings from a `Float64Array` and a `Uint32Array`.

## Register and run

```js
const { KIT: K } = require('@shapeshift-labs/ink-studio').load();
const W = K.world;
const node = W.kernels.register('integrator', {
  revision: 1,
  description: 'Integrate a constant input over the clock.',
  inputs: { velocity: 'number' },
  outputs: { position: 'number' },
  prepare({ initial = 0 }) {
    const state = new Float64Array(1);
    const output = () => ({ position: state[0] });
    return {
      reset() {
        state[0] = initial;
        return output();
      },
      advance({ dt, input }) {
        state[0] += input.velocity * dt;
        return output();
      },
      snapshot() {
        return { buffers: { state } };
      },
      restore({ buffers }) {
        state.set(buffers.state);
      }
    };
  },
  example: {
    clock: { dt: 0.01, tick: 4 },
    commands: [{ tick: 1, input: 'velocity', value: 2 }]
  }
});

const run = W.kernels.prepare('integrator', 1, { initial: 1 }, { dt: 0.01 });
run.advance({ input: { velocity: 2 } });
const saved = JSON.parse(JSON.stringify(run.snapshot()));
run.reset();
run.restore(saved);
```

`register` returns the graph operation ID. `prepare(kind, revision, config,
settings)` returns a ready-to-use instance with `advance`, `reset`,
`snapshot`, and `restore`. Optional settings set the instance `id`,
integer `seed`, and fixed `dt` in seconds.

| Author method | Contract |
| --- | --- |
| `prepare(config, { id, seed, dt })` | Allocate working memory for one instance and return the four methods below. `config` is immutable JSON. |
| `reset()` | Restore the initial condition and return the complete named output record at tick zero. |
| `advance({ tick, time, dt, input, random, ... })` | Move the state by one host step and return all named outputs. Time is in seconds. Worlds also provide their usual step context, including any substep timing. Direct calls default to the next step at the prepared timestep. |
| `snapshot()` | Return `{ buffers, data? }`. All state needed by the next step belongs in the named typed arrays or optional finite JSON data. |
| `restore({ buffers, data })` | Restore the complete state from detached copies of the saved buffers and JSON data. |

Declare ports with the existing world shapes `number`, `bool`, `vec3`,
`record`, and `event`. A descriptor can specify its default, description,
and [physical quantity](physical-ports.md). Named outputs must match
their declared types.

A snapshot preserves buffer type, length, and little-endian bytes even
after a JSON round trip. Use integer or floating-point typed arrays up
to 64 named buffers and 8 MiB of total typed state per instance. Keep
the layout fixed and float contents finite. The envelope pins the kernel
revision, config, instance ID, seed, and timestep. The runtime restores
committed state if an advance fails and verifies that a restored
snapshot round-trips through the kernel.

## Use a registered kernel in a world, model, or graph

Register kernels from the existing `load` hook in
`ink-studio.config.js`, as the [example project](../examples/simulation-kernels/ink-studio.config.js)
does. JSON documents refer to installed kinds and revisions. Load the
same revision in any host that opens a checkpoint or bundled take.
Kernels execute synchronously in their host and participate in the
ordinary fixed-tick model runtime.

In a model, pin an operator with a record such as
`{ "kind": "integrator", "revision": 1, "config": { "initial": 1 } }`.
In a native world, use `operatorRevision` in the system record.
Existing model inputs, outputs, and [module instances](simulation-modules.md)
apply to the kernel's named ports.

`graph nodes` lists loaded kernels, and
`graph describe kernel.integrator.v1` shows its socket metadata and
exports the runnable example when the registration supplies one.
Generated nodes use `kernel.<kind>.v<revision>`. They expose the kernel's
named outputs and a `checkpoint` port. Supply `config`, an authored
`commands` schedule, and optional `clock` settings. The node seeks to
the graph or take time unless `clock.tick` selects a model tick. A supplied
world checkpoint must match the configuration, clock, and authored
input schedule. Publish changes to the solver as a new revision.

Use the optional `estimate(config, { id, seed, dt })` registration callback
to describe workspace size or named work per step in the
[execution plan](simulation-execution-plan.md#interpret-the-estimates).
Ink obtains the typed state size from the checkpoint buffers.

For audio-rate and other sample-heavy models, optionally register an
[`advanceBlock` kernel](simulation-blocks.md) with a preallocated sample loop.

For browser or budgeted block playback, [prepared processing](simulation-prepared-processing.md)
adds capacity-aware allocation and a reusable processor.

## Checkpoint demo

```sh
cd examples/simulation-kernels
node ../../cli/ink-studio.js graph describe kernel.damped-spring.v1 --example > spring.graph.json
node ../../cli/ink-studio.js graph run spring.graph.json
node ../../cli/ink-studio.js sim run spring.model.json --ticks 95 --checkpoint spring.checkpoint.json
node ../../cli/ink-studio.js sim resume spring.checkpoint.json --ticks 300
node demo.cjs demo-output
```

The demo compares uninterrupted motion with a fresh run restored at
0.95 seconds. It exports the animation, a still, the actual saved
checkpoint, and a JSON report. The graph node resumes from the same
checkpoint and reproduces the final position.

For continuous state vectors, [general state integrators](state-integrators.md)
provide prepared solvers, checkpointable error control, and substep event detection.
