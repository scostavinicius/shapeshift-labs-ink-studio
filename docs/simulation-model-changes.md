# Change a model during playback

Sample-rate models can ramp a numeric control and switch to a rebuilt topology
on the same playback clock. Use `KIT.world.modelChanges.create(plan)` in a host
or `ink-studio sim model-changes` for headless inspection and playback. A plan
runs one prepared block kernel at a time, with two running during a crossfade.
All variants use the same `dt`. Follow the [prepared kernel guide](simulation-prepared-processing.md)
to register a kernel and allocate its buffers.

## Author a plan

A version 1 plan has an ID, an initial variant, pinned model definitions,
named output buffers and optional parameter lanes and changes.

```json
{
  "format": "ink-studio/simulation-model-changes",
  "version": 1,
  "id": "tube-workbench",
  "initial": "tube",
  "variants": {
    "tube": { "file": "tube.model.json", "revision": 1 },
    "fork": { "file": "fork.model.json", "revision": 1 }
  },
  "parameters": { "bore": { "buffer": "bore", "min": 0.2, "max": 1 } },
  "outputs": { "audio": "wave" },
  "changes": [
    { "type": "parameter", "parameter": "bore", "sample": 21600, "value": 0.28, "duration": 24000, "curve": "smoothstep" },
    { "type": "swap", "variant": "fork", "sample": 64800, "policy": "crossfade", "duration": 8400 }
  ]
}
```

The CLI resolves relative model files and checks their revisions. Library callers
supply embedded simulation model assets for the variants.

- Each parameter lane names a numeric model input alias and an `input` buffer
  allocated by the kernel. The kernel reads local indices `0 … end-start-1`
  from that buffer. The lane starts at the port default, which must agree across
  variants along with its quantity metadata and buffer type. Bounds are optional
  and expressed in the port's units. Author buffered controls on the plan.
  Ordinary model commands for other inputs run on each activation's local clock.
- Every published output names an `output` buffer the kernel fills with finite
  values on each block. Input and output buffers must be floating point and
  large enough for the variant's effective block size. Give matching output
  buffers the same physical meaning across variants.
- A change acts before its 0-based `sample` is evaluated. A positive parameter
  `duration` puts the starting value at `sample` and the target at
  `sample + duration`. Use `linear` (the default) or `smoothstep`. A zero
  duration applies a step. A new ramp starts from the sampled value of the
  previous ramp, including when it interrupts that ramp.

## Pick a topology policy

Each activation has an independently prepared kernel and a local sample clock
that starts at zero. Global parameter lanes keep their position when a kernel
changes. The host rebuilds each target when it queues the swap. Processing uses
preallocated buffers and splits at the declared boundary.

| Policy | Behaviour |
| --- | --- |
| `reset` | Activate the target with its initialized state. |
| `remap` | Copy selected spans of persistent typed state before the first target sample. Other state keeps its initialized values. |
| `crossfade` | Run both kernels for the specified positive `duration` and linearly blend the published samples. The first sample has incoming weight zero. Incoming weight reaches one at `sample + duration`. The target's own state continues afterward. |

For `remap`, supply a `mapping` array. Each row specifies `from` and `to`
state buffer names, element offsets `source` and `target` (default 0), and a
positive `count`. Buffer types must match and destination spans must be
disjoint. Choose spans according to the model's physical meaning. For example,
carry pressure and velocity on unchanged branches plus oscillator phase, then
let newly added branches start at their prepared values. A crossfade mixes
observations and advances each topology with its own state. Topology swaps are
queued in increasing order and crossfades cannot overlap.

## Drive it from a host

```js
const playback = KIT.world.modelChanges.create(plan, {
  onBlock(start, end, buffers) {
    sendSamples(buffers.audio, end - start);
  }
});

playback.process(128);
const at = playback.cursor();
playback.schedule({
  type: 'parameter', parameter: 'bore', sample: at, value: 0.5, duration: 2400
});
playback.schedule({
  type: 'swap', variant: 'my-edit', model: rebuiltModel,
  sample: at + 4800, policy: 'crossfade', duration: 960
});
playback.process(128);
```

Schedule edits between processing calls. A live parameter change can run before
later authored keys, with one change per lane per sample. A swap can select a
named variant or supply a rebuilt embedded model. The `onBlock` callback sees
reused buffers and a status of `ok` or `deadline`. Copy any prefix you need
to retain before the next block. If one kernel in a crossfade throws or exceeds
its work budget, the playback position and both persistent states remain at the
start of that block.

`playback.inspect()` reports the current variant, next sample's parameter
values, latest output levels and prepared buffer and work estimates. A
checkpoint captures queued live edits, the sample cursor, the active kernel,
and the outgoing kernel during a fade. Pass it to
`modelChanges.create(plan, { checkpoint })` with the same plan. Checkpointing
and preparation are host operations and can run between playback callbacks.

## Run the tube demo

```sh
cd examples/simulation-model-changes
node ../../cli/ink-studio.js sim model-changes tube.changes.json
node ../../cli/ink-studio.js sim model-changes tube.changes.json --samples 69000 --checkpoint resume.json
node ../../cli/ink-studio.js sim model-changes tube.changes.json --samples 144000 --resume resume.json
node demo.cjs /tmp/ink-model-changes
```

`--samples` sets the target sample cursor. Add `--checkpoint-store DIR` to
store checkpoint blocks by content hash. The demo writes two WAVs and a
timeline board. Both runs use the same resonator layouts and change times.
The controlled run narrows the bore over 500 ms, adds a fork over 175 ms, then
maps seven persistent values into a different branch layout. The hard-switch
run steps the bore and uses reset at both boundaries. The demo also verifies a
mid-fade checkpoint against uninterrupted playback with different block sizes.
