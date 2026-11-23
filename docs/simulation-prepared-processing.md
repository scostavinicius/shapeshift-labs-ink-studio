# Prepare a simulation kernel for playback

Opt into prepared processing when a fixed-rate kernel runs repeatedly in a
browser or another host with a block budget. Ink calls the registration's
`prepare` once per instance. Build the topology, allocate typed memory, and
fill lookup tables there. The prepared `process` hook runs on that memory.

```js
W.kernels.register('prepared-integrator', {
  inputs: { velocity: 'number' },
  outputs: { position: 'number' },
  processing: { maxSamples: 128, maxWork: 128, maxBytes: 16, deadlineMs: 2 },
  prepare(config, { allocate }) {
    const state = allocate('position', 'Float64Array', 1, 'state');
    return {
      workPerSample: 1,
      process({ start, end, dt, input, output }) {
        for (let sample = start; sample < end; sample++)
          state[0] += input.velocity * dt;
        output.position = state[0];
      }
    };
  }
});
```

A prepared registration provides a synchronous `process` hook and
nonnegative integer `workPerSample` and optional `workPerBlock` counts.
It can also provide `reset(output)`. Scalar number and Boolean ports
carry levels. Read or write sample arrays through the buffers allocated
during preparation. The ordinary kernel adapter supplies the single-step,
block, and snapshot methods for models and graphs.

## Capacity and processing

| Setting | Meaning |
| --- | --- |
| `maxSamples` | Hard limit on the samples requested by one call. |
| `maxWork` | Hard limit in kernel-defined units. Ink admits only blocks whose prepared work estimate fits. |
| `maxBytes` | Hard limit on tracked typed allocations, including the rollback copies for state and output buffers. |
| `deadlineMs` | Optional wall-clock measurement threshold for admitted work. An overrun is recorded after the callback returns. |

Use `allocate(name, type, length, role)` during preparation. The role
can be `state`, `table`, `scratch`, `input`, or `output`. State persists
across blocks and goes in portable snapshots. Keep tables read-only after
preparation. Scratch is temporary. Input and output buffers are exposed
as borrowed typed views on the processor. Consume them in place or copy
the samples needed by the playback host. Keep their backing storage
attached to the processor.

```js
const session = W.kernels.prepare('prepared-integrator', 1, {}, { dt: 1 / 48000 });
const { processor } = session;
processor.input.velocity = 0.75;
const status = processor.process(96);
const position = processor.output.position;
const report = processor.report();
const checkpoint = processor.snapshot();
```

`process(count)` passes the same context and buffers to the hook for
each call. The range `[start, end)` uses absolute integer sample indices.
Write every scalar summary output and return `undefined`. An optional
`randomAt(sample, stream)` gives partition-stable random values for an
integer stream ID. Use `charge(units)` before data-dependent work beyond
the prepared estimate. A refused charge rolls back the block. The hook
should return promptly when a charge is refused.

A rejected block returns `sample-capacity` or `work-capacity`. It keeps
the cursor, state, summary outputs, and output buffers from the last
completed block. Callback faults also restore those buffers and propagate
the error. `ok` and `deadline` commit their output. Use the deadline
counter to tune the kernel or adapt a playback scheduler. Ink enforces
its admitted work and tracked buffer limits. Author code is responsible
for its loop bounds and any additional JavaScript allocations. The host
cannot interrupt a synchronous JavaScript callback at a deadline.

The processor reuses its context and allocated buffers on the successful
processing path. Snapshot serialization, restore, and report construction
are separate calls. Checkpoints retain kernel state, scalar outputs, and
the sample cursor. Input, scratch, and output sample views and measured
counters belong to the current processor. Prepare lookup tables again
when opening a checkpoint.

## Inspect in the CLI

`sim plan` reports the prepared capacity, typed buffer layout and work
estimate. A block-enabled model splits its requested ranges at the smaller
of its authored block size and the compiled processing limit. Prepared
kernels run on a fixed sample clock. A parent world can embed the model
at a different rate using the ordinary block executor.

`sim run --profile` includes the processor's measured time, hard capacity
rejections, deadline overruns and faults, including processors inside
modules. The browser uses the same `processor.report()` API. Host-local
measurements are outside deterministic replay. [Block review](simulation-block-independence.md)
compares live and offline sample traces with exact or explicitly tolerated numerical differences.

[Measured simulation budgets](simulation-performance-budgets.md) add host timing distributions, queue high-water, and deadline checks across world steps and playback requests.

## Vent network demo

```sh
cd examples/simulation-prepared
node ../../cli/ink-studio.js sim plan vent.model.json
node ../../cli/ink-studio.js sim run vent.model.json --ticks 288 --profile
node demo.cjs demo-output
```

Open the generated `prepared-playback.html` in a browser. The 48 kHz
processor prepares six cells and six links and reserves 1,496 typed bytes.
Its work budget admits 96 samples. A 128-sample request fails the work
check, and a 192-sample request fails the sample limit. The demo keeps
the previous waveform when a request is rejected.
