# Run sample-rate simulation blocks

A model with `numerics.blockSize` can process a range of integer sample
indices in one creator kernel call. The kernel operates on the typed buffers
it allocated during `prepare`. Ink publishes the final outputs and saves
one portable kernel state at the end of the block. A model ticking at
96 kHz can run 1,600 samples beneath each tick of a 60 Hz world.

## Author a block kernel

Set `block: true` in [the kernel registration](simulation-kernels.md) and
return `advanceBlock({start, end, dt, input, randomAt})` from `prepare`.
Keep the existing single-step and checkpoint methods so the same
registration can also be used by ordinary models.

- `start` and `end` are zero-based indices. Process `start` through
  `end - 1`. The corresponding simulation tick for index `i` is `i + 1`.
  On success the checkpoint is at tick `end`.
- `dt` is the fixed sample duration. Input levels are held for this
  range. `randomAt(i, key)` uses the same seeded sample and key as
  `random(key)` at tick `i + 1`.
- Allocate persistent state and scratch buffers in `prepare`. Reuse them
  inside the sample loop and return the named output record at the end.
  State and outputs at a given sample must agree across different block
  partitions. Include every persistent buffer in the kernel snapshot.
- Use level inputs. Event outputs can report
  [occurrences inside the block](simulation-timed-events.md#stamp-an-event).
  If solvers exchange data at every sample, compose
  their update inside a single block kernel. An ordinary world can
  connect several block models at their published boundaries.

Set `numerics` to
`{ "dt": 0.000010416666666666666, "blockSize": 1600 }` for a 96 kHz model.
A block model contains one block kernel on the model clock with no inner
connections or system contracts. The block size is a cap of 1 to 65,536
samples. The generated graph operation also accepts `clock.blockSize`
for block-capable registrations.

For direct execution, use `W.kernels.prepare(kind, revision, config,
{dt})`, then `run.advanceBlock({start, end, input})`. Omit `start` to
continue from the saved sample count. An empty range leaves the state
untouched. Failed blocks roll back their typed state.

## Use a block model inside a world

Embed it through an ordinary versioned simulation module. Connected or
explicitly driven level inputs are held through the child samples covered
by each host visit. These inputs take precedence over the child's authored
commands on driven ports. The runtime splits at scheduled command ticks,
requested endpoints, and the configured cap. Child checkpoints retain
ordinary integer ticks and can be saved, replayed, or inspected.

Standalone `advance` and `advanceAsync` use blocks when the run only needs
endpoint publication. Per-tick callbacks, traces, and evidence collection
retain the individual tick boundaries. A standalone world event still
runs through the regular tick at its authored sample. Outer world
observers can still see every host tick while child modules run blocks.

`sim plan` shows the cap in the model's execution plan and the nested
clock ratio in its parent's. For a standalone block run,
`sim run --profile` reports logical sample calls, block calls, and
samples handled by blocks. Timings vary with the kernel and machine.
[Prepared processors](simulation-prepared-processing.md) can further
limit the block size based on the compiled model's work budget.
Use [`sim block-check`](simulation-block-independence.md) to compare
different request sizes and browser traces on the same authored timeline.

[Fast playback checkpoints](simulation-fast-checkpoints.md) preserve the
sample cursor, persistent buffers, input timeline and unread block events.

## Resonator demo

```sh
cd examples/simulation-blocks
node ../../cli/ink-studio.js sim plan bench.world.json
node ../../cli/ink-studio.js sim run bench.world.json --ticks 12
node ../../cli/ink-studio.js sim run resonator.model.json --ticks 3200 --profile
node demo.cjs demo-output
```

The demo compares a damped resonator running as a 96 kHz module in a
60 Hz host with the scalar version of the same module. It checks every
output sample and the final typed kernel state, and exports the plan,
checkpoint, observed snapshot counts and timings, and a waveform board.
